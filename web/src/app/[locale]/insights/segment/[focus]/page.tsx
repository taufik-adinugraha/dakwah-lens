import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, sql } from "drizzle-orm";
import { ArrowLeft, BookOpen, Layers } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";
import { getLatestInsightsSummary } from "@/lib/insights-data";
import { InsightsHeadlinePills } from "@/components/InsightsHeadlinePills";

/**
 * Audience-segmented dashboard. The /insights main page is mixed —
 * great for a generalist da'i but noisy for someone whose audience is
 * tight (a kajian for working women, a student-org chair, a youth
 * counsellor, a finance-focused community).
 *
 * We map four common focus areas to subsets of the 9 da'wah
 * categories from the relevance classifier:
 *
 *   family      → family + parents
 *   youth       → youth + education
 *   justice     → social_justice + economic_ethics
 *   spiritual   → aqidah + akhlaq
 *
 * The page filters posts where the dominant category is in the
 * focus's category set, then shows: top posts (most relevant),
 * sentiment mix, and recent topic labels. Same data we already
 * collect — just a different slice.
 */

type SearchParams = Record<string, string | string[] | undefined>;
type PageParams = { locale: string; focus: string };

const FOCUS_DEFINITIONS: Record<
  string,
  {
    labelKey: string;
    descriptionKey: string;
    categories: string[];
    tone: { accent: string; ring: string };
  }
> = {
  // Four segments cover all 9 dakwah classifier categories after the
  // 2026-05-20 remap. `health` folds into `family` (mom/child/mental
  // health are the dominant Indonesian family-vlog topics anyway) and
  // `muamalah` folds into `justice` (Indonesian audiences increasingly
  // hear Islamic-finance issues — pinjol, riba, paylater — as
  // economic-justice issues).
  family: {
    labelKey: "segment_family_title",
    descriptionKey: "segment_family_desc",
    categories: ["family", "health"],
    tone: { accent: "bg-rose-500", ring: "ring-rose-100" },
  },
  youth: {
    labelKey: "segment_youth_title",
    descriptionKey: "segment_youth_desc",
    categories: ["youth", "education"],
    tone: { accent: "bg-cyan-500", ring: "ring-cyan-100" },
  },
  justice: {
    labelKey: "segment_justice_title",
    descriptionKey: "segment_justice_desc",
    categories: ["social_justice", "economic_ethics", "muamalah"],
    tone: { accent: "bg-amber-500", ring: "ring-amber-100" },
  },
  spiritual: {
    labelKey: "segment_spiritual_title",
    descriptionKey: "segment_spiritual_desc",
    categories: ["aqidah", "akhlaq"],
    tone: { accent: "bg-emerald-500", ring: "ring-emerald-100" },
  },
};

const ALL_FOCI = Object.keys(FOCUS_DEFINITIONS);

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, focus } = await params;
  if (!ALL_FOCI.includes(focus)) return {};
  const t = await getTranslations({ locale, namespace: "Insights" });
  return {
    title: t(FOCUS_DEFINITIONS[focus]!.labelKey as Parameters<typeof t>[0]),
  };
}

export default async function SegmentPage({
  params,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, focus } = await params;
  setRequestLocale(locale);
  if (!ALL_FOCI.includes(focus)) notFound();

  const def = FOCUS_DEFINITIONS[focus]!;
  const t = await getTranslations({ locale, namespace: "Insights" });

  // Posts whose DOMINANT category is in this focus's category set.
  // Filter via the same JSONB argmax pattern we use in insights-data.
  const dominantCategorySql = sql`(
    SELECT key FROM jsonb_each_text(${schema.socialPosts.categories})
    WHERE key = ANY (ARRAY[${sql.raw(
      def.categories.map((c) => `'${c}'`).join(","),
    )}])
    ORDER BY value::numeric DESC LIMIT 1
  )`;

  // Per-segment AI-narrated briefing — written by the Celery
  // `generate_insights_summary` task. May be null if today's run
  // hasn't fired or no posts exist for this segment yet.
  const segmentBriefingPromise = getLatestInsightsSummary(focus);

  const [topPosts, sentimentRows, [totals], segmentBriefing] = await Promise.all([
    db
      .select({
        id: schema.socialPosts.id,
        text: schema.socialPosts.text,
        author: schema.socialPosts.author,
        platform: schema.socialPosts.platform,
        url: schema.socialPosts.url,
        sentimentLabel: schema.socialPosts.sentimentLabel,
        dawahRelevance: schema.socialPosts.dawahRelevance,
        postedAt: schema.socialPosts.postedAt,
      })
      .from(schema.socialPosts)
      .where(
        and(
          sql`${schema.socialPosts.categories} IS NOT NULL`,
          sql`${dominantCategorySql} = ANY (ARRAY[${sql.raw(
            def.categories.map((c) => `'${c}'`).join(","),
          )}])`,
        ),
      )
      .orderBy(desc(schema.socialPosts.dawahRelevance))
      .limit(15),
    db.execute(sql`
      SELECT sentiment_label, count(*)::int AS n
      FROM social_posts
      WHERE categories IS NOT NULL
        AND ${dominantCategorySql} = ANY (ARRAY[${sql.raw(
          def.categories.map((c) => `'${c}'`).join(","),
        )}])
        AND sentiment_label IS NOT NULL
      GROUP BY sentiment_label
    `) as unknown as Promise<Array<{ sentiment_label: string; n: number }>>,
    db.execute(sql`
      SELECT count(*)::int AS total
      FROM social_posts
      WHERE categories IS NOT NULL
        AND ${dominantCategorySql} = ANY (ARRAY[${sql.raw(
          def.categories.map((c) => `'${c}'`).join(","),
        )}])
    `) as unknown as Promise<Array<{ total: number }>>,
    segmentBriefingPromise,
  ]);

  const total = (totals?.total as number) ?? 0;
  const sentimentMix = { positive: 0, neutral: 0, negative: 0 };
  for (const row of sentimentRows) {
    if (row.sentiment_label === "positive") sentimentMix.positive = row.n;
    else if (row.sentiment_label === "negative") sentimentMix.negative = row.n;
    else if (row.sentiment_label === "neutral") sentimentMix.neutral = row.n;
  }
  const sentimentTotal =
    sentimentMix.positive + sentimentMix.neutral + sentimentMix.negative;
  const pct = (n: number) =>
    sentimentTotal > 0 ? (n / sentimentTotal) * 100 : 0;

  return (
    <>
      <section className="pt-12 pb-8 sm:pt-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("segment_back")}
          </Link>
          <div className="mt-4 flex items-start gap-3">
            <span
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${def.tone.accent} text-white shadow-sm`}
            >
              <Layers className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t(def.labelKey as Parameters<typeof t>[0])}
              </h1>
              <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600">
                {t(def.descriptionKey as Parameters<typeof t>[0])}
              </p>
              <p className="mt-2 text-[11px] text-slate-400">
                {t("segment_post_count", { count: total })}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Per-segment AI briefing — narrative + nasihah + retrieved daleel */}
      {segmentBriefing && (
        <section className="pb-8">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-emerald-50/30 p-6 shadow-sm sm:p-7">
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t("exec_briefing_label")}
              </p>
              <p className="whitespace-pre-line text-pretty text-sm leading-relaxed text-slate-800 sm:text-base">
                {segmentBriefing.summaryMd}
              </p>
              {segmentBriefing.daleelRefs &&
                segmentBriefing.daleelRefs.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-emerald-100 bg-white/60 p-3">
                    <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      <BookOpen className="h-3 w-3" />
                      {t("exec_daleel_label")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {segmentBriefing.daleelRefs.map((ref) => (
                        <Link
                          key={ref.ref_id}
                          href={{
                            pathname: "/kitab",
                            query: { q: ref.citation, kitab: ref.corpus },
                          }}
                          title={ref.translation_id || ref.translation_en || ""}
                          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
                        >
                          <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                            {ref.corpus.replace(/_/g, " ")}
                          </span>
                          <span className="truncate font-medium">
                            {ref.citation}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              {/* Segment-filtered headline pills — same shape as the
                  all-platform hero, but the underlying stats are scoped
                  to this segment's category set. */}
              <InsightsHeadlinePills
                stats={segmentBriefing.headlineStats}
                locale={locale}
                t={(key) => t(key as Parameters<typeof t>[0])}
                localizeCategory={(cat) =>
                  t(`dawah_category_${cat}` as Parameters<typeof t>[0])
                }
              />
            </div>
          </div>
        </section>
      )}

      {/* Sentiment mix for this segment */}
      {sentimentTotal > 0 && (
        <section className="pb-8">
          <div className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className={`rounded-2xl border bg-white p-5 shadow-sm ring-1 ${def.tone.ring}`}>
              <h2 className="text-sm font-semibold text-slate-900">
                {t("segment_sentiment_title")}
              </h2>
              <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                <span
                  className="bg-emerald-500"
                  style={{ width: `${pct(sentimentMix.positive)}%` }}
                />
                <span
                  className="bg-slate-300"
                  style={{ width: `${pct(sentimentMix.neutral)}%` }}
                />
                <span
                  className="bg-amber-500"
                  style={{ width: `${pct(sentimentMix.negative)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <SentimentTile color="bg-emerald-500" pct={pct(sentimentMix.positive)} label={t("live_sentiment_positive")} />
                <SentimentTile color="bg-slate-300" pct={pct(sentimentMix.neutral)} label={t("live_sentiment_neutral")} />
                <SentimentTile color="bg-amber-500" pct={pct(sentimentMix.negative)} label={t("live_sentiment_concerned")} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Top posts in this segment */}
      <section className="pb-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="mb-4 text-base font-semibold text-slate-900 sm:text-lg">
            {t("segment_top_posts_title")}
          </h2>
          {topPosts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
              {t("how_coverage_posts_empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {topPosts.map((p) => (
                <li
                  key={p.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold uppercase tracking-wider text-slate-700">
                      {p.platform}
                    </span>
                    {p.author && <span>@{p.author}</span>}
                    {p.sentimentLabel && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ring-1 ${
                          p.sentimentLabel === "positive"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                            : p.sentimentLabel === "negative"
                              ? "bg-amber-50 text-amber-800 ring-amber-100"
                              : "bg-slate-50 text-slate-600 ring-slate-100"
                        }`}
                      >
                        {p.sentimentLabel}
                      </span>
                    )}
                    {p.dawahRelevance !== null && p.dawahRelevance !== undefined && (
                      <span className="tabular-nums">
                        {(p.dawahRelevance * 100).toFixed(0)}% relevance
                      </span>
                    )}
                    {p.postedAt && (
                      <span className="text-slate-400">
                        {new Date(p.postedAt).toLocaleDateString(locale)}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-800">
                    {(p.text ?? "").slice(0, 360)}
                    {(p.text ?? "").length > 360 ? "…" : ""}
                  </p>
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[11px] font-medium text-brand-700 hover:underline"
                    >
                      {t("posts_open_source")} ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}

function SentimentTile({
  color,
  pct,
  label,
}: {
  color: string;
  pct: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-600">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="font-semibold tabular-nums text-slate-700">
        {Math.round(pct)}%
      </span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
