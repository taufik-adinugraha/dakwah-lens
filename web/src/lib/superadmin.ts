/**
 * Superadmin gate for `/admin/system/*` routes.
 *
 * Stricter than the existing `/admin/users` check — only role=`superadmin`
 * gets in. Regular `admin` can still manage user signups but cannot see
 * infra metrics, API costs, or cost configuration.
 *
 * Usage at the top of every superadmin-only page:
 *   const session = await requireSuperadmin();
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
