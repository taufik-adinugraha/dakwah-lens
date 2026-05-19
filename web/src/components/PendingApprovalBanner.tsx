import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { PendingApprovalBannerClient } from "./PendingApprovalBannerClient";

/**
 * Top-of-page banner for users whose registration is still under review.
 *
 * Server-side: reads the session, returns null unless the signed-in user
 * has `status === "pending"`. No DB hit beyond the auth lookup the layout
 * already performs.
 *
 * Client-side: the inner `PendingApprovalBannerClient` owns the close
 * button and the localStorage dismiss flag (scoped to the user id so a
 * different signin doesn't inherit the previous user's dismissal).
 *
 * Why not the existing ActiveNotice pattern: ActiveNotice is admin-driven
 * broadcasts that live in `app_notices`. This banner is per-user state —
 * different concern, simpler implementation.
 */
export async function PendingApprovalBanner() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== "pending") return null;

  const t = await getTranslations("Auth");

  return (
    <PendingApprovalBannerClient
      userId={session.user.id}
      title={t("pending_banner_title")}
      body={t("pending_banner_body")}
      closeLabel={t("pending_banner_close")}
    />
  );
}
