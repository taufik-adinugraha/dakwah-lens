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
 * Briefs generated by THIS user in the last 7 days
 * ───────────────────────────────────────────────────────────── */

export async function getBriefsThisWeek(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.briefs)
    .where(
      and(
        eq(schema.briefs.userId, userId),
        gte(
          schema.briefs.createdAt,
          sql`now() - interval '7 days'`,
        ),
      ),
    );
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
    return {
      postId: r.post_id,
      title: (r.title?.split("\n")[0] ?? r.title ?? "").slice(0, 120),
      channel: r.channel ?? "?",
      url: r.url,
      viewsNow,
      viewsThen,
      delta,
      deltaPct: viewsThen > 0 ? (delta / viewsThen) * 100 : 0,
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
 * Dashboard tabs — Kit + Data surfaces
 * Helpers for the revamped /dashboard layout.
 * ───────────────────────────────────────────────────────────── */

export type LatestKhutbah = {
  briefId: string;
  generatedAt: string;
  excerpt: string;
  wordCount: number;
};

/**
 * Pull the latest cross-platform briefing's `### Khutbah Jumat` slice
 * and return a hero-card-ready excerpt. We don't load the whole 4K-word
 * khutbah into the dashboard payload — just the opening ~200 words and
 * a link to the full read.
 *
 * Returns null when no insights_summary exists yet, or when the markdown
 * doesn't have a Khutbah Jumat section (e.g. mid-migration formats).
 */
export async function getLatestKhutbah(): Promise<LatestKhutbah | null> {
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

  // Find "### Khutbah Jumat" then take from the first non-heading line
  // forward until we hit the next H3 or run out of room. Truncate at
  // ~220 words for an excerpt that fills a hero card without scrolling.
  const md = row.summary_md;
  const startMarker = "### Khutbah Jumat";
  const startIdx = md.indexOf(startMarker);
  if (startIdx === -1) return null;
  const after = md.slice(startIdx + startMarker.length);
  const nextH3 = after.search(/\n### /);
  const section = nextH3 === -1 ? after : after.slice(0, nextH3);

  // Strip leading whitespace, skip pre-amble like "(3450-4800 kata)" if
  // it slipped through, then walk forward collecting prose until ~220 words.
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("(") && // word-count parenthetical
        !l.startsWith("**KHUTBAH"), // mukadimah header
    );

  const words: string[] = [];
  for (const line of lines) {
    if (words.length >= 220) break;
    // Skip lines that look like Arabic ayat — they'd dominate the excerpt
    // visually and most desktop fonts won't render them well at body size.
    if (/^[؀-ۿ\s]+$/.test(line)) continue;
    words.push(...line.split(/\s+/));
  }
  const excerpt = words.slice(0, 220).join(" ") + (words.length > 220 ? "…" : "");

  return {
    briefId: row.id,
    generatedAt: row.generated_at,
    excerpt,
    wordCount: words.length,
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

/**
 * 7-day rolling sentiment composition. Each point is a WIB-calendar day.
 * Days with fewer than `MIN_DAILY_LABELLED` classified posts are still
 * returned but with total=0 so the chart can render gaps gracefully.
 */
export async function getSentimentTrend7d(): Promise<SentimentTrendPoint[]> {
  const MIN_DAILY_LABELLED = 5;
  const rows = (await db.execute(sql`
    SELECT
      to_char(date_trunc('day', timezone('Asia/Jakarta', created_at)), 'YYYY-MM-DD') AS day,
      COUNT(*) FILTER (WHERE sentiment_label IS NOT NULL)::int AS total,
      COUNT(*) FILTER (WHERE sentiment_label = 'negative')::int AS neg,
      COUNT(*) FILTER (WHERE sentiment_label = 'positive')::int AS pos
    FROM social_posts
    WHERE created_at >= now() - interval '7 days'
    GROUP BY day
    ORDER BY day
  `)) as unknown as Array<{
    day: string;
    total: number;
    neg: number;
    pos: number;
  }>;

  return rows.map((r) => {
    const total = Number(r.total);
    const safeTotal = total >= MIN_DAILY_LABELLED ? total : 0;
    return {
      day: r.day,
      total,
      negPct: safeTotal > 0 ? (Number(r.neg) / safeTotal) * 100 : 0,
      posPct: safeTotal > 0 ? (Number(r.pos) / safeTotal) * 100 : 0,
    };
  });
}
