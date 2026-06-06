/**
 * Server-side aggregation of `social_posts` for the `/briefings/[platform]` pages.
 *
 * Returns `null` when the platform has no ingested data yet — the page then
 * falls back to mock content from `drilldowns.ts`. As soon as the ingestion
 * pipeline writes one real row for that platform, the page seamlessly switches
 * to live data.
 */

import { and, count, countDistinct, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  ALL_GROUP_LABELS,
  classifyThemeGroup,
  GROUP_BY_SLUG,
  LAINNYA_GROUP,
  slugifyGroup,
} from "@/lib/dashboard-metrics";
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
    dawahOpportunity: number | null;
    themeGroup: string | null;
    postedAt: Date | null;
  }>;
  /** Sentiment counts across all posts for this platform. */
  sentimentMix: { positive: number; neutral: number; negative: number };
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

  // Top posts ranked by a composite of relevance + recency + engagement
  // (each normalized 0-1, summed 0-3, sorted desc). The old single-axis
  // "opportunity OR relevance" sort buried fresh high-engagement posts
  // behind older high-relevance ones. Equal weights so the three signals
  // each get a fair say:
  //   - relevance: opportunity, falling back to dawahRelevance (rows
  //     ingested before the 2026-05-21 opportunity migration)
  //   - recency:   linear decay from posted_at, 1 → 0 across 7 days
  //   - engagement: log-scaled engagement_score (only YT populates this
  //     today; ln(1+x)/12 caps at ~1 around 160K views)
  // The list is collapsed-by-default in the UI, so the larger result
  // pool here doesn't pay an initial-render cost — only when a user
  // explicitly expands the section.
  const topStories = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      sentimentLabel: schema.socialPosts.sentimentLabel,
      sentimentScore: schema.socialPosts.sentimentScore,
      dawahOpportunity: schema.socialPosts.dawahOpportunity,
      themeGroup: schema.socialPosts.themeGroup,
      postedAt: schema.socialPosts.postedAt,
    })
    .from(schema.socialPosts)
    .where(platformWhere)
    .orderBy(
      desc(sql`(
        COALESCE(${schema.socialPosts.dawahOpportunity}, 0)
        + GREATEST(0, 1 - EXTRACT(EPOCH FROM (now() - ${schema.socialPosts.postedAt})) / (7 * 86400.0))
        + LEAST(LN(1 + COALESCE(${schema.socialPosts.engagementScore}, 0)) / 12.0, 1.0)
      )`),
    )
    // No cap — return every post for the platform. The list is
    // collapsed by default so the initial paint pays no rendering cost
    // for the larger payload; only users who explicitly expand take the
    // DOM hit. Removing the cap also makes the chip-filter counts equal
    // the Sentiment-mix chart (sentiment classification is currently
    // 100% across all platforms), eliminating the "why are these
    // numbers different" disclaimer that previously sat under the
    // section header. Mainstream is the largest at ~8K posts; transfer
    // size is acceptable with the collapsed default.
;

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

  // Per-platform category aggregation (9 PRD categories) retired
  // 2026-06-05 along with the dropped `social_posts.categories` JSONB
  // column. The /radar/[platform] page now renders the per-platform
  // breakdown via ThemeGroupReachPanel (theme_group bucketing) instead.

  // Discovered topics for this platform. Topic discovery is UNIFIED across
  // platforms (rows stored with platform="all" since 2026-05-27), so we
  // CANNOT filter `topics.platform = <platform>` — that returns nothing.
  // Instead we derive the per-platform breakdown by joining each topic to
  // its assigned posts and counting only this platform's (region-scoped)
  // rows. `topics.post_count` is the cross-platform total and is ignored
  // here. innerJoin drops topics with no posts on this platform.
  const topicRows = (await db
    .select({
      id: schema.topics.id,
      label: schema.topics.label,
      keywords: schema.topics.keywords,
      postCount: count(schema.socialPosts.id),
    })
    .from(schema.topics)
    .innerJoin(
      schema.socialPosts,
      eq(schema.socialPosts.topicId, schema.topics.id),
    )
    .where(platformWhere)
    .groupBy(schema.topics.id, schema.topics.label, schema.topics.keywords)
    .orderBy(desc(count(schema.socialPosts.id)))) as Array<{
    id: string;
    label: string;
    keywords: string[] | null;
    postCount: number;
  }>;

  return {
    totalPosts,
    uniqueAuthors,
    topOutlets: topOutlets
      .filter((o): o is { name: string; articles: number } => !!o.name)
      .map((o) => ({ name: o.name, articles: o.articles })),
    topStories: topStories.map((s) => ({
      ...s,
      sentimentScore: s.sentimentScore as number | null,
      dawahOpportunity: s.dawahOpportunity as number | null,
      themeGroup: s.themeGroup as string | null,
    })),
    sentimentMix,
    discoveredTopics: topicRows.map((t) => ({
      id: t.id,
      label: t.label,
      keywords: t.keywords ?? [],
      postCount: t.postCount,
    })),
  };
}

/* ──────────────────────────────────────────────────────────────────
 * Top-engaged posts per platform — ranked by engagement_score (the
 * log10 composite of views/comments/likes populated by the normalizers).
 *
 * Used by /briefings/[platform] to surface "what's resonating" as a
 * complement to the relevance-sorted top stories. Returns [] for
 * platforms with no engagement signal (mainstream RSS) so the caller
 * can skip the section entirely instead of rendering an empty card.
 *
 * Distinct from getRisingVideos (dashboard-metrics) which uses the
 * social_post_metrics time-series to compute Δ over 24h — that's a
 * YouTube-only signal because YT is the only platform we currently
 * snapshot. For X/IG we have absolute engagement at ingest time but
 * no time series, so "top engaged" is the closest analog.
 * ────────────────────────────────────────────────────────────────── */
export type TopEngagedPost = {
  id: string;
  text: string;
  author: string | null;
  url: string | null;
  postedAt: Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  score: number;
};

export async function getTopEngagedPosts(
  platform: string,
  limit = 10,
): Promise<TopEngagedPost[]> {
  const rows = await db
    .select({
      id: schema.socialPosts.id,
      text: schema.socialPosts.text,
      author: schema.socialPosts.author,
      url: schema.socialPosts.url,
      postedAt: schema.socialPosts.postedAt,
      views: schema.socialPosts.engagementViews,
      likes: schema.socialPosts.engagementLikes,
      comments: schema.socialPosts.engagementComments,
      score: schema.socialPosts.engagementScore,
    })
    .from(schema.socialPosts)
    .where(
      and(
        eq(schema.socialPosts.platform, platform),
        isNotNull(schema.socialPosts.engagementScore),
      ),
    )
    .orderBy(desc(schema.socialPosts.engagementScore))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    author: r.author,
    url: r.url,
    postedAt: r.postedAt,
    views: r.views === null ? null : Number(r.views),
    likes: r.likes === null ? null : Number(r.likes),
    comments: r.comments === null ? null : Number(r.comments),
    score: Number(r.score),
  }));
}

/* ──────────────────────────────────────────────────────────────────
 * Overall-View overview used by the public `/briefings` landing.
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
  /** Post count per THEME_GROUP for the last 7 days. Always emits all
   *  14 groups + Lainnya (zero-count groups render as a 0-width bar)
   *  so the legend stays stable week-over-week. Sorted by count desc
   *  with Lainnya pinned to the bottom. The 9 PRD `categoryTotals` /
   *  `dominantCategories` fields were retired 2026-06-05 (Scope C). */
  dominantGroups: Array<{ group: string; posts: number }>;
  /** Top Gemini-discovered topics across platforms. */
  trendingTopics: Array<{
    id: string;
    label: string;
    platform: string;
    keywords: string[];
    postCount: number;
  }>;
  /** Per-platform breakdown for the /briefings source-mix + cards. */
  platformBreakdown: Array<{
    platform: string;
    posts: number;
    topTopic: { label: string; keywords: string[] } | null;
  }>;
};

export type LatestBriefing = {
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
  themeGroup: string | null;
  daleelRefs: schema.DaleelRef[] | null;
  /** Separate du'a / dzikir pool for Pesan Flyer 5 + 6. NULL on
   *  briefings written before the 2026-05-23 adhkar split. Same item
   *  schema as `daleelRefs`. */
  adhkarRefs: schema.DaleelRef[] | null;
};

/** Most-recent AI-narrated executive briefing for a given group label.
 *
 *  Pass the canonical THEME_GROUPS label ("Hukum & Keadilan", etc.).
 *  Returns null when no row exists yet (briefing job hasn't fired,
 *  or this group wasn't in the auto-pipeline's top-5 this week).
 *
 *  Legacy 4-segment briefings (segment in {"spiritual","family",...})
 *  are no longer reachable through this entry point — they remain in
 *  the DB but the web app surfaces only the new group structure since
 *  2026-06-03. */
export async function getLatestBriefing(
  group: string,
): Promise<LatestBriefing | null> {
  const [row] = await db
    .select({
      generatedAt: schema.briefings.generatedAt,
      periodStart: schema.briefings.periodStart,
      periodEnd: schema.briefings.periodEnd,
      summaryMd: schema.briefings.summaryMd,
      summaryMdEn: schema.briefings.summaryMdEn,
      headlineStats: schema.briefings.headlineStats,
      model: schema.briefings.model,
      themeGroup: schema.briefings.themeGroup,
      daleelRefs: schema.briefings.daleelRefs,
      adhkarRefs: schema.briefings.adhkarRefs,
    })
    .from(schema.briefings)
    .where(eq(schema.briefings.themeGroup, group))
    .orderBy(desc(schema.briefings.generatedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    summaryMd: stripWordCountAnnotations(row.summaryMd) as string,
    summaryMdEn: stripWordCountAnnotations(row.summaryMdEn),
    headlineStats: row.headlineStats as LatestBriefing["headlineStats"],
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
  kultum: {
    // Match BEFORE kajian: a kultum heading like "Kultum Subuh" must not
    // fall through to a kajian matcher. The current /kultum|short talk/
    // pattern is tight enough that it won't shadow kajian's own match.
    matcher: (h) => /kultum|short\s*talk/i.test(h),
    title: "Kultum",
  },
  kajian: {
    matcher: (h) => /kajian|majelis/i.test(h),
    title: "Kajian",
  },
  kisah: {
    // "Kisah dari Hadits" / "Story from a Hadith" — a 7-min narrative
    // retelling of one hadith from the daleel pool.
    matcher: (h) => /kisah|story\s+from/i.test(h),
    title: "Kisah dari Hadits",
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
 *  Public: no auth check — briefings contains only aggregated
 *  conversation data + LLM narrative, no PII.
 */
export async function getBriefingBySlug(
  slug: string,
): Promise<LatestBriefing | null> {
  // Two slug shapes are accepted:
  //   1. `YYYY-MM-DD-<group-slug>` — canonical shareable URL since
  //      2026-06-03. Resolves to the briefing for that exact WIB date
  //      and group.
  //   2. `<group-slug>` — bare group slug, used when the /briefings hub
  //      card has no specific edition to point at yet. Resolves to the
  //      LATEST briefing for that group, regardless of date. Returns
  //      null when the group has no briefings at all yet.
  // Anything else (unknown slug, malformed) returns null so the route
  // 404s cleanly.
  const dateRe = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
  const m = slug.match(dateRe);

  // Tolerate legacy / hand-typed URLs that carry the raw group label
  // ("Hukum & Keadilan") instead of the kebab slug ("hukum-keadilan").
  // The slug-builder bug in discussions-data + admin/rooms was fixed
  // separately; this lookup-side fallback covers stale bookmarks +
  // copy-paste links from earlier sessions.
  const resolveGroup = (raw: string): string | undefined =>
    GROUP_BY_SLUG[raw] ?? GROUP_BY_SLUG[slugifyGroup(raw)];

  let group: string | undefined;
  let dateClause = sql``;
  if (m) {
    const [, date, groupSlug] = m;
    group = resolveGroup(groupSlug);
    if (!group) return null;
    dateClause = sql`AND (generated_at AT TIME ZONE 'Asia/Jakarta')::date = ${date}::date`;
  } else {
    group = resolveGroup(slug);
    if (!group) return null;
    // No date clause — pick the latest briefing for this group.
  }

  const [row] = await db
    .select({
      generatedAt: schema.briefings.generatedAt,
      periodStart: schema.briefings.periodStart,
      periodEnd: schema.briefings.periodEnd,
      summaryMd: schema.briefings.summaryMd,
      summaryMdEn: schema.briefings.summaryMdEn,
      headlineStats: schema.briefings.headlineStats,
      model: schema.briefings.model,
      themeGroup: schema.briefings.themeGroup,
      daleelRefs: schema.briefings.daleelRefs,
      adhkarRefs: schema.briefings.adhkarRefs,
    })
    .from(schema.briefings)
    .where(sql`theme_group = ${group} ${dateClause}`)
    .orderBy(desc(schema.briefings.generatedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    summaryMd: stripWordCountAnnotations(row.summaryMd) as string,
    summaryMdEn: stripWordCountAnnotations(row.summaryMdEn),
    headlineStats: row.headlineStats as LatestBriefing["headlineStats"],
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
 * Used by the /briefings overall-view hero AND each /briefings/segment/
 * [focus] page to render only the executive summary + a CTA to the
 * standalone /briefings/[id] view.
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
  themeGroup: string | null;
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
    themeGroup: string | null;
    generatedAt: Date | string;
    approvedTotal: number;
    approved7d: number;
    lastActivityAt: Date | string | null;
  };

  // Over-fetch by 4× so the JS filter (drop rows without a parseable
  // Mahasiswa block) has plenty of headroom. The bottleneck card
  // section caps at `limit` regardless. Cheap at our scale —
  // 32 rows × ~5 KB each is well under any meaningful budget.
  //
  // Group-slugification in SQL: `segment` now stores the THEME_GROUPS
  // label (e.g. "Hukum & Keadilan") instead of the old 4-segment slug.
  // We slugify inline so the join key matches `briefingSlug()` output
  // — lowercase, ` & ` → ` `, non-alnum-or-hyphen → space, collapse
  // spaces to hyphens. Mirrors `slugifyGroup` in dashboard-metrics.ts
  // and `slugify_group` in api/services/theme_groups.py.
  const slugifySql = sql`regexp_replace(
    trim(
      regexp_replace(
        regexp_replace(lower(COALESCE(i.theme_group, 'all')), '\\s*&\\s*', ' ', 'g'),
        '[^a-z0-9-]+', ' ', 'g'
      )
    ),
    '\\s+', '-', 'g'
  )`;
  const rows = (await db.execute(sql`
    SELECT
      i.summary_md                    AS "summaryMd",
      i.theme_group                   AS "themeGroup",
      i.generated_at                  AS "generatedAt",
      COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0)::int           AS "approvedTotal",
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.created_at >= now() - interval '7 days' THEN 1 ELSE 0 END), 0)::int AS "approved7d",
      MAX(CASE WHEN c.status = 'approved' THEN c.created_at END)                          AS "lastActivityAt"
    FROM briefings i
    LEFT JOIN mahasiswa_comments c
      ON c.briefing_slug =
         to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
           || '-' || ${slugifySql}
    WHERE to_char(i.generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
            || '-' || ${slugifySql} <> ${currentSlug}
      AND i.generated_at >= now() - interval '90 days'
    GROUP BY i.summary_md, i.theme_group, i.generated_at
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
      slug: briefingSlug(generatedAt, r.themeGroup),
      themeGroup: r.themeGroup,
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

/** Canonical slug for a briefing — `YYYY-MM-DD-{group-slug}`.
 *
 *  The `segment` column carries the THEME_GROUPS group LABEL since
 *  2026-06-03 (it was a 4-segment slug before). We slugify here so
 *  URL paths stay lowercase + hyphen-only regardless of the label's
 *  spaces/ampersands ("Hukum & Keadilan" → "hukum-keadilan").
 *
 *  Legacy rows whose `segment` is null or one of the old 4-segment
 *  slugs still produce a slug — they just won't resolve via
 *  `getBriefingBySlug` (which only accepts current group slugs). */
export function briefingSlug(generatedAt: Date, themeGroup: string | null): string {
  // Convert UTC → WIB by adding 7h, then take date portion. Done manually
  // so we don't pull a tz library on the server hot path.
  const wib = new Date(generatedAt.getTime() + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  // Slugify whatever theme-group value the briefing carries — the
  // function tolerates legacy values too. Null → "all" (legacy rows
  // from the pre-2026-06-03 cross-segment model).
  const tail = themeGroup ? slugifyGroup(themeGroup) : "all";
  return `${y}-${m}-${d}-${tail}`;
}

/** All 14 THEME_GROUPS labels in canonical reading order. The
 *  cross-platform "all" briefing was removed 2026-06-03; navigation
 *  is now group-keyed. */
export const BRIEFING_GROUPS: readonly string[] = ALL_GROUP_LABELS;

/**
 * Fetch the latest briefing per group in one batch. Returns a Map
 * keyed by group label — only groups that have ever been briefed
 * appear as keys (the auto-pipeline generates briefings for the
 * top-5 by 7d post volume; the other 9 groups stay empty until
 * their volume earns them a slot in a future week).
 *
 * Used by /briefings to render the 14-group grid: groups with an
 * entry get a "Read briefing" CTA, groups without get an "Explore
 * topics & posts" CTA pointing at /groups/[slug].
 */
export async function getAllLatestBriefings(): Promise<
  Map<string, LatestBriefing>
> {
  const rows = await Promise.all(
    BRIEFING_GROUPS.map((group) => getLatestBriefing(group)),
  );
  const out = new Map<string, LatestBriefing>();
  BRIEFING_GROUPS.forEach((group, i) => {
    const row = rows[i];
    if (row) out.set(group, row);
  });
  return out;
}

export type GroupVolume = {
  /** Posts in the last 7 days. */
  current: number;
  /** Posts in days 8-14 ago (the prior 7d window). */
  previous: number;
  /**
   * Percent change current vs previous. NULL when previous is 0 (can't
   * divide); +Infinity when current grew from a zero baseline.
   */
  deltaPct: number | null;
};

/**
 * 7d post volume per theme group + a same-length comparison against
 * days 8-14 ago, so the /briefings hub can show "X posts · ▲12%" trend
 * chips alongside each card. Single SQL pass with two FILTER clauses —
 * one round-trip, no separate prior-period query.
 *
 * Legacy NULL-theme rows are folded into Lainnya to match how
 * /groups/lainnya scopes them. Non-canonical labels are excluded.
 * Returns a Map with every BRIEFING_GROUPS key initialized to a zero
 * record so the UI always has 14 entries.
 */
export async function getGroupVolumes7d(): Promise<Map<string, GroupVolume>> {
  const rows = await db
    .select({
      themeGroup: schema.socialPosts.themeGroup,
      current: sql<number>`COUNT(*) FILTER (WHERE posted_at >= now() - interval '7 days')::int`,
      previous: sql<number>`COUNT(*) FILTER (WHERE posted_at >= now() - interval '14 days' AND posted_at < now() - interval '7 days')::int`,
    })
    .from(schema.socialPosts)
    .where(sql`posted_at >= now() - interval '14 days'`)
    .groupBy(schema.socialPosts.themeGroup);

  const out = new Map<string, GroupVolume>();
  for (const g of BRIEFING_GROUPS) {
    out.set(g, { current: 0, previous: 0, deltaPct: null });
  }
  for (const r of rows) {
    const key = r.themeGroup ?? LAINNYA_GROUP;
    const existing = out.get(key);
    if (!existing) continue;
    existing.current += Number(r.current);
    existing.previous += Number(r.previous);
  }
  // Compute deltaPct now that totals are settled.
  for (const v of out.values()) {
    v.deltaPct =
      v.previous === 0
        ? v.current === 0
          ? 0
          : null // grew from zero baseline — surface as "new"
        : Math.round(((v.current - v.previous) / v.previous) * 100);
  }
  return out;
}

export type BriefingNavLink = {
  slug: string;
  themeGroup: string | null;
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
 * Strategy: peer briefings are scoped to the SAME WIB date as the
 * current brief — that's the cleanest definition of "this edition"
 * given the weekly Thursday cron may drift by minutes. Up to 5 peers
 * exist per edition (the auto-pipeline picks top-5 groups by 7d
 * post volume). For prev/next we strictly compare `generated_at`
 * of the SAME group.
 */
export async function getBriefingNavigation(
  currentGroup: string,
  currentGeneratedAt: Date,
): Promise<BriefingNavigation> {
  // Peers in the same edition — one row per group, freshest wins if
  // somehow two briefings landed on the same WIB date for the same group.
  const peerRows = (await db.execute(sql`
    SELECT DISTINCT ON (theme_group)
      generated_at AS "generatedAt",
      theme_group AS "themeGroup"
    FROM briefings
    WHERE (generated_at AT TIME ZONE 'Asia/Jakarta')::date
        = (${currentGeneratedAt.toISOString()}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
      AND theme_group IS NOT NULL
    ORDER BY theme_group, generated_at DESC
  `)) as unknown as Array<{ generatedAt: Date; themeGroup: string | null }>;

  const peers = new Map<string, BriefingNavLink>();
  for (const row of peerRows) {
    if (!row.themeGroup) continue;
    const generatedAt =
      row.generatedAt instanceof Date
        ? row.generatedAt
        : new Date(row.generatedAt);
    peers.set(row.themeGroup, {
      themeGroup: row.themeGroup,
      generatedAt,
      slug: briefingSlug(generatedAt, row.themeGroup),
    });
  }

  // Previous / next edition of the same group.
  //
  // We compare on WIB-date (not raw generated_at) so a regeneration
  // that landed on the same day as the current row doesn't get
  // surfaced as "previous" / "next" — both would carry the same date
  // label and resolve back to the same slug (getBriefingBySlug
  // collapses by WIB-date).
  const currentTs = currentGeneratedAt.toISOString();
  const segmentClause = sql`theme_group = ${currentGroup}`;
  const differentDay = sql`
    (generated_at AT TIME ZONE 'Asia/Jakarta')::date <>
    (${currentTs}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date
  `;

  const [prevRow] = await db
    .select({
      generatedAt: schema.briefings.generatedAt,
      themeGroup: schema.briefings.themeGroup,
    })
    .from(schema.briefings)
    .where(
      sql`generated_at < ${currentTs}::timestamptz AND ${segmentClause} AND ${differentDay}`,
    )
    .orderBy(desc(schema.briefings.generatedAt))
    .limit(1);

  // Next edition of the same segment (only exists if reading an older brief).
  const nextRow = (
    await db
      .select({
        generatedAt: schema.briefings.generatedAt,
        themeGroup: schema.briefings.themeGroup,
      })
      .from(schema.briefings)
      .where(
        sql`generated_at > ${currentTs}::timestamptz AND ${segmentClause} AND ${differentDay}`,
      )
      .orderBy(schema.briefings.generatedAt)
      .limit(1)
  )[0];

  return {
    peers,
    previous: prevRow
      ? {
          themeGroup: prevRow.themeGroup,
          generatedAt: prevRow.generatedAt,
          slug: briefingSlug(prevRow.generatedAt, prevRow.themeGroup),
        }
      : null,
    next: nextRow
      ? {
          themeGroup: nextRow.themeGroup,
          generatedAt: nextRow.generatedAt,
          slug: briefingSlug(nextRow.generatedAt, nextRow.themeGroup),
        }
      : null,
  };
}

export async function getOverviewInsights(): Promise<OverviewInsights | null> {
  // All the live widgets on /briefings below the executive-briefing hero
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

  // 9-PRD category aggregation retired 2026-06-05 (Scope C). The
  // dashboard's category chart switched to dominantGroups (theme
  // groups) on the same date; `categoryTotals` + `dominantCategories`
  // fields are gone from the OverviewInsights type.

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
  // Drives the source-mix bar + per-platform cards on /briefings.
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

  // `topCategoryByPlatform` (top 9-PRD category per platform) retired
  // 2026-06-05. The per-platform card carries `topTopic` only since;
  // theme-group breakdown is available per-platform via ThemeGroupReachPanel.
  const platformBreakdown = platformCountRows.map((r) => ({
    platform: r.platform,
    posts: r.posts,
    topTopic: topTopicByPlatform.get(r.platform) ?? null,
  }));

  // 14-group + Lainnya bucketing. Two-pass strategy:
  //
  // 1. Posts WITH theme_group set (Gemini-judged at ingest since
  //    2026-06-03): aggregate by that column directly. Hits the
  //    partial index added in the 2026-06-03 migration.
  //
  // 2. Posts WHERE theme_group IS NULL (historical): fall back to
  //    the legacy `topic_id → topic.label → classifyThemeGroup`
  //    regex chain. Pure JS classify so we don't have to re-codify
  //    the THEME_GROUPS regex in SQL. Posts with NULL theme_group
  //    AND NULL topic_id (truly un-classified) all go to Lainnya.
  //
  // Combining both keeps the chart consistent during the rollout
  // window while the backfill catches everything up to the new
  // taxonomy.
  const groupCounts = new Map<string, number>();

  // Pass 1 — the new column.
  const tgRows = (await db.execute(sql`
    SELECT theme_group AS group, COUNT(*)::int AS posts
    FROM social_posts
    WHERE theme_group IS NOT NULL
      AND posted_at >= now() - interval '7 days'
    GROUP BY theme_group
  `)) as unknown as Array<{ group: string; posts: number }>;
  for (const r of Array.isArray(tgRows) ? tgRows : []) {
    if (!r || typeof r.group !== "string") continue;
    groupCounts.set(r.group, (groupCounts.get(r.group) ?? 0) + Number(r.posts ?? 0));
  }

  // Pass 2 — legacy fallback for rows the new column doesn't cover.
  const topicRows = (await db.execute(sql`
    SELECT t.label AS label, COUNT(sp.id)::int AS posts
    FROM social_posts sp
    JOIN topics t ON sp.topic_id = t.id
    WHERE sp.theme_group IS NULL
      AND sp.posted_at >= now() - interval '7 days'
    GROUP BY t.label
  `)) as unknown as Array<{ label: string; posts: number }>;
  for (const r of Array.isArray(topicRows) ? topicRows : []) {
    if (!r || typeof r.label !== "string") continue;
    const grp = classifyThemeGroup(r.label);
    groupCounts.set(grp, (groupCounts.get(grp) ?? 0) + Number(r.posts ?? 0));
  }

  // Truly un-classified — no theme_group AND no topic_id — bucket
  // straight into Lainnya.
  const nullTopicRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS posts
    FROM social_posts
    WHERE theme_group IS NULL
      AND topic_id IS NULL
      AND posted_at >= now() - interval '7 days'
  `)) as unknown as Array<{ posts: number }>;
  const nullTopicCount = Number(
    (Array.isArray(nullTopicRow) ? nullTopicRow[0]?.posts : 0) ?? 0,
  );
  if (nullTopicCount > 0) {
    groupCounts.set(
      LAINNYA_GROUP,
      (groupCounts.get(LAINNYA_GROUP) ?? 0) + nullTopicCount,
    );
  }
  // Emit all 14 groups + Lainnya so the chart legend stays stable
  // week-over-week even when a group has zero posts this week (renders
  // as a 0-width bar — honest "this group went quiet"). Ordered by
  // count desc with Lainnya pinned to the bottom so it doesn't visually
  // outweigh real themes when un-grouped topics spike.
  const dominantGroupsSorted = [...ALL_GROUP_LABELS]
    .map((g) => ({ group: g, posts: groupCounts.get(g) ?? 0 }))
    .sort((a, b) => b.posts - a.posts);
  const lainnyaCount = groupCounts.get(LAINNYA_GROUP) ?? 0;
  const dominantGroups = [
    ...dominantGroupsSorted,
    { group: LAINNYA_GROUP, posts: lainnyaCount },
  ];

  return {
    totalPosts,
    classifiedPosts,
    sentimentMix,
    dominantGroups,
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
