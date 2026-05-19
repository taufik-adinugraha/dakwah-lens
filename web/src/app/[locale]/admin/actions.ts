"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { logAdminAction } from "@/lib/admin-log";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";

/** Throws Error so unauthorized attempts surface in dev tools / server logs. */
async function assertAdmin(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  const role = session?.user?.role;
  if (!id) throw new Error("auth_required");
  if (role !== "admin" && role !== "superadmin") {
    throw new Error("forbidden");
  }
  return id;
}

async function setUserStatus(
  targetId: string,
  status: "approved" | "rejected" | "blocked" | "pending",
  /** Audit-log namespace; pass the friendlier verb (e.g. `reinstate`
   *  rather than the resolved status `approved`) so the audit page
   *  reflects the admin's intent rather than the DB write. */
  action: "approve" | "reject" | "block" | "reinstate",
): Promise<void> {
  const selfId = await assertAdmin();

  // Don't let admins lock themselves out by mistake. UI also gates this.
  if (targetId === selfId && status !== "approved") return;

  // Pre-fetch the target email + name so the audit log entry
  // survives even if the user is later removed.
  const [target] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!target) return;

  await db
    .update(schema.users)
    .set({ status })
    .where(eq(schema.users.id, targetId));

  await logAdminAction({
    actorId: selfId,
    action: `user.${action}`,
    targetType: "user",
    targetId,
    payload: { email: target.email, name: target.name, new_status: status },
  });

  revalidatePath("/admin/users");
}

export async function approveUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "approved", "approve");
}

export async function rejectUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "rejected", "reject");
}

export async function blockUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "blocked", "block");
}

export async function reinstateUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "approved", "reinstate");
}

/* ───────────────────────────────────────────────────────────────
 * Role changes
 *
 * Rules (enforced server-side, not just in the UI):
 *  - Only superadmins can grant the `superadmin` role. Regular admins
 *    can promote users to admin but not above their own level —
 *    prevents an admin from privilege-escalating themselves to
 *    superadmin.
 *  - Nobody can change their own role. Use SQL or another superadmin.
 * ─────────────────────────────────────────────────────────────── */

async function setUserRole(
  targetId: string,
  role: "user" | "admin" | "superadmin",
): Promise<void> {
  const session = await auth();
  const selfId = session?.user?.id;
  const callerRole = session?.user?.role;
  if (!selfId) throw new Error("auth_required");
  if (callerRole !== "admin" && callerRole !== "superadmin") {
    throw new Error("forbidden");
  }
  if (targetId === selfId) {
    // Self role-change would let an admin escalate themselves; refuse.
    throw new Error("cannot_change_own_role");
  }
  if (role === "superadmin" && callerRole !== "superadmin") {
    throw new Error("only_superadmin_can_grant_superadmin");
  }

  // Pre-fetch for the audit row — we want both the email/name AND
  // the previous role so the log shows the full delta.
  const [target] = await db
    .select({
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!target) return;

  await db
    .update(schema.users)
    .set({ role, status: "approved" })
    .where(eq(schema.users.id, targetId));

  await logAdminAction({
    actorId: selfId,
    action: "user.role_change",
    targetType: "user",
    targetId,
    payload: {
      email: target.email,
      name: target.name,
      from: target.role,
      to: role,
    },
  });

  revalidatePath("/admin/users");
}

export async function promoteToAdminAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserRole(id, "admin");
}

export async function promoteToSuperadminAction(
  formData: FormData,
): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserRole(id, "superadmin");
}

export async function demoteToUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserRole(id, "user");
}

/* ───────────────────────────────────────────────────────────────
 * Permanent removal
 *
 * Hard-deletes the user row. The FK chain (accounts.userId,
 * sessions.userId, briefs.userId, etc.) is configured with
 * onDelete: "cascade", so the user's OAuth links, active sessions,
 * and generated briefs all go with them. Notifies the user by email
 * before the delete fires so the address is still readable.
 *
 * Use sparingly — block (reversible) or reject (status flip) is
 * almost always the right choice. Reach for this when the row truly
 * needs to be gone (spam signup confirmed, hard data-removal request,
 * etc.).
 * ─────────────────────────────────────────────────────────────── */

export async function removeUserAction(formData: FormData): Promise<void> {
  const selfId = await assertAdmin();
  const id = formData.get("user_id")?.toString();
  if (!id) return;

  // Don't let an admin delete themselves — they'd lose all access in
  // the same transaction. UI also disables this for the self row.
  if (id === selfId) {
    throw new Error("cannot_remove_self");
  }

  // Read the user FIRST so we have the email + name for the
  // notification. If the row is gone, there's nothing to notify.
  const [target] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);

  if (!target) return; // already gone — idempotent

  // Best-effort notification. Failures don't block the delete — the
  // sendEmail helper itself never throws (falls back to console log
  // in dev) so this is just defensive structure.
  try {
    if (target.email) {
      const greetingName = target.name || target.email;
      const contactUrl = appUrl("/contact");
      await sendEmail({
        to: target.email,
        subject: "Your Dakwah-Lens account has been removed",
        html: removalEmailHtml(greetingName, target.email, contactUrl),
        text: removalEmailText(greetingName, target.email, contactUrl),
      });
    }
  } catch (err) {
    console.warn("[admin] removal email failed:", err);
  }

  await db.delete(schema.users).where(eq(schema.users.id, id));

  await logAdminAction({
    actorId: selfId,
    action: "user.remove",
    targetType: "user",
    targetId: id,
    payload: { email: target.email, name: target.name },
  });

  revalidatePath("/admin/users");
}

/** Bilingual notice — Indonesian primary (most users), English mirror.
 *  Brief by design: tell them what happened, give them a way to reach
 *  us if it's a mistake, no fluff. */
function removalEmailHtml(
  greetingName: string,
  email: string,
  contactUrl: string,
): string {
  return renderEmail({
    greeting: `Assalamu'alaikum, ${escapeHtml(greetingName)}.`,
    heading: "Akun Anda telah dihapus",
    paragraphs: [
      `Akun Anda di Dakwah-Lens (<strong>${escapeHtml(email)}</strong>) telah dihapus oleh administrator. Semua kajian dan data akun Anda ikut terhapus.`,
      "Bila Anda yakin ini kesalahan, silakan hubungi kami dan akan kami tinjau kembali.",
    ],
    cta: { label: "Hubungi kami", url: contactUrl },
    secondary: {
      heading: "English",
      paragraphs: [
        `Your Dakwah-Lens account (<strong>${escapeHtml(email)}</strong>) has been removed by an administrator. All briefs and account data have been deleted.`,
        `If you believe this was a mistake, please <a href="${contactUrl}" style="color:#047857;font-weight:600;">contact us</a> and we'll review.`,
      ],
    },
  });
}

function removalEmailText(
  greetingName: string,
  email: string,
  contactUrl: string,
): string {
  return `Assalamu'alaikum, ${greetingName}.

Akun Anda di Dakwah-Lens (${email}) telah dihapus oleh administrator. Semua brief dan data akun Anda ikut terhapus.

Bila Anda yakin ini kesalahan, silakan hubungi kami di ${contactUrl} dan kami akan tinjau.

---

Your Dakwah-Lens account has been removed by an administrator. All briefs and account data have been deleted. If you believe this was a mistake, please contact us at ${contactUrl}.

— Tim Dakwah-Lens`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
