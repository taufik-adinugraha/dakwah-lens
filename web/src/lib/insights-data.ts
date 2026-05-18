/**
 * Server-side aggregation of `social_posts` for the `/insights/[platform]` pages.
 *
 * Returns `null` when the platform has no ingested data yet — the page then
 * falls back to mock content from `drilldowns.ts`. As soon as the ingestion
 * pipeline writes one real row for that platform, the page seamlessly switches
 * to live data.
 */

import { and, count, countDistinct, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";

export type PlatformInsights = {
  totalPosts: number;
  uniqueAuthors: number;
  topOutlets: Array<{ name: string; articles: number }>;
  topStories: Array<{
    id: string;
    text: string;
    author: string | null;
    url: string | null;
    sentimentLabel: string | null;
    sentimentScore: number | null;
    dawahRelevance: number | null;
    categories: Record<string, number> | null;
    postedAt: Date | null;
  }>;
  /** Sentiment counts across all posts for this platform. */
  sentimentMix: { positive: number; neutral: number; negative: number };
  /**
   * Da'wah categories aggregated across all posts. For each of the 9 PRD
   * categories, the value is the sum of per-post scores → useful for
   * "biggest themes" rendering.
   */
  categoryTotals: Record<string, number>;
  /**
   * Posts bucketed by their *dominant* category (the category with the
   * highest score in that post's `categories` JSONB). Sorted by count desc.
   */
  dominantCategories: Array<{ category: string; posts: number }>;
  /**
   * Topics discovered by the BERTopic batch job. Empty until
   * `api/src/api/scripts/cluster_topics.py` has run for this platform.
   */
  discoveredTopics: Array<{
    id: string;
    label: string;
    keywords: string[];
    postCount: number;
  }>;
};

export type ScopeFilter = "all" | "national" | "regional";

/**
 * Optional scope/region narrowing — only meaningful for `platform=mainstream`.
 *  - scope `national` → posts with `region IS NULL`
 *  - scope `regional` → posts with `region IS NOT NULL` (any region)
 *  - region set       → posts with `region = <region>` (implies scope=regional)
 * Other platforms ignore these.
 */
export type InsightsFilters = {
  scope?: ScopeFilter;
  region?: string | null;
};

function buildPlatformFilter(
  platform: string,
  filters: InsightsFilters | undefined,
) {
  // Returns a SQL fragment that always includes `platform = X`. We use
  // raw SQL `region IS [NOT] NULL` here because drizzle's `isNull` /
  // `isNotNull` would force a different helper import — keeping it inline
  // is shorter and equally safe (params are bound, no string concat).
  if (platform !== "mainstream" || !filters) {
    return eq(schema.socialPosts.platform, platform);
  }
  if (filters.region) {
    return and(
      eq(schema.socialPosts.platform, platform),
      eq(schema.socialPosts.region, filters.region),
    )!;
  }
  if (filters.scope === "national") {
    return and(
      eq(schema.socialPosts.platform, platform),
      sql`region IS NULL`,
    )!;
  }
  if (filters.scope === "regional") {
    return and(
      eq(schema.socialPosts.platform, platform),
      sql`region IS NOT NULL`,
    )!;
  }
  return eq(schema.socialPosts.platform, platform);
}

export async function getPlatformInsights(
  platform: string,
  filters?: InsightsFilters,
): Promise<PlatformInsights | null> {
  const platformWhere = buildPlatformFilter(platform, filters);

  const [{ totalPosts = 0 } = { totalPosts: 0 }] = (await db
    .select({ totalPosts: count() })
    .from(schema.socialPosts)
    .where(platformWhere)) as Array<{
    totalPosts: number;
  }>;

  if (totalPosts === 0) return null;

  const [{ uniqueAuthors = 0 } = { uniqueAuthors: 0 }] = (await db
    .select({ uniqueAuthors: countDistinct(schema.socialPosts.author) })
    .from(schema.socialPosts)
    .where(platformWhere)) as Array<{
    uniqueAuthors: number;
  }>;

  const topOutlets = (await db
    .select({
      name: schema.socialPosts.author,
      articles: count(),
    })
    .from(schema.socialPosts)
    .where(
      and(platformWhere, isNotNull(schema.socialPosts.author)),
    )
    .groupBy(schema.socialPosts.author)
    .orderBy(desc(count()))
    .limit(8)) as Array<{ name: string | null; articles: number }>;

  const topStories = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      sentimentLabel: schema.socialPosts.sentimentLabel,
      sentimentScore: schema.socialPosts.sentimentScore,
      dawahRelevance: schema.socialPosts.dawahRelevance,
      categories: schema.socialPosts.categories,
      postedAt: schema.socialPosts.postedAt,
    })
    .from(schema.socialPosts)
    .where(platformWhere)
    .orderBy(desc(schema.socialPosts.dawahRelevance))
    .limit(8);

  // Sentiment mix — count per label.
  const sentimentRows = (await db
    .select({
      label: schema.socialPosts.sentimentLabel,
      n: count(),
    })
    .from(schema.socialPosts)
    .where(platformWhere)
    .groupBy(schema.socialPosts.sentimentLabel)) as Array<{
    label: string | null;
    n: number;
  }>;

  const sentimentMix = { positive: 0, neutral: 0, negative: 0 };
  for (const row of sentimentRows) {
    if (row.label === "positive") sentimentMix.positive = row.n;
    else if (row.label === "negative") sentimentMix.negative = row.n;
    else if (row.label === "neutral") sentimentMix.neutral = row.n;
  }

  // Aggregate category scores across all posts for this platform. We sum the
  // per-post per-category scores; the resulting magnitudes show "how much
  // collective attention" each da'wah category is getting.
  const CATEGORIES = [
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

  const categorySums = (await db
    .select({
      ...Object.fromEntries(
        CATEGORIES.map((cat) => [
          cat,
          sql<number>`COALESCE(SUM((categories ->> ${cat})::numeric), 0)`,
        ]),
      ),
    })
    .from(schema.socialPosts)
    .where(
      and(platformWhere, isNotNull(schema.socialPosts.categories)),
    )) as Array<Record<(typeof CATEGORIES)[number], number>>;

  const row = categorySums[0] ?? ({} as Record<string, number>);
  const categoryTotals: Record<string, number> = {};
  for (const cat of CATEGORIES) {
    categoryTotals[cat] = Number(row[cat] ?? 0);
  }

  // Count posts where each da'wah category is the *dominant* one. This is
  // the bucketing we use to render the cluster-card view. Done in SQL via a
  // lateral subquery — for each row we pick the (key, value) pair with the
  // highest value from the `categories` JSONB and count by that key.
  // Extra SQL fragment for the scope/region narrowing on the raw query
  // below. Kept as a separate fragment because `db.execute(sql)` can't
  // easily reuse the drizzle WHERE expression machinery.
  const regionFragment = (() => {
    if (platform !== "mainstream" || !filters) return sql``;
    if (filters.region) return sql`AND region = ${filters.region}`;
    if (filters.scope === "national") return sql`AND region IS NULL`;
    if (filters.scope === "regional") return sql`AND region IS NOT NULL`;
    return sql``;
  })();

  const dominantRows = (await db.execute(
    sql`
      SELECT dom, COUNT(*)::int AS posts
      FROM (
        SELECT (
          SELECT key
          FROM jsonb_each_text(categories)
          ORDER BY value::numeric DESC
          LIMIT 1
        ) AS dom
        FROM social_posts
        WHERE platform = ${platform}
          AND categories IS NOT NULL
          ${regionFragment}
      ) t
      WHERE dom IS NOT NULL
      GROUP BY dom
      ORDER BY posts DESC
    `,
  )) as unknown as Array<{ dom: string; posts: number }>;

  // drizzle's `execute` returns the array directly via postgres-js
  const dominantList: Array<{ category: string; posts: number }> = [];
  for (const row of Array.isArray(dominantRows) ? dominantRows : []) {
    if (row && typeof row.dom === "string") {
      dominantList.push({ category: row.dom, posts: Number(row.posts ?? 0) });
    }
  }

  // Discovered topics for this platform (latest BERTopic batch).
  const topicRows = await db
    .select({
      id: schema.topics.id,
      label: schema.topics.label,
      keywords: schema.topics.keywords,
      postCount: schema.topics.postCount,
    })
    .from(schema.topics)
    .where(eq(schema.topics.platform, platform))
    .orderBy(desc(schema.topics.postCount))
    .limit(8);

  return {
    totalPosts,
    uniqueAuthors,
    topOutlets: topOutlets
      .filter((o): o is { name: string; articles: number } => !!o.name)
      .map((o) => ({ name: o.name, articles: o.articles })),
    topStories: topStories.map((s) => ({
      ...s,
      sentimentScore: s.sentimentScore as number | null,
      dawahRelevance: s.dawahRelevance as number | null,
      categories: s.categories as Record<string, number> | null,
    })),
    sentimentMix,
    categoryTotals,
    dominantCategories: dominantList,
    discoveredTopics: topicRows.map((t) => ({
      id: t.id,
      label: t.label,
      keywords: t.keywords ?? [],
      postCount: t.postCount,
    })),
  };
}
