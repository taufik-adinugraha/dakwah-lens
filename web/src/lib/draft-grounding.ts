/**
 * Draft kajian grounding — fetch real per-platform sample posts that
 * match the topic the user typed, so the brief generator's "platform
 * breakdown" paragraph cites actual conversations rather than the
 * LLM's stereotyped training data about each platform.
 *
 * Two match modes:
 *   1. topicId given (user picked a trending topic from the dropdown):
 *      query posts directly by `social_posts.topic_id` — these are
 *      cluster-assigned by the unified topic-discovery run, so the
 *      match is precise.
 *   2. Free-text topic only: tokenize the topic, drop stop-words,
 *      ILIKE-match each keyword against `social_posts.text`. Posts
 *      that contain at least one keyword surface; rank by engagement.
 *      Loose but bounded — better than no grounding at all.
 *
 * Returns the canonical 5 platforms in fixed order even when one has
 * zero matches, so the prompt block keeps a consistent shape and the
 * LLM can write "tidak ada percakapan yang ditemukan di sini pekan
 * ini" rather than fabricate.
 */

import { sql } from "drizzle-orm";

import { db } from "@/db";

/** Platform buckets the draft prompt segments on. */
export const PLATFORM_BUCKETS = [
  "x",
  "tiktok",
  "instagram",
  "youtube",
  "mainstream",
] as const;
export type PlatformBucket = (typeof PLATFORM_BUCKETS)[number];

export type PlatformSample = {
  /** Sanitised single-line excerpt of the post. */
  text: string;
  postedAt: string | null;
  author: string | null;
  engagementScore: number | null;
  /** Sentiment label from the ingestion classifier (Gemini Flash-Lite).
   *  Typically one of: positive / neutral / negative / concerned.
   *  NULL on legacy rows or platforms with sentiment disabled. */
  sentimentLabel: string | null;
  /** Original post URL — lets the "Sumber percakapan" UI link out so
   *  the da'i can verify the case before quoting in a kajian. NULL
   *  when the ingester didn't capture a canonical URL. */
  url: string | null;
};

export type PlatformSampleGroup = {
  platform: PlatformBucket;
  samples: PlatformSample[];
};

/** Indonesian + English stop-words plus dakwah-corpus filler. Tokens
 *  shorter than 4 chars are also dropped by the keyword filter. */
const STOP_WORDS = new Set([
  // ID
  "yang", "dan", "atau", "dengan", "untuk", "dari", "pada", "dalam",
  "ke", "di", "se", "ini", "itu", "adalah", "akan", "agar", "kalau",
  "kita", "kami", "kamu", "anda", "tidak", "bisa", "sudah", "sedang",
  "para", "sebagai", "supaya", "kepada", "saja", "tentang", "lebih",
  "juga", "namun", "tetapi", "harus", "sangat", "telah", "secara",
  "tersebut", "antara", "punya", "lewat",
  // EN
  "the", "and", "for", "with", "from", "this", "that", "their", "them",
  "they", "are", "was", "were", "but", "not", "into", "have", "has",
  "had", "you", "your", "our", "out", "about", "more", "than", "some",
  "what", "when", "where", "why", "how", "would", "could", "should",
]);

function topicKeywords(topicText: string): string[] {
  const tokens = topicText
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter((tok) => tok.length >= 4 && !STOP_WORDS.has(tok));
  // Dedup while preserving order; cap at 6 to keep the SQL bounded.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/** Resolve a user-typed free-text topic to the most-relevant existing
 *  `topics.id`. Mirrors the weekly briefings pipeline (which only
 *  consumes posts via the pre-clustered `social_posts.topic_id` FK):
 *  when the user picks a trending topic from the dropdown the topic_id
 *  is already in hand, and when they type freely we map the phrase
 *  back onto the same clustering so the draft is grounded in the
 *  exact same aggregated pool the published briefings use.
 *
 *  Match logic:
 *  1. Tokenize the input into 4+ char keywords (stopwords stripped).
 *  2. For each candidate topic, count how many of those keywords
 *     appear in `topics.label` (case-insensitive) OR in any element of
 *     the `topics.keywords` JSONB array.
 *  3. Rank by (match_count DESC, recency tie-break via post_count DESC).
 *  4. Return the top match's id only if at least one keyword overlaps;
 *     otherwise null (caller falls back to "no grounded data" mode).
 *
 *  This is intentionally a SQL-only lookup — no LLM call. Cost: one
 *  cheap query per draft generate. Reuses the same data the dashboard
 *  topic cards already display, so a topic the user can see anywhere
 *  in the app is also reachable from free-text. */
export async function resolveTopicId(
  topicText: string,
): Promise<string | null> {
  const keywords = topicKeywords(topicText);
  if (keywords.length === 0) return null;

  // Lowercased keyword variants for predictable matching against
  // jsonb_array_elements_text (which is case-sensitive) and the
  // ILIKE label scan.
  const lowered = keywords.map((k) => k.toLowerCase());

  // For each topic in the last 30 days, count how many of the user's
  // keywords appear in (label, keywords[]). Constrain to topics that
  // actually got post traffic recently so we don't match a dormant
  // cluster.
  const rows = (await db.execute(sql`
    WITH kw(token) AS (
      SELECT unnest(${lowered}::text[])
    ),
    matched_topics AS (
      SELECT
        t.id::text AS id,
        t.label,
        (
          SELECT count(*) FROM kw
          WHERE lower(t.label) LIKE '%' || kw.token || '%'
        ) AS label_hits,
        (
          SELECT count(*) FROM kw
          WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE jsonb_typeof(t.keywords)
                WHEN 'array' THEN t.keywords
                ELSE '[]'::jsonb
              END
            ) AS tk
            WHERE lower(tk) LIKE '%' || kw.token || '%'
          )
        ) AS keyword_hits,
        (
          SELECT count(*) FROM social_posts sp
          WHERE sp.topic_id = t.id
            AND sp.posted_at >= now() - interval '14 days'
        ) AS recent_posts
      FROM topics t
      WHERE t.created_at >= now() - interval '30 days'
    )
    SELECT id, label, label_hits, keyword_hits, recent_posts
    FROM matched_topics
    WHERE (label_hits + keyword_hits) > 0
      AND recent_posts > 0
    ORDER BY (label_hits * 2 + keyword_hits) DESC, recent_posts DESC
    LIMIT 1
  `)) as unknown as Array<{
    id: string;
    label: string;
    label_hits: number;
    keyword_hits: number;
    recent_posts: number;
  }>;

  const top = rows[0];
  if (!top) return null;
  console.info(
    "[draft-grounding] resolved free-text → topic_id:",
    JSON.stringify({
      input: topicText.slice(0, 80),
      label: top.label,
      label_hits: top.label_hits,
      keyword_hits: top.keyword_hits,
      recent_posts: top.recent_posts,
    }),
  );
  return top.id;
}

export type GetPlatformSamplesInput = {
  topicText: string;
  /** Optional — when the user picked a trending topic, this is the FK to
   *  `topics.id`. Match by topic_id is more precise than ILIKE. */
  topicId?: string | null;
  daysBack?: number;
  perPlatformLimit?: number;
};

export async function getPlatformSamplesForTopic(
  input: GetPlatformSamplesInput,
): Promise<PlatformSampleGroup[]> {
  const {
    topicText,
    topicId,
    daysBack = 14,
    perPlatformLimit = 3,
  } = input;

  // Resolve to a concrete topic_id using the same clustering the
  // weekly briefings consume. No ILIKE on social_posts.text — that
  // path was prone to surface keyword false positives that the
  // weekly-briefings pipeline never tolerates.
  const resolvedTopicId = topicId ?? (await resolveTopicId(topicText));
  if (!resolvedTopicId) {
    return PLATFORM_BUCKETS.map((p) => ({ platform: p, samples: [] }));
  }

  // Ranking mirrors the briefing service (sample posts per topic):
  // the Gemini ingest-classifier score (`dawah_opportunity`) leads,
  // engagement is the tie-break. Keeps the draft consistent with
  // what the published weekly briefings draw their daleel-anchor
  // headlines from.
  // `db.execute(sql\`...\`)` returns timestamps as ISO strings, not Date
  // objects (unlike the typed `db.select()` API). Typing as `string |
  // null` and normalising downstream avoids the
  // `a.posted_at.toISOString is not a function` crash.
  // `dawah_opportunity >= 0.4` floor: drops posts the ingest
  // classifier wasn't confident on. Topic clustering sometimes pulls
  // in marginally-relevant posts (e.g. a Narasi explainer on AI
  // ending up in the "Kekerasan Seksual di Lingkungan Pendidikan"
  // cluster because both touch "pendidikan"). The floor filters
  // those out before they pollute the prompt.
  const rows = (await db.execute(sql`
    WITH ranked AS (
      SELECT
        platform,
        text,
        url,
        posted_at,
        author,
        engagement_score,
        sentiment_label,
        row_number() OVER (
          PARTITION BY platform
          ORDER BY dawah_opportunity DESC NULLS LAST,
                   engagement_score DESC NULLS LAST,
                   posted_at DESC NULLS LAST
        ) AS rn
      FROM social_posts
      WHERE topic_id = ${resolvedTopicId}::uuid
        AND posted_at >= now() - (${daysBack} || ' days')::interval
        AND text IS NOT NULL
        AND length(text) > 20
        AND dawah_opportunity >= 0.4
    )
    SELECT platform, text, url, posted_at, author, engagement_score, sentiment_label
    FROM ranked
    WHERE rn <= ${perPlatformLimit}
  `)) as unknown as Array<{
    platform: string;
    text: string;
    url: string | null;
    posted_at: string | Date | null;
    author: string | null;
    engagement_score: number | null;
    sentiment_label: string | null;
  }>;

  // Group by platform, keep canonical order, fill missing platforms
  // with empty arrays.
  const grouped = new Map<PlatformBucket, PlatformSample[]>();
  for (const p of PLATFORM_BUCKETS) grouped.set(p, []);
  for (const r of rows) {
    if (!PLATFORM_BUCKETS.includes(r.platform as PlatformBucket)) continue;
    const bucket = grouped.get(r.platform as PlatformBucket)!;
    const cleaned = r.text
      .replace(/\s+/g, " ")
      .replace(/https?:\/\/\S+/g, "")
      .trim()
      .slice(0, 280);
    if (!cleaned) continue;
    bucket.push({
      text: cleaned,
      // Coerce via `new Date(...)` so we accept both string (raw
      // db.execute path) and Date (legacy callers).
      postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
      author: r.author,
      engagementScore: r.engagement_score,
      sentimentLabel: r.sentiment_label,
      url: r.url,
    });
  }

  return PLATFORM_BUCKETS.map((platform) => ({
    platform,
    samples: grouped.get(platform) ?? [],
  }));
}

export type PlatformStat = {
  platform: PlatformBucket;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  /** Posts the ingest classifier flagged with any other label (e.g. mixed,
   *  concerned, unknown). Kept separate so the UI's 3-bucket bar still
   *  adds up to `total`. */
  other: number;
};

/** Per-platform post counts + sentiment breakdown for the same topic
 *  window as [[getPlatformSamplesForTopic]]. Used to render the
 *  "Statistik" section on the draft detail page. Same match semantics
 *  (topic_id when given, ILIKE-keyword fallback otherwise). */
export async function getPlatformStatsForTopic(
  input: GetPlatformSamplesInput,
): Promise<PlatformStat[]> {
  const { topicText, topicId, daysBack = 14 } = input;

  // Same topic_id resolution path as the sample fetcher — no ILIKE
  // fallback so stats match the weekly briefings' aggregation
  // semantics exactly.
  const resolvedTopicId = topicId ?? (await resolveTopicId(topicText));
  if (!resolvedTopicId) {
    return PLATFORM_BUCKETS.map((p) => ({
      platform: p,
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      other: 0,
    }));
  }

  // Same dawah_opportunity floor as the sample fetcher — keeps the
  // displayed stats consistent with the prompt's CONTOH POST and
  // prevents off-topic cluster-noise from inflating the totals.
  const rows = (await db.execute(sql`
    SELECT
      platform,
      count(*)::int AS total,
      count(*) FILTER (WHERE sentiment_label = 'positive')::int AS positive,
      count(*) FILTER (WHERE sentiment_label = 'neutral')::int AS neutral,
      count(*) FILTER (WHERE sentiment_label = 'negative')::int AS negative,
      count(*) FILTER (
        WHERE sentiment_label IS NULL
           OR sentiment_label NOT IN ('positive', 'neutral', 'negative')
      )::int AS other
    FROM social_posts
    WHERE topic_id = ${resolvedTopicId}::uuid
      AND posted_at >= now() - (${daysBack} || ' days')::interval
      AND dawah_opportunity >= 0.4
    GROUP BY platform
  `)) as unknown as Array<{
    platform: string;
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    other: number;
  }>;

  const byPlatform = new Map<PlatformBucket, PlatformStat>();
  for (const p of PLATFORM_BUCKETS) {
    byPlatform.set(p, {
      platform: p,
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      other: 0,
    });
  }
  for (const r of rows) {
    if (!PLATFORM_BUCKETS.includes(r.platform as PlatformBucket)) continue;
    byPlatform.set(r.platform as PlatformBucket, {
      platform: r.platform as PlatformBucket,
      total: Number(r.total ?? 0),
      positive: Number(r.positive ?? 0),
      neutral: Number(r.neutral ?? 0),
      negative: Number(r.negative ?? 0),
      other: Number(r.other ?? 0),
    });
  }
  return PLATFORM_BUCKETS.map((p) => byPlatform.get(p)!);
}

/** Render the per-platform stats block for the LLM user prompt — terse
 *  numeric summary the LLM can cite alongside the sample-quote analysis.
 *  Returns "" when every platform has zero posts so the caller can skip
 *  the section entirely. */
export function renderPlatformStatsBlock(stats: PlatformStat[]): string {
  if (!stats.some((s) => s.total > 0)) return "";
  const platformLabel: Record<PlatformBucket, string> = {
    x: "X (Twitter)",
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
    mainstream: "Berita arus utama (RSS)",
  };
  const lines: string[] = [
    "| Platform | Total | Positif | Netral | Negatif | Lain |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  let totalAll = 0;
  let posAll = 0;
  let neuAll = 0;
  let negAll = 0;
  let othAll = 0;
  for (const s of stats) {
    if (s.total === 0) {
      lines.push(
        `| ${platformLabel[s.platform]} | 0 | — | — | — | — |`,
      );
      continue;
    }
    totalAll += s.total;
    posAll += s.positive;
    neuAll += s.neutral;
    negAll += s.negative;
    othAll += s.other;
    lines.push(
      `| ${platformLabel[s.platform]} | ${s.total} | ${s.positive} | ${s.neutral} | ${s.negative} | ${s.other} |`,
    );
  }
  lines.push(
    `| **Total** | **${totalAll}** | **${posAll}** | **${neuAll}** | **${negAll}** | **${othAll}** |`,
  );
  return lines.join("\n");
}

/** Render the per-platform samples block for the LLM user prompt.
 *  Returns an empty string when every platform has zero samples — caller
 *  should then skip the platform-breakdown directive entirely. */
export function renderPlatformSamplesBlock(
  groups: PlatformSampleGroup[],
): string {
  const platformLabel: Record<PlatformBucket, string> = {
    x: "X (Twitter)",
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
    mainstream: "Berita arus utama (RSS)",
  };

  const lines: string[] = [];
  let anySamples = false;
  for (const group of groups) {
    lines.push(`### ${platformLabel[group.platform]}`);
    if (group.samples.length === 0) {
      lines.push("  (tidak ada post yang cocok di platform ini pekan lalu)");
    } else {
      anySamples = true;
      group.samples.forEach((s, i) => {
        const meta = [
          s.author ? `@${s.author}` : null,
          s.postedAt ? new Date(s.postedAt).toISOString().slice(0, 10) : null,
          s.sentimentLabel ? `sentimen: ${s.sentimentLabel}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        lines.push(`  ${i + 1}. ${s.text}${meta ? ` — ${meta}` : ""}`);
      });
    }
    lines.push("");
  }
  if (!anySamples) return "";
  return lines.join("\n").trimEnd();
}
