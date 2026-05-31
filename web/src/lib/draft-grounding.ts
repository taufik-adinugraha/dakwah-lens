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

  // Per-platform queries via UNION ALL so each platform gets its own
  // top-N slice (vs. global LIMIT which would let popular platforms
  // monopolise the result). The window function inside each sub-query
  // ranks within (platform).
  let rows: Array<{
    platform: string;
    text: string;
    posted_at: Date | null;
    author: string | null;
    engagement_score: number | null;
    sentiment_label: string | null;
  }>;

  if (topicId) {
    rows = (await db.execute(sql`
      WITH ranked AS (
        SELECT
          platform,
          text,
          posted_at,
          author,
          engagement_score,
          sentiment_label,
          row_number() OVER (
            PARTITION BY platform
            ORDER BY engagement_score DESC NULLS LAST,
                     dawah_opportunity DESC NULLS LAST,
                     posted_at DESC NULLS LAST
          ) AS rn
        FROM social_posts
        WHERE topic_id = ${topicId}::uuid
          AND posted_at >= now() - (${daysBack} || ' days')::interval
          AND text IS NOT NULL
          AND length(text) > 20
      )
      SELECT platform, text, posted_at, author, engagement_score, sentiment_label
      FROM ranked
      WHERE rn <= ${perPlatformLimit}
    `)) as unknown as typeof rows;
  } else {
    const keywords = topicKeywords(topicText);
    if (keywords.length === 0) {
      // No usable keywords (very short or all-stopword topic). Return
      // empty groups — the prompt will tell the LLM no samples exist
      // and to label para 1 as "pola umum" instead of fabricating.
      return PLATFORM_BUCKETS.map((p) => ({ platform: p, samples: [] }));
    }
    // Build an OR chain of ILIKE patterns. Postgres can use the BTREE
    // index on text via trigram if pg_trgm is installed; otherwise
    // it's a seq scan over the recent-posts slice, which is bounded
    // by the posted_at filter. With 5K-50K posts in a 14-day window
    // this stays under 100ms.
    const ilikeClause = sql.join(
      keywords.map((kw) => sql`text ILIKE ${"%" + kw + "%"}`),
      sql` OR `,
    );
    rows = (await db.execute(sql`
      WITH ranked AS (
        SELECT
          platform,
          text,
          posted_at,
          author,
          engagement_score,
          sentiment_label,
          row_number() OVER (
            PARTITION BY platform
            ORDER BY engagement_score DESC NULLS LAST,
                     dawah_opportunity DESC NULLS LAST,
                     posted_at DESC NULLS LAST
          ) AS rn
        FROM social_posts
        WHERE posted_at >= now() - (${daysBack} || ' days')::interval
          AND text IS NOT NULL
          AND length(text) > 20
          AND (${ilikeClause})
      )
      SELECT platform, text, posted_at, author, engagement_score, sentiment_label
      FROM ranked
      WHERE rn <= ${perPlatformLimit}
    `)) as unknown as typeof rows;
  }

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
      postedAt: r.posted_at ? r.posted_at.toISOString() : null,
      author: r.author,
      engagementScore: r.engagement_score,
      sentimentLabel: r.sentiment_label,
    });
  }

  return PLATFORM_BUCKETS.map((platform) => ({
    platform,
    samples: grouped.get(platform) ?? [],
  }));
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
