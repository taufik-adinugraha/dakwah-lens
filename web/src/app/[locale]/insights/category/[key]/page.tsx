import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, ArrowRight, ArrowUpRight, Filter } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { db, schema } from "@/db";

type SearchParams = Record<string, string | string[] | undefined>;
type PageParams = { locale: string; key: string };

// Mirror of the PRD da'wah categories (also defined in
// `api/src/api/services/relevance.py` and `lib/insights-data.ts`).
// Kept inline here so the route validates its dynamic segment without
// pulling the server-only data module just for the constant.
const DAWAH_CATEGORIES = [
  "aqidah",
  "akhlaq",
  "muamalah",
  "social_justice",
  "family",
  "youth",
  "education",
  "economic_ethics",
  "health",
] as const;

const SENTIMENTS = ["all", "positive", "neutral", "negative"] as const;
type Sentiment = (typeof SENTIMENTS)[number];

const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: "Insights" });
  if (!(DAWAH_CATEGORIES as readonly string[]).includes(key)) return {};
  const label = t(
    `dawah_category_${key}` as Parameters<typeof t>[0],
  );
  return { title: `${t("category_posts_title", { category: label })} · DakwahLens` };
}

/**
 * Per-category cross-platform post browser. Lists every post whose
 * dominant da'wah category equals `[key]`, with sentiment filtering and
 * pagination. Distinct from `/insights/[platform]/posts?category=X`
 * which narrows to ONE platform — this surface is "all platforms,
 * one category", reachable from the category bars on `/insights/explore`.
 */
export default async function CategoryPostsPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, key } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  if (!(DAWAH_CATEGORIES as readonly string[]).includes(key)) notFound();

  const t = await getTranslations({ locale, namespace: "Insights" });

  // Sentiment chip — default "all".
  const sentimentParam =
    typeof search.sentiment === "string" ? search.sentiment : "all";
  const sentiment: Sentiment = (SENTIMENTS as readonly string[]).includes(
    sentimentParam,
  )
    ? (sentimentParam as Sentiment)
    : "all";

  // Page number — clamp to >= 1.
  const pageParam = typeof search.page === "string" ? search.page : "1";
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // The dominant-category filter: pick the JSONB key with the highest
  // value among the 9 da'wah keys (above a 0.1 noise floor — matches
  // the platform/posts page) and require it to equal `key`. Wrap once
  // and reuse across the three queries below.
  const dominantMatches = sql`(
    SELECT key FROM jsonb_each_text(${schema.socialPosts.categories})
    WHERE key = ANY (ARRAY[${sql.raw(
      DAWAH_CATEGORIES.map((c) => `'${c}'`).join(","),
    )}])
      AND value::numeric > 0.1
    ORDER BY value::numeric DESC LIMIT 1
  ) = ${key}`;

  const baseFilters = [dominantMatches];
  const queryFilters =
    sentiment !== "all"
      ? [...baseFilters, eq(schema.socialPosts.sentimentLabel, sentiment)]
      : baseFilters;

  // 1) Total matching rows for pagination + count display.
  const [{ total = 0 } = { total: 0 }] = (await db
    .select({ total: count() })
    .from(schema.socialPosts)
    .where(and(...queryFilters))) as Array<{ total: number }>;

  // 2) Sentiment composition over the WHOLE category (not the page) so
  //    the bar reads "what this category looks like overall", and per-
  //    sentiment chip counts ignore the active chip (so each chip says
  //    "how many would I see if I switched to this").
  const sentimentCountRows = (await db
    .select({
      label: schema.socialPosts.sentimentLabel,
      n: count(),
    })
    .from(schema.socialPosts)
    .where(and(...baseFilters))
    .groupBy(schema.socialPosts.sentimentLabel)) as Array<{
    label: string | null;
    n: number;
  }>;
  const sentimentCounts: Record<Sentiment, number> = {
    all: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  for (const row of sentimentCountRows) {
    sentimentCounts.all += row.n;
    if (row.label === "positive") sentimentCounts.positive = row.n;
    else if (row.label === "neutral") sentimentCounts.neutral = row.n;
    else if (row.label === "negative") sentimentCounts.negative = row.n;
  }
  const sentTotal =
    sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.negative;
  const sentPct = (n: number) =>
    sentTotal > 0 ? Math.round((n / sentTotal) * 100) : 0;
  const posPct = sentPct(sentimentCounts.positive);
  const neuPct = sentPct(sentimentCounts.neutral);
  // Bound negative to fill so the three percents always sum to 100 even
  // after rounding (avoid a 1px gap on the bar end).
  const negPct = sentTotal > 0 ? Math.max(0, 100 - posPct - neuPct) : 0;

  // 3) The actual page slice of posts, newest first.
  const posts = await db
    .select({
      id: schema.socialPosts.id,
      platform: schema.socialPosts.platform,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      sentimentLabel: schema.socialPosts.sentimentLabel,
      sentimentScore: schema.socialPosts.sentimentScore,
      categories: schema.socialPosts.categories,
      postedAt: schema.socialPosts.postedAt,
    })
    .from(schema.socialPosts)
    .where(and(...queryFilters))
    .orderBy(desc(schema.socialPosts.postedAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const categoryLabel = t(
    `dawah_category_${key}` as Parameters<typeof t>[0],
  );

  const buildHref = (s: Sentiment, p: number) => {
    const qs = new URLSearchParams();
    if (s !== "all") qs.set("sentiment", s);
    if (p > 1) qs.set("page", String(p));
    const suffix = qs.toString();
    return `/insights/category/${key}${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Link
          href="/insights/explore"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("category_back_to_explore")}
        </Link>

        <div className="mt-4">
          <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("category_posts_title", { category: categoryLabel })}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {t("category_posts_count", { count: total })}
          </p>
        </div>

        {/* Sentiment composition bar — overall for the category, ignores
            the active sentiment chip so the user can see "of all posts
            in this category, X% are positive/etc." */}
        {sentTotal > 0 && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {t("section_sentiment")}
            </p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full">
              <span className="bg-emerald-500" style={{ width: `${posPct}%` }} />
              <span className="bg-slate-300" style={{ width: `${neuPct}%` }} />
              <span className="bg-amber-500" style={{ width: `${negPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs tabular-nums text-slate-600">
              <span>
                <span className="font-semibold text-emerald-700">{posPct}%</span>{" "}
                {t("live_sentiment_positive")}
              </span>
              <span>
                <span className="font-semibold text-slate-700">{neuPct}%</span>{" "}
                {t("live_sentiment_neutral")}
              </span>
              <span>
                <span className="font-semibold text-amber-700">{negPct}%</span>{" "}
                {t("live_sentiment_concerned")}
              </span>
            </div>
          </div>
        )}

        {/* Sentiment filter chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Filter className="h-3 w-3" />
            {t("posts_sentiment_filter_label")}
          </span>
          {SENTIMENTS.map((s) => {
            const active = s === sentiment;
            const tone: "slate" | "emerald" | "amber" = {
              all: "slate" as const,
              positive: "emerald" as const,
              neutral: "slate" as const,
              negative: "amber" as const,
            }[s];
            const toneActive = {
              slate: "bg-slate-900 text-white ring-slate-900",
              emerald: "bg-emerald-600 text-white ring-emerald-600",
              amber: "bg-amber-600 text-white ring-amber-600",
            }[tone];
            const toneInactive = {
              slate: "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
              emerald:
                "bg-white text-emerald-700 ring-emerald-200 hover:bg-emerald-50",
              amber: "bg-white text-amber-700 ring-amber-200 hover:bg-amber-50",
            }[tone];
            const n = sentimentCounts[s];
            return (
              <Link
                key={s}
                href={buildHref(s, 1)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${
                  active ? toneActive : toneInactive
                }`}
              >
                <span>
                  {t(`posts_sentiment_${s}` as Parameters<typeof t>[0])}
                </span>
                <span
                  className={`tabular-nums text-[10px] ${
                    active ? "text-white/80" : "text-slate-500"
                  }`}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Post list */}
        {posts.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            {t("posts_empty")}
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {posts.map((p) => (
              <li
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
                    {p.platform}
                  </span>
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
                      {p.sentimentScore !== null
                        ? ` · ${Math.round(Number(p.sentimentScore) * 100)}%`
                        : ""}
                    </span>
                  )}
                  {p.author && <span className="font-medium">@{p.author}</span>}
                  {p.postedAt && (
                    <span className="text-slate-400">
                      {new Date(p.postedAt).toLocaleDateString(locale, {
                        timeZone: "Asia/Jakarta",
                      })}
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
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    {t("posts_open_source")}
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Pagination — only render when there's more than one page. */}
        {totalPages > 1 && (
          <div className="mt-8 flex items-center justify-between gap-4">
            {currentPage > 1 ? (
              <Link
                href={buildHref(sentiment, currentPage - 1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("pagination_prev")}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-300">
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("pagination_prev")}
              </span>
            )}
            <span className="text-xs tabular-nums text-slate-500">
              {t("pagination_status", { page: currentPage, total: totalPages })}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={buildHref(sentiment, currentPage + 1)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                {t("pagination_next")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-300">
                {t("pagination_next")}
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
