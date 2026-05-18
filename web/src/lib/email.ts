/**
 * Outbound email helper.
 *
 * Sender behavior is environment-driven:
 *  - With `RESEND_API_KEY` set → real email via Resend (https://resend.com)
 *  - Otherwise → log the payload to console so dev flows still work.
 *
 * Why this shape: most outbound mail at prototype scale is transactional
 * (verify, reset). Resend's free tier covers 3K/month — plenty. If you
 * later swap to SES / Mailgun / SMTP, only this file changes.
 */

import { recordUsage } from "@/lib/usage-log";

export type SendEmailInput = {
  to: string;
  subject: string;
  /** HTML body — links should be absolute URLs. */
  html: string;
  /** Plain-text body for clients that prefer it / Gmail's preview pane. */
  text: string;
};

/** Best-effort send. Never throws — auth flows shouldn't break because mail
 *  is misconfigured; the dev-mode console log is also the fallback if Resend
 *  errors out. The caller's responsibility is to keep the operation
 *  succeeding (e.g. signup) and surface a "check your email" hint. */
export async function sendEmail(input: SendEmailInput): Promise<{
  ok: boolean;
  provider: "resend" | "console";
}> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Dakwah-Lens <onboarding@resend.dev>";

  if (!apiKey) {
    // Dev / unconfigured mode — print the link inline so the developer can
    // copy it from the terminal during testing.
    console.log("\n[email] ─────────────────────────────────");
    console.log("[email] (RESEND_API_KEY not set — logging only)");
    console.log(`[email] To:      ${input.to}`);
    console.log(`[email] From:    ${from}`);
    console.log(`[email] Subject: ${input.subject}`);
    console.log("[email] ── Plain text ──");
    console.log(input.text);
    console.log("[email] ─────────────────────────────────\n");
    return { ok: true, provider: "console" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "(no body)");
      console.warn(`[email] Resend ${resp.status}: ${errText}`);
      return { ok: false, provider: "resend" };
    }
    // Resend free tier is ~$0; we record the call anyway for visibility.
    void recordUsage({
      provider: "resend",
      operation: "send_email",
      model: "resend",
      units: 1,
      costUsd: 0,
      meta: { subject: input.subject },
    });
    return { ok: true, provider: "resend" };
  } catch (err) {
    console.warn("[email] send failed:", err);
    return { ok: false, provider: "resend" };
  }
}

/** Build absolute URLs for links in emails. Prefer `NEXTAUTH_URL` so dev
 *  vs prod is consistent with the rest of the auth stack. */
export function appUrl(path: string): string {
  const base =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    process.env.AUTH_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
