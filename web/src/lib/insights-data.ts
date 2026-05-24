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
import { extractMahasiswaContent } from "@/lib/flyer/content";

/**
 * Strip word-count annotations the LLM echoes back from the prompt's
 * structural headings — e.g. `### Khutbah Jumat (2300-3200 kata)` →
 * `### Khutbah Jumat`. Those parentheticals are length instructions
 * FOR the model, not content FOR the reader; they read as confusing
 * noise in the published briefing.
 *
 * Applied at every data-access boundary that returns `summary_md` /
 * `summary_md_en` so downstream renderers (BriefingNarrative,
 * deliverable share pages, .md/.pdf/.txt downloads, flyer compose,
 * Mahasiswa article extract) all see clean copy.
 *
 * Patterns handled (id + en, parenthetical only):
 *   (2300-3200 kata)    (~80 kata)    (300-450 kata Arab)
 *   (2300-3200 words)   (~80 words)
 * Both ASCII hyphen and en-dash separators accepted.
 */
export function stripWordCountAnnotations(md: string | null): string | null {
  if (md == null) return md;
  return md
    .replace(
      /\s*\(\s*~?\d+(?:\s*[-–]\s*\d+)?\s*(?:kata|words?)(?:\s+[A-Za-z]+)?\s*\)/gi,
      "",
    )
    // Collapse "Heading  :" or "Heading  ." double-spaces left by the
    // strip. Only intra-line — never crosses newlines.
    .replace(/ {2,}/g, " ");
}

/**
 * The 9 PRD da'wah categories the Gemini classifier assigns to every post.
 * Source of truth: `api/src/api/services/relevance.py`. Mirror here because
 * the web side aggregates per-category scores from the `categories` JSONB
 * column. Stat tiles + segment definitions key off `.length` so a category
 * add/remove only needs an edit in one place.
 */
export const DAWAH_CATEGORIES = [
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
    dawahOpportunity: number | null;
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
   * Topics discovered by the Gemini topic-discovery batch job. Empty
   * until `api/src/api/scripts/cluster_topics.py` has run for this
   * platform (runs nightly at 04:00 WIB).
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

  // Top posts: sort by da'wah opportunity (the 2026-05-21 focused-prompt
  // signal), falling back to dawahRelevance when opportunity is NULL
  // on rows ingested before the migration. COALESCE keeps the ranking
  // continuous across the cutover.
  const topStories = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      sentimentLabel: schema.socialPosts.sentimentLabel,
      sentimentScore: schema.socialPosts.sentimentScore,
      dawahRelevance: schema.socialPosts.dawahRelevance,
      dawahOpportunity: schema.socialPosts.dawahOpportunity,
      categories: schema.socialPosts.categories,
      postedAt: schema.socialPosts.postedAt,
    })
    .from(schema.socialPosts)
    .where(platformWhere)
    .orderBy(
      desc(
        sql`COALESCE(${schema.socialPosts.dawahOpportunity}, ${schema.socialPosts.dawahRelevance})`,
      ),
    )
    // Fetch a deeper pool; UI uses <ShowMoreList /> to reveal 8 at
    // a time. 50 is enough for ~6 "show more" clicks before exhaust.
    .limit(50);

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
  const categorySums = (await db
    .select({
      ...Object.fromEntries(
        DAWAH_CATEGORIES.map((cat) => [
          cat,
          sql<number>`COALESCE(SUM((categories ->> ${cat})::numeric), 0)`,
        ]),
      ),
    })
    .from(schema.socialPosts)
    .where(
      and(platformWhere, isNotNull(schema.socialPosts.categories)),
    )) as Array<Record<(typeof DAWAH_CATEGORIES)[number], number>>;

  const row = categorySums[0] ?? ({} as Record<string, number>);
  const categoryTotals: Record<string, number> = {};
  for (const cat of DAWAH_CATEGORIES) {
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

  // Discovered topics for this platform (latest topic-discovery batch).
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
      dawahOpportunity: s.dawahOpportunity as number | null,
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

/* ──────────────────────────────────────────────────────────────────
 * Cross-platform overview used by the public `/insights` landing.
 *
 * Same shape ideas as the per-platform queries but aggregated over
 * every platform with no scope filter. Returns `null` when the
 * pipeline hasn't ingested anything yet so the page can render an
 * empty state without inventing numbers.
 * ────────────────────────────────────────────────────────────────── */
export type OverviewInsights = {
  totalPosts: number;
  classifiedPosts: number;
  sentimentMix: { positive: number; neutral: number; negative: number };
  /** Sum of per-post category scores across all platforms. */
  categoryTotals: Record<string, number>;
  /** Post count per dominant da'wah category. Sorted desc. */
  dominantCategories: Array<{ category: string; posts: number }>;
  /** Top Gemini-discovered topics across platforms. */
  trendingTopics: Array<{
    id: string;
    label: string;
    platform: string;
    keywords: string[];
    postCount: number;
  }>;
  /** Per-platform breakdown for the /insights source-mix + cards. */
  platformBreakdown: Array<{
    platform: string;
    posts: number;
    topTopic: { label: string; keywords: string[] } | null;
    topCategory: string | null;
  }>;
};

export type LatestInsightsSummary = {
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  summaryMd: string;
  /** Parallel English narrative — null on rows generated before the
   *  2026-05-21 migration. Consumers should fall back to summaryMd. */
  summaryMdEn: string | null;
  headlineStats: {
    totals?: {
      posts_7d?: number;
      posts_prev_7d?: number;
      delta_pct?: number | null;
    };
    sentiment?: {
      current_pct_negative?: number;
      current_pct_neutral?: number;
      current_pct_positive?: number;
      baseline_pct_negative?: number;
      /** null when there's no prior-week baseline yet (first ingest weeks). */
      delta_pp_negative?: number | null;
    };
    top_categories?: Array<{
      category: string;
      posts: number;
      share_pct: number;
      /** null when there's no prior-week baseline. */
      delta_pp: number | null;
    }>;
    top_topics?: Array<{
      label: string;
      platform: string;
      keywords: string[];
      post_count: number;
    }>;
    platforms?: Array<{ platform: string; posts: number }>;
  };
  model: string;
  segment: string | null;
  daleelRefs: schema.DaleelRef[] | null;
  /** Separate du'a / dzikir pool for Pesan Flyer 5 + 6. NULL on
   *  briefings written before the 2026-05-23 adhkar split. Same item
   *  schema as `daleelRefs`. */
  adhkarRefs: schema.DaleelRef[] | null;
};

/** Most-recent AI-narrated executive briefing for a given segment.
 *  `segment` = null returns the all-platform briefing. Returns null
 *  when no row exists yet (briefing job hasn't fired). */
export async function getLatestInsightsSummary(
  segment: string | null = null,
): Promise<LatestInsightsSummary | null> {
  const [row] = await db
    .select({
      generatedAt: schema.insightsSummaries.generatedAt,
      periodStart: schema.insightsSummaries.periodStart,
      periodEnd: schema.insightsSummaries.periodEnd,
      summaryMd: schema.insightsSummaries.summaryMd,
      summaryMdEn: schema.insightsSummaries.summaryMdEn,
      headlineStats: schema.insightsSummaries.headlineStats,
      model: schema.insightsSummaries.model,
      segment: schema.insightsSummaries.segment,
      daleelRefs: schema.insightsSummaries.daleelRefs,
      adhkarRefs: schema.insightsSummaries.adhkarRefs,
    })
    .from(schema.insightsSummaries)
    .where(
      segment === null
        ? sql`segment IS NULL`
        : eq(schema.insightsSummaries.segment, segment),
    )
    .orderBy(desc(schema.insightsSummaries.generatedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    summaryMd: stripWordCountAnnotations(row.summaryMd) as string,
    summaryMdEn: stripWordCountAnnotations(row.summaryMdEn),
    headlineStats: row.headlineStats as LatestInsightsSummary["headlineStats"],
    daleelRefs: (row.daleelRefs as schema.DaleelRef[] | null) ?? null,
    adhkarRefs: (row.adhkarRefs as schema.DaleelRef[] | null) ?? null,
  };
}

/** Section-4 deliverable slugs that map H3 sub-headings to URL keys.
 *  The matcher pattern is the same one used by
 *  BriefDeliverableCards.classifyHeading — kept here so both server
 *  pages (/d/{brief}/{deliverable}) and the modal card grid agree. */
export const DELIVERABLE_HEADING_PATTERNS: Record<
  string,
  { matcher: (heading: string) => boolean; title: string }
> = {
  khutbah: {
    matcher: (h) => /khutbah|friday/i.test(h),
    title: "Khutbah Jumat",
  },
  kajian: {
    matcher: (h) => /kajian|majelis/i.test(h),
    title: "Kajian",
  },
  home: {
    matcher: (h) => /rumah|home|teaching at/i.test(h),
    title: "Pengajaran di Rumah",
  },
  content: {
    matcher: (h) =>
      /konten|kreator|content creator|digital content/i.test(h),
    title: "Kreator Konten",
  },
  genz: {
    matcher: (h) =>
      /mahasiswa|university\s+student|gen[\s-]?z|pendekatan\s+gen|reaching gen/i.test(
        h,
      ),
    title: "Mahasiswa",
  },
  action: {
    matcher: (h) =>
      /aksi|khidmah|ummah|social action|service to/i.test(h),
    title: "Aksi Sosial",
  },
};

/** Extract one Section-4 deliverable sub-section from a briefing's
 *  markdown body. Returns the H3 heading text + the prose / Q&A under
 *  it (everything between that H3 and the next H3 / H2). Returns null
 *  when the briefing doesn't have that deliverable. */
export function extractDeliverableSection(
  markdown: string,
  slug: keyof typeof DELIVERABLE_HEADING_PATTERNS,
): { heading: string; body: string } | null {
  const matcher = DELIVERABLE_HEADING_PATTERNS[slug]?.matcher;
  if (!matcher) return null;
  const lines = markdown.split("\n");
  let start = -1;
  let headingLine = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###\s+(.+?)\s*$/);
    if (m && matcher(m[1])) {
      start = i + 1;
      headingLine = m[1].trim();
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
  return {
    heading: headingLine,
    body: lines.slice(start, end).join("\n").trim(),
  };
}

/** Slug → briefing resolver for /briefs/[id] public pages.
 *
 *  Slug format: `{YYYY-MM-DD}-{segment-or-all}` (e.g. `2026-05-21-all`,
 *  `2026-05-21-family`). Date is interpreted in WIB (Asia/Jakarta) so a
 *  briefing fired at 05:00 WIB lands on today's date even though UTC is
 *  still yesterday. Returns the LATEST briefing matching that
 *  date+segment — when multiple briefings exist for the same combo
 *  (e.g. a test re-run), only the freshest is reachable by slug.
 *
 *  Public: no auth check — insights_summaries contains only aggregated
 *  conversation data + LLM narrative, no PII.
 */
export async function getBriefingBySlug(
  slug: string,
): Promise<LatestInsightsSummary | null> {
  // Strict regex match — slug is YYYY-MM-DD followed by -segment.
  const m = slug.match(/^(\d{4}-\d{2}-\d{2})-(all|family|youth|justice|spiritual)$/);
  if (!m) return null;
  const [, date, segmentLabel] = m;
  const segment = segmentLabel === "all" ? null : segmentLabel;

  const [row] = await db
    .select({
      generatedAt: schema.insightsSummaries.generatedAt,
      periodStart: schema.insightsSummaries.periodStart,
      periodEnd: schema.insightsSummaries.periodEnd,
      summaryMd: schema.insightsSummaries.summaryMd,
      summaryMdEn: schema.insightsSummaries.summaryMdEn,
      headlineStats: schema.insightsSummaries.headlineStats,
      model: schema.insightsSummaries.model,
      segment: schema.insightsSummaries.segment,
      daleelRefs: schema.insightsSummaries.daleelRefs,
      adhkarRefs: schema.insightsSummaries.adhkarRefs,
    })
    .from(schema.insightsSummaries)
    .where(
      sql`(generated_at AT TIME ZONE 'Asia/Jakarta')::date = ${date}::date AND ${
        segment === null
          ? sql`segment IS NULL`
          : sql`segment = ${segment}`
      }`,
    )
    .orderBy(desc(schema.insightsSummaries.generatedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    summaryMd: stripWordCountAnnotations(row.summaryMd) as string,
    summaryMdEn: stripWordCountAnnotations(row.summaryMdEn),
    headlineStats: row.headlineStats as LatestInsightsSummary["headlineStats"],
    daleelRefs: (row.daleelRefs as schema.DaleelRef[] | null) ?? null,
    adhkarRefs: (row.adhkarRefs as schema.DaleelRef[] | null) ?? null,
  };
}

/**
 * Pull the first H2 section out of a long-form markdown briefing.
 *
 * Returns everything from the first `## ` heading up to (but not
 * including) the second `## ` heading. The H2 line itself is included
 * so the preview renders with its own heading — matches what readers
 * see when they click through to the full page.
 *
 * Falls back to returning the whole body if no second H2 exists (old
 * 3-paragraph rows from before the 2026-05-21 long-form migration).
 *
 * Used by the /insights all-platform hero AND each /insights/segment/
 * [focus] page to render only the executive summary + a CTA to the
 * standalone /insights/brief/[id] view.
 */
export function extractFirstBriefingSection(body: string): string {
  const headings: number[] = [];
  body.split("\n").forEach((line, idx) => {
    if (/^##\s+/.test(line)) headings.push(idx);
  });
  if (headings.length < 2) return body;

  const lines = body.split("\n");
  const start = headings[0];
  const end = headings[1];
  return lines.slice(start, end).join("\n").trim();
}

/**
 * Other Mahasiswa rooms — surfaced at the bottom of /m/{slug} to
 * cross-link the QR-landed reader into other discussion threads.
 *
 * Returns at most `limit` rooms, sorted newest first, excluding the
 * current slug. Each row carries the poster question (so the card
 * can show "Apakah kita …?" rather than just a date) plus comment
 * aggregates feeding the status pill (`baru` / `aktif` / `tenang`).
 *
 * Rooms without a parseable Mahasiswa block are dropped — older
 * briefings predating the Mahasiswa pack would otherwise show with
 * an empty question.
 */
export type OtherRoom = {
  slug: string;
  segment: string | null;
  generatedAt: Date;
  /** Poster question — already trimmed, may be up to ~300 chars. */
  question: string;
  approvedTotal: number;
  approved7d: number;
  lastActivityAt: Date | null;
};

export async function getOtherMahasiswaRooms(
  currentSlug: string,
  limit = 8,
): Promise<OtherRoom[]> {
  type Row = {
    summaryMd: string;
    segment: string | null;
    generatedAt: Date | string;
    approvedTotal: number;
    approved7d: number;
    lastActivityAt: Date | string | null;
  };

  // Over-fetch by 4× so the JS filter (drop rows without a parseable
  // Mahasiswa block) has plenty of headroom. The bottleneck card
  // section caps at `limit` regardless. Cheap at our scale —
  // 32 rows × ~5 KB each is well under any meaningful budget.
  const rows = (await db.execute(sql`
    SELECT
      i.summary_md                    AS "summaryMd",
      i.segment                       AS "segment",
      i.generated_at                  AS "generatedAt",
      COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0)::int           AS "approvedTotal",
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.created_at >= now() - interval '7 days' THEN 1 ELSE 0 END), 0)::int AS "approved7d",
      MAX(CASE WHEN c.status = 'approved' THEN c.created_at END)                          AS "lastActivityAt"
    FROM insights_summaries i
    LEFT JOIN mahasiswa_comments c
      ON c.briefing_slug =
         to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
           || '-' || COALESCE(i.segment, 'all')
    WHERE to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
            || '-' || COALESCE(i.segment, 'all') <> ${currentSlug}
      AND i.generated_at >= now() - interval '90 days'
    GROUP BY i.summary_md, i.segment, i.generated_at
    ORDER BY i.generated_at DESC
    LIMIT ${limit * 4}
  `)) as unknown as Row[];

  const out: OtherRoom[] = [];
  for (const r of rows) {
    const m = extractMahasiswaContent(r.summaryMd);
    if (!m.question || !m.question.trim()) continue;
    const generatedAt =
      r.generatedAt instanceof Date ? r.generatedAt : new Date(r.generatedAt);
    out.push({
      slug: briefingSlug(generatedAt, r.segment),
      segment: r.segment,
      generatedAt,
      question: m.question.trim(),
      approvedTotal: r.approvedTotal,
      approved7d: r.approved7d,
      lastActivityAt: r.lastActivityAt
        ? r.lastActivityAt instanceof Date
          ? r.lastActivityAt
          : new Date(r.lastActivityAt)
        : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Canonical slug for a briefing — used for share links + RSS later. */
export function briefingSlug(generatedAt: Date, segment: string | null): string {
  // Convert UTC → WIB by adding 7h, then take date portion. Done manually
  // so we don't pull a tz library on the server hot path.
  const wib = new Date(generatedAt.getTime() + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}-${segment ?? "all"}`;
}

/** All 5 segment keys in canonical reading order. `null` represents the
 *  cross-segment "all" briefing. Kept here (not in a shared constants file)
 *  because briefing navigation is the only place this exact order matters. */
export const BRIEFING_SEGMENTS: (string | null)[] = [
  null,
  "spiritual",
  "family",
  "youth",
  "justice",
];

/**
 * Fetch the latest briefing per segment in one batch. Returns a 5-entry
 * map keyed by segment ("all" for the cross-segment briefing) — missing
 * keys mean that segment's generation failed for the most recent cycle.
 *
 * Used by /insights to render all 5 briefings side-by-side as the
 * primary nav hub (briefings-first redesign, 2026-05-23).
 */
export async function getAllLatestBriefings(): Promise<
  Map<string, LatestInsightsSummary>
> {
  const rows = await Promise.all(
    BRIEFING_SEGMENTS.map((seg) => getLatestInsightsSummary(seg)),
  );
  const out = new Map<string, LatestInsightsSummary>();
  BRIEFING_SEGMENTS.forEach((seg, i) => {
    const row = rows[i];
    if (row) out.set(seg ?? "all", row);
  });
  return out;
}

export type BriefingNavLink = {
  slug: string;
  segment: string | null;
  generatedAt: Date;
};

export type BriefingNavigation = {
  /** One entry per segment in this edition (same WIB date as the brief the
   *  reader is on). Map keyed by `segment ?? "all"`. Missing entries mean
   *  that segment's briefing failed/wasn't generated for this cycle. */
  peers: Map<string, BriefingNavLink>;
  /** Previous edition of the SAME segment (strictly older). */
  previous: BriefingNavLink | null;
  /** Next edition of the SAME segment (strictly newer) — non-null only
   *  when the reader is browsing an older brief. */
  next: BriefingNavLink | null;
};

/**
 * Data feeder for the in-page brief pagination widget.
 *
 * Strategy: peer briefings are scoped to the SAME WIB date as the current
 * brief — that's the cleanest definition of "this edition" given the
 * weekly Thursday cron may drift by minutes. For prev/next we strictly compare
 * `generated_at` of the SAME segment.
 */
export async function getBriefingNavigation(
  currentSegment: string | null,
  currentGeneratedAt: Date,
): Promise<BriefingNavigation> {
  // Peers in the same edition — one row per segment, freshest wins if
  // somehow two briefings landed on the same WIB date for the same segment.
  const peerRows = (await db.execute(sql`
    SELECT DISTINCT ON (segment)
      generated_at AS "generatedAt",
      segment
    FROM insights_summaries
    WHERE (generated_at AT TIME ZONE 'Asia/Jakarta')::date
        = (${currentGeneratedAt.toISOString()}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
    ORDER BY segment NULLS FIRST, generated_at DESC
  `)) as unknown as Array<{ generatedAt: Date; segment: string | null }>;

  const peers = new Map<string, BriefingNavLink>();
  for (const row of peerRows) {
    const generatedAt =
      row.generatedAt instanceof Date
        ? row.generatedAt
        : new Date(row.generatedAt);
    const key = row.segment ?? "all";
    peers.set(key, {
      segment: row.segment,
      generatedAt,
      slug: briefingSlug(generatedAt, row.segment),
    });
  }

  // Previous / next edition of the same segment.
  //
  // We compare on WIB-date (not raw generated_at) so a regeneration
  // that landed on the same day as the current row doesn't get
  // surfaced as "previous" / "next" — both would carry the same date
  // label and resolve back to the same slug (getBriefingBySlug
  // collapses by WIB-date).
  const currentTs = currentGeneratedAt.toISOString();
  const segmentClause =
    currentSegment === null
      ? sql`segment IS NULL`
      : sql`segment = ${currentSegment}`;
  const differentDay = sql`
    (generated_at AT TIME ZONE 'Asia/Jakarta')::date <>
    (${currentTs}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
  `;

  const [prevRow] = await db
    .select({
      generatedAt: schema.insightsSummaries.generatedAt,
      segment: schema.insightsSummaries.segment,
    })
    .from(schema.insightsSummaries)
    .where(
      sql`generated_at < ${currentTs}::timestamptz AND ${segmentClause} AND ${differentDay}`,
    )
    .orderBy(desc(schema.insightsSummaries.generatedAt))
    .limit(1);

  // Next edition of the same segment (only exists if reading an older brief).
  const nextRow = (
    await db
      .select({
        generatedAt: schema.insightsSummaries.generatedAt,
        segment: schema.insightsSummaries.segment,
      })
      .from(schema.insightsSummaries)
      .where(
        sql`generated_at > ${currentTs}::timestamptz AND ${segmentClause} AND ${differentDay}`,
      )
      .orderBy(schema.insightsSummaries.generatedAt)
      .limit(1)
  )[0];

  return {
    peers,
    previous: prevRow
      ? {
          segment: prevRow.segment,
          generatedAt: prevRow.generatedAt,
          slug: briefingSlug(prevRow.generatedAt, prevRow.segment),
        }
      : null,
    next: nextRow
      ? {
          segment: nextRow.segment,
          generatedAt: nextRow.generatedAt,
          slug: briefingSlug(nextRow.generatedAt, nextRow.segment),
        }
      : null,
  };
}

export async function getOverviewInsights(): Promise<OverviewInsights | null> {
  // All the live widgets on /insights below the executive-briefing hero
  // (sentiment composition, dominant-category bars, category totals,
  // per-platform mix) are scoped to the SAME 7-day window the briefing
  // narrates over. Before 2026-05-21 these were lifetime aggregates,
  // which made the briefing pill say "22.4% concerned" while the bar
  // beneath it read "22.8% concerned" — same population, different
  // windows, no labels. Aligning everything to 7d removes that confusion.
  // `totalPosts` stays lifetime as a "scale-of-corpus" badge — it's
  // clearly labeled below the category panel and represents total ingest.
  const sevenDaysAgo = sql`now() - interval '7 days'`;

  const [{ totalPosts = 0 } = { totalPosts: 0 }] = (await db
    .select({ totalPosts: count() })
    .from(schema.socialPosts)) as Array<{ totalPosts: number }>;

  if (totalPosts === 0) return null;

  const [{ classifiedPosts = 0 } = { classifiedPosts: 0 }] = (await db
    .select({ classifiedPosts: count() })
    .from(schema.socialPosts)
    .where(isNotNull(schema.socialPosts.sentimentLabel))) as Array<{
    classifiedPosts: number;
  }>;

  // Sentiment mix — 7-day window only (was lifetime).
  const sentimentRows = (await db
    .select({
      label: schema.socialPosts.sentimentLabel,
      n: count(),
    })
    .from(schema.socialPosts)
    .where(sql`${schema.socialPosts.postedAt} >= ${sevenDaysAgo}`)
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

  type CatKey = (typeof DAWAH_CATEGORIES)[number];

  // Sum of per-post per-category scores — gives "collective attention"
  // weight per da'wah category across the 7-day window (was lifetime).
  const categorySums = (await db
    .select({
      ...Object.fromEntries(
        DAWAH_CATEGORIES.map((cat) => [
          cat,
          sql<number>`COALESCE(SUM((categories ->> ${cat})::numeric), 0)`,
        ]),
      ),
    })
    .from(schema.socialPosts)
    .where(
      sql`${schema.socialPosts.categories} IS NOT NULL AND ${schema.socialPosts.postedAt} >= ${sevenDaysAgo}`,
    )) as Array<Record<CatKey, number>>;
  const categoryTotals: Record<string, number> = {};
  for (const cat of DAWAH_CATEGORIES) {
    categoryTotals[cat] = Number(categorySums[0]?.[cat] ?? 0);
  }

  // Dominant-category bucketing — for each post, find the category with
  // the highest score in its `categories` JSONB; count posts per dominant.
  // Encapsulated in raw SQL because Postgres has no "argmax over jsonb keys"
  // shortcut.
  // drizzle's db.execute with postgres-js returns the array directly,
  // not a `{ rows: [...] }` wrapper. Was previously typed wrong → access
  // to `.rows` always returned undefined → "Activity by category" panel
  // rendered the empty state even when 506 posts were classified.
  const dominantRows = (await db.execute(sql`
    SELECT dominant AS category, count(*)::int AS posts
    FROM (
      SELECT (
        SELECT key
        FROM jsonb_each_text(categories)
        WHERE key = ANY (ARRAY[${sql.raw(
          DAWAH_CATEGORIES.map((c) => `'${c}'`).join(","),
        )}])
          AND value::numeric > 0.1
        ORDER BY value::numeric DESC
        LIMIT 1
      ) AS dominant
      FROM social_posts
      WHERE categories IS NOT NULL
        AND posted_at >= now() - interval '7 days'
    ) sub
    WHERE dominant IS NOT NULL
    GROUP BY dominant
    ORDER BY posts DESC
  `)) as unknown as Array<{ category: string; posts: number }>;
  const dominantCategories: Array<{ category: string; posts: number }> = [];
  for (const row of Array.isArray(dominantRows) ? dominantRows : []) {
    if (row && typeof row.category === "string") {
      dominantCategories.push({
        category: row.category,
        posts: Number(row.posts ?? 0),
      });
    }
  }

  // Top trending topics across all platforms — highest postCount first.
  const trendingTopics = await db
    .select({
      id: schema.topics.id,
      label: schema.topics.label,
      platform: schema.topics.platform,
      keywords: schema.topics.keywords,
      postCount: schema.topics.postCount,
    })
    .from(schema.topics)
    .orderBy(desc(schema.topics.postCount))
    .limit(5);

  // Per-platform breakdown: post count + top topic per platform.
  // Drives the source-mix bar + per-platform cards on /insights.
  // 7-day window only — was lifetime, which made greyed cards for
  // paused platforms persist their old all-time counts even after
  // a multi-week absence.
  const platformCountRows = (await db
    .select({
      platform: schema.socialPosts.platform,
      posts: count(),
    })
    .from(schema.socialPosts)
    .where(sql`${schema.socialPosts.postedAt} >= ${sevenDaysAgo}`)
    .groupBy(schema.socialPosts.platform)) as Array<{
    platform: string;
    posts: number;
  }>;

  // Top topic per platform (single SQL with DISTINCT ON for simplicity).
  const topTopicRows = (await db.execute(sql`
    SELECT DISTINCT ON (platform) platform, label, keywords
    FROM topics
    ORDER BY platform, post_count DESC
  `)) as unknown as {
    rows: Array<{ platform: string; label: string; keywords: string[] | null }>;
  };
  const topTopicByPlatform = new Map(
    (topTopicRows.rows ?? []).map((r) => [
      r.platform,
      { label: r.label, keywords: r.keywords ?? [] },
    ]),
  );

  // Top dominant category per platform — 7-day window.
  const topCategoryRows = (await db.execute(sql`
    SELECT platform, dominant AS category, count(*)::int AS posts
    FROM (
      SELECT
        platform,
        (
          SELECT key FROM jsonb_each_text(categories)
          WHERE key = ANY (ARRAY[${sql.raw(
            DAWAH_CATEGORIES.map((c) => `'${c}'`).join(","),
          )}])
            AND value::numeric > 0.1
          ORDER BY value::numeric DESC LIMIT 1
        ) AS dominant
      FROM social_posts
      WHERE categories IS NOT NULL
        AND posted_at >= now() - interval '7 days'
    ) sub
    WHERE dominant IS NOT NULL
    GROUP BY platform, dominant
    ORDER BY platform, posts DESC
  `)) as unknown as {
    rows: Array<{ platform: string; category: string; posts: number }>;
  };
  const topCategoryByPlatform = new Map<string, string>();
  for (const r of topCategoryRows.rows ?? []) {
    if (!topCategoryByPlatform.has(r.platform)) {
      topCategoryByPlatform.set(r.platform, r.category);
    }
  }

  const platformBreakdown = platformCountRows.map((r) => ({
    platform: r.platform,
    posts: r.posts,
    topTopic: topTopicByPlatform.get(r.platform) ?? null,
    topCategory: topCategoryByPlatform.get(r.platform) ?? null,
  }));

  return {
    totalPosts,
    classifiedPosts,
    sentimentMix,
    categoryTotals,
    dominantCategories,
    trendingTopics: trendingTopics.map((t) => ({
      id: t.id,
      label: t.label,
      platform: t.platform,
      keywords: t.keywords ?? [],
      postCount: t.postCount,
    })),
    platformBreakdown,
  };
}
