"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackPageView } from "@/lib/analytics";

/**
 * Fires one `trackPageView` server action per client-route change.
 *
 * Mount this once near the root of the locale layout. The `useRef` guard
 * prevents double-firing under React strict mode and during the initial
 * hydration when the same effect runs twice. Each distinct `pathname`
 * counts once per mount lifecycle.
 */
export function PageTracker({ locale }: { locale: string }) {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    // Strip locale prefix so the path is consistent across `id`/`en` for
    // aggregation. `/en/insights/x` → `/insights/x`.
    const normalized =
      pathname.replace(/^\/(en|id)(?=\/|$)/, "") || "/";
    void trackPageView({ path: normalized, locale });
  }, [pathname, locale]);

  return null;
}
