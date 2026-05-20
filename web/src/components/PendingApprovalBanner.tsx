"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PendingApprovalBannerClient } from "./PendingApprovalBannerClient";

/**
 * Top-of-page banner for users whose registration is still under review.
 *
 * Client-side fetch of `/api/auth/session` (NextAuth's built-in session
 * endpoint, served from this app, no extra config). We used to read the
 * session server-side via `await auth()`, but the layout that hosts this
 * banner gets cached as a static fragment in Next.js 16 — so an admin
 * who flipped a user's status from `pending` → `approved` in the DB
 * would still see the banner because the rendered HTML was frozen. The
 * client-side fetch always hits the live JWT, so promotions reflect
 * within seconds (or instantly on a refresh).
 *
 * Same approach also dodges the "server error on signout" we were
 * seeing: when the layout server-renders right after a signout, it
 * could observe a half-cleared session and crash. Reading from the
 * client moves that concern out of the render path.
 *
 * Loading state renders nothing (no flash of "you're pending" while
 * we're still fetching). The fetch is one round-trip per page load —
 * acceptable cost for correctness.
 */
export function PendingApprovalBanner() {
  type Session = {
    user?: { id?: string; status?: string };
  } | null;

  const [session, setSession] = useState<Session>(null);
  const [loaded, setLoaded] = useState(false);
  const t = useTranslations("Auth");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Session) => {
        if (!cancelled) {
          setSession(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  if (!session?.user?.id) return null;
  if (session.user.status !== "pending") return null;

  return (
    <PendingApprovalBannerClient
      userId={session.user.id}
      title={t("pending_banner_title")}
      body={t("pending_banner_body")}
      closeLabel={t("pending_banner_close")}
    />
  );
}
