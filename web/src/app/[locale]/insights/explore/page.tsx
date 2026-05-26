import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

// Revalidate every 5 minutes. The page queries social_posts aggregates
// that update on the ingest schedule (RSS every 2h, X+TT+IG weekly).
// A 5-min cache means the heavy multi-query render hits the DB at most
// once per 5min per locale — huge p95 improvement for anonymous visitors
// who would otherwise pay the full Promise.all every page view. We were
// `force-dynamic` until 2026-05-26 when an audit showed no auth() call
// in the request path, so per-user caching keys don't apply here.
export const revalidate = 300;
import {
  ArrowRight,
  BarChart3,
  ChevronRight,
  Info,
  Newspaper,
  TrendingUp,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { BackToInsightsLink } from "@/components/BackToInsightsLink";
import { CoverageBreakdown } from "@/components/CoverageBreakdown";
import { I18nText } from "@/components/I18nText";
import { TrendingTopicsList } from "@/components/TrendingTopicsList";
import { getOverviewInsights } from "@/lib/insights-data";
import {
  getPlatformDistribution7d,
  getSentimentByPlatform7d,
  getSentimentDistribution7d,
  getTopIssues,
  getTopicDistribution7d,
  getTopicsByPlatform7d,
} from "@/lib/dashboard-metrics";

/**
 * Data-exploration hub. Surfaces what used to live BELOW the briefing
 * hero on /insights:
 *   - Trending topics (Gemini-discovered themes, last 7d)
 *   - Sentiment + category breakdown (rolling 7d)
 *   - Per-platform mix + per-platform CTA cards
 *
 * Separated 2026-05-23 so /insights itself can lead with the 5 weekly
 * briefings (the actual product) without burying them under stats.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/insights/explore">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Insights" });
  return { title: t("explore_page_title") };
}

export default async function InsightsExplorePage({
  params,
}: PageProps<"/[locale]/insights/explore">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("Insights");

  const [
    overview,
    topIssues,
    platformDist,
    sentimentDist,
    sentimentByPlatform,
    topicDist,
    topicsByPlatform,
  ] = await Promise.all([
    getOverviewInsights(),
    getTopIssues(5),
    getPlatformDistribution7d(),
    getSentimentDistribution7d(),
    getSentimentByPlatform7d(),
    getTopicDistribution7d(10),
    getTopicsByPlatform7d(5),
  ]);

  const trendingRows = topIssues;

  const CATEGORY_TONES = [
    "bg-brand-500",
    "bg-emerald-500",
    "bg-cyan-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-violet-500",
  ];
  const categories = (overview?.dominantCategories ?? [])
    .slice(0, 6)
    .map((c, i) => ({
      label: localizeCategory(t, c.category),
      volume: c.posts,
      tone: CATEGORY_TONES[i % CATEGORY_TONES.length],
    }));
  const catMax = categories.length
    ? Math.max(...categories.map((c) => c.volume))
    : 1;

  const mix = overview?.sentimentMix ?? {
    positive: 0,
    neutral: 0,
    negative: 0,
  };
  const sentimentTotal = mix.positive + mix.neutral + mix.negative;
  const sentimentPct = {
    positive: sentimentTotal ? (mix.positive / sentimentTotal) * 100 : 0,
    neutral: sentimentTotal ? (mix.neutral / sentimentTotal) * 100 : 0,
    negative: sentimentTotal ? (mix.negative / sentimentTotal) * 100 : 0,
  };
  const totalPosts = overview?.totalPosts ?? 0;

  return (
    <>
      <section className="pt-10 pb-6 sm:pt-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <BackToInsightsLink />
          <div className="mt-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-medium text-brand-700">
              <BarChart3 className="h-3.5 w-3.5" />
              {t("explore_eyebrow")}
            </span>
            <h1 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("explore_title")}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
              {t("explore_subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Coverage breakdown (platform / sentiment / topic distributions).
          Mirrors what /dashboard Data tab shows — exposed on this public
          /insights/explore page so anonymous visitors can see the same
          snapshot of "who's talking, how they feel, what about" without
          needing to log in. */}
      <section className="pb-10 sm:pb-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <CoverageBreakdown
            platforms={platformDist}
            sentiment={sentimentDist}
            sentimentByPlatform={sentimentByPlatform}
            topics={topicDist}
            topicsByPlatform={topicsByPlatform}
            labels={{
              sectionTitle: t("coverage_section_title"),
              sectionSubtitle: t("coverage_section_subtitle"),
              platformsTitle: t("coverage_platforms_title"),
              postsSuffix: t("coverage_posts_7d"),
              platformMainstream: t("coverage_platform_mainstream"),
              sentimentTitle: t("coverage_sentiment_title"),
              classifiedSuffix: t("coverage_classified_7d"),
              sentimentPositive: t("coverage_sentiment_positive"),
              sentimentNeutral: t("coverage_sentiment_neutral"),
              sentimentNegative: t("coverage_sentiment_negative"),
              unlabelledTpl: t("coverage_unlabelled_tpl", { n: "{n}" }),
              sentimentByPlatform: {
                cta: t("coverage_sentiment_by_platform_cta"),
                dialogTitle: t("coverage_sentiment_by_platform_title"),
                dialogSubtitle: t("coverage_sentiment_by_platform_subtitle"),
                closeLabel: t("coverage_sentiment_by_platform_close"),
                positive: t("coverage_sentiment_positive"),
                neutral: t("coverage_sentiment_neutral"),
                negative: t("coverage_sentiment_negative"),
                noData: t("coverage_sentiment_by_platform_no_data"),
                platformMainstream: t("coverage_platform_mainstream"),
              },
              topicsTitle: t("coverage_topics_title"),
              topicsCountSuffix: t("coverage_topics_count_suffix"),
              noDataYet: t("coverage_no_data_yet"),
              topicsByPlatform: {
                iconAriaLabel: t("coverage_topics_by_platform_aria"),
                dialogTitle: t("coverage_topics_by_platform_title"),
                dialogSubtitle: t("coverage_topics_by_platform_subtitle"),
                closeLabel: t("coverage_sentiment_by_platform_close"),
                noData: t("coverage_topics_by_platform_no_data"),
                platformMainstream: t("coverage_platform_mainstream"),
              },
            }}
          />
        </div>
      </section>

      <section className="pb-12 sm:pb-16">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 lg:grid-cols-3">
          <div
            id="trending"
            className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
                {t("section_trending")}
              </h2>
              <TrendingUp className="h-4 w-4 text-brand-600" />
            </div>
            {trendingRows.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-xs text-slate-500">
                <I18nText text={t("how_coverage_posts_empty")} />
              </div>
            ) : (
              <TrendingTopicsList
                topics={trendingRows}
                countLabel={t("trending_count_suffix")}
              />
            )}
          </div>

          <div
            id="sentiment"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm scroll-mt-24"
          >
            <h2 className="text-balance text-base font-semibold text-slate-900 sm:text-lg">
              <I18nText text={t("section_sentiment")} />
            </h2>
            {sentimentTotal === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
                <I18nText text={t("how_coverage_posts_empty")} />
              </div>
            ) : (
              <>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full">
                  <span
                    className="bg-emerald-500"
                    style={{ width: `${sentimentPct.positive}%` }}
                  />
                  <span
                    className="bg-slate-300"
                    style={{ width: `${sentimentPct.neutral}%` }}
                  />
                  <span
                    className="bg-amber-500"
                    style={{ width: `${sentimentPct.negative}%` }}
                  />
                </div>
                <div className="mt-4 space-y-2 text-xs">
                  <SentimentRow
                    color="bg-emerald-500"
                    pct={`${Math.round(sentimentPct.positive)}%`}
                    label={t("live_sentiment_positive")}
                  />
                  <SentimentRow
                    color="bg-slate-300"
                    pct={`${Math.round(sentimentPct.neutral)}%`}
                    label={t("live_sentiment_neutral")}
                  />
                  <SentimentRow
                    color="bg-amber-500"
                    pct={`${Math.round(sentimentPct.negative)}%`}
                    label={t("live_sentiment_concerned")}
                  />
                </div>
              </>
            )}

            <h3 className="mt-6 text-balance text-base font-semibold text-slate-900 sm:text-lg">
              {t("section_categories")}
            </h3>
            {categories.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs text-slate-500">
                <I18nText text={t("how_coverage_posts_empty")} />
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {categories.map((c) => (
                  <div key={c.label} className="text-xs">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600">
                      <span>{c.label}</span>
                      <span className="tabular-nums">
                        {c.volume.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${c.tone}`}
                        style={{ width: `${(c.volume / catMax) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {totalPosts > 0 && (
              <p className="mt-4 text-[10px] text-slate-400">
                {totalPosts.toLocaleString()} posts ingested
              </p>
            )}
          </div>
        </div>
      </section>

      <PlatformsBreakdown
        t={t}
        breakdown={overview?.platformBreakdown ?? []}
      />

      {process.env.NODE_ENV !== "production" && (
        <p className="mx-auto mb-12 flex max-w-3xl items-center justify-center gap-1.5 px-4 text-center text-xs text-slate-500 sm:px-6">
          <Info className="h-3.5 w-3.5" />
          {t("data_note")}
        </p>
      )}

      <section className="pb-16 sm:pb-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50/50 to-white p-6 text-center shadow-sm">
            <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {t("explore_back_cta_title")}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-relaxed text-slate-600">
              {t("explore_back_cta_body")}
            </p>
            <Link
              href="/insights"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
            >
              {t("back_to_insights")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"Insights">>>;

const PLATFORM_VISUALS: Record<
  string,
  {
    key: string;
    Icon: React.ComponentType<{ className?: string }>;
    iconBg: string;
    barColor: string;
    href: string;
  }
> = {
  mainstream: {
    key: "news",
    Icon: Newspaper,
    iconBg: "bg-slate-900",
    barColor: "bg-slate-500",
    href: "/insights/mainstream",
  },
  youtube: {
    key: "youtube",
    Icon: YouTubeIcon,
    iconBg: "bg-red-600",
    barColor: "bg-red-500",
    href: "/insights/youtube",
  },
  tiktok: {
    key: "tiktok",
    Icon: TikTokIcon,
    iconBg: "bg-black",
    barColor: "bg-fuchsia-500",
    href: "/insights/tiktok",
  },
  x: {
    key: "x",
    Icon: XIcon,
    iconBg: "bg-black",
    barColor: "bg-zinc-700",
    href: "/insights/x",
  },
  instagram: {
    key: "instagram",
    Icon: InstagramIcon,
    iconBg: "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
    barColor: "bg-rose-500",
    href: "/insights/instagram",
  },
  facebook: {
    key: "facebook",
    Icon: FacebookIcon,
    iconBg: "bg-[#1877F2]",
    barColor: "bg-blue-600",
    href: "/insights/facebook",
  },
};

const PLATFORM_ORDER = ["mainstream", "youtube", "tiktok", "x", "instagram", "facebook"];

function PlatformsBreakdown({
  t,
  breakdown,
}: {
  t: T;
  breakdown: Array<{
    platform: string;
    posts: number;
    topTopic: { label: string; keywords: string[] } | null;
    topCategory: string | null;
  }>;
}) {
  const byPlatform = new Map(breakdown.map((b) => [b.platform, b]));
  const totalPosts = breakdown.reduce((s, b) => s + b.posts, 0) || 1;

  const rows = PLATFORM_ORDER.map((platform) => {
    const visual = PLATFORM_VISUALS[platform];
    const data = byPlatform.get(platform);
    const posts = data?.posts ?? 0;
    const sharePct = (posts / totalPosts) * 100;
    return {
      platform,
      visual,
      posts,
      sharePct,
      topTopic: data?.topTopic ?? null,
      topCategory: data?.topCategory ?? null,
    };
  });

  if (totalPosts <= 1 && breakdown.length === 0) {
    return (
      <section className="pb-16 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("section_platforms")}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
              {t("section_platforms_subtitle")}
            </p>
          </div>
          <div className="mt-10 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            <I18nText text={t("how_coverage_posts_empty")} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-16 sm:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_platforms")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_platforms_subtitle")}
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {t("section_source_mix")}
          </p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full">
            {rows.map((r) =>
              r.sharePct > 0 ? (
                <span
                  key={r.platform}
                  className={r.visual.barColor}
                  style={{ width: `${r.sharePct}%` }}
                  title={`${r.visual.key} · ${r.sharePct.toFixed(1)}%`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            {rows.map((r) => (
              <span
                key={r.platform}
                className={`inline-flex items-center gap-1.5 ${r.posts === 0 ? "text-slate-400" : "text-slate-600"}`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${r.visual.barColor}`} />
                <span className="font-medium text-slate-700">
                  {t(`platform_${r.visual.key}_name` as Parameters<typeof t>[0])}
                </span>
                <span className="tabular-nums">
                  {r.posts === 0 ? "—" : `${r.sharePct.toFixed(1)}%`}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const { visual, posts, topTopic, topCategory } = r;
            const { Icon, iconBg, href } = visual;
            const hasData = posts > 0;
            const categoryLabel = topCategory
              ? t(`dawah_category_${topCategory}` as Parameters<typeof t>[0])
              : null;
            const inner = (
              <>
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${iconBg}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {t(`platform_${visual.key}_name` as Parameters<typeof t>[0])}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="tabular-nums">
                        {hasData ? (
                          `${posts.toLocaleString()} posts`
                        ) : (
                          <I18nText text={t("how_coverage_posts_empty")} />
                        )}
                      </span>
                      {hasData && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">
                          {r.sharePct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {hasData && (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" />
                  )}
                </div>

                {hasData && (
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {t("platform_top_topic")}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-800">
                      {topTopic?.label ?? t("platform_top_topic_pending")}
                    </p>
                    {(topTopic?.keywords.length || categoryLabel) && (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {topTopic?.keywords.slice(0, 3).join(" · ") || categoryLabel}
                      </p>
                    )}
                  </div>
                )}

                {hasData && href && (
                  <p className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 group-hover:text-brand-900">
                    {t("platform_view_breakdown")}
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </p>
                )}
              </>
            );

            const cardClass = clsx(
              "group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition",
              hasData && href && "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md",
              !hasData && "opacity-60",
            );

            return hasData && href ? (
              <Link key={visual.key} href={href} className={cardClass}>
                {inner}
              </Link>
            ) : (
              <article key={visual.key} className={cardClass}>
                {inner}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.16a8.16 8.16 0 0 0 4.77 1.52V6.23a4.85 4.85 0 0 1-1.84-.54z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2.163c3.204 0 3.584.012 4.849.07 3.255.148 4.771 1.691 4.919 4.919.058 1.265.069 1.644.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.849.07-3.205 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function SentimentRow({
  color,
  pct,
  label,
}: {
  color: string;
  pct: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="font-semibold tabular-nums text-slate-700">{pct}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

function localizeCategory(t: T, category: string): string {
  return t(`dawah_category_${category}` as Parameters<typeof t>[0]);
}
