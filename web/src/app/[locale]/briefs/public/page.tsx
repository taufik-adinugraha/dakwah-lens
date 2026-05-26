import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "drizzle-orm";
import {
  ArrowUpRight,
  BookOpen,
  Clock,
  Filter,
  Sparkles,
  Users,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db } from "@/db";
import type { BriefContent } from "@/db/schema";

const RECENCY_DAYS = 7;
const PAGE_LIMIT = 50;

const SEGMENTS = [
  "urban_gen_z",
  "working_professionals",
  "parents_families",
  "ibu_pengajian",
  "rural_communities",
  "students",
] as const;
const TONES = [
  "scholarly",
  "casual",
  "motivational",
  "empathetic",
  "fiery",
  "gentle",
] as const;
const LOCALES_FILTER = ["id", "en"] as const;

type BriefRow = {
  id: string;
  topic_title: string;
  segment: string;
  tone: string;
  locale: string;
  content: BriefContent;
  created_at: string;
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/briefs/public">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PublicBriefs" });
  return { title: t("page_title") };
}

export default async function PublicBriefsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/briefs/public">) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("PublicBriefs");
  const tBriefs = await getTranslations("Briefs");

  // ── Filter parsing ─────────────────────────────────────────────
  const seg = pickFilter(sp.segment, SEGMENTS);
  const tone = pickFilter(sp.tone, TONES);
  const loc = pickFilter(sp.locale, LOCALES_FILTER);

  // ── Smart dedup: pick the most-recent brief per
  // (lowercased+trimmed topic, segment) pair so identical topics submitted
  // by different users in the same week don't pile up.
  //
  // PostgreSQL DISTINCT ON requires the ORDER BY to lead with the same
  // expressions used in DISTINCT ON; we then re-sort the outer result by
  // created_at desc for display.
  const rows = (await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (LOWER(TRIM(topic_title)), segment)
        id, topic_title, segment, tone, locale, content, created_at
      FROM briefs
      WHERE is_placeholder = false
        AND created_at >= now() - interval '${sql.raw(String(RECENCY_DAYS))} days'
        ${seg ? sql`AND segment = ${seg}` : sql``}
        ${tone ? sql`AND tone = ${tone}` : sql``}
        ${loc ? sql`AND locale = ${loc}` : sql``}
      ORDER BY LOWER(TRIM(topic_title)), segment, created_at DESC
    ) t
    ORDER BY created_at DESC
    LIMIT ${PAGE_LIMIT}
  `)) as unknown as BriefRow[];

  const briefs: BriefRow[] = Array.isArray(rows) ? rows : [];
  const segLabel = (s: string) =>
    tBriefs(`segment_${s}` as Parameters<typeof tBriefs>[0]);
  const toneLabel = (s: string) =>
    tBriefs(`tone_${s}` as Parameters<typeof tBriefs>[0]);

  const baseFilters = {
    segment: seg ?? undefined,
    tone: tone ?? undefined,
    locale: loc ?? undefined,
  };

  return (
    <>
      <Hero t={t} />

      <section className="py-8 sm:py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Filter row */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Filter className="h-3 w-3" />
              {t("filter_label")}
            </span>
            <FilterGroup
              activeValue={seg}
              all={SEGMENTS}
              currentFilters={baseFilters}
              filterKey="segment"
              label={tBriefs("field_segment")}
              optionLabel={segLabel}
            />
            <FilterGroup
              activeValue={tone}
              all={TONES}
              currentFilters={baseFilters}
              filterKey="tone"
              label={tBriefs("field_tone")}
              optionLabel={toneLabel}
            />
            <FilterGroup
              activeValue={loc}
              all={LOCALES_FILTER}
              currentFilters={baseFilters}
              filterKey="locale"
              label={tBriefs("field_locale")}
              optionLabel={(s) =>
                tBriefs(`locale_${s}` as Parameters<typeof tBriefs>[0])
              }
            />
            {(seg || tone || loc) && (
              <Link
                href="/briefs/public"
                className="text-xs font-semibold text-rose-700 hover:text-rose-900"
              >
                {t("filter_clear")}
              </Link>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            {t("results_count", { count: briefs.length })}
          </p>

          {briefs.length === 0 ? (
            <Empty t={t} />
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {briefs.map((b) => (
                <BriefCard
                  key={b.id}
                  brief={b}
                  segLabel={segLabel(b.segment)}
                  toneLabel={toneLabel(b.tone)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"PublicBriefs">>>;

function pickFilter<T extends readonly string[]>(
  raw: unknown,
  options: T,
): T[number] | null {
  if (typeof raw !== "string") return null;
  return (options as readonly string[]).includes(raw)
    ? (raw as T[number])
    : null;
}

function Hero({ t }: { t: T }) {
  return (
    <section className="relative isolate overflow-hidden pt-12 pb-6 sm:pt-16 sm:pb-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-24 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-brand-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm backdrop-blur">
          <Sparkles className="h-3.5 w-3.5" />
          {t("badge")}
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          {t("hero_title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
          {t("hero_subtitle")}
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock className="h-3 w-3" />
          {t("recency_hint", { days: RECENCY_DAYS })}
        </p>
      </div>
    </section>
  );
}

function FilterGroup<O extends readonly string[]>({
  label,
  all,
  activeValue,
  filterKey,
  currentFilters,
  optionLabel,
}: {
  label: string;
  all: O;
  activeValue: O[number] | null;
  filterKey: "segment" | "tone" | "locale";
  currentFilters: { segment?: string; tone?: string; locale?: string };
  optionLabel: (s: O[number]) => string;
}) {
  // Build the URL preserving the other active filters.
  const buildHref = (value: O[number] | null) => {
    const next: Record<string, string | undefined> = {
      ...currentFilters,
      [filterKey]: value ?? undefined,
    };
    const qs = Object.entries(next)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `/briefs/public?${qs}` : "/briefs/public";
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <Link
        href={buildHref(null)}
        className={pillClass(activeValue === null)}
      >
        {/* "Any" — when not filtered, this is highlighted */}
        ·
      </Link>
      {all.map((opt) => (
        <Link
          key={opt}
          href={buildHref(opt)}
          className={pillClass(activeValue === opt)}
        >
          {optionLabel(opt)}
        </Link>
      ))}
    </div>
  );
}

function pillClass(active: boolean): string {
  return active
    ? "inline-flex h-7 items-center rounded-full border border-slate-900 bg-slate-900 px-2.5 text-xs font-semibold text-white"
    : "inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
}

function Empty({ t }: { t: T }) {
  return (
    <div className="mt-12 rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
      <Sparkles className="mx-auto h-7 w-7 text-slate-300" />
      <p className="mt-3 text-sm font-semibold text-slate-700">
        {t("empty_title")}
      </p>
      <p className="mt-1 text-pretty text-xs text-slate-500">
        {t("empty_body", { days: RECENCY_DAYS })}
      </p>
    </div>
  );
}

function BriefCard({
  brief,
  segLabel,
  toneLabel,
  t,
}: {
  brief: BriefRow;
  segLabel: string;
  toneLabel: string;
  t: T;
}) {
  const preview = excerpt(brief.content?.situation_summary ?? "", 180);
  const audience =
    brief.content?.audience_segmentation?.primary || segLabel;

  return (
    <Link
      href={`/briefs/public/${brief.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="brand">{segLabel}</Chip>
        <Chip tone="emerald">{toneLabel}</Chip>
        <Chip tone="slate">{brief.locale.toUpperCase()}</Chip>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {relativeTime(brief.created_at, t)}
        </span>
      </div>

      <h3 className="text-balance text-base font-bold leading-snug text-slate-900 group-hover:text-brand-700">
        {brief.topic_title}
      </h3>

      <p className="line-clamp-4 text-pretty text-sm leading-relaxed text-slate-600">
        {preview}
      </p>

      <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
        <span className="inline-flex items-center gap-1 text-slate-500">
          <Users className="h-3 w-3" />
          <span className="truncate">{audience}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-brand-700 group-hover:text-brand-900">
          {t("card_view")}
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "brand" | "emerald" | "slate";
  children: React.ReactNode;
}) {
  const cls =
    tone === "brand"
      ? "bg-brand-50 text-brand-700 ring-brand-100"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
        : "bg-slate-50 text-slate-700 ring-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${cls}`}
    >
      {children}
    </span>
  );
}

function excerpt(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function relativeTime(iso: string, t: T): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor(diffMs / 3_600_000);
  if (days >= 1) return t("time_days_ago", { n: days });
  if (hours >= 1) return t("time_hours_ago", { n: hours });
  return t("time_just_now");
}
