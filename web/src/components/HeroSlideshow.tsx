"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Calendar,
  ChevronRight,
  Filter,
  LayoutDashboard,
  Library,
  ScrollText,
  Sparkles,
  TrendingUp,
  Users,
  Lightbulb,
  BookMarked,
} from "lucide-react";
import clsx from "clsx";

const SLIDES = ["dashboard", "trends", "brief", "kitab"] as const;
type SlideKey = (typeof SLIDES)[number];

const AUTO_ADVANCE_MS = 6500;

const SLIDE_ICONS: Record<SlideKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  trends: TrendingUp,
  brief: ScrollText,
  kitab: Library,
};

type T = ReturnType<typeof useTranslations<"Preview">>;

export function HeroSlideshow() {
  const t = useTranslations("Preview");
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const active = SLIDES[index];
  const urls: Record<SlideKey, string> = {
    dashboard: t("dashboard_url"),
    trends: t("trends_url"),
    brief: t("brief_url"),
    kitab: t("kitab_url"),
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="absolute inset-x-12 -bottom-2 h-16 rounded-3xl bg-brand-500/15 blur-2xl" />

      <div className="relative rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/10 sm:p-4">
        {/* Tabs row */}
        <div className="mb-3 flex items-center justify-between gap-2 overflow-x-auto px-1">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((key, i) => {
              const Icon = SLIDE_ICONS[key];
              const isActive = i === index;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition sm:px-3 sm:text-xs",
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  )}
                  aria-pressed={isActive}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`slide_${key}` as const)}
                </button>
              );
            })}
          </div>

          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() =>
                setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)
              }
              aria-label={t("prev")}
              className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
              aria-label={t("next")}
              className="rounded-full border border-slate-200 p-1.5 text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Frame */}
        <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-gradient-to-br from-slate-50 to-white">
          <BrowserChrome url={urls[active]} live={t("live")} />

          <div className="relative min-h-[400px] sm:min-h-[460px]">
            {SLIDES.map((key, i) => (
              <div
                key={key}
                aria-hidden={i !== index}
                className={clsx(
                  "absolute inset-0 p-4 transition-opacity duration-500",
                  i === index
                    ? "opacity-100"
                    : "pointer-events-none opacity-0",
                )}
              >
                {key === "dashboard" && <DashboardSlide t={t} />}
                {key === "trends" && <TrendsSlide t={t} />}
                {key === "brief" && <BriefSlide t={t} />}
                {key === "kitab" && <KitabSlide t={t} />}
              </div>
            ))}
          </div>
        </div>

        {/* Dots */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {SLIDES.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t(`slide_${key}` as const)}
              className={clsx(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-8 bg-slate-900" : "w-3 bg-slate-300",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BrowserChrome({ url, live }: { url: string; live: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
      </div>
      <span className="truncate px-2 text-xs font-medium text-slate-500">
        {url}
      </span>
      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        {live}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * Slide 1 — Dashboard
 * Top stat row + Daily Insights strip + Top Issues grid.
 * ──────────────────────────────────────────────────────────── */

function DashboardSlide({ t }: { t: T }) {
  const insightIcons = [TrendingUp, Sparkles, Users, BookOpenCheck];
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatCard
          tone="brand"
          label={t("dashboard_pulse_label")}
          value="7.3"
          hint={t("dashboard_pulse_hint")}
        />
        <StatCard
          tone="emerald"
          label={t("dashboard_trending_label")}
          value="12"
          hint={t("dashboard_trending_hint")}
        />
        <StatCard
          tone="amber"
          label={t("dashboard_ready_label")}
          value="3"
          hint={t("dashboard_ready_hint")}
        />
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t("dashboard_insights_label")}
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[1, 2, 3, 4].map((n, i) => {
            const Icon = insightIcons[i];
            return (
              <div
                key={n}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
              >
                <Icon className="h-3 w-3 shrink-0 text-brand-600" />
                <span className="truncate text-[10px] font-medium text-slate-700">
                  {t(`dashboard_insight_${n}` as Parameters<typeof t>[0])}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t("dashboard_issues_label")}
        </p>
        <div className="space-y-1.5">
          <IssueRow
            title={t("dashboard_issue_1_title")}
            tag={t("dashboard_issue_1_tag")}
            volume="12.4K"
            sentiment={62}
          />
          <IssueRow
            title={t("dashboard_issue_2_title")}
            tag={t("dashboard_issue_2_tag")}
            volume="8.1K"
            sentiment={48}
          />
          <IssueRow
            title={t("dashboard_issue_3_title")}
            tag={t("dashboard_issue_3_tag")}
            volume="6.7K"
            sentiment={75}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  tone,
  label,
  value,
  hint,
}: {
  tone: "brand" | "emerald" | "amber";
  label: string;
  value: string;
  hint: string;
}) {
  const tones: Record<typeof tone, string> = {
    brand: "from-brand-50 to-brand-100/40 text-brand-700",
    emerald: "from-emerald-50 to-emerald-100/40 text-emerald-700",
    amber: "from-amber-50 to-amber-100/40 text-amber-700",
  };
  return (
    <div
      className={`rounded-lg border border-slate-200/70 bg-gradient-to-br ${tones[tone]} p-3`}
    >
      <p className="text-xs font-medium uppercase tracking-wider opacity-80">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function IssueRow({
  title,
  tag,
  volume,
  sentiment,
}: {
  title: string;
  tag: string;
  volume: string;
  sentiment: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-800 sm:text-sm">
          {title}
        </p>
        <p className="text-[10px] text-slate-500">{tag}</p>
      </div>
      <span className="hidden text-xs font-medium tabular-nums text-slate-500 sm:inline">
        {volume}
      </span>
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:block">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
          style={{ width: `${sentiment}%` }}
        />
      </div>
      <span className="hidden w-8 text-right text-xs font-medium text-slate-500 sm:inline">
        {sentiment}%
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * Slide 2 — Trends Explorer
 * Two-column: trending table on the left, sentiment + category
 * volume panel on the right (mirrors /insights split).
 * ──────────────────────────────────────────────────────────── */

function TrendsSlide({ t }: { t: T }) {
  const rows = [
    { title: t("trends_row_1_title"), tag: t("trends_row_1_tag"), volume: "12.4K", relevance: 92, trend: [40, 50, 60, 55, 70, 78, 82] },
    { title: t("trends_row_2_title"), tag: t("trends_row_2_tag"), volume: "8.1K", relevance: 81, trend: [20, 30, 28, 40, 55, 60, 68] },
    { title: t("trends_row_3_title"), tag: t("trends_row_3_tag"), volume: "6.7K", relevance: 88, trend: [55, 50, 60, 65, 60, 62, 70] },
    { title: t("trends_row_4_title"), tag: t("trends_row_4_tag"), volume: "5.3K", relevance: 64, trend: [25, 30, 35, 40, 38, 42, 48] },
    { title: t("trends_row_5_title"), tag: t("trends_row_5_tag"), volume: "4.2K", relevance: 76, trend: [30, 32, 30, 28, 35, 40, 45] },
  ];

  const categories = [
    { label: t("trends_category_1"), pct: 84 },
    { label: t("trends_category_2"), pct: 71 },
    { label: t("trends_category_3"), pct: 58 },
    { label: t("trends_category_4"), pct: 42 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip icon={Calendar} label={t("trends_filter_date")} />
        <FilterChip icon={Filter} label={t("trends_filter_category")} />
        <FilterChip icon={Filter} label={t("trends_filter_sentiment")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <span>{t("trends_col_topic")}</span>
            <span className="hidden sm:inline">{t("trends_col_volume")}</span>
            <span>{t("trends_col_relevance")}</span>
            <span>{t("trends_col_trend")}</span>
          </div>
          {rows.map((r) => (
            <div
              key={r.title}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-800">
                  {r.title}
                </p>
                <p className="text-[10px] text-slate-500">{r.tag}</p>
              </div>
              <span className="hidden text-xs tabular-nums text-slate-600 sm:inline">
                {r.volume}
              </span>
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                {r.relevance}
              </span>
              <Sparkline points={r.trend} />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("trends_sentiment_label")}
            </p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full">
              <span className="bg-emerald-500" style={{ width: "48%" }} />
              <span className="bg-slate-300" style={{ width: "30%" }} />
              <span className="bg-amber-500" style={{ width: "22%" }} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-slate-500">
              <span>
                <span className="font-semibold text-emerald-600">48%</span>{" "}
                {t("dashboard_sentiment_pos")}
              </span>
              <span>
                <span className="font-semibold text-slate-600">30%</span>{" "}
                {t("dashboard_sentiment_neu")}
              </span>
              <span>
                <span className="font-semibold text-amber-600">22%</span>{" "}
                {t("dashboard_sentiment_neg")}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("trends_categories_label")}
            </p>
            <div className="mt-2 space-y-1.5">
              {categories.map((c) => (
                <div key={c.label}>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-medium text-slate-700">
                      {c.label}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {c.pct}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  icon: Icon,
  label,
}: {
  icon: typeof Calendar;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 56;
  const h = 18;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${h - ((p - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-emerald-500">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────
 * Slide 3 — Brief Detail
 * Summary + audience-segmentation chips + daleel card +
 * recommendations list (mirrors the real brief layout).
 * ──────────────────────────────────────────────────────────── */

function BriefSlide({ t }: { t: T }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-[10px] text-slate-500">
        <span>Briefs</span>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate">{t("brief_breadcrumb")}</span>
      </div>

      <div>
        <h4 className="text-balance text-sm font-semibold text-slate-900 sm:text-base">
          {t("brief_title")}
        </h4>
        <p className="mt-1 text-xs text-slate-500">{t("brief_meta")}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t("brief_section_summary")}
        </p>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-700">
          {t("brief_summary")}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {t("brief_section_audience")}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <AudienceCell
            label={t("brief_audience_primary_label")}
            value={t("brief_audience_primary_value")}
            tone="brand"
          />
          <AudienceCell
            label={t("brief_audience_perception_label")}
            value={t("brief_audience_perception_value")}
            tone="amber"
          />
          <AudienceCell
            label={t("brief_audience_angle_label")}
            value={t("brief_audience_angle_value")}
            tone="emerald"
          />
        </div>
      </div>

      <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            {t("brief_section_daleel")}
          </p>
          <BookOpenCheck className="h-3.5 w-3.5 text-emerald-600" />
        </div>
        <p
          dir="rtl"
          lang="ar"
          className="mt-2 font-arabic text-base leading-[2] text-slate-900 sm:text-lg"
        >
          {t("brief_daleel_arabic")}
        </p>
        <p className="mt-1 text-pretty text-xs leading-relaxed text-slate-700">
          {t("brief_daleel_translation")}
        </p>
        <p className="mt-1 text-[10px] font-medium text-emerald-700">
          — {t("brief_daleel_source")}
        </p>
        <div className="mt-2 flex items-center gap-1.5 border-t border-emerald-100/80 pt-2 text-[10px] text-emerald-700">
          <BookMarked className="h-3 w-3" />
          <span className="font-medium">{t("brief_daleel_2_label")}</span>
          <span className="text-emerald-600">{t("brief_daleel_2_source")}</span>
        </div>
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Lightbulb className="h-3 w-3 text-amber-500" />
          {t("brief_section_recommendations")}
        </p>
        <ol className="space-y-1 text-xs text-slate-700">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-semibold text-white">
                {n}
              </span>
              <span className="leading-snug">
                {t(`brief_rec_${n}` as Parameters<typeof t>[0])}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-center text-[10px] text-slate-400">{t("ai_label")}</p>
    </div>
  );
}

function AudienceCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "brand" | "amber" | "emerald";
}) {
  const tones: Record<typeof tone, string> = {
    brand: "border-brand-200 bg-brand-50/60 text-brand-800",
    amber: "border-amber-200 bg-amber-50/60 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-800",
  };
  return (
    <div className={`rounded-lg border ${tones[tone]} px-2 py-1.5`}>
      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </p>
      <p className="mt-0.5 text-xs font-medium leading-tight">{value}</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * Slide 4 — Kitab Library
 * The credibility hook: every daleel retrieved, never generated.
 * Mirrors the public /kitab page's source cards.
 * ──────────────────────────────────────────────────────────── */

function KitabSlide({ t }: { t: T }) {
  const sources = [
    {
      name: t("kitab_1_name"),
      meta: t("kitab_1_meta"),
      languages: t("kitab_1_languages"),
      tone: "brand" as const,
    },
    {
      name: t("kitab_2_name"),
      meta: t("kitab_2_meta"),
      languages: t("kitab_2_languages"),
      tone: "emerald" as const,
    },
    {
      name: t("kitab_3_name"),
      meta: t("kitab_3_meta"),
      languages: t("kitab_3_languages"),
      tone: "amber" as const,
    },
    {
      name: t("kitab_4_name"),
      meta: t("kitab_4_meta"),
      languages: t("kitab_4_languages"),
      tone: "rose" as const,
    },
    {
      name: t("kitab_5_name"),
      meta: t("kitab_5_meta"),
      languages: t("kitab_5_languages"),
      tone: "violet" as const,
    },
    {
      name: t("kitab_6_name"),
      meta: t("kitab_6_meta"),
      languages: t("kitab_6_languages"),
      tone: "cyan" as const,
    },
  ];

  const tones: Record<
    "brand" | "emerald" | "amber" | "rose" | "violet" | "cyan",
    string
  > = {
    brand: "border-brand-200 bg-brand-50/50 text-brand-700",
    emerald: "border-emerald-200 bg-emerald-50/50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50/50 text-amber-700",
    rose: "border-rose-200 bg-rose-50/50 text-rose-700",
    violet: "border-violet-200 bg-violet-50/50 text-violet-700",
    cyan: "border-cyan-200 bg-cyan-50/50 text-cyan-700",
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("kitab_eyebrow")}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">
            {t("kitab_subtitle")}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          <BookOpenCheck className="h-3 w-3" />
          {t("kitab_verified_badge")}
        </span>
      </div>

      <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((s) => (
          <div
            key={s.name}
            className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-slate-900">
                {s.name}
              </p>
              <span
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${tones[s.tone]}`}
              >
                {s.languages}
              </span>
            </div>
            <p className="text-xs leading-snug text-slate-600">
              {s.meta}
            </p>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs leading-relaxed text-slate-600">
        <BookOpenCheck className="mr-1 inline h-3 w-3 align-text-bottom text-emerald-600" />
        {t("kitab_promise")}
      </p>
    </div>
  );
}
