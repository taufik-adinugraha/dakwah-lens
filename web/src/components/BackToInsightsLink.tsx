import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link } from "@/i18n/navigation";

/**
 * Small breadcrumb-style back-link to `/insights`.
 *
 * Placed at the top of every page reachable FROM the insights hub
 * (per-platform pages, segment-focus pages, /kitab) so readers can
 * always return to the briefings without hunting in the global nav.
 *
 * Hidden in print mode — printed pages should stand alone.
 */
export async function BackToInsightsLink({
  className = "",
}: {
  className?: string;
}) {
  const t = await getTranslations("Insights");
  return (
    <Link
      href="/insights"
      className={`inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-900 print:hidden ${className}`}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {t("back_to_insights")}
    </Link>
  );
}
