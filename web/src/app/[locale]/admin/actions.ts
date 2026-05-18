"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/db";

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
): Promise<void> {
  const selfId = await assertAdmin();

  // Don't let admins lock themselves out by mistake. UI also gates this.
  if (targetId === selfId && status !== "approved") return;

  await db
    .update(schema.users)
    .set({ status })
    .where(eq(schema.users.id, targetId));

  revalidatePath("/admin/users");
}

export async function approveUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "approved");
}

export async function rejectUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "rejected");
}

export async function blockUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "blocked");
}

export async function reinstateUserAction(formData: FormData): Promise<void> {
  const id = formData.get("user_id")?.toString();
  if (!id) return;
  await setUserStatus(id, "approved");
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

  await db
    .update(schema.users)
    .set({ role, status: "approved" })
    .where(eq(schema.users.id, targetId));

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
