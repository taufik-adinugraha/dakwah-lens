import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Flame,
  Info,
  Newspaper,
  Radio,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { BackToInsightsLink } from "@/components/BackToInsightsLink";
import { I18nText } from "@/components/I18nText";
import { TopicsByCluster } from "@/components/TopicsByCluster";
import { PlatformStoriesFilter } from "./PlatformStoriesFilter";
import {
  CLUSTER_TONES,
  DRILLDOWN_CONFIGS,
  PLATFORM_SLUGS,
  type DrilldownConfig,
  type PlatformKey,
} from "@/data/drilldowns";
import { routing } from "@/i18n/routing";
import {
  getPlatformInsights,
  getTopEngagedPosts,
  type InsightsFilters,
  type PlatformInsights,
  type ScopeFilter,
  type TopEngagedPost,
} from "@/lib/briefing-data";
import {
  getRisingVideos,
  getThemeGroupReachDelta,
  type RisingVideo,
  type ThemeGroupReach,
} from "@/lib/dashboard-metrics";

export function generateStaticParams() {
  // Pre-render every (locale, platform) combination.
  return routing.locales.flatMap((locale) =>
    PLATFORM_SLUGS.map((platform) => ({ locale, platform })),
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/radar/[platform]">): Promise<Metadata> {
  const { locale, platform } = await params;
  const config = DRILLDOWN_CONFIGS[platform as PlatformKey];
  if (!config) return {};
  const t = await getTranslations({ locale, namespace: config.namespace });
  return { title: t("page_title") };
}

// Region picker presets — mirror the onboarding `loc_*` codes so we use the
// same vocabulary across the app. Only relevant for the `mainstream` platform.
const REGIONS = [
  "jabodetabek",
  "jawa_barat",
  "jawa_tengah_diy",
  "jawa_timur",
  "sumatera",
  "kalimantan",
  "sulawesi",
  "indonesia_timur",
] as const;

export default async function PlatformDrilldownPage({
  params,
  searchParams,
}: PageProps<"/[locale]/radar/[platform]">) {
  const { locale, platform } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const config = DRILLDOWN_CONFIGS[platform as PlatformKey];
  if (!config) notFound();

  const t = await getTranslations(config.namespace);
  const tInsights = await getTranslations({ locale, namespace: "Briefing" });

  // Scope-aware filters — only meaningful on `mainstream`. Defaults to
  // "all" so we don't surprise existing users. Region wins when both are
  // set in the query string.
  const rawScope = typeof sp.scope === "string" ? sp.scope : undefined;
  const rawRegion = typeof sp.region === "string" ? sp.region : undefined;
  const scope: ScopeFilter =
    rawScope === "national" || rawScope === "regional" || rawScope === "all"
      ? rawScope
      : "all";
  const region =
    rawRegion && (REGIONS as readonly string[]).includes(rawRegion)
      ? rawRegion
      : null;
  const filters: InsightsFilters = {
    scope: region ? "regional" : scope,
    region,
  };

  // Fetch real ingested data; null if nothing has been scraped for this
  // platform yet, in which case all sections fall back to mock content.
  // `session` gates the "Apply for Full Access" CTA at the page bottom —
  // signed-in users have already converted, so they don't need that pitch.
  //
  // Per-platform secondary signals fetched in parallel:
  //   - YouTube: BOTH — rising videos (24h Δ, the only platform we
  //     snapshot today) AND top-engaged posts (absolute view count).
  //     Rising = "what's surging right now"; top-engaged = "what's
  //     dominating this week overall". Both signals are useful and
  //     complement each other.
  //   - X / Instagram: top-engaged posts only (no time series).
  //   - Mainstream / TT / FB: skip — no useful engagement signal.
  const isYouTube = platform === "youtube";
  const hasEngagement =
    platform === "x" || platform === "instagram" || platform === "youtube";
  // Bucket-reach widget is meaningful on every platform that has either
  // engagement (YT/X/IG, sums views) or a per-article count (mainstream,
  // sums articles). Skip on TikTok (disabled) and Facebook (no data).
  const showBucketReach =
    platform === "youtube" ||
    platform === "x" ||
    platform === "instagram" ||
    platform === "mainstream";
  const [live, session, risingVideos, topEngaged, themeGroupReach] =
    await Promise.all([
      getPlatformInsights(platform, filters),
      auth(),
      isYouTube ? getRisingVideos(10) : Promise.resolve([] as RisingVideo[]),
      hasEngagement
        ? getTopEngagedPosts(platform, 10)
        : Promise.resolve([] as TopEngagedPost[]),
      showBucketReach
        ? getThemeGroupReachDelta(platform)
        : Promise.resolve([] as ThemeGroupReach[]),
    ]);

  // Use real da'wah-category clusters when we have a meaningful number of
  // classified posts; below that threshold the mock editorial clusters are
  // more informative than a sparse histogram.
  const useRealClusters = !!live && live.totalPosts >= 5;

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <BackToInsightsLink />
      </div>
      <Hero config={config} t={t} live={live} />
      {platform === "mainstream" && (
        <ScopePicker
          locale={locale}
          activeScope={scope}
          activeRegion={region}
          tInsights={tInsights}
        />
      )}
      {themeGroupReach.length > 0 && (
        <ThemeGroupReachPanel rows={themeGroupReach} tInsights={tInsights} />
      )}
      {live && live.totalPosts > 0 && (
        <LiveStream live={live} t={t} tInsights={tInsights} />
      )}
      {useRealClusters ? (
        <CategoryTopicCharts live={live!} locale={locale} platform={platform} />
      ) : (
        <>
          <ClusterCards config={config} t={t} />
          <TopicsByCluster config={config} />
        </>
      )}
      <TopOutlets config={config} t={t} live={live} platform={platform} />
      {risingVideos.length > 0 && (
        <RisingVideosPanel videos={risingVideos} tInsights={tInsights} />
      )}
      {topEngaged.length > 0 && (
        <TopEngagedPanel
          posts={topEngaged}
          platform={platform}
          tInsights={tInsights}
          locale={locale}
        />
      )}
      <TopStories config={config} t={t} live={live} platform={platform} />
      {/* Apply-for-Full-Access CTA hidden (2026-05-23). */}
      {false && !session?.user && <CTA t={t} />}
    </>
  );
}

/**
 * Scope/region picker — only rendered on `/radar/mainstream`. Each
 * pill is a plain Link with the appropriate `?scope=` or `?region=` query
 * so the page stays 100% server-rendered.
 */
function ScopePicker({
  locale,
  activeScope,
  activeRegion,
  tInsights,
}: {
  locale: string;
  activeScope: ScopeFilter;
  activeRegion: string | null;
  tInsights: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const _ = locale; // accepted for symmetry with other section components
  const pill = (selected: boolean) =>
    selected
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300";

  return (
    <section className="border-b border-slate-100 bg-slate-50/50 py-6">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tInsights("scope_picker_label")}
          </span>
          <Link
            href="/radar/mainstream"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition ${pill(activeScope === "all" && !activeRegion)}`}
          >
            {tInsights("scope_all")}
          </Link>
          <Link
            href="/radar/mainstream?scope=national"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition ${pill(activeScope === "national" && !activeRegion)}`}
          >
            {tInsights("scope_national")}
          </Link>
          <Link
            href="/radar/mainstream?scope=regional"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition ${pill(activeScope === "regional" && !activeRegion)}`}
          >
            {tInsights("scope_regional_all")}
          </Link>
          <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />
          {REGIONS.map((r) => (
            <Link
              key={r}
              href={`/radar/mainstream?region=${r}`}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition ${pill(activeRegion === r)}`}
            >
              {tInsights(`loc_${r}` as Parameters<typeof tInsights>[0])}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Display tones cycled across the 9 PRD da'wah categories. */
const CATEGORY_TONES: Record<string, keyof typeof CLUSTER_TONES> = {
  aqidah: "emerald",
  akhlaq: "brand",
  muamalah: "amber",
  social_justice: "rose",
  family: "violet",
  youth: "cyan",
  education: "brand",
  economic_ethics: "amber",
  health: "emerald",
};

// DAWAH_CATEGORIES is imported from @/lib/briefing-data (single source).

/**
 * Da'wah categories + discovered topics, rendered as two side-by-side
 * horizontal bar charts (stacked on mobile, lg:grid-cols-2 on desktop).
 *
 * Replaces the earlier two separate card-grid sections. Each panel is a
 * single "frame": one bar per item, scaled to the panel's own max so the
 * largest item fills the track. Bars stay clickable — a row links to the
 * filtered post list, same as the old cards.
 *
 * The two are distinct axes: `categories` is the fixed 9-segment PRD
 * taxonomy from the relevance classifier (ALL 9 shown, 0-filled, so the
 * chart reads complete); `topics` are emergent Gemini-labelled clusters
 * showing what the week is actually *about*, with per-platform counts.
 */
async function CategoryTopicCharts({
  live,
  locale,
  platform,
}: {
  live: PlatformInsights;
  locale: string;
  platform: string;
}) {
  const tInsights = await getTranslations({ locale, namespace: "Briefing" });

  // 9 PRD categories pane retired 2026-06-05 — the per-platform
  // theme-group breakdown lives in the ThemeGroupReachPanel WoW
  // strip near the top of the page. The discovered-topics column
  // below is the per-platform topic distribution.

  // Per-platform discovered topics (already sorted desc by the data layer).
  const topics = live.discoveredTopics;
  const topTotal = topics.reduce((s, t) => s + t.postCount, 0);
  const topMax = Math.max(1, ...topics.map((t) => t.postCount));
  const TOPIC_TONES: Array<keyof typeof CLUSTER_TONES> = [
    "brand",
    "emerald",
    "amber",
    "violet",
    "rose",
    "cyan",
  ];
  const hasTopics = topics.length > 0;

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-6">
          {/* ── Discovered topics ── */}
          {hasTopics && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                  {tInsights("section_topics_discovered_title")}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  <Sparkles className="h-3 w-3" />
                  {tInsights("section_topics_discovered_badge")}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {tInsights("section_topics_discovered_subtitle")}
              </p>

              <div className="mt-5 space-y-1">
                {topics.map((topic, idx) => {
                  const tone =
                    CLUSTER_TONES[TOPIC_TONES[idx % TOPIC_TONES.length]];
                  const sharePct = topTotal
                    ? ((topic.postCount / topTotal) * 100).toFixed(1)
                    : "0.0";
                  return (
                    <Link
                      key={topic.id}
                      href={`/briefings/${platform}/posts?topic=${topic.id}`}
                      className="group block rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-slate-800">
                          {topic.label}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">
                          {topic.postCount.toLocaleString()}
                          <span className="text-slate-400"> · {sharePct}%</span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${(topic.postCount / topMax) * 100}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function Hero({
  config,
  t,
  live,
}: {
  config: DrilldownConfig;
  t: T;
  live: PlatformInsights | null;
}) {
  const totalArticles =
    live?.totalPosts ?? config.clusters.reduce((s, c) => s + c.articles, 0);
  const totalOutlets =
    live?.uniqueAuthors ?? config.clusters.reduce((s, c) => s + c.outlets.length, 0);

  return (
    <section className="relative isolate overflow-hidden pt-12 pb-10 sm:pt-16 sm:pb-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute -top-20 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-brand-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Link
          href="/briefings"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("breadcrumb_back")}
        </Link>

        <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
                <Newspaper className="h-3.5 w-3.5" />
                {t("badge")}
              </span>
              {live && live.totalPosts > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  Live · {live.totalPosts.toLocaleString()} posts ingested
                </span>
              )}
            </div>
            <h1 className="mt-4 text-balance text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
              {t("subtitle", {
                count: totalArticles.toLocaleString(),
                outlets: String(totalOutlets),
              })}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            <Stat
              label={t("stat_articles")}
              value={
                totalArticles >= 1000
                  ? `${(totalArticles / 1000).toFixed(1)}K`
                  : String(totalArticles)
              }
            />
            <Stat label={t("stat_outlets")} value={String(totalOutlets)} />
            <Stat label={t("stat_clusters")} value={String(config.clusters.length)} />
            {/* The "stat_categories" tile showing the 9-PRD count
                was dropped 2026-06-05; theme-group count (14) is
                already implicit from the ThemeGroupReachPanel above. */}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center shadow-sm">
      <p className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
    </div>
  );
}

function ClusterCards({ config, t }: { config: DrilldownConfig; t: T }) {
  const totalArticles = config.clusters.reduce((s, c) => s + c.articles, 0);
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_clusters_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_clusters_subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {config.clusters.map((c) => {
            const tone = CLUSTER_TONES[c.tone];
            const sharePct = ((c.articles / totalArticles) * 100).toFixed(1);
            return (
              <article
                key={c.key}
                className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900 sm:text-lg">
                      {t(`cluster_${c.key}_name`)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {c.outlets.length} {t("stat_outlets").toLowerCase()} ·{" "}
                      {c.articles.toLocaleString()} {t("stat_articles").toLowerCase()}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                      tone.chipBg,
                      tone.chipText,
                      tone.ring,
                    )}
                  >
                    {sharePct}%
                  </span>
                </div>

                <p className="mt-3 text-pretty text-xs leading-relaxed text-slate-600">
                  {t(`cluster_${c.key}_desc`)}
                </p>

                <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${tone.bar}`}
                    style={{ width: `${sharePct}%` }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {c.outlets.map((o) => (
                    <span
                      key={o}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
                    >
                      {o}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TopOutlets({
  config,
  t,
  live,
  platform,
}: {
  config: DrilldownConfig;
  t: T;
  live: PlatformInsights | null;
  platform: string;
}) {
  // Prefer live data when we have a meaningful number of distinct outlets.
  // When live data is present, each row is a clickable link to the filtered
  // post list — config-based fallback rows stay non-interactive since they
  // are demo placeholders.
  const useLive = !!live && live.topOutlets.length >= 2;
  const outlets = useLive ? live!.topOutlets : config.topOutlets;
  const max = Math.max(...outlets.map((o) => o.articles), 1);

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_outlets_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_outlets_subtitle")}
          </p>
          {useLive && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Radio className="h-3 w-3" />
              Real-time · from {live!.totalPosts.toLocaleString()} ingested posts
            </p>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            {outlets.map((o) => {
              const pct = (o.articles / max) * 100;
              const rowInner = (
                <>
                  <span className="truncate text-sm font-medium text-slate-800">
                    {o.name}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-slate-500">
                    {o.articles.toLocaleString()}
                  </span>
                </>
              );
              const gridClasses =
                "grid grid-cols-[140px_1fr_auto] items-center gap-3 rounded-lg px-2 py-2 sm:grid-cols-[200px_1fr_auto]";
              return useLive ? (
                <Link
                  key={o.name}
                  href={`/briefings/${platform}/posts?author=${encodeURIComponent(o.name)}`}
                  className={`${gridClasses} transition hover:bg-slate-50`}
                >
                  {rowInner}
                </Link>
              ) : (
                <div key={o.name} className={gridClasses}>
                  {rowInner}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Real-time live-stream section, only rendered when there ARE ingested posts.
 * Shows top posts by da'wah relevance with sentiment badges and the dominant
 * category — the user can verify the ingestion pipeline is actually surfacing
 * the right kind of content.
 */
function LiveStream({
  live,
  t,
  tInsights,
}: {
  live: PlatformInsights;
  t: T;
  tInsights: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const totalSentiment = Math.max(
    1,
    live.sentimentMix.positive + live.sentimentMix.neutral + live.sentimentMix.negative,
  );
  const posPct = Math.round((live.sentimentMix.positive / totalSentiment) * 100);
  const neuPct = Math.round((live.sentimentMix.neutral / totalSentiment) * 100);
  const negPct = 100 - posPct - neuPct;

  return (
    <section className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/40 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <Radio className="h-3 w-3" />
              {tInsights("live_sentiment_concerned_badge")}
            </span>
            <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {tInsights("live_section_title")}
            </h2>
            <I18nText
              text={tInsights("live_section_subtitle", {
                count: live.totalPosts.toLocaleString(),
              })}
              className="mt-1.5 block text-pretty text-sm text-slate-600"
            />
            {/* The "chart vs chip count" disclaimer was only needed while
                the post list was capped at 50 (and later 1000) — chip
                counts now match the chart because the list shows every
                post (sentiment classification is 100% coverage), so the
                note is omitted to reduce footer noise. */}
          </div>

          {/* Sentiment mix mini-chart */}
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {tInsights("live_sentiment_mix")}
            </p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full">
              <span className="bg-emerald-500" style={{ width: `${posPct}%` }} />
              <span className="bg-slate-300" style={{ width: `${neuPct}%` }} />
              <span className="bg-amber-500" style={{ width: `${negPct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs tabular-nums text-slate-600">
              <span>
                <span className="font-semibold text-emerald-700">{posPct}%</span>{" "}
                {tInsights("live_sentiment_positive")}
              </span>
              <span>
                <span className="font-semibold text-slate-700">{neuPct}%</span>{" "}
                {tInsights("live_sentiment_neutral")}
              </span>
              <span>
                <span className="font-semibold text-amber-700">{negPct}%</span>{" "}
                {tInsights("live_sentiment_concerned")}
              </span>
            </div>
          </div>
        </div>

        <PlatformStoriesFilter
          stories={live.topStories}
          filterLabels={{
            all: tInsights("filter_all"),
            positive: tInsights("live_sentiment_positive"),
            neutral: tInsights("live_sentiment_neutral"),
            negative: tInsights("live_sentiment_concerned"),
          }}
          showMoreLabel={tInsights("show_more")}
          openOriginalLabel={tInsights("posts_open_source")}
          emptyMessage={tInsights("how_coverage_posts_empty")}
          expandLabel={tInsights("livestream_show_posts")}
          collapseLabel={tInsights("livestream_hide_posts")}
        />
      </div>
    </section>
  );
}

function TopStories({
  config,
  t,
  live,
  platform,
}: {
  config: DrilldownConfig;
  t: T;
  live: PlatformInsights | null;
  platform: string;
}) {
  // Use REAL top posts (sorted by da'wah relevance) when we have any.
  // Falls back to the i18n-keyed demo strings only as a placeholder
  // while ingestion is empty — the demo was the source of the
  // "Government urges work-life balance after burnout study" English
  // mock that confused users about whether the section was real.
  const useLive = !!live && live.topStories.length > 0;
  const stories = useLive ? live!.topStories.slice(0, config.storyCount) : [];

  return (
    <section className="bg-slate-50/60 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("section_stories_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("section_stories_subtitle")}
          </p>
          {useLive && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <Radio className="h-3 w-3" />
              Real-time · top posts by da&apos;wah relevance
            </p>
          )}
        </div>

        {useLive ? (
          <div className="mt-8 space-y-2.5">
            {stories.map((post) => {
              // First non-empty line of the post body — what most outlets
              // put their headline as. Trim and cap so a long article body
              // doesn't visually overflow.
              const title =
                (post.text ?? "").split("\n").find((s) => s.trim()) ?? "";
              const inner = (
                <>
                  <Newspaper className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {title.slice(0, 130) || "(no headline)"}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                      {post.author && (
                        <>
                          <span className="font-medium text-slate-700">
                            {post.author}
                          </span>
                          {post.themeGroup && <span>·</span>}
                        </>
                      )}
                      {post.themeGroup && (
                        <span>{post.themeGroup}</span>
                      )}
                      {typeof post.dawahOpportunity === "number" && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums">
                            relevance {(post.dawahOpportunity * 100).toFixed(0)}%
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300" />
                </>
              );
              return post.url ? (
                <a
                  key={post.id}
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  {inner}
                </a>
              ) : (
                <div
                  key={post.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
            {t("data_note")}
          </div>
        )}
      </div>
    </section>
  );
}

function CTA({ t }: { t: T }) {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-brand-700 px-6 py-12 text-center text-white shadow-2xl sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
          >
            <div className="absolute -top-24 left-1/3 h-72 w-72 rounded-full bg-amber-300 opacity-25 blur-3xl" />
            <div className="absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-emerald-300 opacity-30 blur-3xl" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Free forever
          </span>
          <h2 className="mt-6 text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            {t("cta_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-white/85 sm:text-base">
            {t("cta_body")}
          </p>
          <Link
            href="/login"
            className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-emerald-800 shadow-lg transition hover:bg-emerald-50"
          >
            {t("cta_button")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * RisingVideosPanel — YouTube only.
 *
 * Mirrors the dashboard's "Video sedang viral pekan ini" but rendered
 * as a /radar/youtube section. The badge percentage is "% of total
 * views that came from the past 24h" (bounded 0-100) — see
 * dashboard-metrics.ts:getRisingVideos for the metric rationale.
 * ─────────────────────────────────────────────────────────────────── */
function RisingVideosPanel({
  videos,
  tInsights,
}: {
  videos: RisingVideo[];
  tInsights: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <section className="bg-rose-50/30 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
            <Flame className="h-3 w-3" />
            {tInsights("section_rising_videos_badge")}
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {tInsights("section_rising_videos_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {tInsights("section_rising_videos_subtitle_platform")}
          </p>
        </div>

        <ul className="mt-8 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {videos.map((v) => (
            <li key={v.postId} className="flex items-start gap-3 p-4 sm:p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xs font-bold text-rose-700 tabular-nums">
                {Math.round(v.deltaPct)}%
              </div>
              <div className="min-w-0 flex-1">
                {v.url ? (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-semibold text-slate-900 hover:text-rose-700"
                  >
                    {v.title}
                  </a>
                ) : (
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {v.title}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">
                    {v.channel}
                  </span>
                  {" · "}
                  {formatCompactInt(v.viewsNow)} views ·{" "}
                  <span className="text-emerald-700">
                    +{formatCompactInt(v.delta)}
                  </span>{" "}
                  {tInsights("rising_videos_vs_24h_ago")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────
 * TopEngagedPanel — X / Instagram.
 *
 * No time-series available for these platforms, so we surface posts
 * ranked by absolute engagement_score (log10 composite of
 * views + comments + likes). Distinct from LiveStream which sorts
 * by relevance + recency + engagement composite — this is a pure
 * "what's been engaged with most" feed, useful for spotting viral
 * moments the relevance sort might bury.
 * ─────────────────────────────────────────────────────────────────── */
function TopEngagedPanel({
  posts,
  platform,
  tInsights,
  locale,
}: {
  posts: TopEngagedPost[];
  platform: string;
  tInsights: Awaited<ReturnType<typeof getTranslations>>;
  locale: string;
}) {
  return (
    <section className="bg-amber-50/30 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            <TrendingUp className="h-3 w-3" />
            {tInsights("section_top_engaged_badge")}
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {tInsights("section_top_engaged_title", { platform })}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {tInsights("section_top_engaged_subtitle")}
          </p>
        </div>

        <ul className="mt-8 space-y-3">
          {posts.map((p, idx) => {
            const title =
              (p.text ?? "").split("\n").find((s) => s.trim())?.slice(0, 200) ??
              "";
            const inner = (
              <>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 tabular-nums">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-amber-700">
                    {title || "(no title)"}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    {p.author && (
                      <span className="font-medium text-slate-700">
                        @{p.author}
                      </span>
                    )}
                    {p.views !== null && (
                      <span className="tabular-nums">
                        {formatCompactInt(p.views)}{" "}
                        {tInsights("top_engaged_views")}
                      </span>
                    )}
                    {p.likes !== null && (
                      <span className="tabular-nums">
                        {formatCompactInt(p.likes)}{" "}
                        {tInsights("top_engaged_likes")}
                      </span>
                    )}
                    {p.comments !== null && (
                      <span className="tabular-nums">
                        {formatCompactInt(p.comments)}{" "}
                        {tInsights("top_engaged_comments")}
                      </span>
                    )}
                    {p.postedAt && (
                      <span className="text-slate-400">
                        {new Date(p.postedAt).toLocaleDateString(locale, {
                          timeZone: "Asia/Jakarta",
                        })}
                      </span>
                    )}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300" />
              </>
            );
            return (
              <li key={p.id}>
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow-md"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function formatCompactInt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/* ───────────────────────────────────────────────────────────────────
 * ThemeGroupReachPanel — week-over-week reach by THEME GROUP.
 *
 * Bucket = post's `theme_group` column (one of the 14 THEME_GROUPS or
 * Lainnya, Gemini-judged at ingest since 2026-06-04). Replaced the
 * 9-PRD da'wah-category buckets on 2026-06-05 — those scores stay as
 * an internal sub-signal but are no longer surfaced to readers.
 * Metric = SUM(engagement_views) on platforms with engagement
 * (YT/X/IG), or COUNT(*) on mainstream where RSS has no per-article
 * views. Labels are Indonesian by default (group names like "Hukum &
 * Keadilan") so no i18n lookup is needed.
 * ─────────────────────────────────────────────────────────────────── */
function ThemeGroupReachPanel({
  rows,
  tInsights,
}: {
  rows: ThemeGroupReach[];
  tInsights: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <section className="border-y border-slate-100 bg-slate-50/40 py-10 sm:py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
          {tInsights("section_bucket_reach_title")}
        </h2>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((r) => {
            const dir =
              r.deltaPct === null
                ? "—"
                : r.deltaPct > 0
                  ? "up"
                  : r.deltaPct < 0
                    ? "down"
                    : "flat";
            const deltaClass =
              dir === "up"
                ? "text-emerald-700"
                : dir === "down"
                  ? "text-rose-700"
                  : "text-slate-500";
            const unitLabel =
              r.unit === "articles"
                ? tInsights("bucket_reach_unit_articles")
                : r.unit === "posts"
                  ? tInsights("bucket_reach_unit_posts")
                  : tInsights("bucket_reach_unit_views");
            return (
              <div
                key={r.group}
                className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {r.group}
                </div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {formatCompactInt(r.valueThisWeek)} {unitLabel}
                </div>
                <div className={`text-[11px] tabular-nums ${deltaClass}`}>
                  {r.deltaPct === null
                    ? tInsights("bucket_reach_no_baseline")
                    : tInsights("bucket_reach_delta", {
                        sign: r.deltaPct >= 0 ? "+" : "",
                        pct: r.deltaPct.toFixed(0),
                      })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
