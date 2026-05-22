import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Info,
  Newspaper,
  Radio,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
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
  DAWAH_CATEGORIES,
  getPlatformInsights,
  type InsightsFilters,
  type PlatformInsights,
  type ScopeFilter,
} from "@/lib/insights-data";

export function generateStaticParams() {
  // Pre-render every (locale, platform) combination.
  return routing.locales.flatMap((locale) =>
    PLATFORM_SLUGS.map((platform) => ({ locale, platform })),
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/insights/[platform]">): Promise<Metadata> {
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
}: PageProps<"/[locale]/insights/[platform]">) {
  const { locale, platform } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const config = DRILLDOWN_CONFIGS[platform as PlatformKey];
  if (!config) notFound();

  const t = await getTranslations(config.namespace);
  const tInsights = await getTranslations({ locale, namespace: "Insights" });

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
  const [live, session] = await Promise.all([
    getPlatformInsights(platform, filters),
    auth(),
  ]);

  // Use real da'wah-category clusters when we have a meaningful number of
  // classified posts; below that threshold the mock editorial clusters are
  // more informative than a sparse histogram.
  const useRealClusters = !!live && live.totalPosts >= 5;

  return (
    <>
      <Hero config={config} t={t} live={live} />
      {platform === "mainstream" && (
        <ScopePicker
          locale={locale}
          activeScope={scope}
          activeRegion={region}
          tInsights={tInsights}
        />
      )}
      {live && live.totalPosts > 0 && (
        <LiveStream live={live} t={t} tInsights={tInsights} />
      )}
      {useRealClusters ? (
        <RealCategoryClusters live={live!} locale={locale} platform={platform} />
      ) : (
        <ClusterCards config={config} t={t} />
      )}
      {!useRealClusters && <TopicsByCluster config={config} />}
      {live && live.discoveredTopics.length > 0 && (
        <DiscoveredTopics live={live} locale={locale} platform={platform} />
      )}
      <TopOutlets config={config} t={t} live={live} platform={platform} />
      <TopStories config={config} t={t} live={live} platform={platform} />
      {!session?.user && <CTA t={t} />}
    </>
  );
}

/**
 * Scope/region picker — only rendered on `/insights/mainstream`. Each
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
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {tInsights("scope_picker_label")}
          </span>
          <Link
            href="/insights/mainstream"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-semibold transition ${pill(activeScope === "all" && !activeRegion)}`}
          >
            {tInsights("scope_all")}
          </Link>
          <Link
            href="/insights/mainstream?scope=national"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-semibold transition ${pill(activeScope === "national" && !activeRegion)}`}
          >
            {tInsights("scope_national")}
          </Link>
          <Link
            href="/insights/mainstream?scope=regional"
            className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-semibold transition ${pill(activeScope === "regional" && !activeRegion)}`}
          >
            {tInsights("scope_regional_all")}
          </Link>
          <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />
          {REGIONS.map((r) => (
            <Link
              key={r}
              href={`/insights/mainstream?region=${r}`}
              className={`inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition ${pill(activeRegion === r)}`}
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

// DAWAH_CATEGORIES is imported from @/lib/insights-data (single source).

async function RealCategoryClusters({
  live,
  locale,
  platform,
}: {
  live: PlatformInsights;
  locale: string;
  platform: string;
}) {
  // Use the shared Insights namespace for da'wah category labels so they're
  // consistent across platforms and properly localized.
  const tInsights = await getTranslations({ locale, namespace: "Insights" });
  const totalDominant = live.dominantCategories.reduce(
    (s, c) => s + c.posts,
    0,
  );
  const totalForShare = Math.max(1, totalDominant);

  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {tInsights("section_real_clusters_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {tInsights("section_real_clusters_subtitle")}
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
            <Radio className="h-3 w-3" />
            {tInsights("real_clusters_live_label", {
              count: totalDominant.toLocaleString(),
            })}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.dominantCategories.map((c) => {
            const toneKey = CATEGORY_TONES[c.category] ?? "brand";
            const tone = CLUSTER_TONES[toneKey];
            const sharePct = ((c.posts / totalForShare) * 100).toFixed(1);
            const label = DAWAH_CATEGORIES.includes(
              c.category as (typeof DAWAH_CATEGORIES)[number],
            )
              ? tInsights(
                  `dawah_category_${c.category}` as Parameters<typeof tInsights>[0],
                )
              : c.category;
            return (
              <Link
                key={c.category}
                href={`/insights/${platform}/posts?category=${c.category}`}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900 sm:text-lg">
                      {label}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {tInsights("real_clusters_post_count", {
                        count: c.posts.toLocaleString(),
                      })}
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
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${tone.bar}`}
                    style={{ width: `${sharePct}%` }}
                  />
                </div>
                <p className="mt-3 text-[11px] font-medium text-brand-700 opacity-0 transition group-hover:opacity-100">
                  {tInsights("category_view_posts")} →
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Topics discovered by the Gemini topic-discovery pass.
 * Distinct from the 9 PRD `categories`: categories are a fixed taxonomy
 * from the relevance classifier; topics are emergent clusters with
 * Gemini-authored Bahasa labels that surface what the conversation is
 * actually *about* this week. Each card links to the posts in the cluster.
 */
async function DiscoveredTopics({
  live,
  locale,
  platform,
}: {
  live: PlatformInsights;
  locale: string;
  platform: string;
}) {
  const tInsights = await getTranslations({ locale, namespace: "Insights" });
  const totalPosts = live.discoveredTopics.reduce(
    (s, t) => s + t.postCount,
    0,
  );
  const totalForShare = Math.max(1, totalPosts);

  return (
    <section className="border-t border-slate-100 bg-gradient-to-b from-white to-slate-50/40 py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <Sparkles className="h-3 w-3" />
            {tInsights("section_topics_discovered_badge")}
          </span>
          <h2 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {tInsights("section_topics_discovered_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {tInsights("section_topics_discovered_subtitle")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {live.discoveredTopics.map((topic, idx) => {
            const toneKeys: Array<keyof typeof CLUSTER_TONES> = [
              "brand",
              "emerald",
              "amber",
              "violet",
              "rose",
              "cyan",
            ];
            const tone = CLUSTER_TONES[toneKeys[idx % toneKeys.length]];
            const sharePct = ((topic.postCount / totalForShare) * 100).toFixed(
              1,
            );
            return (
              <Link
                key={topic.id}
                href={`/insights/${platform}/posts?topic=${topic.id}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold leading-snug text-slate-900">
                    {topic.label}
                  </p>
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
                <p className="mt-1 text-xs text-slate-500">
                  {tInsights("real_clusters_post_count", {
                    count: topic.postCount.toLocaleString(),
                  })}
                </p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${tone.bar}`}
                    style={{ width: `${sharePct}%` }}
                  />
                </div>
                {topic.keywords.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {topic.keywords.slice(0, 6).map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-[11px] font-medium text-brand-700 opacity-0 transition group-hover:opacity-100">
                  {tInsights("category_view_posts")} →
                </p>
              </Link>
            );
          })}
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
          href="/insights"
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
            <Stat
              label={t("stat_categories")}
              value={String(DAWAH_CATEGORIES.length)}
            />
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
                      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
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
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
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
                  href={`/insights/${platform}/posts?author=${encodeURIComponent(o.name)}`}
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
            <I18nText
              text={tInsights("live_section_top50_note", {
                count: live.totalPosts.toLocaleString(),
              })}
              className="mt-1 block text-pretty text-xs italic text-slate-500"
            />
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
            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-slate-600">
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
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
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
              const dominantCat = post.categories
                ? Object.entries(post.categories)
                    .sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0]
                : null;
              const inner = (
                <>
                  <Newspaper className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {title.slice(0, 130) || "(no headline)"}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      {post.author && (
                        <>
                          <span className="font-medium text-slate-700">
                            {post.author}
                          </span>
                          {dominantCat && <span>·</span>}
                        </>
                      )}
                      {dominantCat && (
                        <span className="capitalize">
                          {dominantCat.replace(/_/g, " ")}
                        </span>
                      )}
                      {(() => {
                        const score = post.dawahOpportunity ?? post.dawahRelevance;
                        if (typeof score !== "number") return null;
                        return (
                          <>
                            <span>·</span>
                            <span className="tabular-nums">
                              relevance {(score * 100).toFixed(0)}%
                            </span>
                          </>
                        );
                      })()}
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
