/**
 * What the public /radar pages read, kept in the in-process cache
 * (stale-while-revalidate.ts) instead of being queried on every visit.
 *
 * Why (2026-11-26): /radar took 5 to 10 s to open and /radar/youtube 16 s, the
 * same on a second visit seconds later. The pages ask for `revalidate = 300`,
 * but the locale layout reads the session cookie (PendingApprovalBanner →
 * auth()), so every page renders on every request and that setting never
 * applies. /radar/<platform> counts every post the platform ever had, one query
 * after the other (the distinct-author count alone is ~7 s on YouTube). The
 * data changes when ingest runs (news every 2 h, labels nightly), so a visitor
 * now gets the last copy at once and a new one is built behind the visit.
 *
 * Only data shared by every visitor lives here. The session (`auth()`) is read
 * by the page itself, per request, never cached.
 */
import { PLATFORM_SLUGS } from "@/data/drilldowns";
import {
  getOverviewInsights,
  getPlatformInsights,
  getTopEngagedPosts,
  type InsightsFilters,
  type TopEngagedPost,
} from "@/lib/briefing-data";
import {
  getPlatformDistribution7d,
  getRisingVideos,
  getSentimentByPlatform7d,
  getSentimentDistribution7d,
  getThemeGroupReachDelta,
  getTopIssues,
  getTopicDistribution7d,
  getTopicsByPlatform7d,
  type RisingVideo,
  type ThemeGroupReach,
} from "@/lib/dashboard-metrics";
import { cached } from "@/lib/stale-while-revalidate";

/** How long a copy counts as fresh. Ingest adds news every 2 h, so a copy is
 *  at most one ingest behind. */
export const RADAR_TTL_MS = 15 * 60 * 1000;

/** /radar/<platform> shows all-time totals, which move by well under 1% a day,
 *  so after a long quiet spell the first visitor is handed the old copy (and a
 *  new one is built behind them) rather than waiting ~16 s. /radar itself is a
 *  7-day view and keeps the cache's 24 h default. */
const PLATFORM_MAX_STALE_MS = 3 * 24 * 3_600_000;

async function loadOverview() {
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
    // High cap, not "no limit" — the SQL HAVING count >= 2 already does the
    // real curation; this just protects against a pathological ingest spike.
    getTopIssues(100),
    getPlatformDistribution7d(),
    getSentimentDistribution7d(),
    getSentimentByPlatform7d(),
    getTopicDistribution7d(10),
    getTopicsByPlatform7d(5),
  ]);
  return {
    overview,
    topIssues,
    platformDist,
    sentimentDist,
    sentimentByPlatform,
    topicDist,
    topicsByPlatform,
  };
}

export type RadarOverview = Awaited<ReturnType<typeof loadOverview>>;

export function getRadarOverview(): Promise<RadarOverview> {
  return cached("radar:overview", loadOverview, { ttlMs: RADAR_TTL_MS });
}

/** The key must name every filter the query obeys. Only `mainstream` obeys
 *  scope and region (buildPlatformFilter in briefing-data.ts); every other
 *  platform shares one copy whatever the URL says. */
function insightsKey(platform: string, filters?: InsightsFilters): string {
  if (platform !== "mainstream") return `radar:platform:${platform}`;
  return `radar:platform:mainstream:${filters?.scope ?? "all"}:${filters?.region ?? ""}`;
}

export function getCachedPlatformInsights(platform: string, filters?: InsightsFilters) {
  return cached(insightsKey(platform, filters), () => getPlatformInsights(platform, filters), {
    ttlMs: RADAR_TTL_MS,
    maxStaleMs: PLATFORM_MAX_STALE_MS,
  });
}

export type PlatformExtras = {
  risingVideos: RisingVideo[];
  topEngaged: TopEngagedPost[];
  themeGroupReach: ThemeGroupReach[];
};

/** The secondary panels, which do not depend on scope or region. Which ones a
 *  platform shows is decided here, as the page did before. */
async function loadExtras(platform: string): Promise<PlatformExtras> {
  // YouTube is the only platform with a view-count time series (rising
  // videos). X / Instagram / YouTube carry engagement at ingest. The reach
  // widget needs engagement or a per-article count; TikTok and Facebook have
  // neither.
  const isYouTube = platform === "youtube";
  const hasEngagement = platform === "x" || platform === "instagram" || platform === "youtube";
  const showBucketReach =
    platform === "youtube" || platform === "x" || platform === "instagram" || platform === "mainstream";
  const [risingVideos, topEngaged, themeGroupReach] = await Promise.all([
    isYouTube ? getRisingVideos(10) : Promise.resolve([] as RisingVideo[]),
    hasEngagement ? getTopEngagedPosts(platform, 10) : Promise.resolve([] as TopEngagedPost[]),
    showBucketReach ? getThemeGroupReachDelta(platform) : Promise.resolve([] as ThemeGroupReach[]),
  ]);
  return { risingVideos, topEngaged, themeGroupReach };
}

export function getCachedPlatformExtras(platform: string): Promise<PlatformExtras> {
  return cached(`radar:extras:${platform}`, () => loadExtras(platform), {
    ttlMs: RADAR_TTL_MS,
    maxStaleMs: PLATFORM_MAX_STALE_MS,
  });
}

/** Load /radar and every unfiltered /radar/<platform> at boot, so the first
 *  visits after a deploy find them ready. One page at a time, never all at
 *  once: each platform reads a large part of social_posts, and the VM has
 *  2 GB (parallel heavy reads have taken prod down before). */
export async function warmRadar(): Promise<void> {
  await getRadarOverview();
  for (const platform of PLATFORM_SLUGS) {
    await getCachedPlatformInsights(platform);
    await getCachedPlatformExtras(platform);
  }
}
