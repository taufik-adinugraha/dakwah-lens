"use server";

import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Public contact form handler.
 *
 * Two concerns interleave here:
 *  - Persist the message (`contact_messages`) so the admin inbox has a
 *    durable record even if the forwarded email is lost.
 *  - Forward a copy to the admin's mailbox so they get notified live.
 *
 * Light abuse mitigation:
 *  - Honeypot field `_hp` — bots tend to fill every input; humans can't
 *    see it (CSS hidden in the form), so any non-empty value = drop.
 *  - Per-email rate limit: max 3 submissions per email per hour (DB).
 *  - Per-IP rate limit: max 10 submissions per IP per hour (in-memory).
 *    The IP is held in process memory only — never persisted, so the
 *    privacy policy's "we don't log IPs" still holds.
 *  - Length bounds on every text field.
 *
 * Deliberately no CAPTCHA — at prototype scale the honeypot + dual
 * rate limit is more than enough.
 */

const RATE_LIMIT_PER_EMAIL = 3;
const RATE_LIMIT_PER_IP = 10;
const RATE_WINDOW_HOURS = 1;
const RATE_WINDOW_MS = RATE_WINDOW_HOURS * 3600 * 1000;

const ContactSchema = z.object({
  name: z.string().trim().min(1, "error_name_required").max(120),
  email: z.string().trim().toLowerCase().email("error_invalid_email"),
  subject: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  message: z
    .string()
    .trim()
    .min(10, "error_message_too_short")
    .max(5000, "error_message_too_long"),
});

export type ContactResult =
  | { ok: true }
  | { ok: false; error: string };

export async function sendContactMessage(
  formData: FormData,
): Promise<ContactResult> {
  // Honeypot. The visible form never sets this; bots typically fill every
  // input they see.
  if (typeof formData.get("_hp") === "string" && formData.get("_hp")) {
    // Pretend success — don't tell the bot it was filtered.
    return { ok: true };
  }

  // Per-IP throttle. Runs before parsing so a flood of malformed payloads
  // from one source still gets throttled. Null = no proxy header (local
  // dev or misconfigured deployment); fall through rather than block.
  const ip = await getClientIp();
  if (ip) {
    const rl = checkRateLimit(`contact:${ip}`, RATE_LIMIT_PER_IP, RATE_WINDOW_MS);
    if (!rl.ok) {
      return { ok: false, error: "error_rate_limited" };
    }
  }

  const parsed = ContactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { name, email, subject, message } = parsed.data;

  // Per-email rate limit.
  const [{ recentN = 0 } = { recentN: 0 }] = await db
    .select({
      recentN: sql<number>`COUNT(*)::int`,
    })
    .from(schema.contactMessages)
    .where(
      and(
        eq(schema.contactMessages.email, email),
        gt(
          schema.contactMessages.receivedAt,
          new Date(Date.now() - RATE_WINDOW_HOURS * 3600 * 1000),
        ),
      ),
    );
  if (Number(recentN) >= RATE_LIMIT_PER_EMAIL) {
    return { ok: false, error: "error_rate_limited" };
  }

  // Persist first — even if email forwarding fails, the admin can see it
  // in /admin/system/inbox.
  await db.insert(schema.contactMessages).values({
    name,
    email,
    subject: subject ?? null,
    message,
  });

  // Forward a copy. ADMIN_EMAIL first, then SUPERADMIN_EMAIL. If neither
  // is set the email just doesn't ship — the inbox row is still there.
  const to = (
    process.env.ADMIN_EMAIL ||
    process.env.SUPERADMIN_EMAIL ||
    ""
  ).trim();
  if (to) {
    const inboxLink = appUrl("/admin/system/inbox");
    const safeSubject = subject ? subject : "(no subject)";
    await sendEmail({
      to,
      subject: `[Dakwah-Lens contact] ${safeSubject}`,
      text:
        `New message via the /contact form on Dakwah-Lens.\n\n` +
        `From: ${name} <${email}>\n` +
        `Subject: ${safeSubject}\n\n` +
        `${message}\n\n` +
        `— —\n` +
        `Reply by emailing ${email} directly.\n` +
        `Manage in the admin inbox: ${inboxLink}`,
      html: renderEmail({
        heading: `New message: ${escapeHtml(safeSubject)}`,
        paragraphs: [
          `<strong>From:</strong> ${escapeHtml(name)} &lt;<a href="mailto:${escapeHtml(email)}" style="color:#047857;">${escapeHtml(email)}</a>&gt;`,
          `<div style="margin-top:8px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.6;color:#0f172a;">${escapeHtml(message)}</div>`,
        ],
        cta: { label: "Open in admin inbox", url: inboxLink },
        footnote: `Reply by emailing <a href="mailto:${escapeHtml(email)}" style="color:#047857;">${escapeHtml(email)}</a> directly.`,
        footerTagline: "Forwarded from the public /contact form",
      }),
    });
  }

  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
