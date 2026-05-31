/**
 * Dashboard metric queries.
 *
 * Returns structured data (numbers + labels) from the DB so the dashboard
 * page can render real values instead of the previous hardcoded mock. All
 * functions return null / empty arrays / `hasEnoughData: false` when the
 * corpus doesn't have enough activity yet — the page renders a "—" or a
 * gentle "data filling in" hint rather than misleading polish.
 *
 * No caching here. At prototype scale these queries run in <50ms total.
 * If they get slow, wrap with next-intl's `unstable_cache` at a 5-min TTL.
 */

import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { currentWeekStartUtc } from "@/lib/user-flyer/quota";

/* ─────────────────────────────────────────────────────────────
 * Pulse — weighted composite over the last 7 days
 * ───────────────────────────────────────────────────────────── */

export type PulseSnapshot = {
  /** 0–10, null when fewer than MIN_POSTS_FOR_PULSE in the last 7 days. */
  score: number | null;
  /** Same-shape score for the PRIOR 7 days, for trend display. */
  scoreLastWeek: number | null;
  /** Points difference (positive = improvement). Null if either week lacks data. */
  delta: number | null;
  /** Daily post counts, oldest → newest, exactly 7 entries. */
  sparkline: number[];
  hasEnoughData: boolean;
};

const MIN_POSTS_FOR_PULSE = 7;

type DailyRow = {
  bucket: number;
  n_posts: number;
  n_pos: number;
  n_neu: number;
  n_neg: number;
  n_topics: number;
};

/**
 * Pulse formula per day, normalised to 0–10:
 *   - activity   = min(n_posts / 50, 1) × 10            (target 50 posts/day)
 *   - sentiment  = (n_pos + 0.5 × n_neu) / total × 10   (skip if no labelled posts)
 *   - diversity  = min(n_topics / 5, 1) × 10            (target 5 distinct topics/day)
 *   pulse = 0.4 × activity + 0.3 × sentiment + 0.3 × diversity
 *
 * Bucket scoring matches the explainer copy ("aggregate of trending topics,
 * sentiment shifts, and segment engagement"): activity = engagement,
 * sentiment = the shift signal, diversity = trending topic spread.
 */
function pulseFor(row: DailyRow): number | null {
  if (row.n_posts < 2) return null;
  const activity = Math.min(row.n_posts / 50, 1) * 10;
  const labelled = row.n_pos + row.n_neu + row.n_neg;
  const sentiment =
    labelled > 0 ? ((row.n_pos + 0.5 * row.n_neu) / labelled) * 10 : 5;
  const diversity = Math.min(row.n_topics / 5, 1) * 10;
  return 0.4 * activity + 0.3 * sentiment + 0.3 * diversity;
}

export async function getPulseSnapshot(): Promise<PulseSnapshot> {
  // One query, bucket 0 = today, bucket 13 = 13 days ago.
  // `floor(extract(epoch from (now() - created_at)) / 86400)` gives a 0-indexed
  // day-offset that's stable regardless of timezone (we just need consistency,
  // not wall-clock-day alignment).
  const rows = (await db.execute(sql`
    SELECT
      floor(extract(epoch from (now() - created_at)) / 86400)::int AS bucket,
      count(*)::int AS n_posts,
      count(*) FILTER (WHERE sentiment_label = 'positive')::int AS n_pos,
      count(*) FILTER (WHERE sentiment_label = 'neutral')::int AS n_neu,
      count(*) FILTER (WHERE sentiment_label = 'negative')::int AS n_neg,
      count(DISTINCT topic_id) FILTER (WHERE topic_id IS NOT NULL)::int AS n_topics
    FROM social_posts
    WHERE created_at >= now() - interval '14 days'
    GROUP BY bucket
    ORDER BY bucket
  `)) as unknown as DailyRow[];

  const byBucket = new Map<number, DailyRow>(rows.map((r) => [r.bucket, r]));
  const empty: DailyRow = {
    bucket: 0,
    n_posts: 0,
    n_pos: 0,
    n_neu: 0,
    n_neg: 0,
    n_topics: 0,
  };

  const days: DailyRow[] = Array.from({ length: 14 }, (_, i) => ({
    ...(byBucket.get(i) ?? empty),
    bucket: i,
  }));

  const thisWeek = days.slice(0, 7);
  const lastWeek = days.slice(7, 14);

  const thisWeekTotal = thisWeek.reduce((s, d) => s + d.n_posts, 0);
  const lastWeekTotal = lastWeek.reduce((s, d) => s + d.n_posts, 0);

  const avgPulse = (window: DailyRow[]): number | null => {
    const scored = window
      .map(pulseFor)
      .filter((v): v is number => v !== null);
    if (scored.length === 0) return null;
    return scored.reduce((s, v) => s + v, 0) / scored.length;
  };

  const score = thisWeekTotal >= MIN_POSTS_FOR_PULSE ? avgPulse(thisWeek) : null;
  const scoreLastWeek =
    lastWeekTotal >= MIN_POSTS_FOR_PULSE ? avgPulse(lastWeek) : null;
  const delta =
    score !== null && scoreLastWeek !== null ? score - scoreLastWeek : null;

  // Sparkline: 7 daily post counts, oldest→newest (reverse buckets 0..6).
  const sparkline = thisWeek.map((d) => d.n_posts).reverse();

  return {
    score: score !== null ? Math.round(score * 10) / 10 : null,
    scoreLastWeek:
      scoreLastWeek !== null ? Math.round(scoreLastWeek * 10) / 10 : null,
    delta: delta !== null ? Math.round(delta * 10) / 10 : null,
    sparkline,
    hasEnoughData: thisWeekTotal >= MIN_POSTS_FOR_PULSE,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Trending count — distinct topics with new activity in last 24h
 * ───────────────────────────────────────────────────────────── */

export async function getTrendingCount24h(): Promise<number> {
  // Distinct topic clusters with at least one post PUBLISHED in the last
  // 24h. Was previously keyed on `created_at` (ingest time) which made
  // the count drift with our scraping schedule instead of with actual
  // news activity. `posted_at` reflects when the outlet published the
  // item — the user-meaningful "trending right now" signal.
  const [row] = await db
    .select({ n: sql<number>`count(DISTINCT topic_id)::int` })
    .from(schema.socialPosts)
    .where(
      and(
        gte(
          schema.socialPosts.postedAt,
          sql`now() - interval '24 hours'`,
        ),
        isNotNull(schema.socialPosts.topicId),
      ),
    );
  return Number(row?.n ?? 0);
}

/* ─────────────────────────────────────────────────────────────
 * Briefs + kajian generated by THIS user this week
 *
 * Reads the immutable `weekly_quota_usage` counter rather than
 * counting rows on briefs/deliverables — so deleting a generation
 * does NOT free a quota slot. Window key is Sunday-00:00 WIB
 * (`currentWeekStartUtc()`).
 * ───────────────────────────────────────────────────────────── */

export async function getBriefsThisWeek(userId: string): Promise<number> {
  const weekStart = currentWeekStartUtc();
  const [row] = await db
    .select({ n: schema.weeklyQuotaUsage.briefsUsed })
    .from(schema.weeklyQuotaUsage)
    .where(
      and(
        eq(schema.weeklyQuotaUsage.userId, userId),
        eq(schema.weeklyQuotaUsage.weekStartUtc, weekStart),
      ),
    )
    .limit(1);
  return Number(row?.n ?? 0);
}

/** Mirror of [[getBriefsThisWeek]] for the deliverables counter. */
export async function getKajianThisWeek(userId: string): Promise<number> {
  const weekStart = currentWeekStartUtc();
  const [row] = await db
    .select({ n: schema.weeklyQuotaUsage.kajianUsed })
    .from(schema.weeklyQuotaUsage)
    .where(
      and(
        eq(schema.weeklyQuotaUsage.userId, userId),
        eq(schema.weeklyQuotaUsage.weekStartUtc, weekStart),
      ),
    )
    .limit(1);
  return Number(row?.n ?? 0);
}

/* ─────────────────────────────────────────────────────────────
 * Top Issues — top N topics by 7-day post volume, with sentiment
 * ───────────────────────────────────────────────────────────── */

export type TopIssue = {
  id: string;
  title: string;
  platform: string;
  keywords: string[];
  volume: number;
  reach: number;
  /** [positive %, neutral %, concerned %] — already 0–100, sums to ≤100. */
  sentiment: [number, number, number];
  /** Raw sentiment counts for the detail modal — Σ may differ from volume
   *  when some posts have no sentiment label. */
  sentimentCounts: { positive: number; neutral: number; negative: number };
  /** Top-N posts in this topic, highest opportunity first. The dashboard
   *  card itself doesn't show these — they populate the detail modal. */
  samplePosts: Array<{
    id: string;
    text: string;
    author: string | null;
    url: string | null;
    sentimentLabel: string | null;
    opportunity: number | null;
    postedAt: Date | null;
  }>;
  /** Top outlets/accounts covering this topic with their post counts. */
  topOutlets: Array<{ name: string; count: number }>;
};

type TopIssueRow = {
  id: string;
  label: string;
  platform: string;
  keywords: string[] | null;
  volume: number;
  reach: number;
  n_pos: number;
  n_neu: number;
  n_neg: number;
};

type TopIssuePostRow = {
  topic_id: string;
  id: string;
  text: string;
  author: string | null;
  url: string | null;
  sentiment_label: string | null;
  opportunity: number | null;
  posted_at: Date | null;
};

type TopIssueOutletRow = {
  topic_id: string;
  name: string;
  count: number;
};

export async function getTopIssues(limit = 3): Promise<TopIssue[]> {
  const rows = (await db.execute(sql`
    SELECT
      t.id::text AS id,
      t.label AS label,
      t.platform AS platform,
      t.keywords AS keywords,
      count(p.id)::int AS volume,
      count(DISTINCT p.author) FILTER (WHERE p.author IS NOT NULL)::int AS reach,
      count(*) FILTER (WHERE p.sentiment_label = 'positive')::int AS n_pos,
      count(*) FILTER (WHERE p.sentiment_label = 'neutral')::int  AS n_neu,
      count(*) FILTER (WHERE p.sentiment_label = 'negative')::int AS n_neg
    FROM topics t
    JOIN social_posts p
      ON p.topic_id = t.id
     AND p.posted_at >= now() - interval '7 days'
    GROUP BY t.id, t.label, t.platform, t.keywords
    HAVING count(p.id) >= 2
    ORDER BY volume DESC
    LIMIT ${limit}
  `)) as unknown as TopIssueRow[];

  if (rows.length === 0) return [];

  const topicIds = rows.map((r) => r.id);

  // Sample posts per topic — pick top-5 by opportunity score so the modal
  // surfaces the strongest da'wah signal in the cluster, not just whatever
  // happened to be ingested most recently. ROW_NUMBER() inside a CTE so
  // we can take N per topic in one query.
  const postRows = (await db.execute(sql`
    SELECT topic_id, id, text, author, url, sentiment_label, opportunity, posted_at
    FROM (
      SELECT
        sp.topic_id::text AS topic_id,
        sp.id::text AS id,
        sp.text AS text,
        sp.author AS author,
        sp.url AS url,
        sp.sentiment_label AS sentiment_label,
        sp.dawah_opportunity AS opportunity,
        sp.posted_at AS posted_at,
        ROW_NUMBER() OVER (
          PARTITION BY sp.topic_id
          ORDER BY COALESCE(sp.dawah_opportunity, sp.dawah_relevance, 0) DESC,
                   sp.posted_at DESC
        ) AS rn
      FROM social_posts sp
      WHERE sp.topic_id::text = ANY (${sql.raw(`ARRAY[${topicIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`)})
        AND sp.posted_at >= now() - interval '7 days'
    ) ranked
    WHERE rn <= 5
    ORDER BY topic_id, rn
  `)) as unknown as TopIssuePostRow[];

  // Top 3 outlets per topic by post count.
  const outletRows = (await db.execute(sql`
    SELECT topic_id, author AS name, count
    FROM (
      SELECT
        sp.topic_id::text AS topic_id,
        sp.author AS author,
        count(*)::int AS count,
        ROW_NUMBER() OVER (
          PARTITION BY sp.topic_id ORDER BY count(*) DESC
        ) AS rn
      FROM social_posts sp
      WHERE sp.topic_id::text = ANY (${sql.raw(`ARRAY[${topicIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")}]::text[]`)})
        AND sp.author IS NOT NULL
        AND sp.posted_at >= now() - interval '7 days'
      GROUP BY sp.topic_id, sp.author
    ) ranked
    WHERE rn <= 3
    ORDER BY topic_id, rn
  `)) as unknown as TopIssueOutletRow[];

  const postsByTopic = new Map<string, TopIssuePostRow[]>();
  for (const p of postRows) {
    const list = postsByTopic.get(p.topic_id) ?? [];
    list.push(p);
    postsByTopic.set(p.topic_id, list);
  }
  const outletsByTopic = new Map<string, TopIssueOutletRow[]>();
  for (const o of outletRows) {
    const list = outletsByTopic.get(o.topic_id) ?? [];
    list.push(o);
    outletsByTopic.set(o.topic_id, list);
  }

  return rows.map((r) => {
    const labelled = r.n_pos + r.n_neu + r.n_neg;
    let sentiment: [number, number, number] = [0, 0, 0];
    if (labelled > 0) {
      sentiment = [
        Math.round((r.n_pos / labelled) * 100),
        Math.round((r.n_neu / labelled) * 100),
        Math.round((r.n_neg / labelled) * 100),
      ];
    } else {
      // No sentiment labels — show a neutral bar rather than a
      // misleading 0/0/0.
      sentiment = [0, 100, 0];
    }
    return {
      id: r.id,
      title: r.label,
      platform: r.platform,
      keywords: r.keywords ?? [],
      volume: Number(r.volume),
      reach: Number(r.reach),
      sentiment,
      sentimentCounts: {
        positive: Number(r.n_pos),
        neutral: Number(r.n_neu),
        negative: Number(r.n_neg),
      },
      samplePosts: (postsByTopic.get(r.id) ?? []).map((p) => ({
        id: p.id,
        text: p.text,
        author: p.author,
        url: p.url,
        sentimentLabel: p.sentiment_label,
        opportunity: p.opportunity != null ? Number(p.opportunity) : null,
        postedAt: p.posted_at,
      })),
      topOutlets: (outletsByTopic.get(r.id) ?? []).map((o) => ({
        name: o.name,
        count: Number(o.count),
      })),
    };
  });
}

/* ─────────────────────────────────────────────────────────────
 * Daily Insights — four real, template-shaped facts about the data
 *
 * Returns null for any insight where we don't have enough signal —
 * the dashboard renders only the insights that are non-null, so an
 * empty corpus shows nothing rather than fabricated content.
 * ───────────────────────────────────────────────────────────── */

export type DailyInsights = {
  /** Sentiment shift: this-week vs last-week positive %. */
  sentiment: { thisWeekPos: number; lastWeekPos: number; deltaPp: number } | null;
  /** Newest emerging topic seen in last 7 days. */
  emerging: { label: string; volume: number } | null;
  /** Most active platform by 7-day post count. */
  topPlatform: { platform: string; share: number } | null;
  /** Strongest da'wah category by avg `dawah_relevance` over last 7 days. */
  daleelOpportunity: { category: string; nPosts: number } | null;
};

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

export async function getDailyInsights(): Promise<DailyInsights> {
  // ── Sentiment shift ──
  const sentimentRows = (await db.execute(sql`
    SELECT
      CASE WHEN created_at >= now() - interval '7 days' THEN 'this' ELSE 'last' END AS bucket,
      count(*) FILTER (WHERE sentiment_label = 'positive')::int AS n_pos,
      count(*) FILTER (WHERE sentiment_label IN ('positive','neutral','negative'))::int AS n_total
    FROM social_posts
    WHERE created_at >= now() - interval '14 days'
      AND sentiment_label IS NOT NULL
    GROUP BY bucket
  `)) as unknown as Array<{ bucket: "this" | "last"; n_pos: number; n_total: number }>;

  const sentimentByBucket = new Map(sentimentRows.map((r) => [r.bucket, r]));
  const tw = sentimentByBucket.get("this");
  const lw = sentimentByBucket.get("last");
  const minLabelled = 10;
  let sentiment: DailyInsights["sentiment"] = null;
  if (tw && lw && tw.n_total >= minLabelled && lw.n_total >= minLabelled) {
    const twPos = Math.round((tw.n_pos / tw.n_total) * 100);
    const lwPos = Math.round((lw.n_pos / lw.n_total) * 100);
    sentiment = { thisWeekPos: twPos, lastWeekPos: lwPos, deltaPp: twPos - lwPos };
  }

  // ── Newest emerging topic — first seen within last 7 days, by volume ──
  const emergingRows = (await db.execute(sql`
    SELECT t.label AS label, t.post_count AS volume
    FROM topics t
    WHERE t.first_seen >= now() - interval '7 days'
    ORDER BY t.post_count DESC NULLS LAST
    LIMIT 1
  `)) as unknown as Array<{ label: string; volume: number }>;
  const emerging =
    emergingRows.length > 0 && emergingRows[0].volume >= 2
      ? { label: emergingRows[0].label, volume: Number(emergingRows[0].volume) }
      : null;

  // ── Top platform by 7-day volume ──
  const platformRows = (await db.execute(sql`
    SELECT platform, count(*)::int AS n
    FROM social_posts
    WHERE created_at >= now() - interval '7 days'
    GROUP BY platform
    ORDER BY n DESC
  `)) as unknown as Array<{ platform: string; n: number }>;
  const totalRecent = platformRows.reduce((s, r) => s + r.n, 0);
  const topPlatform =
    platformRows.length > 0 && totalRecent >= 5
      ? {
          platform: platformRows[0].platform,
          share: Math.round((platformRows[0].n / totalRecent) * 100),
        }
      : null;

  // ── Da'wah category with the most "strong-signal" posts (relevance ≥ 0.7) ──
  // categories jsonb stores per-category 0-1 scores; we count rows where the
  // category's score is ≥ 0.7. The category-with-max-count wins.
  const categoryRows = (await db.execute(sql`
    SELECT category, count(*)::int AS n_posts
    FROM (
      SELECT
        jsonb_each_text(coalesce(categories, '{}'::jsonb)) AS kv
      FROM social_posts
      WHERE created_at >= now() - interval '7 days'
        AND dawah_relevance >= 0.5
        AND categories IS NOT NULL
    ) AS expanded,
    LATERAL (SELECT (expanded.kv).key AS category, (expanded.kv).value::float AS score) AS pair
    WHERE pair.score >= 0.7
    GROUP BY category
    ORDER BY n_posts DESC
    LIMIT 1
  `)) as unknown as Array<{ category: string; n_posts: number }>;
  const daleelOpportunity =
    categoryRows.length > 0 &&
    categoryRows[0].n_posts >= 2 &&
    (DAWAH_CATEGORIES as readonly string[]).includes(categoryRows[0].category)
      ? {
          category: categoryRows[0].category,
          nPosts: Number(categoryRows[0].n_posts),
        }
      : null;

  return { sentiment, emerging, topPlatform, daleelOpportunity };
}

/* ─────────────────────────────────────────────────────────────
 * Rising videos — biggest engagement_views delta in the last 24h
 * ───────────────────────────────────────────────────────────── */

export type RisingVideo = {
  postId: string;
  title: string;
  channel: string;
  url: string | null;
  viewsNow: number;
  viewsThen: number;
  delta: number;
  deltaPct: number;
};

/**
 * Find YouTube videos whose view count grew the most in the last `windowHours`.
 *
 * Compares the latest `social_post_metrics` snapshot to the most recent
 * snapshot from BEFORE `now() - windowHours`. Returns the top `limit`
 * by absolute delta. Filters to videos with at least `minBaseline` prior
 * views so a brand-new video going 0 → 5K doesn't dominate the list as
 * a `∞%` outlier — we want "actually viral," not "freshly posted."
 *
 * Returns empty list until the time-series table has 2+ days of data.
 */
export async function getRisingVideos(
  limit = 5,
  windowHours = 24,
  minBaseline = 500,
): Promise<RisingVideo[]> {
  const rows = (await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (social_post_id)
        social_post_id, engagement_views AS views_now, captured_at
      FROM social_post_metrics
      ORDER BY social_post_id, captured_at DESC
    ),
    baseline AS (
      SELECT DISTINCT ON (social_post_id)
        social_post_id, engagement_views AS views_then
      FROM social_post_metrics
      WHERE captured_at < now() - (${windowHours} || ' hours')::interval
      ORDER BY social_post_id, captured_at DESC
    )
    SELECT
      sp.id::text AS post_id,
      sp.text AS title,
      sp.author AS channel,
      sp.url AS url,
      l.views_now::bigint AS views_now,
      b.views_then::bigint AS views_then
    FROM latest l
    JOIN baseline b ON b.social_post_id = l.social_post_id
    JOIN social_posts sp ON sp.id = l.social_post_id
    WHERE l.views_now > b.views_then
      AND b.views_then >= ${minBaseline}
      AND sp.platform = 'youtube'
    ORDER BY (l.views_now - b.views_then) DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    post_id: string;
    title: string;
    channel: string;
    url: string | null;
    views_now: number;
    views_then: number;
  }>;

  return rows.map((r) => {
    const viewsNow = Number(r.views_now);
    const viewsThen = Number(r.views_then);
    const delta = viewsNow - viewsThen;
    // `deltaPct` is "share of total views that came from the past 24h"
    // = delta / views_now × 100, bounded 0-100. Previously this was
    // delta / views_then × 100 (growth-rate vs prior baseline), which
    // was mathematically correct but produced eye-watering "+3436%"
    // numbers for breakout videos with tiny pre-baselines. The new
    // metric reads cleanly ("97% of total views are from the past
    // 24h") and stays bounded, while the sort order is unchanged
    // (still ORDER BY absolute delta DESC).
    const deltaPct = viewsNow > 0 ? (delta / viewsNow) * 100 : 0;
    return {
      postId: r.post_id,
      title: (r.title?.split("\n")[0] ?? r.title ?? "").slice(0, 120),
      channel: r.channel ?? "?",
      url: r.url,
      viewsNow,
      viewsThen,
      delta,
      deltaPct,
    };
  });
}

/* ─────────────────────────────────────────────────────────────
 * Per-channel YouTube health — engagement aggregates for the
 * /admin/system/youtube-channels surface
 * ───────────────────────────────────────────────────────────── */

export type ChannelHealth = {
  channelId: string;
  name: string;
  category: string;
  videos7d: number;
  totalViews7d: number;
  avgViews7d: number;
  maxViews7d: number;
  lastUploadAt: string | null;
};

/**
 * For each verified+enabled `youtube_channels` row, compute aggregates
 * over the last 7 days of its uploads (via `social_posts.author` matched
 * to `youtube_channels.name`). Powers the "which channels are actually
 * reaching audiences" view.
 *
 * Channels that haven't been ingested yet (post-2026-05-25 fresh seed,
 * or just-added channels) appear with all zeros + null last_upload.
 * That's the signal: "this channel is in the whitelist but we have no
 * data for it" — operator should kick a manual ingest.
 */
export async function getChannelHealth(): Promise<ChannelHealth[]> {
  const rows = (await db.execute(sql`
    SELECT
      yc.channel_id,
      yc.name,
      yc.category,
      COALESCE(agg.videos_7d, 0)::int AS videos_7d,
      COALESCE(agg.total_views_7d, 0)::bigint AS total_views_7d,
      COALESCE(agg.avg_views_7d, 0)::float AS avg_views_7d,
      COALESCE(agg.max_views_7d, 0)::bigint AS max_views_7d,
      agg.last_upload_at
    FROM youtube_channels yc
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS videos_7d,
        SUM(engagement_views) AS total_views_7d,
        AVG(engagement_views) AS avg_views_7d,
        MAX(engagement_views) AS max_views_7d,
        MAX(posted_at) AS last_upload_at
      FROM social_posts
      WHERE platform = 'youtube'
        AND author = yc.name
        AND posted_at >= now() - interval '7 days'
    ) agg ON TRUE
    WHERE yc.enabled = true AND yc.verified = true
    ORDER BY agg.total_views_7d DESC NULLS LAST, yc.name
  `)) as unknown as Array<{
    channel_id: string;
    name: string;
    category: string;
    videos_7d: number;
    total_views_7d: number;
    avg_views_7d: number;
    max_views_7d: number;
    last_upload_at: string | null;
  }>;

  return rows.map((r) => ({
    channelId: r.channel_id,
    name: r.name,
    category: r.category,
    videos7d: Number(r.videos_7d),
    totalViews7d: Number(r.total_views_7d),
    avgViews7d: Number(r.avg_views_7d),
    maxViews7d: Number(r.max_views_7d),
    lastUploadAt: r.last_upload_at,
  }));
}

/* ─────────────────────────────────────────────────────────────
 * Bucket-level engagement delta — week-over-week summed views
 * per `youtube_channels.category`, for the main dashboard pulse
 * ───────────────────────────────────────────────────────────── */

export type BucketDelta = {
  category: string;
  viewsThisWeek: number;
  viewsLastWeek: number;
  deltaPct: number | null;
};

export async function getBucketEngagementDelta(): Promise<BucketDelta[]> {
  const rows = (await db.execute(sql`
    SELECT
      yc.category,
      COALESCE(SUM(sp.engagement_views) FILTER (
        WHERE sp.posted_at >= now() - interval '7 days'
      ), 0)::bigint AS views_this,
      COALESCE(SUM(sp.engagement_views) FILTER (
        WHERE sp.posted_at >= now() - interval '14 days'
          AND sp.posted_at <  now() - interval '7 days'
      ), 0)::bigint AS views_last
    FROM youtube_channels yc
    LEFT JOIN social_posts sp
      ON sp.platform = 'youtube'
     AND sp.author = yc.name
     AND sp.posted_at >= now() - interval '14 days'
    WHERE yc.enabled = true AND yc.verified = true
    GROUP BY yc.category
    ORDER BY views_this DESC
  `)) as unknown as Array<{
    category: string;
    views_this: number;
    views_last: number;
  }>;

  return rows.map((r) => {
    const viewsThis = Number(r.views_this);
    const viewsLast = Number(r.views_last);
    return {
      category: r.category,
      viewsThisWeek: viewsThis,
      viewsLastWeek: viewsLast,
      deltaPct:
        viewsLast > 0 ? ((viewsThis - viewsLast) / viewsLast) * 100 : null,
    };
  });
}

/* ─────────────────────────────────────────────────────────────
 * Bucket reach by da'wah category — 7d vs prior 7d, per-platform.
 *
 * Distinct from `getBucketEngagementDelta` (admin/youtube-channels):
 * that one buckets by `youtube_channels.category` (an editorial
 * channel-genre enum), this one buckets by the post's DOMINANT
 * da'wah category from the 9-category JSONB taxonomy populated on
 * EVERY platform. Used by /insights/<platform> so the same widget
 * shape works across YT / X / IG / mainstream.
 *
 * Metric per platform:
 *   mainstream  → COUNT(*) (no engagement_views from RSS), unit='articles'
 *   else        → SUM(engagement_views),                   unit='views'
 *
 * Returns sorted desc by `valueThisWeek` so the biggest bucket leads
 * the strip.
 * ───────────────────────────────────────────────────────────── */

export type DawahCategoryReach = {
  category: string;
  valueThisWeek: number;
  valueLastWeek: number;
  deltaPct: number | null;
  unit: "views" | "articles" | "posts";
};

const DAWAH_CATS_SQL = sql.raw(
  ["aqidah", "akhlaq", "muamalah", "social_justice", "family", "youth",
    "education", "economic_ethics", "health"]
    .map((c) => `'${c}'`)
    .join(","),
);

export async function getDawahCategoryReachDelta(
  platform: string,
): Promise<DawahCategoryReach[]> {
  // Which aggregate makes the chart MEANINGFUL per platform:
  //   - mainstream → COUNT(*): RSS has no per-article views at all.
  //   - instagram  → COUNT(*): the IG hashtag scraper only fills
  //                  videoViewCount for VIDEO posts; the bulk of IG
  //                  posts are images and have NULL views, so
  //                  SUM(views) would render every bucket as ~0
  //                  (looks like the panel is broken). COUNT is the
  //                  truthful "how much activity" signal for IG.
  //   - YT / X / TT → SUM(engagement_views): engagement is 100%
  //                   populated post-backfill, views are the real
  //                   "reach" measure for video/microblog platforms.
  const useCount = platform === "mainstream" || platform === "instagram";
  const unit: DawahCategoryReach["unit"] = useCount
    ? platform === "mainstream"
      ? "articles"
      : "posts"
    : "views";

  // FILTER must attach to the aggregate DIRECTLY in Postgres — not to
  // an expression wrapping it. So `COALESCE(SUM(...), 0) FILTER (...)`
  // throws "syntax error at or near FILTER"; the only legal shape is
  // `COALESCE(SUM(...) FILTER (...), 0)`. Build per-window via a helper.
  const windowedMetric = (where: ReturnType<typeof sql>) =>
    useCount
      ? sql`COUNT(*) FILTER (WHERE ${where})`
      : sql`COALESCE(SUM(sp.engagement_views) FILTER (WHERE ${where}), 0)`;

  const rows = (await db.execute(sql`
    SELECT
      dominant.cat AS category,
      ${windowedMetric(sql`sp.posted_at >= now() - interval '7 days'`)}::bigint AS metric_this,
      ${windowedMetric(sql`sp.posted_at >= now() - interval '14 days' AND sp.posted_at < now() - interval '7 days'`)}::bigint AS metric_last
    FROM social_posts sp
    CROSS JOIN LATERAL (
      SELECT key AS cat
      FROM jsonb_each_text(sp.categories)
      WHERE key = ANY (ARRAY[${DAWAH_CATS_SQL}])
        AND value::numeric > 0.1
      ORDER BY value::numeric DESC
      LIMIT 1
    ) dominant
    WHERE sp.platform = ${platform}
      AND sp.posted_at >= now() - interval '14 days'
      AND sp.categories IS NOT NULL
    GROUP BY dominant.cat
    ORDER BY metric_this DESC
  `)) as unknown as Array<{
    category: string;
    metric_this: number;
    metric_last: number;
  }>;

  return rows.map((r) => {
    const thisWeek = Number(r.metric_this);
    const lastWeek = Number(r.metric_last);
    // Suppress delta% when the baseline is so thin the percent is
    // dominated by data-pipeline warm-up, not real growth. Bar: prior
    // 7d must have ≥10 items AND ≥5% of this week. Otherwise we'd
    // render "+1,350,043%" type numbers that are arithmetically right
    // but read as misleading "everything's viral!" when really the
    // ingest pipeline just came online. Self-heals once the pipeline
    // has had two stable weeks (then 5% of this-week is always cleared).
    const thinBaseline = lastWeek < Math.max(10, thisWeek * 0.05);
    return {
      category: r.category,
      valueThisWeek: thisWeek,
      valueLastWeek: lastWeek,
      deltaPct:
        lastWeek > 0 && !thinBaseline
          ? ((thisWeek - lastWeek) / lastWeek) * 100
          : null,
      unit,
    };
  });
}

/* ─────────────────────────────────────────────────────────────
 * Dashboard tabs — Kit + Data surfaces
 * Helpers for the revamped /dashboard layout.
 * ───────────────────────────────────────────────────────────── */

export type KitDeliverable = {
  slug:
    | "khutbah"
    | "kultum"
    | "kajian"
    | "kisah"
    | "home"
    | "content"
    | "genz"
    | "action";
  title: string;
  excerpt: string;
  href: string;
  wordCount: number;
};

export type FlyerMessage = {
  n: number;
  headline: string;
  daleel: string | null;
  body: string;
};

export type OverallViewKits = {
  briefSlug: string;
  generatedAt: string;
  kits: KitDeliverable[];
  posterQuestion: string | null;
  posterHref: string | null;
  flyers: FlyerMessage[];
};

/**
 * Extract one H3-bounded section from a briefing's markdown by matching
 * the heading text against a regex. Returns the headline-stripped body
 * (everything until the next H3 or H2 boundary).
 */
function extractH3Block(md: string, matcher: RegExp): string | null {
  const lines = md.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###\s+(.+?)\s*$/);
    if (m && matcher.test(m[1])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/**
 * Walk a section's prose and pull the first `wordCap` words, skipping
 * structural noise: Arabic-only lines (would dominate the excerpt and
 * render poorly at body size), parenthetical word-counts left in by
 * the LLM, all-caps headers like "**KHUTBAH PERTAMA**", and bullet
 * markers. Used to build the per-kit teaser on the dashboard.
 */
function buildExcerpt(section: string, wordCap = 110): string {
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith("(")) // word-count parenthetical
    .filter((l) => !/^\*\*[A-Z\s]+\*\*\s*:?$/.test(l)); // ALL-CAPS bold header
  const words: string[] = [];
  for (const line of lines) {
    if (words.length >= wordCap) break;
    if (/^[؀-ۿ\s]+$/.test(line)) continue; // Arabic-only
    // Strip leading bullet markers + bold markers for a cleaner teaser
    const cleaned = line
      .replace(/^[-*•]\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/^>\s+/, "");
    words.push(...cleaned.split(/\s+/));
  }
  const out = words.slice(0, wordCap).join(" ");
  return out + (words.length > wordCap ? "…" : "");
}

const KIT_DEFS: ReadonlyArray<{
  slug: KitDeliverable["slug"];
  title: string;
  matcher: RegExp;
}> = [
  { slug: "khutbah", title: "Khutbah Jumat", matcher: /khutbah|friday/i },
  { slug: "kultum", title: "Kultum", matcher: /kultum|short\s*talk/i },
  { slug: "kajian", title: "Kajian Ibu-ibu", matcher: /kajian|majelis/i },
  { slug: "kisah", title: "Kisah dari Hadits", matcher: /kisah|story\s+from/i },
  { slug: "home", title: "Pengajaran di Rumah", matcher: /rumah|home|teaching at/i },
  { slug: "content", title: "Kreator Konten", matcher: /konten|kreator|content creator|digital content/i },
  {
    slug: "genz",
    title: "Mahasiswa: Poster + Artikel + Diskusi",
    matcher: /mahasiswa|university\s+student|gen[\s-]?z/i,
  },
  {
    slug: "action",
    title: "Aksi Sosial & Khidmah Umat",
    matcher: /aksi|khidmah|ummah|social action|service to/i,
  },
];

/**
 * Parse the `## Pesan Flyer` section into structured per-flyer rows.
 * Each flyer in the markdown follows the format:
 *
 *   ### Pesan Flyer N — Suara {{kategori}}
 *   **Headline:** "{{headline}}"
 *   **Dalil:** {{citation}}
 *
 *   {{paragraph body}}
 *
 * Returns [] when no Pesan Flyer block is present.
 */
function extractFlyers(md: string): FlyerMessage[] {
  const sectionIdx = md.indexOf("## Pesan Flyer");
  if (sectionIdx === -1) return [];
  const after = md.slice(sectionIdx);
  // Stop at the next H2 boundary; otherwise consume to end of doc.
  const nextH2 = after.slice(15).search(/\n## /);
  const section =
    nextH2 === -1 ? after : after.slice(0, 15 + nextH2);

  const flyers: FlyerMessage[] = [];
  // Split on each `### Pesan Flyer N` header. The first chunk is the
  // section preamble and is discarded.
  const chunks = section.split(/\n### Pesan Flyer\s+(\d+)[^\n]*\n/);
  // chunks: [preamble, "1", body1, "2", body2, ...]
  for (let i = 1; i < chunks.length; i += 2) {
    const n = Number(chunks[i]);
    const body = chunks[i + 1] ?? "";
    const headline = body.match(/\*\*Headline:\*\*\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim() ?? "";
    const daleel = body.match(/\*\*Dalil:\*\*\s*([^\n]+?)\s*$/m)?.[1]?.trim() ?? null;
    // Paragraph body = everything after the marker lines, first 80 words.
    const paragraph = body
      .replace(/\*\*Headline:\*\*[^\n]+/, "")
      .replace(/\*\*Dalil:\*\*[^\n]+/, "")
      .trim();
    flyers.push({
      n,
      headline,
      daleel,
      body: buildExcerpt(paragraph, 80),
    });
  }
  return flyers;
}

/**
 * Latest overall-view briefing decomposed into per-kit slices for the
 * dashboard. Replaces the older single-khutbah hero with the full
 * content kit so users see every deliverable at a glance. Each kit
 * carries a `href` pointing to the public read page (`/d/{slug}/{kit}`
 * for most, `/m/{slug}` for Mahasiswa where the article + discussion
 * live together).
 *
 * Returns null when no overall-view briefing exists yet OR the markdown
 * lacks the Section-4 deliverable block (mid-migration formats).
 */
export async function getOverallViewKits(): Promise<OverallViewKits | null> {
  const rows = (await db.execute(sql`
    SELECT id::text AS id, generated_at, summary_md
    FROM insights_summaries
    WHERE segment IS NULL
      AND summary_md IS NOT NULL
    ORDER BY generated_at DESC
    LIMIT 1
  `)) as unknown as Array<{
    id: string;
    generated_at: string;
    summary_md: string;
  }>;

  const row = rows[0];
  if (!row) return null;

  const md = row.summary_md;
  // Build the same `{YYYY-MM-DD}-all` slug the `/d/{brief}/...` and
  // `/m/{slug}` routes expect. Date is interpreted in WIB so a brief
  // generated at 05:00 WIB lands on today's date in the URL.
  const generatedAtDate = new Date(row.generated_at);
  const wibIso = new Date(
    generatedAtDate.getTime() + 7 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const briefSlug = `${wibIso}-all`;

  const kits: KitDeliverable[] = [];
  for (const def of KIT_DEFS) {
    const section = extractH3Block(md, def.matcher);
    if (!section) continue;
    const excerpt = buildExcerpt(section, 110);
    const wordCount = section.split(/\s+/).filter(Boolean).length;
    const href =
      def.slug === "genz"
        ? `/m/${briefSlug}`
        : `/d/${briefSlug}/${def.slug}`;
    kits.push({
      slug: def.slug,
      title: def.title,
      excerpt,
      href,
      wordCount,
    });
  }

  // Mahasiswa section also carries the "Poster Question" we surface as
  // the campus-poster artifact. The poster preview shares the /m/{slug}
  // page (no separate route).
  const mahasiswaSection = extractH3Block(md, /mahasiswa|university\s+student|gen[\s-]?z/i);
  const posterQuestion =
    mahasiswaSection
      ?.match(/\*\*Poster Question:\*\*\s*"?([^"\n]+?)"?\s*$/m)?.[1]
      ?.trim() ?? null;
  const posterHref = posterQuestion ? `/m/${briefSlug}` : null;

  const flyers = extractFlyers(md);

  return {
    briefSlug,
    generatedAt: row.generated_at,
    kits,
    posterQuestion,
    posterHref,
    flyers,
  };
}

export type SegmentBriefingChoice = {
  segment: "all" | "spiritual" | "family" | "youth" | "justice";
  briefId: string;
  generatedAt: string;
  postsThisWeek: number;
};

const SEGMENT_ORDER = ["all", "spiritual", "family", "youth", "justice"] as const;

/**
 * Latest briefing per segment for the 5-card chooser row. NULLS in DB
 * (segment IS NULL) maps to label "all" in the UI. Slots without any
 * row yet (newer segment never generated) are silently dropped.
 */
export async function getSegmentBriefingChoices(): Promise<
  SegmentBriefingChoice[]
> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(segment, 'all'))
      COALESCE(segment, 'all') AS segment,
      id::text AS id,
      generated_at,
      COALESCE((headline_stats->'totals'->>'posts_7d')::int, 0) AS posts_7d
    FROM insights_summaries
    ORDER BY COALESCE(segment, 'all'), generated_at DESC
  `)) as unknown as Array<{
    segment: string;
    id: string;
    generated_at: string;
    posts_7d: number;
  }>;

  const bySeg = new Map(rows.map((r) => [r.segment, r]));
  return SEGMENT_ORDER.flatMap((s) => {
    const row = bySeg.get(s);
    if (!row) return [];
    return [
      {
        segment: s,
        briefId: row.id,
        generatedAt: row.generated_at,
        postsThisWeek: Number(row.posts_7d),
      } satisfies SegmentBriefingChoice,
    ];
  });
}

export type SavedItem = {
  id: string;
  kind: "kitab" | "brief" | "post";
  refId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Latest 5 bookmarks across all kinds for the dashboard "Saved" card.
 * Full-list lives at /saved; this is just a "recent" peek.
 */
export async function getRecentSaved(userId: string): Promise<SavedItem[]> {
  const rows = await db
    .select({
      id: schema.bookmarks.id,
      kind: schema.bookmarks.kind,
      refId: schema.bookmarks.refId,
      payload: schema.bookmarks.payload,
      createdAt: schema.bookmarks.createdAt,
    })
    .from(schema.bookmarks)
    .where(eq(schema.bookmarks.userId, userId))
    .orderBy(desc(schema.bookmarks.createdAt))
    .limit(5);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as SavedItem["kind"],
    refId: r.refId,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt),
  }));
}

export type SentimentTrendPoint = {
  day: string; // YYYY-MM-DD
  negPct: number;
  posPct: number;
  total: number;
};

export type SentimentTrend30d = {
  /** Aggregate across all platforms — what the default chart renders. */
  overall: SentimentTrendPoint[];
  /** One series per product-supported platform, fixed order. Used by the
   *  "view by platform" dialog. Empty arrays are kept so the dialog can
   *  render a stable 5-row grid even for paused platforms. */
  byPlatform: Array<{ platform: string; points: SentimentTrendPoint[] }>;
};

/**
 * 30-day rolling sentiment composition. Each point is a WIB-calendar day.
 * Days with fewer than `MIN_DAILY_LABELLED` classified posts (per series)
 * are still returned but with `total=0` so the chart can render gaps
 * gracefully.
 *
 * Returns both the aggregate series AND per-platform series in a single
 * SQL roll-up to keep the dashboard's parallel-await tight.
 */
export async function getSentimentTrend30d(): Promise<SentimentTrend30d> {
  const MIN_DAILY_LABELLED = 5;
  const rows = (await db.execute(sql`
    SELECT
      to_char(date_trunc('day', timezone('Asia/Jakarta', created_at)), 'YYYY-MM-DD') AS day,
      platform,
      COUNT(*) FILTER (WHERE sentiment_label IS NOT NULL)::int AS total,
      COUNT(*) FILTER (WHERE sentiment_label = 'negative')::int AS neg,
      COUNT(*) FILTER (WHERE sentiment_label = 'positive')::int AS pos
    FROM social_posts
    WHERE created_at >= now() - interval '30 days'
    GROUP BY day, platform
    ORDER BY day
  `)) as unknown as Array<{
    day: string;
    platform: string;
    total: number;
    neg: number;
    pos: number;
  }>;

  // Roll up into per-platform daily buckets plus an "all" aggregate.
  type DayBucket = { total: number; neg: number; pos: number };
  const overallByDay = new Map<string, DayBucket>();
  const byPlatformDay = new Map<string, Map<string, DayBucket>>();

  for (const r of rows) {
    const total = Number(r.total);
    const neg = Number(r.neg);
    const pos = Number(r.pos);

    const o = overallByDay.get(r.day) ?? { total: 0, neg: 0, pos: 0 };
    o.total += total;
    o.neg += neg;
    o.pos += pos;
    overallByDay.set(r.day, o);

    const pm = byPlatformDay.get(r.platform) ?? new Map<string, DayBucket>();
    pm.set(r.day, { total, neg, pos });
    byPlatformDay.set(r.platform, pm);
  }

  const toSeries = (m: Map<string, DayBucket>): SentimentTrendPoint[] =>
    Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, b]) => {
        const safe = b.total >= MIN_DAILY_LABELLED ? b.total : 0;
        return {
          day,
          total: b.total,
          negPct: safe > 0 ? (b.neg / safe) * 100 : 0,
          posPct: safe > 0 ? (b.pos / safe) * 100 : 0,
        };
      });

  const ORDER = ["mainstream", "x", "youtube", "tiktok", "instagram"];
  const byPlatform = ORDER.map((platform) => ({
    platform,
    points: toSeries(byPlatformDay.get(platform) ?? new Map()),
  }));

  return { overall: toSeries(overallByDay), byPlatform };
}

/* ─────────────────────────────────────────────────────────────
 * Active discussion rooms — rooms where THIS user has commented
 * in the last N days
 * ───────────────────────────────────────────────────────────── */

export type ActiveRoom = {
  briefingSlug: string;
  title: string | null;
  myCommentCount: number;
  totalApprovedCount: number;
  lastInteractionAt: string;
  /** Pre-computed days since last interaction (floor, capped at 0).
   *  Server-side so the client doesn't need `Date.now()` in render —
   *  React's purity rule flags impure calls inside components. Adequate
   *  granularity for the "N days ago" label on the dashboard card. */
  daysSinceLast: number;
};

/**
 * Rooms (Mahasiswa discussion threads) the current visitor has posted
 * an approved comment in within the last `days`. Identifies the
 * visitor by `visitor_token_hash` — set on first comment via the
 * `dl_visitor` cookie. Anonymous-by-design (no userId join needed),
 * matches how the rest of the discussion system already works.
 *
 * Returns [] when the visitor has never commented OR the cookie has
 * expired / been cleared. That's the correct empty state for the
 * dashboard card.
 *
 * `title` is parsed from the briefing's Mahasiswa Poster Question via
 * the same extractor used elsewhere — when the briefing predates the
 * Poster format we fall back to the slug. Caller renders both.
 */
export async function getActiveDiscussionRooms(
  visitorTokenHash: string | null,
  days = 14,
  limit = 6,
): Promise<ActiveRoom[]> {
  if (!visitorTokenHash) return [];

  const rows = (await db.execute(sql`
    WITH my_activity AS (
      SELECT
        briefing_slug,
        COUNT(*)::int AS my_comments,
        MAX(created_at) AS last_at
      FROM mahasiswa_comments
      WHERE visitor_token_hash = ${visitorTokenHash}
        AND status = 'approved'
        AND created_at >= now() - (${days} || ' days')::interval
      GROUP BY briefing_slug
    ),
    totals AS (
      SELECT briefing_slug, COUNT(*)::int AS total_approved
      FROM mahasiswa_comments
      WHERE status = 'approved'
        AND briefing_slug IN (SELECT briefing_slug FROM my_activity)
      GROUP BY briefing_slug
    )
    SELECT
      m.briefing_slug,
      m.my_comments,
      COALESCE(t.total_approved, 0)::int AS total_approved,
      m.last_at,
      i.summary_md
    FROM my_activity m
    LEFT JOIN totals t ON t.briefing_slug = m.briefing_slug
    -- INNER JOIN against insights_summaries via a LATERAL subquery so
    -- rooms whose underlying briefing has been deleted drop out of the
    -- "active rooms" list. (Previously a LEFT JOIN — those rooms stayed
    -- visible with a NULL title, pointing at a /m/<slug> page that no
    -- longer renders anything.) Re-published briefings reincarnate the
    -- card automatically the next time the dashboard loads.
    JOIN LATERAL (
      SELECT summary_md FROM insights_summaries
      WHERE (
        CASE
          WHEN m.briefing_slug LIKE '%-all'
            THEN segment IS NULL
          ELSE segment = split_part(m.briefing_slug, '-', 4)
        END
      )
      AND to_char(date_trunc('day', generated_at AT TIME ZONE 'Asia/Jakarta'),
                  'YYYY-MM-DD')
          = substring(m.briefing_slug FROM 1 FOR 10)
      LIMIT 1
    ) i ON TRUE
    ORDER BY m.last_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    briefing_slug: string;
    my_comments: number;
    total_approved: number;
    last_at: string;
    summary_md: string | null;
  }>;

  // Pin "now" once per query call; daysSinceLast on each row uses this
  // single reference so all rows in the returned list are comparable
  // even if assembling takes a few ms.
  const now = Date.now();
  return rows.map((r) => {
    // Best-effort title: parse the Mahasiswa section's Poster Question
    // ("**Poster Question:** "..."") if present; otherwise null and
    // the UI falls back to the slug.
    let title: string | null = null;
    if (r.summary_md) {
      const m = r.summary_md.match(
        /\*\*Poster Question:\*\*\s*"?([^"\n]+?)"?\s*$/m,
      );
      if (m) title = m[1].trim();
    }
    const daysSinceLast = Math.max(
      0,
      Math.floor((now - new Date(r.last_at).getTime()) / 86400000),
    );
    return {
      briefingSlug: r.briefing_slug,
      title,
      myCommentCount: Number(r.my_comments),
      totalApprovedCount: Number(r.total_approved),
      lastInteractionAt: r.last_at,
      daysSinceLast,
    };
  });
}

/* ─────────────────────────────────────────────────────────────
 * Kit segments — all 5 briefings parsed into H2 sections for the
 * Kit-tab in-page tab switcher.
 * ───────────────────────────────────────────────────────────── */

export type SegmentKey = "all" | "spiritual" | "family" | "youth" | "justice";

export type KitSegmentData = {
  segment: SegmentKey;
  briefSlug: string;
  generatedAt: string;
  /** Briefing H2 sections, raw markdown slices, render with ReactMarkdown
   *  in the client tab. Strategi is exposed BOTH as raw markdown (in
   *  case the operator wants prose view) AND as parsed `strategi` below
   *  so the deliverable card grid + poster/flyer collapse can be
   *  rendered without re-parsing client-side. */
  sections: {
    ringkasan: string;
    numerik: string;
    tema: string;
    strategi: string;
    dalil: string;
  };
  strategi: {
    kits: KitDeliverable[];
    posterQuestion: string | null;
    posterHref: string | null;
    flyers: FlyerMessage[];
  };
};

/**
 * Extract one H2-bounded section from a briefing's markdown by exact
 * heading prefix. Returns the body INCLUDING any nested H3 children
 * (so Strategi's 6 sub-sections come through as a single string the
 * client can either re-parse or render whole).
 */
function extractH2Block(md: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = md.indexOf(marker);
  if (start === -1) return "";
  const after = md.slice(start + marker.length);
  const nextH2 = after.search(/\n## /);
  return (nextH2 === -1 ? after : after.slice(0, nextH2)).trim();
}

const SEGMENT_HEADINGS = {
  ringkasan: ["Ringkasan Eksekutif", "Executive Summary"],
  numerik: [
    "Numerik & Tren Pekan Ini",
    "Numbers & Trends This Week",
    "Numerik & Tren",
  ],
  tema: [
    "Tema Utama & Pola Yang Muncul",
    "Main Themes & Emerging Patterns",
    "Tema Utama",
  ],
  strategi: ["Strategi & Aksi Dakwah", "Da'wah Strategies & Actions"],
  dalil: ["Dalil & Sumber", "Daleel & Sources", "Daleel & Sumber"],
} as const;

function pickSection(md: string, candidates: readonly string[]): string {
  for (const c of candidates) {
    const v = extractH2Block(md, c);
    if (v) return v;
  }
  return "";
}

/**
 * Load all 5 latest briefings (one per segment) and structure each into
 * the 5 H2 sections + the parsed Strategi block for the kit-card grid.
 * Ordered all → spiritual → family → youth → justice so the segment
 * tabs render in a predictable left-to-right sequence.
 */
export async function getKitSegments(): Promise<KitSegmentData[]> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(segment, 'all'))
      COALESCE(segment, 'all') AS segment,
      id::text AS id,
      generated_at,
      summary_md
    FROM insights_summaries
    WHERE summary_md IS NOT NULL
    ORDER BY COALESCE(segment, 'all'), generated_at DESC
  `)) as unknown as Array<{
    segment: string;
    id: string;
    generated_at: string;
    summary_md: string;
  }>;

  const order: SegmentKey[] = ["all", "spiritual", "family", "youth", "justice"];
  const bySeg = new Map(rows.map((r) => [r.segment, r]));
  const out: KitSegmentData[] = [];

  for (const seg of order) {
    const row = bySeg.get(seg);
    if (!row) continue;
    const md = row.summary_md;

    // Slug for the deliverable + Mahasiswa URLs. Date interpreted in WIB
    // so a brief generated at 05:00 WIB lands on the local-calendar day.
    const generatedAtDate = new Date(row.generated_at);
    const wibIso = new Date(
      generatedAtDate.getTime() + 7 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const segSuffix = seg === "all" ? "all" : seg;
    const briefSlug = `${wibIso}-${segSuffix}`;

    // H2 section slices — raw markdown so the client can ReactMarkdown
    // them (or use a custom renderer for Strategi).
    const sections = {
      ringkasan: pickSection(md, SEGMENT_HEADINGS.ringkasan),
      numerik: pickSection(md, SEGMENT_HEADINGS.numerik),
      tema: pickSection(md, SEGMENT_HEADINGS.tema),
      strategi: pickSection(md, SEGMENT_HEADINGS.strategi),
      dalil: pickSection(md, SEGMENT_HEADINGS.dalil),
    };

    // Parse Strategi into the kit-card structure + posters + flyers.
    // Reuses the same helpers as `getOverallViewKits` so the UX is
    // consistent across segments.
    const kits: KitDeliverable[] = [];
    for (const def of KIT_DEFS) {
      const section = extractH3Block(md, def.matcher);
      if (!section) continue;
      const excerpt = buildExcerpt(section, 110);
      const wordCount = section.split(/\s+/).filter(Boolean).length;
      const href =
        def.slug === "genz"
          ? `/m/${briefSlug}`
          : `/d/${briefSlug}/${def.slug}`;
      kits.push({
        slug: def.slug,
        title: def.title,
        excerpt,
        href,
        wordCount,
      });
    }

    const mahasiswaSection = extractH3Block(
      md,
      /mahasiswa|university\s+student|gen[\s-]?z/i,
    );
    const posterQuestion =
      mahasiswaSection
        ?.match(/\*\*Poster Question:\*\*\s*"?([^"\n]+?)"?\s*$/m)?.[1]
        ?.trim() ?? null;
    const posterHref = posterQuestion ? `/m/${briefSlug}` : null;

    const flyers = extractFlyers(md);

    out.push({
      segment: seg,
      briefSlug,
      generatedAt: row.generated_at,
      sections,
      strategi: { kits, posterQuestion, posterHref, flyers },
    });
  }

  return out;
}

/* ─────────────────────────────────────────────────────────────
 * Coverage breakdowns — 7d snapshots that complement the existing
 * sparkline + top-issue cards on the Data tab. Three slices:
 *   - per-platform post counts (where the signal came from)
 *   - sentiment composition (positive / neutral / negative)
 *   - topic distribution (top N labelled clusters)
 *
 * All three pull from `social_posts` and use the same 7d window so
 * the percentages are comparable across cards.
 * ───────────────────────────────────────────────────────────── */

export type PlatformBucket = {
  platform: string;
  count: number;
  pct: number;
};

/**
 * Posts ingested per platform in the last 7 days. Sorted descending
 * by count so the dominant source surfaces first. Empty platforms
 * (paused scrapers) are simply absent from the list, which is the
 * correct empty-state — no row for X / IG / TikTok while they're
 * paused per `project_pipeline_verification_state`.
 */
export async function getPlatformDistribution7d(): Promise<PlatformBucket[]> {
  const rows = (await db.execute(sql`
    SELECT platform, count(*)::int AS count
    FROM social_posts
    WHERE created_at >= now() - interval '7 days'
    GROUP BY platform
    ORDER BY count DESC
  `)) as unknown as Array<{ platform: string; count: number }>;

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => ({
    platform: r.platform,
    count: Number(r.count),
    pct: total > 0 ? (Number(r.count) / total) * 100 : 0,
  }));
}

export type SentimentBreakdown = {
  positive: { count: number; pct: number };
  neutral: { count: number; pct: number };
  negative: { count: number; pct: number };
  total: number;
  /** Posts ingested but not yet classified (still null). Useful as a
   *  "data freshness" cue — if this is high, sentiment lines on other
   *  cards may be skewed by the unlabelled tail. */
  unlabelled: number;
};

/**
 * Overall sentiment composition for the 7d window. Excludes
 * unlabelled rows from the percentage denominator so percentages
 * always sum to ~100. Reports unlabelled separately so the UI can
 * surface the "classification in progress" signal if it's high.
 */
export async function getSentimentDistribution7d(): Promise<SentimentBreakdown> {
  const [row] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE sentiment_label = 'positive')::int AS positive,
      count(*) FILTER (WHERE sentiment_label = 'neutral')::int AS neutral,
      count(*) FILTER (WHERE sentiment_label = 'negative')::int AS negative,
      count(*) FILTER (WHERE sentiment_label IS NULL)::int AS unlabelled
    FROM social_posts
    WHERE created_at >= now() - interval '7 days'
  `)) as unknown as Array<{
    positive: number;
    neutral: number;
    negative: number;
    unlabelled: number;
  }>;

  const pos = Number(row?.positive ?? 0);
  const neu = Number(row?.neutral ?? 0);
  const neg = Number(row?.negative ?? 0);
  const unlabelled = Number(row?.unlabelled ?? 0);
  const total = pos + neu + neg;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return {
    positive: { count: pos, pct: pct(pos) },
    neutral: { count: neu, pct: pct(neu) },
    negative: { count: neg, pct: pct(neg) },
    total,
    unlabelled,
  };
}

export type SentimentByPlatformRow = {
  platform: string;
  positive: { count: number; pct: number };
  neutral: { count: number; pct: number };
  negative: { count: number; pct: number };
  total: number;
  unlabelled: number;
};

/**
 * Per-platform sentiment composition for the 7d window. Returns one
 * row for each of the 5 product-supported platforms in a fixed order
 * (mainstream, x, youtube, tiktok, instagram) — including zero-volume
 * platforms so the "show by platform" dialog can render a stable
 * 5-row grid regardless of ingest state.
 */
export async function getSentimentByPlatform7d(): Promise<
  SentimentByPlatformRow[]
> {
  const rows = (await db.execute(sql`
    SELECT
      platform,
      count(*) FILTER (WHERE sentiment_label = 'positive')::int AS positive,
      count(*) FILTER (WHERE sentiment_label = 'neutral')::int  AS neutral,
      count(*) FILTER (WHERE sentiment_label = 'negative')::int AS negative,
      count(*) FILTER (WHERE sentiment_label IS NULL)::int      AS unlabelled
    FROM social_posts
    WHERE created_at >= now() - interval '7 days'
    GROUP BY platform
  `)) as unknown as Array<{
    platform: string;
    positive: number;
    neutral: number;
    negative: number;
    unlabelled: number;
  }>;

  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  // Fixed display order — keeps the dialog UI consistent even when a
  // platform has zero rows.
  const ORDER = ["mainstream", "x", "youtube", "tiktok", "instagram"];
  return ORDER.map((platform) => {
    const r = byPlatform.get(platform);
    const pos = Number(r?.positive ?? 0);
    const neu = Number(r?.neutral ?? 0);
    const neg = Number(r?.negative ?? 0);
    const unl = Number(r?.unlabelled ?? 0);
    const total = pos + neu + neg;
    const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
    return {
      platform,
      positive: { count: pos, pct: pct(pos) },
      neutral: { count: neu, pct: pct(neu) },
      negative: { count: neg, pct: pct(neg) },
      total,
      unlabelled: unl,
    };
  });
}

export type TopicBucket = {
  id: string;
  label: string;
  platform: string;
  keywords: string[];
  count: number;
  pct: number;
  /** Coarse-grained group (e.g. "Hukum & Keadilan", "Ekonomi & Bisnis").
   *  Derived from the topic label via THEME_GROUPS regex matching.
   *  UI can use this to render a collapsed group-first view that
   *  expands into the fine themes. */
  group: string;
};

/** Maps fine-grained topic labels to coarse-grained groups. Each group
 *  has 0+ regex patterns; the first match wins. Labels that match no
 *  pattern fall into "Lainnya" (catch-all group, NOT the same as the
 *  Tidak Terklasifikasi fallback topic).
 *
 *  Defined in code (not DB) so it can be edited freely without
 *  migrations and applied as a presentation projection. Static themes
 *  always end up in their intended group; dynamic Gemini themes match
 *  by regex on their generated label. */
export const THEME_GROUPS: ReadonlyArray<{ group: string; patterns: RegExp[] }> = [
  {
    group: "Hukum & Keadilan",
    patterns: [
      /korupsi/i,
      /pengkhianatan amanah/i,
      /kriminalitas/i,
      /kejahatan/i,
      /pembunuhan/i,
      /penipuan/i,
    ],
  },
  {
    group: "Sosial & Keluarga",
    patterns: [
      /kekerasan seksual/i,
      /perlindungan anak/i,
      /isu sosial/i,
      /keluarga/i,
      /kdrt/i,
    ],
  },
  {
    group: "Ekonomi & Bisnis",
    patterns: [
      /ekonomi/i,
      /kesejahteraan rakyat/i,
      /bisnis/i,
      /wirausaha/i,
      /rupiah/i,
      /crypto/i,
      /trading/i,
      /investasi/i,
      /umkm/i,
    ],
  },
  {
    group: "Aqidah & Spiritualitas",
    patterns: [
      /ibadah/i,
      /haji/i,
      /kurban/i,
      /idul adha/i,
      /hijrah/i,
      /mualaf/i,
      /inspirasi spiritual/i,
      /fatwa/i,
      /hukum islam/i,
      /polemik aqidah/i,
      /sektarian/i,
    ],
  },
  {
    group: "Kesehatan & Kehidupan",
    patterns: [/kesehatan/i, /penyakit/i, /kesehatan mental/i, /kesejahteraan jiwa/i],
  },
  {
    group: "Pendidikan & SDM",
    patterns: [/pendidikan/i, /sekolah/i, /literasi/i, /sdm/i, /kualitas sdm/i],
  },
  {
    group: "Lingkungan & Bencana",
    patterns: [/bencana/i, /lingkungan/i, /pengelolaan sampah/i, /tragedi/i],
  },
  {
    group: "Pemerintahan & Kebijakan",
    patterns: [
      /pemerintahan/i,
      /otonomi daerah/i,
      /kebijakan publik/i,
      /birokrasi/i,
      /otda/i,
    ],
  },
  {
    group: "Patologi Sosial Digital",
    patterns: [/judi online/i, /pinjol/i, /pinjaman online/i, /narkoba/i, /penyalahgunaan obat/i],
  },
  {
    group: "Pekerja & Pertanian Rakyat",
    patterns: [
      /buruh/i,
      /tenaga kerja/i,
      /pekerja rumah tangga/i,
      /upah minimum/i,
      /bpjs ketenagakerjaan/i,
      /ketahanan pangan/i,
      /pertanian/i,
      /petani/i,
      /pupuk/i,
      /bulog/i,
      /nelayan/i,
    ],
  },
  {
    group: "Konflik & Geopolitik",
    patterns: [
      /palestina/i,
      /solidaritas umat/i,
      /konflik internasional/i,
      /hubungan internasional/i,
      /geopolitik/i,
    ],
  },
  {
    group: "Inspirasi & Kisah Pribadi",
    patterns: [/inspirasi/i, /kisah hidup/i, /pengalaman pribadi/i, /renungan/i, /motivasi/i],
  },
  {
    group: "Toleransi & Lintas-Iman",
    patterns: [/toleransi/i, /keberagaman/i, /lintas[\s-]?iman/i, /moderasi beragama/i, /pluralisme/i],
  },
];

/** Apply THEME_GROUPS to derive the coarse group for a topic label.
 *  First-match wins. Falls back to "Lainnya" when no pattern matches —
 *  this is distinct from the "Tidak Terklasifikasi" fallback topic
 *  (which is a topic that lives in the topics table). "Lainnya" here
 *  means "we have a topic but it doesn't fit any of our groups yet,"
 *  which is a signal to extend THEME_GROUPS rather than a problem. */
export function classifyThemeGroup(label: string): string {
  for (const { group, patterns } of THEME_GROUPS) {
    if (patterns.some((p) => p.test(label))) return group;
  }
  return "Lainnya";
}

export type PickerTopic = {
  id: string;
  label: string;
  keywords: string[];
  postCount: number;
};

/**
 * Topics available to surface in the brief + flyer "pick a current
 * topic" dropdowns. Excludes the synthetic fallback bucket
 * ("Lainnya — Tidak Terklasifikasi") since picking it would yield no
 * useful context. Ordered by post count desc; pulls topics that have
 * any posts in the last 7d.
 */
export async function getCurrentTopicsForPicker(
  limit = 20,
): Promise<PickerTopic[]> {
  const rows = (await db.execute(sql`
    SELECT
      t.id::text AS id,
      t.label,
      t.keywords AS keywords,
      count(sp.id)::int AS post_count
    FROM topics t
    LEFT JOIN social_posts sp
      ON sp.topic_id = t.id
     AND sp.created_at >= now() - interval '7 days'
    WHERE t.label != 'Lainnya — Tidak Terklasifikasi'
    GROUP BY t.id, t.label, t.keywords
    HAVING count(sp.id) > 0
    ORDER BY post_count DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    label: string;
    keywords: unknown;
    post_count: number;
  }>;
  return rows.map((r) => {
    const kw = Array.isArray(r.keywords)
      ? (r.keywords as string[])
      : typeof r.keywords === "string"
        ? (JSON.parse(r.keywords) as string[])
        : [];
    return {
      id: r.id,
      label: r.label,
      keywords: kw.slice(0, 8),
      postCount: Number(r.post_count),
    };
  });
}

/**
 * Fetch one picker topic + a few sample post headlines under it for
 * use as LLM context. Called from briefs/actions.ts and the user-
 * flyers API when the user has picked a specific current topic. Keeps
 * the query tight (id + label + keywords + 5 headlines) so the
 * generation pipeline gets a focused anchor instead of the broad
 * "top trending" blob.
 */
export async function getCurrentTopicContext(
  topicId: string,
): Promise<{
  id: string;
  label: string;
  keywords: string[];
  sampleHeadlines: string[];
} | null> {
  const [topicRow] = (await db.execute(sql`
    SELECT id::text AS id, label, keywords
    FROM topics
    WHERE id = ${topicId}::uuid
    LIMIT 1
  `)) as unknown as Array<{
    id: string;
    label: string;
    keywords: unknown;
  }>;
  if (!topicRow) return null;

  const sampleRows = (await db.execute(sql`
    SELECT regexp_replace(split_part(text, E'\n', 1), '\s+', ' ', 'g') AS headline
    FROM social_posts
    WHERE topic_id = ${topicId}::uuid
      AND created_at >= now() - interval '7 days'
      AND text IS NOT NULL
      AND length(text) > 20
    ORDER BY (engagement_score IS NOT NULL) DESC, engagement_score DESC NULLS LAST, created_at DESC
    LIMIT 5
  `)) as unknown as Array<{ headline: string | null }>;

  const kw = Array.isArray(topicRow.keywords)
    ? (topicRow.keywords as string[])
    : typeof topicRow.keywords === "string"
      ? (JSON.parse(topicRow.keywords) as string[])
      : [];

  return {
    id: topicRow.id,
    label: topicRow.label,
    keywords: kw.slice(0, 8),
    sampleHeadlines: sampleRows
      .map((r) => (r.headline ?? "").trim())
      .filter((h) => h.length > 0)
      .map((h) => h.slice(0, 200)),
  };
}

/**
 * Top N topics by post count in the last 7 days. Distinguishes from
 * `getTopIssues` (which returns 3 with full sentiment+sample details
 * for the hero cards) — this returns a leaner list of ~10 for the
 * "everything else" distribution card. No sentiment / sample posts;
 * just `(label, platform, count, pct)`.
 *
 * `pct` is share of TOTAL 7d posts (not topic-only), so reading
 * "X% of all this week's posts cluster here" is correct.
 */
export async function getTopicDistribution7d(
  limit = 10,
): Promise<TopicBucket[]> {
  // One round-trip — JOIN topics → counted posts, scalar subquery for
  // the corpus total. Keeps the math consistent if posts and topics
  // race against each other (very rare at our cadence, but safer).
  const rows = (await db.execute(sql`
    WITH total AS (
      SELECT count(*)::int AS n FROM social_posts
      WHERE created_at >= now() - interval '7 days'
    )
    SELECT
      t.id::text AS id,
      t.label,
      t.platform,
      t.keywords AS keywords,
      count(sp.id)::int AS post_count,
      (SELECT n FROM total) AS corpus_total
    FROM topics t
    LEFT JOIN social_posts sp
      ON sp.topic_id = t.id
     AND sp.created_at >= now() - interval '7 days'
    GROUP BY t.id, t.label, t.platform, t.keywords
    HAVING count(sp.id) > 0
    ORDER BY post_count DESC
    LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    label: string;
    platform: string;
    keywords: unknown;
    post_count: number;
    corpus_total: number;
  }>;

  return rows.map((r) => {
    const kw = Array.isArray(r.keywords)
      ? (r.keywords as string[])
      : typeof r.keywords === "string"
        ? (JSON.parse(r.keywords) as string[])
        : [];
    const total = Number(r.corpus_total ?? 0);
    const count = Number(r.post_count);
    return {
      id: r.id,
      label: r.label,
      platform: r.platform,
      keywords: kw.slice(0, 5),
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      group: classifyThemeGroup(r.label),
    };
  });
}

export type TopicByPlatformGroup = {
  platform: string;
  topics: Array<{
    id: string;
    label: string;
    count: number;
    pct: number;
    /** Coarse-grained group, derived from label via THEME_GROUPS. */
    group: string;
  }>;
};

/**
 * Top N topics per platform for the 7d window. Returns one entry per
 * product-supported platform in fixed order (mainstream, x, youtube,
 * tiktok, instagram) — empty `topics: []` if the platform has no
 * topics yet. `pct` is share of that platform's total topic volume
 * (so percentages sum to ~100 within each platform, not across).
 *
 * Topics are now UNIFIED (cluster_topics clusters all platforms into one
 * set, `topics.platform = "all"`), so the per-platform breakdown is
 * derived from each POST's own `social_posts.platform`: for each
 * platform, the top unified topics that have posts from it in the 7d
 * window. A topic can therefore appear under multiple platforms (e.g. a
 * theme discussed on both mainstream and YouTube).
 *
 * Used by the "topics by platform" dialog on the coverage breakdown.
 */
export async function getTopicsByPlatform7d(
  perPlatform = 5,
): Promise<TopicByPlatformGroup[]> {
  const rows = (await db.execute(sql`
    SELECT platform, id, label, post_count, platform_total
    FROM (
      SELECT
        sp.platform AS platform,
        t.id::text AS id,
        t.label AS label,
        count(sp.id) AS post_count,
        SUM(count(sp.id)) OVER (PARTITION BY sp.platform) AS platform_total,
        row_number() OVER (
          PARTITION BY sp.platform ORDER BY count(sp.id) DESC
        ) AS rn
      FROM topics t
      JOIN social_posts sp
        ON sp.topic_id = t.id
       AND sp.posted_at >= now() - interval '7 days'
      GROUP BY sp.platform, t.id, t.label
    ) ranked
    WHERE rn <= ${perPlatform}
    ORDER BY platform, post_count DESC
  `)) as unknown as Array<{
    platform: string;
    id: string;
    label: string;
    post_count: number;
    platform_total: number;
  }>;

  const byPlatform = new Map<string, TopicByPlatformGroup["topics"]>();
  for (const r of rows) {
    const total = Number(r.platform_total ?? 0);
    const count = Number(r.post_count);
    const entry = {
      id: r.id,
      label: r.label,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      group: classifyThemeGroup(r.label),
    };
    const list = byPlatform.get(r.platform) ?? [];
    list.push(entry);
    byPlatform.set(r.platform, list);
  }

  const ORDER = ["mainstream", "x", "youtube", "tiktok", "instagram"];
  return ORDER.map((platform) => ({
    platform,
    topics: byPlatform.get(platform) ?? [],
  }));
}
