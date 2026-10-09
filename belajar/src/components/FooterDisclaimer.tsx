"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * The footer's mandatory label (AGENTS.md), chosen by route. The Ilmu Waris track has no human
 * review (docs/waris-plan.md §2 "Decisions taken"), so its pages (track, calculator, report,
 * on screen and in print) carry the track's own label, "Dibantu AI, bukan fatwa otoritatif, bukan
 * penetapan pengadilan", instead of the module's wording about ustadz review, which stays on every
 * other page. The layout passes both strings; usePathname (next-intl: no locale, no basePath)
 * picks one during the static render as well as in the browser.
 */
export function FooterDisclaimer({ module, waris }: { module: string; waris: string }) {
  const pathname = usePathname();
  const onWaris = pathname === "/waris" || pathname.startsWith("/waris/");
  return <>{onWaris ? waris : module}</>;
}
