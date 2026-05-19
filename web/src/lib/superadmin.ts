/**
 * Access gates for `/admin/system/*` routes.
 *
 *  - `requireSystemAccess()` — admin OR superadmin. The read-side gate.
 *    Used by the system layout and any server action that's safe for
 *    regular admins (inbox triage, donation ledger entry).
 *
 *  - `requireSuperadmin()` — strict superadmin-only. Used by write
 *    actions that should stay locked down: FX rate, manual costs,
 *    RSS feeds, ingest queries, terms-followup blasts.
 *
 * The role distinction is enforced server-side on every write action,
 * not just hidden in the UI — an admin can't escalate by hand-crafting
 * a POST to a restricted endpoint.
 */

import { redirect } from "next/navigation";

import { auth } from "@/auth";

export async function requireSuperadmin() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/system");
  }
  if (session.user.role !== "superadmin") {
    redirect("/dashboard?error=forbidden");
  }
  return session;
}

/** Read-side gate for /admin/system/*. Admins land here too but get
 *  a read-only view of most pages — inbox + donations are the two
 *  exceptions where they have full write access. */
export async function requireSystemAccess() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/system");
  }
  const role = session.user.role;
  if (role !== "admin" && role !== "superadmin") {
    redirect("/dashboard?error=forbidden");
  }
  return session;
}
