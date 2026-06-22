import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Banknote,
  Boxes,
  CalendarHeart,
  Clock,
  Cpu,
  Globe2,
  GraduationCap,
  HandHeart,
  Heart,
  HeartPulse,
  Landmark,
  LandPlot,
  Leaf,
  Minus,
  Scale,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users2,
  Wheat,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { slugifyGroup } from "@/lib/dashboard-metrics";
import {
  BRIEFING_GROUPS,
  briefingSlug,
  type GroupVolume,
  type LatestBriefing,
} from "@/lib/briefing-data";

/**
 * Per-group visual tone — tailwind classes for the card bg gradient,
 * the icon chip background, and the icon glyph. One-stop styling so a
 * group always reads the same color across the app. Each tone is
 * deliberately distinct enough to survive at thumbnail size; saturation
 * sits at the 50/100 band so cards stay readable, not loud.
 *
 * Icon picks: each glyph should evoke the bucket's tema (Scale for
 * justice, Heart for family/social, Mosque for ibadah, Globe2 for
 * geopolitik, etc.) — abstract enough that an unfamiliar reader can
 * still pattern-match the row.
 */
const GROUP_THEME: Record<
  string,
  { tone: string; iconBg: string; iconText: string; Icon: typeof Scale }
> = {
  "Hukum & Keadilan": {
    tone: "from-rose-50/80 to-white border-rose-200 hover:border-rose-500",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    Icon: Scale,
  },
  "Sosial & Keluarga": {
    tone: "from-pink-50/80 to-white border-pink-200 hover:border-pink-500",
    iconBg: "bg-pink-100",
    iconText: "text-pink-700",
    Icon: Users2,
  },
  "Ekonomi & Bisnis": {
    tone: "from-amber-50/80 to-white border-amber-200 hover:border-amber-500",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    Icon: Banknote,
  },
  "Aqidah & Ibadah": {
    tone:
      "from-emerald-50/80 to-white border-emerald-200 hover:border-emerald-500",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    Icon: Landmark, // mosque-ish silhouette; lucide doesn't ship a mosque glyph
  },
  "Kesehatan & Kehidupan": {
    tone: "from-teal-50/80 to-white border-teal-200 hover:border-teal-500",
    iconBg: "bg-teal-100",
    iconText: "text-teal-700",
    Icon: HeartPulse,
  },
  "Pendidikan & SDM": {
    tone: "from-sky-50/80 to-white border-sky-200 hover:border-sky-500",
    iconBg: "bg-sky-100",
    iconText: "text-sky-700",
    Icon: GraduationCap,
  },
  "Lingkungan & Bencana": {
    tone: "from-lime-50/80 to-white border-lime-200 hover:border-lime-500",
    iconBg: "bg-lime-100",
    iconText: "text-lime-700",
    Icon: Leaf,
  },
  "Pemerintahan & Kebijakan": {
    tone:
      "from-indigo-50/80 to-white border-indigo-200 hover:border-indigo-500",
    iconBg: "bg-indigo-100",
    iconText: "text-indigo-700",
    Icon: LandPlot,
  },
  "Patologi Sosial Digital": {
    tone:
      "from-orange-50/80 to-white border-orange-200 hover:border-orange-500",
    iconBg: "bg-orange-100",
    iconText: "text-orange-700",
    Icon: Smartphone,
  },
  "Teknologi & AI": {
    tone:
      "from-violet-50/80 to-white border-violet-200 hover:border-violet-500",
    iconBg: "bg-violet-100",
    iconText: "text-violet-700",
    Icon: Cpu,
  },
  "Pekerja & Pertanian Rakyat": {
    tone:
      "from-yellow-50/80 to-white border-yellow-200 hover:border-yellow-500",
    iconBg: "bg-yellow-100",
    iconText: "text-yellow-700",
    Icon: Wheat,
  },
  "Konflik & Geopolitik": {
    tone: "from-red-50/80 to-white border-red-200 hover:border-red-500",
    iconBg: "bg-red-100",
    iconText: "text-red-700",
    Icon: Globe2,
  },
  "Inspirasi & Kisah Pribadi": {
    tone:
      "from-fuchsia-50/80 to-white border-fuchsia-200 hover:border-fuchsia-500",
    iconBg: "bg-fuchsia-100",
    iconText: "text-fuchsia-700",
    Icon: Heart,
  },
  "Toleransi & Lintas-Iman": {
    tone: "from-cyan-50/80 to-white border-cyan-200 hover:border-cyan-500",
    iconBg: "bg-cyan-100",
    iconText: "text-cyan-700",
    Icon: HandHeart,
  },
  Lainnya: {
    tone: "from-slate-50/80 to-white border-slate-200 hover:border-slate-500",
    iconBg: "bg-slate-100",
    iconText: "text-slate-600",
    Icon: Boxes,
  },
};

const DEFAULT_THEME = GROUP_THEME["Lainnya"];

// Cards whose briefing is older than this many days adopt a neutral
// grey tone so readers see at a glance that the content is stale. Set
// by user request 2026-06-07 — operators ship a fresh briefing on
// Sunday, so anything past ~5 days has missed at least one weekly
// cycle and should look "needs refresh" rather than "this week's read".
const STALE_DAYS = 5;

/**
 * The /briefings hub's focal element — all 14 THEME_GROUPS rendered as
 * colorful cards sorted by 7d post volume descending, each linking to
 * the latest briefing for that group.
 *
 * Card content: per-group color tone + glyph, group label, 7d post
 * count, and a trend chip showing +/- vs the prior 7d window. Groups
 * that don't have a briefing yet still link to /briefings/[slug] (the
 * detail route handles a no-briefing-yet placeholder); we never bounce
 * to /groups/[slug] from this surface — that's the data-exploration
 * page, not the briefing destination.
 *
 * Redesign log:
 *   2026-06-08 — uniform compact grid sorted by volume, replaced 5-card
 *     preview text layout.
 *   2026-06-06 — per-group tones + glyphs + 7d-delta chip; every card
 *     now points at the briefing route (no more statistic-page detour).
 */
export async function BriefingsGrid({
  briefings,
  volumes,
  occasion,
  locale,
}: {
  briefings: Map<string, LatestBriefing>;
  volumes: Map<string, GroupVolume>;
  /** Latest 15th-track Islamic-calendar occasion briefing
   *  (theme_group = 'Acara Kalender Islam'). When non-null, rendered
   *  as a FEATURED first card with the yellow gold-tone palette,
   *  visually distinct from the 14 weekly theme cards below. NULL
   *  when no occasion briefing has been saved yet — grid falls back
   *  to the standard 14-card layout. */
  occasion: LatestBriefing | null;
  locale: string;
}) {
  const t = await getTranslations("Briefing");
  const nf = new Intl.NumberFormat(locale);
  // Server component, one evaluation per request — the react-hooks
  // purity rule flags Date.now() as impure (correct for client
  // components, overly strict here). The request-time `now` is
  // exactly what we want to compute briefing age against.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  // Sort by 7d volume desc; ties fall back to canonical reading order.
  const sortedGroups = [...BRIEFING_GROUPS].sort((a, b) => {
    const va = volumes.get(a)?.current ?? 0;
    const vb = volumes.get(b)?.current ?? 0;
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

        <p className="mb-5 max-w-3xl rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs leading-relaxed text-slate-600">
          {t("hub_top_n_note")}
        </p>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {occasion && (() => {
            // 15th-track Islamic-calendar occasion card — featured first.
            // Yellow / amber gold tone signals "event-driven, not weekly
            // news theme". The headline pulled from headlineStats
            // (manual save writes occasion_name there); falls back to
            // theme_group label.
            const stats = occasion.headlineStats as Record<string, unknown>;
            const occasionName =
              (typeof stats.occasion_name === "string"
                ? stats.occasion_name
                : null) ||
              occasion.themeGroup ||
              "Acara Kalender Islam";
            const hijriDate =
              typeof stats.hijri_date === "string"
                ? stats.hijri_date
                : null;
            const gregorianDate =
              typeof stats.gregorian_date === "string"
                ? stats.gregorian_date
                : null;
            const occasionHref = `/briefings/${briefingSlug(
              occasion.generatedAt,
              occasion.themeGroup,
              occasion.occasionSlug,
            )}`;
            const ageDays = Math.max(
              0,
              Math.floor(
                (nowMs - occasion.generatedAt.getTime()) / 86_400_000,
              ),
            );
            return (
              <li key={`__occasion-${occasion.occasionSlug ?? "latest"}`}>
                <Link
                  href={occasionHref}
                  className="group relative flex h-full flex-col rounded-2xl border bg-gradient-to-br p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md from-yellow-50/90 to-white border-yellow-300 hover:border-yellow-500"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
                      <CalendarHeart className="h-4 w-4" />
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-yellow-800"
                        title="Acara kalender Hijriah"
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        Acara
                      </span>
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-700"
                        title={t("hub_card_age_tooltip", { n: ageDays })}
                      >
                        <Clock className="h-2.5 w-2.5" />
                        {ageDays}d
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                    {occasionName}
                  </h3>
                  {(hijriDate || gregorianDate) && (
                    <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-600">
                      {hijriDate}
                      {hijriDate && gregorianDate && (
                        <span className="text-slate-400"> · </span>
                      )}
                      {gregorianDate}
                    </div>
                  )}
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-yellow-800 transition group-hover:gap-1.5">
                    Baca briefing acara
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            );
          })()}
          {sortedGroups.map((group) => {
            const brief = briefings.get(group);
            const vol = volumes.get(group);
            const current = vol?.current ?? 0;
            const deltaPct = vol?.deltaPct ?? null;
            const groupSlug = slugifyGroup(group);
            // Every card lands on the briefing route. If a briefing
            // exists, use the date-stamped slug for direct latest-edition
            // load; otherwise fall through to the bare group-slug, which
            // the /briefings/[id] route resolves to "latest for this
            // group" or renders a friendly "awaiting first briefing"
            // placeholder. Never link to /groups/[slug] from here.
            const href = brief
              ? `/briefings/${briefingSlug(brief.generatedAt, brief.themeGroup, brief.occasionSlug)}`
              : `/briefings/${groupSlug}`;
            const ageDays = brief
              ? Math.max(
                  0,
                  Math.floor(
                    (nowMs - brief.generatedAt.getTime()) / 86_400_000,
                  ),
                )
              : null;
            const isStale = ageDays !== null && ageDays > STALE_DAYS;
            const theme = isStale
              ? DEFAULT_THEME
              : (GROUP_THEME[group] ?? DEFAULT_THEME);
            const Icon = theme.Icon;
            return (
              <li key={group}>
                <Link
                  href={href}
                  className={`group relative flex h-full flex-col rounded-2xl border bg-gradient-to-br p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${theme.tone}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${theme.iconBg} ${theme.iconText}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {/* Age badge — "3d" / "1d" / "0d". Slate when fresh,
                          amber when stale (>STALE_DAYS) so readers spot
                          weeks that missed their Sunday refresh. */}
                      {ageDays !== null && (
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${
                            isStale
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                          title={t("hub_card_age_tooltip", { n: ageDays })}
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {ageDays}d
                        </span>
                      )}
                      {/* Trend chip — +N% / -N% vs prior 7d. "Baru" when
                          the group went from zero baseline to current
                          activity (deltaPct === null with current > 0).
                          Hidden entirely when there's no signal in either
                          window so we don't show a meaningless "—". */}
                      {(current > 0 || (vol?.previous ?? 0) > 0) && (
                      <span
                        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                          deltaPct === null
                            ? "bg-emerald-100 text-emerald-800"
                            : deltaPct > 0
                              ? "bg-emerald-100 text-emerald-800"
                              : deltaPct < 0
                                ? "bg-rose-100 text-rose-800"
                                : "bg-slate-100 text-slate-700"
                        }`}
                        title={t("hub_card_delta_tooltip")}
                      >
                        {deltaPct === null ? (
                          <>
                            <Sparkles className="h-2.5 w-2.5" />
                            {t("hub_card_delta_new")}
                          </>
                        ) : deltaPct > 0 ? (
                          <>
                            <TrendingUp className="h-2.5 w-2.5" />+{deltaPct}%
                          </>
                        ) : deltaPct < 0 ? (
                          <>
                            <TrendingDown className="h-2.5 w-2.5" />
                            {deltaPct}%
                          </>
                        ) : (
                          <>
                            <Minus className="h-2.5 w-2.5" />
                            0%
                          </>
                        )}
                      </span>
                    )}
                    </div>
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">
                    {group}
                  </h3>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-base font-bold tabular-nums text-slate-900">
                      {nf.format(current)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {t("hub_card_volume_unit")}
                    </span>
                  </div>
                  <div
                    className={`mt-3 inline-flex items-center gap-1 text-[11px] font-semibold transition group-hover:gap-1.5 ${theme.iconText}`}
                  >
                    {brief
                      ? t("hub_card_cta")
                      : t("hub_card_no_briefing_yet")}
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
