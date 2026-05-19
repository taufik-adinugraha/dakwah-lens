"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { logAdminAction } from "@/lib/admin-log";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { requireSuperadmin } from "@/lib/superadmin";
import { TERMS_VERSION } from "@/lib/terms-version";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

async function loadFollowupPending(id: string) {
  const [row] = await db
    .select()
    .from(schema.adminFollowups)
    .where(
      and(
        eq(schema.adminFollowups.id, id),
        eq(schema.adminFollowups.status, "pending"),
      ),
    )
    .limit(1);
  if (!row) throw new Error("followup_not_found_or_completed");
  return row;
}

/**
 * Send the terms-update notice to all approved users with a verified
 * email. Iterates sequentially — Resend's free tier rate-limits to 2
 * requests/second, and at our scale (sub-thousand users) the loop
 * finishes well inside a server-action timeout. If you outgrow that,
 * batch via a Celery task instead of in-process here.
 */
export async function sendTermsEmailBlastAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();
  const id = formData.get("followup_id")?.toString();
  // HTML maxLength on the textarea is decorative — the real cap lives
  // here. Subject mirrors RFC 5322's practical limit (Resend rejects
  // anything over ~700 chars); body cap matches the contact form for
  // consistency and prevents a 10MB paste from blowing up the HTML
  // wrapper / per-recipient send.
  const subject = formData.get("subject")?.toString().trim().slice(0, 160);
  const bodyText = formData.get("body_text")?.toString().trim().slice(0, 5000);
  if (!id || !subject || !bodyText) {
    throw new Error("missing_fields");
  }
  const followup = await loadFollowupPending(id);
  if (followup.kind !== "terms_email_blast") {
    throw new Error("wrong_followup_kind");
  }

  // Approved users get the notice. We don't filter on emailVerified
  // because Google-OAuth users land approved without that flag set;
  // their email-on-file is the address provider returned, which is the
  // address they signed in with. Filter only obviously-empty rows.
  const recipients = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.status, "approved"));
  const verifiedRecipients = recipients.filter((r) => r.email);

  const termsLink = appUrl("/terms");
  const html = bodyToHtml(bodyText, termsLink);
  const textWithLink = `${bodyText}\n\n${termsLink}`;

  let sent = 0;
  let failed = 0;
  for (const r of verifiedRecipients) {
    const res = await sendEmail({
      to: r.email,
      subject,
      html,
      text: textWithLink,
    });
    if (res.ok) sent += 1;
    else failed += 1;
  }

  await db
    .update(schema.adminFollowups)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedBy: session.user.id,
      payload: {
        ...(followup.payload ?? {}),
        sent,
        failed,
        recipients: verifiedRecipients.length,
        subject,
      },
    })
    .where(eq(schema.adminFollowups.id, id));

  await logAdminAction({
    actorId: session.user.id,
    action: "followup.email_blast",
    targetType: "admin_followup",
    targetId: id,
    payload: {
      subject,
      sent,
      failed,
      recipients: verifiedRecipients.length,
    },
  });

  revalidatePath("/admin/system/followups");
  revalidatePath("/admin/system");
}

/**
 * Post the 14-day in-app banner. Bilingual message required so we can
 * render the right copy per locale without falling back to one.
 */
export async function postTermsBannerAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();
  const id = formData.get("followup_id")?.toString();
  const messageEn = formData
    .get("message_en")
    ?.toString()
    .trim()
    .slice(0, 300);
  const messageId = formData
    .get("message_id")
    ?.toString()
    .trim()
    .slice(0, 300);
  if (!id || !messageEn || !messageId) {
    throw new Error("missing_fields");
  }
  const followup = await loadFollowupPending(id);
  if (followup.kind !== "terms_banner_post") {
    throw new Error("wrong_followup_kind");
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + FOURTEEN_DAYS_MS);

  const [notice] = await db
    .insert(schema.appNotices)
    .values({
      kind: "terms_update",
      messageEn,
      messageId,
      severity: "info",
      startsAt: now,
      endsAt,
    })
    .returning({ id: schema.appNotices.id });

  await db
    .update(schema.adminFollowups)
    .set({
      status: "completed",
      completedAt: new Date(),
      completedBy: session.user.id,
      payload: {
        ...(followup.payload ?? {}),
        notice_id: notice?.id,
        starts_at: now.toISOString(),
        ends_at: endsAt.toISOString(),
      },
    })
    .where(eq(schema.adminFollowups.id, id));

  await logAdminAction({
    actorId: session.user.id,
    action: "followup.banner_post",
    targetType: "admin_followup",
    targetId: id,
    payload: {
      notice_id: notice?.id,
      message_en: messageEn,
      message_id: messageId,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    },
  });

  revalidatePath("/admin/system/followups");
  revalidatePath("/admin/system");
  // Banner renders in the root layout — bust the whole tree.
  revalidatePath("/", "layout");
}

/** Mark a follow-up dismissed without acting on it. Use sparingly: this
 *  exists for accidental constant bumps where no real notification is
 *  warranted. Records who dismissed it. */
export async function dismissFollowupAction(formData: FormData): Promise<void> {
  const session = await requireSuperadmin();
  const id = formData.get("followup_id")?.toString();
  if (!id) throw new Error("missing_fields");
  const followup = await loadFollowupPending(id);

  await db
    .update(schema.adminFollowups)
    .set({
      status: "dismissed",
      completedAt: new Date(),
      completedBy: session.user.id,
    })
    .where(eq(schema.adminFollowups.id, id));

  await logAdminAction({
    actorId: session.user.id,
    action: "followup.dismiss",
    targetType: "admin_followup",
    targetId: id,
    payload: { kind: followup.kind },
  });

  revalidatePath("/admin/system/followups");
  revalidatePath("/admin/system");
}

/** Wrap the admin's blast body in the shared email template. The textarea
 *  ships plain text — we escape it, then split on blank lines so each
 *  paragraph carries the template's paragraph styling. Single `\n` becomes
 *  a soft break inside the paragraph. */
function bodyToHtml(bodyText: string, termsLink: string): string {
  const escaped = bodyText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "<br>"));
  return renderEmail({
    heading: "Pembaruan Syarat & Ketentuan",
    paragraphs,
    cta: { label: "Baca ketentuan terbaru", url: termsLink },
    footerTagline: `terms version ${TERMS_VERSION}`,
  });
}

