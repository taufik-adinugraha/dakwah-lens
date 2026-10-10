"use client";

import { usePathname } from "@/i18n/navigation";

/**
 * The footer's mandatory label (AGENTS.md), chosen by route. Waris pages (track, calculator,
 * report, on screen and in print) add "bukan penetapan pengadilan" to the module's AI-assisted
 * line, because the report is a recommendation people may act on; every other page keeps the
 * module line. There is no human review anywhere (plan L11). The layout passes both strings; usePathname (next-intl: no locale, no basePath)
 * picks one during the static render as well as in the browser.
 */
export function FooterDisclaimer({ module, waris }: { module: string; waris: string }) {
  const pathname = usePathname();
  const onWaris = pathname === "/waris" || pathname.startsWith("/waris/");
  return <>{onWaris ? waris : module}</>;
}
