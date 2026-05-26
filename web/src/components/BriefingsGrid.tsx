import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Clock,
  HeartHandshake,
  Layers,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import {
  BRIEFING_SEGMENTS,
  briefingSlug,
  extractFirstBriefingSection,
  type LatestInsightsSummary,
} from "@/lib/insights-data";

/**
 * The /insights hub's focal element — 5 equal-sized briefing cards
 * laid out in a responsive 1/2/5-column grid. Each card previews a
 * 1-sentence hook from the briefing's Section 1 (Ringkasan Eksekutif)
 * and CTAs into the long-form read.
 *
 * Equal sizing is intentional: the briefings-first redesign treats the
 * 5 perspectives as peers rather than hero + supporting. The reader
 * sees we offer 5 distinct lenses on the same week, picks whichever
 * speaks to their context.
 *
 * Missing briefings (e.g. a segment's Pro call failed) render as a
 * dimmed placeholder card — same shape, honest about the gap.
 */
export async function BriefingsGrid({
  briefings,
  locale,
}: {
  briefings: Map<string, LatestInsightsSummary>;
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

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {BRIEFING_SEGMENTS.map((segment) => {
            const key = segment ?? "all";
            const brief = briefings.get(key);
            const meta = SEGMENT_META[key as keyof typeof SEGMENT_META];
            const titleKey =
              segment === null
                ? "hub_card_all_title"
                : (`segment_${segment}_title` as Parameters<typeof t>[0]);
            const title = t(titleKey);
            const Icon = meta.icon;

            if (!brief) {
              return (
                <li key={key}>
                  <div
                    className={`flex h-full flex-col rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-slate-400`}
                    aria-disabled="true"
                  >
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="mt-3 text-sm font-bold text-slate-600">
                      {title}
                    </h3>
                    <p className="mt-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {t("hub_card_missing")}
                    </p>
                  </div>
                </li>
              );
            }

            const body =
              locale === "en" && brief.summaryMdEn
                ? brief.summaryMdEn
                : brief.summaryMd;
            const previewSection = extractFirstBriefingSection(body);
            const previewLine = excerpt(previewSection, 170);
            const wordCount = body.trim().split(/\s+/).length;
            const readingMinutes = Math.max(1, Math.round(wordCount / 200));
            const slug = briefingSlug(brief.generatedAt, brief.segment);

            return (
              <li key={key}>
                <Link
                  href={`/insights/brief/${slug}`}
                  className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border ${meta.idleBorder} ${meta.idleBg} p-5 shadow-sm transition hover:-translate-y-1 ${meta.hoverBorder} hover:shadow-lg`}
                >
                  {/* Soft decorative blob behind the icon */}
                  <div
                    aria-hidden
                    className={`pointer-events-none absolute -top-12 -right-12 h-28 w-28 rounded-full ${meta.blob} opacity-50 blur-3xl`}
                  />
                  <span
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconText}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <h3 className="mt-3 text-base font-bold text-slate-900">
                    {title}
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

                  <div
                    className={`mt-3 inline-flex items-center gap-1.5 text-xs font-semibold ${meta.cta} transition group-hover:gap-2`}
                  >
                    {t("hub_card_cta")}
                    <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
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

/** Per-segment palette — mirrors BriefingNarrative section themes and
 *  BriefPagination cards so a reader's color memory stays coherent. */
const SEGMENT_META = {
  all: {
    icon: Layers,
    iconBg: "bg-slate-900",
    iconText: "text-white",
    idleBorder: "border-slate-200",
    idleBg: "bg-gradient-to-br from-white to-slate-50",
    hoverBorder: "hover:border-slate-900",
    blob: "bg-slate-300",
    cta: "text-slate-700",
  },
  spiritual: {
    icon: Sparkles,
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    idleBorder: "border-emerald-100",
    idleBg: "bg-gradient-to-br from-emerald-50/50 to-white",
    hoverBorder: "hover:border-emerald-500",
    blob: "bg-emerald-200",
    cta: "text-emerald-700",
  },
  family: {
    icon: HeartHandshake,
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    idleBorder: "border-rose-100",
    idleBg: "bg-gradient-to-br from-rose-50/50 to-white",
    hoverBorder: "hover:border-rose-500",
    blob: "bg-rose-200",
    cta: "text-rose-700",
  },
  youth: {
    icon: Users,
    iconBg: "bg-sky-100",
    iconText: "text-sky-700",
    idleBorder: "border-sky-100",
    idleBg: "bg-gradient-to-br from-sky-50/50 to-white",
    hoverBorder: "hover:border-sky-500",
    blob: "bg-sky-200",
    cta: "text-sky-700",
  },
  justice: {
    icon: Scale,
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    idleBorder: "border-amber-100",
    idleBg: "bg-gradient-to-br from-amber-50/50 to-white",
    hoverBorder: "hover:border-amber-500",
    blob: "bg-amber-200",
    cta: "text-amber-700",
  },
} as const;
