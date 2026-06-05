import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Clock,
  Compass,
  Layers,
  Sparkles,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { slugifyGroup } from "@/lib/dashboard-metrics";
import {
  BRIEFING_GROUPS,
  briefingSlug,
  extractFirstBriefingSection,
  type LatestBriefing,
} from "@/lib/briefing-data";

/**
 * The /briefings hub's focal element — 14 equal-sized group cards laid
 * out in a responsive grid.
 *
 * Each card represents one THEME_GROUP. The auto-pipeline generates
 * weekly briefings for the TOP 5 groups by 7d post volume; cards for
 * those groups get a 1-sentence Section-1 preview + "Read briefing"
 * CTA into /briefings/[slug]. The other 9 group cards show an
 * "Explore topics & posts" CTA pointing at /groups/[slug],
 * a lightweight landing showing the group's topics + recent posts
 * without a full LLM briefing.
 *
 * Group-based redesign 2026-06-03 — replaces the prior 5-segment
 * (all + spiritual + family + youth + justice) layout.
 */
export async function BriefingsGrid({
  briefings,
  locale,
}: {
  briefings: Map<string, LatestBriefing>;
  locale: string;
}) {
  const t = await getTranslations("Insights");

  const formatDate = (d: Date) =>
    d.toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    });

  // Show only the top-5 groups that the auto-pipeline actually
  // generated a briefing for this week. Hides the other 9 entirely
  // (since 2026-06-04) — they were producing visual noise + diluting
  // the "this is what the week is about" signal. Readers who want to
  // explore non-briefed groups still get there through the explore
  // page (/radar) chart links.
  const orderedGroups = BRIEFING_GROUPS.filter((g) => briefings.has(g));

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
            seeing 5 read-ready cards above 9 explore-only cards
            doesn't think the others are broken. */}
        <p className="mb-5 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600">
          {t("hub_top_n_note")}
        </p>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {orderedGroups.map((group) => {
            const brief = briefings.get(group);
            const groupSlug = slugifyGroup(group);

            if (brief) {
              const body =
                locale === "en" && brief.summaryMdEn
                  ? brief.summaryMdEn
                  : brief.summaryMd;
              const previewSection = extractFirstBriefingSection(body);
              const previewLine = excerpt(previewSection, 170);
              const wordCount = body.trim().split(/\s+/).length;
              const readingMinutes = Math.max(1, Math.round(wordCount / 200));
              const slug = briefingSlug(brief.generatedAt, brief.themeGroup);

              return (
                <li key={group}>
                  <Link
                    href={`/briefings/${slug}`}
                    className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-emerald-500 hover:shadow-lg"
                  >
                    <div
                      aria-hidden
                      className="pointer-events-none absolute -top-12 -right-12 h-28 w-28 rounded-full bg-emerald-200 opacity-50 blur-3xl"
                    />
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <Layers className="h-4 w-4" />
                    </span>
                    <h3 className="mt-3 text-base font-bold text-slate-900">
                      {group}
                    </h3>
                    <p className="mt-2 line-clamp-4 text-[13px] leading-relaxed text-slate-600">
                      {previewLine}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                      <span>{formatDate(brief.generatedAt)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t("brief_reading_time", { minutes: readingMinutes })}
                      </span>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 transition group-hover:gap-2">
                      {t("hub_card_cta")}
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                </li>
              );
            }

            // No briefing this week — link to the group landing page.
            return (
              <li key={group}>
                <Link
                  href={`/groups/${groupSlug}`}
                  className="group relative flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-slate-900 hover:shadow-md"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition group-hover:bg-slate-900 group-hover:text-white">
                    <Compass className="h-4 w-4" />
                  </span>
                  <h3 className="mt-3 text-base font-bold text-slate-900">
                    {group}
                  </h3>
                  <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-slate-500">
                    {t("hub_card_explore_body")}
                  </p>
                  <div className="mt-auto pt-4">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 transition group-hover:gap-2">
                      {t("hub_card_explore_cta")}
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </div>
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

/** Strip the first H2 heading line from the preview section, collapse
 *  markdown markers, and cap to `max` chars with ellipsis. */
function excerpt(section: string, max: number): string {
  const stripped = section
    .replace(/^##\s+.+\n/, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max
    ? stripped.slice(0, max - 1).trimEnd() + "…"
    : stripped;
}
