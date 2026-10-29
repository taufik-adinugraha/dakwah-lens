/**
 * Briefing listing window (operator decision 2026-10-29).
 *
 * A briefing stays LISTED for `BRIEFING_LISTED_DAYS` after it is saved.
 * After that it is unlisted: it drops out of every listing — the
 * /briefings hub (14-grid + Edisi Khusus), group pages, edition
 * navigation, the Khutbah & Kultum library, the public flyer gallery,
 * discussion rooms, the landing page, dashboard kits and the sitemap —
 * and its own pages carry `noindex`. A direct link still opens:
 * `getBriefingBySlug` does not apply this rule, so links people shared
 * or saved keep working. Nothing is deleted.
 *
 * Applies to every track (weekly themes, Fiqh, Tafsir, occasion and
 * national editions). One exception: an occasion edition saved more
 * than `BRIEFING_LISTED_DAYS` ahead of its event stays listed until the
 * event day (`headline_stats.gregorian_date`, WIB) — it is not stale yet.
 */
import { sql } from "drizzle-orm";

export const BRIEFING_LISTED_DAYS = 10;

/** SQL predicate: this briefings row is still listed. `alias` qualifies
 *  the columns when the query aliases the table (`FROM briefings i`). */
export function briefingListedSql(alias?: string) {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  return sql`(
    ${col("generated_at")} >= now() - interval '${sql.raw(String(BRIEFING_LISTED_DAYS))} days'
    OR (
      ${col("occasion_slug")} IS NOT NULL
      AND CASE
        WHEN ${col("headline_stats")}->>'gregorian_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN (${col("headline_stats")}->>'gregorian_date')::date
               >= (now() AT TIME ZONE 'Asia/Jakarta')::date
        ELSE false
      END
    )
  )`;
}

/** JS twin of `briefingListedSql`, for a row already fetched (page
 *  metadata decides `noindex` with it). */
export function isBriefingListed(
  row: {
    generatedAt: Date;
    occasionSlug?: string | null;
    headlineStats?: unknown;
  },
  now: Date = new Date(),
): boolean {
  const ageMs = now.getTime() - new Date(row.generatedAt).getTime();
  if (ageMs <= BRIEFING_LISTED_DAYS * 86_400_000) return true;
  if (!row.occasionSlug) return false;
  const raw = (row.headlineStats as { gregorian_date?: unknown } | null)
    ?.gregorian_date;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const todayWib = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  return raw >= todayWib;
}
