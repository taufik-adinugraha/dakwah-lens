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

/* ──────────────────────────────────────────────────────────────────
 * Shared HTML email template.
 *
 * One layout, every transactional email — verification, password reset,
 * contact-form forward, account removal, terms blast. Centralizing keeps
 * the brand consistent and the styling decisions in one place.
 *
 * Design constraints (these are why it looks the way it does):
 *  - Inline styles only. Many clients (Outlook, Yahoo) strip <style>.
 *  - Table-based layout. Gmail mobile + Outlook handle div+flex poorly.
 *  - System font stack. Web fonts in email = grey boxes on half of mail
 *    clients. Native fonts render everywhere.
 *  - 560px max width fits Gmail's preview pane without horizontal scroll
 *    and reads comfortably on phone.
 *  - Buttons are bulletproof-button pattern (table cell w/ background +
 *    padded anchor) so the colored background paints in Outlook too.
 * ────────────────────────────────────────────────────────────────── */

export type EmailLayout = {
  /** Big title at the top of the card. */
  heading: string;
  /** First-line greeting, often "Assalamu'alaykum". */
  greeting?: string;
  /** Body paragraphs. HTML allowed — escape user-supplied text yourself. */
  paragraphs: string[];
  /** Primary action button. The URL is also echoed in plain text below
   *  so it works even when the button image fails to render. */
  cta?: { label: string; url: string };
  /** Optional small note below the CTA. Good for "Link valid for 24h". */
  footnote?: string;
  /** Optional second block — used for the Indonesian/English mirror in
   *  bilingual emails (e.g. account removal notices). */
  secondary?: { heading?: string; paragraphs: string[] };
  /** Override the default footer tagline. */
  footerTagline?: string;
};

const BRAND_DARK = "#065f46"; // emerald-800
const BRAND = "#047857"; // emerald-700
const TEXT = "#0f172a"; // slate-900
const MUTED = "#475569"; // slate-600
const FAINT = "#94a3b8"; // slate-400
const BG = "#f8fafc"; // slate-50
const BORDER = "#e2e8f0"; // slate-200

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

function renderParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${MUTED};">${p}</p>`,
    )
    .join("");
}

export function renderEmail(layout: EmailLayout): string {
  const {
    heading,
    greeting,
    paragraphs,
    cta,
    footnote,
    secondary,
    footerTagline = "Platform media intelligence berbasis AI untuk para da'i di Indonesia",
  } = layout;

  const greetingHtml = greeting
    ? `<p style="margin:0 0 12px;font-size:15px;color:${TEXT};">${greeting}</p>`
    : "";

  const ctaHtml = cta
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td style="border-radius:9999px;background-color:${BRAND};">
              <a href="${cta.url}" style="display:inline-block;padding:12px 26px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:9999px;">${cta.label}</a>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 6px;font-size:12px;color:${FAINT};">Atau salin tautan ini:</p>
        <p style="margin:0 0 16px;font-size:12px;color:${MUTED};word-break:break-all;"><a href="${cta.url}" style="color:${BRAND};text-decoration:underline;">${cta.url}</a></p>
      `
    : "";

  const footnoteHtml = footnote
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.6;color:${FAINT};">${footnote}</p>`
    : "";

  const secondaryHtml = secondary
    ? `
        <hr style="border:0;border-top:1px solid ${BORDER};margin:28px 0;">
        ${
          secondary.heading
            ? `<p style="margin:0 0 12px;font-size:13px;font-weight:600;color:${TEXT};letter-spacing:0.02em;">${secondary.heading}</p>`
            : ""
        }
        ${renderParagraphs(secondary.paragraphs)}
      `
    : "";

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:${FONT_STACK};color:${TEXT};-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;border:1px solid ${BORDER};overflow:hidden;">
        <tr>
          <td style="background-color:${BRAND_DARK};padding:18px 28px;">
            <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Dakwah-Lens</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 28px;">
            ${greetingHtml}
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${TEXT};font-weight:700;letter-spacing:-0.01em;">${heading}</h1>
            ${renderParagraphs(paragraphs)}
            ${ctaHtml}
            ${footnoteHtml}
            ${secondaryHtml}
          </td>
        </tr>
        <tr>
          <td style="background-color:${BG};padding:16px 28px;border-top:1px solid ${BORDER};text-align:center;">
            <p style="margin:0;font-size:11px;color:${FAINT};font-weight:600;letter-spacing:0.04em;">Dakwah-Lens · Sukses &amp; Berkah Group</p>
            <p style="margin:4px 0 0;font-size:11px;color:${FAINT};line-height:1.5;">${footerTagline}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
