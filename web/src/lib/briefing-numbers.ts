/**
 * The "Numerik & Tren Pekan Ini" infographic's data, read from the
 * briefing's own headline_stats (the same stats block the composer wrote
 * the section's prose from), so the charts and the text cannot disagree.
 *
 * Owner 2026-11-25: "we put a lot of numbers in paragraph. it's not so
 * easy to read. better to show infographic and plot instead of plain
 * text." Anything missing or malformed returns null and the page keeps
 * the prose.
 */

export type Sentiment = { negative: number; neutral: number; positive: number };

export type BriefingNumbers = {
  posts: number;
  prevPosts: number | null;
  /** Week-on-week change in posts, percent (negative = fewer). */
  deltaPct: number | null;
  sentiment: Sentiment;
  /** Last weeks' negative share, percent. */
  baselineNegative: number | null;
  /** Change of the negative share vs the baseline, percentage points. */
  deltaPpNegative: number | null;
  platforms: Array<{ key: string; posts: number; sentiment: Sentiment | null }>;
  topics: Array<{ label: string; posts: number; headlines: string[] }>;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function sentimentFrom(
  s: Record<string, unknown> | null,
  prefix: "current_pct_" | "pct_",
): Sentiment | null {
  if (!s) return null;
  const negative = num(s[`${prefix}negative`]);
  const neutral = num(s[`${prefix}neutral`]);
  const positive = num(s[`${prefix}positive`]);
  if (negative === null || neutral === null || positive === null) return null;
  const total = negative + neutral + positive;
  // Shares that don't add up to ~100 are not a distribution we can draw.
  if (total < 95 || total > 105) return null;
  return { negative, neutral, positive };
}

/** "Domain Ekonomi dan Bisnis" -> "Ekonomi dan Bisnis"; "Lainnya — Tidak
 *  Terklasifikasi" -> "Lainnya". Event topics ("Prabowo di KTT ASEAN …")
 *  keep their name. */
export function cleanTopicLabel(label: string): string {
  const s = label.trim();
  if (/^lainnya\b/i.test(s)) return "Lainnya";
  return s.replace(/^domain\s+/i, "");
}

export function briefingNumbers(stats: unknown): BriefingNumbers | null {
  const s = obj(stats);
  if (!s) return null;
  const totals = obj(s.totals);
  const posts = num(totals?.posts_7d);
  const sentimentRaw = obj(s.sentiment);
  const sentiment = sentimentFrom(sentimentRaw, "current_pct_");
  if (posts === null || posts <= 0 || !sentiment) return null;

  const platforms = (Array.isArray(s.platform_stats) ? s.platform_stats : [])
    .map(obj)
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => ({
      key: String(p.platform ?? ""),
      posts: num(p.posts) ?? 0,
      sentiment: sentimentFrom(obj(p.sentiment), "pct_"),
    }))
    .filter((p) => p.key && p.posts > 0)
    .sort((a, b) => b.posts - a.posts);

  const topics = (Array.isArray(s.top_topics) ? s.top_topics : [])
    .map(obj)
    .filter((t): t is Record<string, unknown> => !!t)
    .map((t) => ({
      label: cleanTopicLabel(String(t.label ?? "")),
      posts: num(t.post_count) ?? 0,
      headlines: (Array.isArray(t.sample_headlines) ? t.sample_headlines : [])
        .map((h) => (typeof h === "string" ? h : String(obj(h)?.title ?? "")))
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, 2),
    }))
    .filter((t) => t.label && t.posts > 0)
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 6);

  return {
    posts,
    prevPosts: num(totals?.posts_prev_7d),
    deltaPct: num(totals?.delta_pct),
    sentiment,
    baselineNegative: num(sentimentRaw?.baseline_pct_negative),
    deltaPpNegative: num(sentimentRaw?.delta_pp_negative),
    // One platform adds nothing the overall bar doesn't already show.
    platforms: platforms.length > 1 ? platforms : [],
    topics,
  };
}
