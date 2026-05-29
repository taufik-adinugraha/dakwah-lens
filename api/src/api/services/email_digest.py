"""Weekly email digest — send the AI-narrated insights briefing to
opted-in users.

Runs Thursday 18:00 WIB via Celery beat — same day as the briefing
publish (Thursday 05:00 WIB). Pulls the most-recent
`insights_summaries` row and emails
it to every user with `email_digest_opt_in = true`. Each email
includes a one-click unsubscribe link tied to the user's
`digest_unsubscribe_token`.

Sender: Resend HTTP API (same provider the web app uses for auth
emails). No need to share template code — we render plain HTML +
text in Python here.

Cost: free up to 3K emails/month on Resend's free tier.
"""

from __future__ import annotations

import os
import secrets
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from api.db import SessionLocal

log = structlog.get_logger()

RESEND_ENDPOINT = "https://api.resend.com/emails"


def _public_base_url() -> str:
    return (
        os.environ.get("NEXTAUTH_URL")
        or os.environ.get("PUBLIC_BASE_URL")
        or "https://dakwah-lens.id"
    ).rstrip("/")


def _from_address() -> str:
    return os.environ.get("EMAIL_FROM") or "Dakwah-Lens <noreply@dakwah-lens.id>"


async def send_weekly_digests() -> dict[str, Any]:
    """Send the latest insights briefing to every opted-in user.

    Idempotent in the sense that a re-run on the same day would resend
    — but the schedule is once-weekly. Skips if no summary has been
    generated yet (e.g. first week of operation before the daily LLM
    task has fired).
    """
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        log.warning("email_digest.no_resend_key")
        return {"skipped": "no_resend_key"}

    async with SessionLocal() as session:
        # Latest summary (one row).
        summary_row = (
            await session.execute(
                text(
                    """
                    SELECT summary_md, headline_stats, generated_at, period_start, period_end
                    FROM insights_summaries
                    ORDER BY generated_at DESC
                    LIMIT 1
                    """
                )
            )
        ).first()
        if summary_row is None:
            log.info("email_digest.no_summary_yet")
            return {"skipped": "no_summary"}

        # Users who opted in — also issue an unsubscribe token if they
        # don't have one yet (first-digest users).
        # No email_verified guard: NextAuth's DrizzleAdapter doesn't
        # populate users.email_verified for Google OAuth sign-ups, so
        # that column is NULL for the entire user base. The opt-in
        # toggle itself requires being signed in (Google has already
        # verified the address) so the extra guard was a no-op-or-
        # always-false depending on signup path.
        users = (
            await session.execute(
                text(
                    """
                    SELECT id, email, name, digest_unsubscribe_token
                    FROM users
                    WHERE email_digest_opt_in = true
                    """
                )
            )
        ).all()
        if not users:
            log.info("email_digest.no_opted_in_users")
            return {"sent": 0, "reason": "no_subscribers"}

        # Mint missing tokens in a single roundtrip.
        missing_token_ids: list[str] = []
        for u in users:
            if not u.digest_unsubscribe_token:
                missing_token_ids.append(str(u.id))
        if missing_token_ids:
            for uid in missing_token_ids:
                await session.execute(
                    text(
                        "UPDATE users SET digest_unsubscribe_token = :tok "
                        "WHERE id = :uid AND digest_unsubscribe_token IS NULL"
                    ),
                    {"tok": secrets.token_urlsafe(32), "uid": uid},
                )
            await session.commit()
            # Re-read so we have the fresh tokens.
            users = (
                await session.execute(
                    text(
                        """
                        SELECT id, email, name, digest_unsubscribe_token
                        FROM users
                        WHERE email_digest_opt_in = true
                        """
                    )
                )
            ).all()

    sent = 0
    failed = 0
    base = _public_base_url()
    summary_md = summary_row.summary_md
    stats = summary_row.headline_stats or {}

    async with httpx.AsyncClient(timeout=20.0) as client:
        for u in users:
            try:
                html = _render_html(
                    name=u.name or u.email,
                    summary_md=summary_md,
                    stats=stats,
                    unsubscribe_url=f"{base}/api/digest/unsubscribe?token={u.digest_unsubscribe_token}",
                    insights_url=f"{base}/insights",
                )
                plain = _render_text(
                    name=u.name or u.email,
                    summary_md=summary_md,
                    insights_url=f"{base}/insights",
                    unsubscribe_url=f"{base}/api/digest/unsubscribe?token={u.digest_unsubscribe_token}",
                )
                resp = await client.post(
                    RESEND_ENDPOINT,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": _from_address(),
                        "to": u.email,
                        "subject": "Dakwah-Lens · ringkasan minggu ini",
                        "html": html,
                        "text": plain,
                        "headers": {
                            "List-Unsubscribe": f"<{base}/api/digest/unsubscribe?token={u.digest_unsubscribe_token}>",
                            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                        },
                    },
                )
                if resp.status_code >= 400:
                    log.warning(
                        "email_digest.send_failed",
                        email=u.email,
                        status=resp.status_code,
                    )
                    failed += 1
                else:
                    sent += 1
            except Exception:
                log.exception("email_digest.send_exception", email=u.email)
                failed += 1

    log.info("email_digest.run_done", sent=sent, failed=failed, total=len(users))
    return {"sent": sent, "failed": failed, "total": len(users)}


def _render_html(
    *,
    name: str,
    summary_md: str,
    stats: dict[str, Any],
    unsubscribe_url: str,
    insights_url: str,
) -> str:
    """Bulletproof transactional email HTML — tables, inline styles,
    no fancy CSS. Renders consistently in Gmail/Outlook/Apple Mail."""
    sentiment = stats.get("sentiment") or {}
    top_cat = (stats.get("top_categories") or [{}])[0]
    top_topic = (stats.get("top_topics") or [{}])[0]

    pill_rows = []
    if sentiment.get("current_pct_negative") is not None:
        pill_rows.append(
            ("Nada negatif", f"{round(sentiment['current_pct_negative'])}%")
        )
    if top_cat.get("category"):
        pill_rows.append(
            (
                "Kategori utama",
                f"{top_cat['category']} ({round(top_cat.get('share_pct', 0))}%)",
            )
        )
    if top_topic.get("label"):
        pill_rows.append(("Topik utama", top_topic["label"]))

    pill_html = "".join(
        f"""<tr><td style="padding:6px 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em">{k}</td><td style="padding:6px 0;color:#0f172a;font-weight:600;text-align:right">{v}</td></tr>"""
        for k, v in pill_rows
    )

    summary_para = summary_md.replace("\n", "<br>")

    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.05);overflow:hidden">
      <tr><td style="padding:24px 28px 8px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#059669">Dakwah-Lens · ringkasan minggu ini</div>
      </td></tr>
      <tr><td style="padding:20px 28px 8px">
        <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.7">{summary_para}</p>
      </td></tr>
      <tr><td style="padding:8px 28px 20px">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;padding:14px 16px;background:#f1f5f9;border-radius:8px">
          {pill_html}
        </table>
      </td></tr>
      <tr><td style="padding:8px 28px 24px" align="center">
        <a href="{insights_url}" style="display:inline-block;padding:10px 18px;background:#0f172a;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:9999px">Buka /insights lengkap →</a>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.5">
        Anda menerima email ini karena berlangganan ringkasan mingguan Dakwah-Lens.
        <a href="{unsubscribe_url}" style="color:#64748b;text-decoration:underline">Berhenti berlangganan</a> kapan saja.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


def _render_text(
    *,
    name: str,
    summary_md: str,
    insights_url: str,
    unsubscribe_url: str,
) -> str:
    return (
        f"Dakwah-Lens · ringkasan minggu ini\n\n"
        f"{summary_md}\n\n"
        f"Lihat insights lengkap: {insights_url}\n\n"
        f"---\n"
        f"Berhenti berlangganan: {unsubscribe_url}\n"
    )
