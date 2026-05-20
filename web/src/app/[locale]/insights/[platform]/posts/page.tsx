import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft, Filter } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { PLATFORM_SLUGS, type PlatformKey } from "@/data/drilldowns";
import { db, schema } from "@/db";

type SearchParams = Record<string, string | string[] | undefined>;
type PageParams = { locale: string; platform: string };

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

// URL slug → DB platform name. The drilldown URLs sometimes use the
// canonical platform name directly (mainstream/x/youtube/etc.), so we
// keep this map permissive.
const SLUG_TO_DB: Record<string, string> = {
  mainstream: "mainstream",
  news: "mainstream",
  youtube: "youtube",
  tiktok: "tiktok",
  x: "x",
  instagram: "instagram",
  facebook: "facebook",
};

function dbPlatform(slug: string): string | null {
  return SLUG_TO_DB[slug] ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, platform } = await params;
  const t = await getTranslations({ locale, namespace: "Insights" });
  return { title: `${t("posts_browse_title")} · ${platform}` };
}

export default async function PostsBrowsePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, platform } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  if (!PLATFORM_SLUGS.includes(platform as PlatformKey)) notFound();

  const t = await getTranslations({ locale, namespace: "Insights" });

  const dbPlatformName = dbPlatform(platform);
  if (!dbPlatformName) notFound();

  // Pick category from query, default = no filter.
  const categoryParam = typeof search.category === "string" ? search.category : "";
  const category = (DAWAH_CATEGORIES as readonly string[]).includes(categoryParam)
    ? categoryParam
    : "";

  // Sentiment chip — default "all".
  const sentimentParam =
    typeof search.sentiment === "string" ? search.sentiment : "all";
  const sentiment: Sentiment = (SENTIMENTS as readonly string[]).includes(
    sentimentParam,
  )
    ? (sentimentParam as Sentiment)
    : "all";

  // Build WHERE clauses.
  const filters = [eq(schema.socialPosts.platform, dbPlatformName)];
  if (sentiment !== "all") {
    filters.push(eq(schema.socialPosts.sentimentLabel, sentiment));
  }

  // For category filter: dominant category match. JSONB → key with the
  // highest value among the 9 da'wah keys must equal the requested one.
  if (category) {
    filters.push(
      sql`(
        SELECT key FROM jsonb_each_text(${schema.socialPosts.categories})
        WHERE key = ANY (ARRAY[${sql.raw(
          DAWAH_CATEGORIES.map((c) => `'${c}'`).join(","),
        )}])
        ORDER BY value::numeric DESC LIMIT 1
      ) = ${category}`,
    );
  }

  const posts = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      sentimentLabel: schema.socialPosts.sentimentLabel,
      sentimentScore: schema.socialPosts.sentimentScore,
      categories: schema.socialPosts.categories,
      postedAt: schema.socialPosts.postedAt,
    })
    .from(schema.socialPosts)
    .where(and(...filters))
    .orderBy(desc(schema.socialPosts.postedAt))
    .limit(50);

  const categoryLabel = category
    ? t(`dawah_category_${category}` as Parameters<typeof t>[0])
    : null;

  const buildChipHref = (s: Sentiment) => {
    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (s !== "all") qs.set("sentiment", s);
    const suffix = qs.toString();
    return `/insights/${platform}/posts${suffix ? `?${suffix}` : ""}`;
  };

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <Link
          href={`/insights/${platform}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("posts_back_to_platform")}
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {categoryLabel
                ? t("posts_browse_title_with_category", {
                    platform,
                    category: categoryLabel,
                  })
                : t("posts_browse_title_platform", { platform })}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {t("posts_browse_count", { count: posts.length })}
            </p>
          </div>
        </div>

        {/* Sentiment filter chips */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Filter className="h-3 w-3" />
            {t("posts_sentiment_filter_label")}
          </span>
          {SENTIMENTS.map((s) => {
            const active = s === sentiment;
            const colorClass = {
              all: "bg-slate-100 text-slate-700 ring-slate-200",
              positive: "bg-emerald-50 text-emerald-700 ring-emerald-200",
              neutral: "bg-slate-50 text-slate-700 ring-slate-200",
              negative: "bg-amber-50 text-amber-800 ring-amber-200",
            }[s];
            return (
              <Link
                key={s}
                href={buildChipHref(s)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                  active
                    ? `${colorClass} font-semibold shadow-sm`
                    : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {t(`posts_sentiment_${s}` as Parameters<typeof t>[0])}
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
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
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
                        ? ` · ${Math.round(p.sentimentScore * 100)}%`
                        : ""}
                    </span>
                  )}
                  {p.author && <span className="font-medium">@{p.author}</span>}
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
  );
}
