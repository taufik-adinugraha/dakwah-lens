import { getTranslations } from "next-intl/server";
import { ArrowRight, Compass, Layers, Sparkles, TrendingUp } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { slugifyGroup } from "@/lib/dashboard-metrics";
import {
  BRIEFING_GROUPS,
  briefingSlug,
  type LatestBriefing,
} from "@/lib/briefing-data";

/**
 * The /briefings hub's focal element — all 14 THEME_GROUPS rendered as
 * compact cards sorted by 7d post volume descending.
 *
 * Each card shows the group label + 7d post count. Groups that the
 * auto-pipeline has generated a briefing for (top-5 by volume each
 * Thursday) are marked with a "Briefing" badge and link straight to
 * /briefings/[slug]; the other 9 link to /groups/[slug] (topics +
 * recent posts, no full LLM briefing).
 *
 * 2026-06-08 redesign — replaces the prior 5-card preview-text layout
 * with a uniform compact grid so all 14 groups are visible at a glance
 * and the volume signal is the primary visual sort.
 */
export async function BriefingsGrid({
  briefings,
  volumes,
  locale,
}: {
  briefings: Map<string, LatestBriefing>;
  volumes: Map<string, number>;
  locale: string;
}) {
  const t = await getTranslations("Briefing");
  const nf = new Intl.NumberFormat(locale);

  // Sort by 7d volume desc; ties fall back to canonical reading order.
  const sortedGroups = [...BRIEFING_GROUPS].sort((a, b) => {
    const va = volumes.get(a) ?? 0;
    const vb = volumes.get(b) ?? 0;
    if (vb !== va) return vb - va;
    return BRIEFING_GROUPS.indexOf(a) - BRIEFING_GROUPS.indexOf(b);
  });

  return (
    <section className="pb-10 sm:pb-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <Sparkles className="h-3 w-3" />
              {t("hub_briefings_eyebrow")}
            </span>
            <h2 className="mt-2 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("hub_briefings_title")}
            </h2>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
              {t("hub_briefings_body")}
            </p>
          </div>
        </div>

        {/* Note explaining the top-5 auto-generation model so a reader
            seeing some cards with the "Briefing" badge and others
            without doesn't think the latter are broken. */}
        <p className="mb-5 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600">
          {t("hub_top_n_note")}
        </p>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sortedGroups.map((group) => {
            const brief = briefings.get(group);
            const volume = volumes.get(group) ?? 0;
            const groupSlug = slugifyGroup(group);
            const hasBriefing = !!brief;
            const href = hasBriefing
              ? `/briefings/${briefingSlug(brief.generatedAt, brief.themeGroup)}`
              : `/groups/${groupSlug}`;

            return (
              <li key={group}>
                <Link
                  href={href}
                  className={`group relative flex h-full flex-col rounded-2xl border p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    hasBriefing
                      ? "border-emerald-200 bg-gradient-to-br from-emerald-50/40 to-white hover:border-emerald-500"
                      : "border-slate-200 bg-white hover:border-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                        hasBriefing
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {hasBriefing ? (
                        <Layers className="h-3.5 w-3.5" />
                      ) : (
                        <Compass className="h-3.5 w-3.5" />
                      )}
                    </span>
                    {hasBriefing && (
                      <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                        {t("hub_card_briefing_badge")}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                    {group}
                  </h3>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <TrendingUp className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="text-base font-bold tabular-nums text-slate-900">
                      {nf.format(volume)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {t("hub_card_volume_unit")}
                    </span>
                  </div>
                  <div
                    className={`mt-3 inline-flex items-center gap-1 text-[11px] font-semibold transition group-hover:gap-1.5 ${
                      hasBriefing ? "text-emerald-700" : "text-slate-700"
                    }`}
                  >
                    {hasBriefing
                      ? t("hub_card_cta")
                      : t("hub_card_explore_cta")}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
