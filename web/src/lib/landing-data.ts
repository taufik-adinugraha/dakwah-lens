import "server-only";

import { and, count, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { briefingListedSql } from "@/lib/briefing-listing";
import { cached } from "@/lib/stale-while-revalidate";

/** How long the landing page's figures are kept before they are read again.
 *  They change when the nightly label batch runs (00:00 WIB) and when a
 *  briefing is saved, so an hour is invisible to a visitor. Reading them cost
 *  a visit 2.8 s (the post count scanned the whole table: `created_at` had no
 *  index until migration 20261104_0900), which is what the cache is for.
 *  Measured 2026-11-04. */
export const LANDING_TTL_MS = 60 * 60 * 1000;

/** Lightweight rows for the landing "live Insights preview" — the
 *  redesign's proof that the product is real: latest briefing per
 *  theme_group (newest few) + the busiest live discussion topics. Kept
 *  deliberately skinny (no summary markdown) so the landing stays
 *  fast; the heavy lifting lives on /briefings.
 *
 *  Note the vocabulary split this project keeps strict: a "theme" (aka
 *  theme_group) is one of the 14 fixed briefing categories; a "topic" is
 *  a reclustered discussion cluster from the `topics` table (e.g. "TPPU
 *  Febrie Adriansyah"). The busiest-list below is TOPICS, not themes. */
export type LandingBriefing = {
  id: string;
  themeGroup: string;
  generatedAt: Date;
};

export type LandingTopic = {
  label: string;
  postCount: number;
};

export type LandingInsights = {
  briefings: LandingBriefing[];
  topics: LandingTopic[];
};

/** The two figures the landing page counts live: feeds on, and posts the
 *  nightly Claude batch has labelled in the last 30 days. The platforms line
 *  is not here: it is a constant (lib/ingest-status.ts), not a query. */
export type LandingCoverage = {
  outlets: number;
  postsAnalyzed30d: number;
};

async function loadCoverage(): Promise<LandingCoverage> {
  // Two counts in parallel. The feeds count is a table of a few dozen rows. The posts
  // count was the expensive one: until migration 20261104_0900 `social_posts.created_at`
  // had no index, so Postgres read the whole table (2.8 s and ~0.5 GB on 2026-11-04). It
  // used to run on every visit under the comment "hits an indexed column (<10ms)", which
  // it never did; it now runs once an hour (see getLandingCoverage).
  const [outletRows, postRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.rssFeeds)
      .where(eq(schema.rssFeeds.enabled, true)),
    // "Posts analyzed" = posts the nightly Claude batch has labelled (theme +
    // sentiment). Posts not labelled yet stay in the table but don't count
    // toward the figure shown on the homepage. We count mainstream RSS too;
    // it's the majority of the corpus. Until 2026-11-03 this read
    // `dawah_opportunity IS NOT NULL`, which showed 1,151 against 68,272
    // labelled posts once the score's classifier ran out of prepay.
    db
      .select({ n: count() })
      .from(schema.socialPosts)
      .where(
        and(
          sql`created_at >= now() - interval '30 days'`,
          sql`theme_group IS NOT NULL`,
          sql`sentiment_label IS NOT NULL`,
        ),
      ),
  ]);
  return {
    outlets: outletRows[0]?.n ?? 0,
    postsAnalyzed30d: postRows[0]?.n ?? 0,
  };
}

async function loadInsights(): Promise<LandingInsights> {
  const [briefingRows, topicRows] = await Promise.all([
    // Latest briefing per theme_group, ranked by that group's 7d post
    // volume (NOT recency — the weekly batch publishes low-volume
    // groups last, so "newest 4" would surface exactly the least-busy
    // themes; operator caught this on 2026-07-06). DISTINCT ON keeps
    // one row per group; the volume join picks the 4 biggest.
    db.execute(sql`
      SELECT latest.id, latest.theme_group, latest.generated_at
      FROM (
        SELECT DISTINCT ON (theme_group)
          id, theme_group, generated_at
        FROM briefings
        WHERE theme_group IS NOT NULL AND occasion_slug IS NULL
          AND ${briefingListedSql()}
        ORDER BY theme_group, generated_at DESC
      ) latest
      LEFT JOIN (
        SELECT theme_group, COUNT(*) AS vol
        FROM social_posts
        WHERE posted_at >= now() - interval '7 days'
          AND theme_group IS NOT NULL
        GROUP BY theme_group
      ) v ON v.theme_group = latest.theme_group
      ORDER BY COALESCE(v.vol, 0) DESC
      LIMIT 4
    `) as unknown as Promise<
      Array<{ id: string; theme_group: string; generated_at: string }>
    >,
    // Busiest live topics from the topics table, skipping the synthetic
    // catch-all bucket — it's real but reads as noise on a landing page.
    // No date filter: the topics table is a single current set rebuilt on
    // each manual recluster, so this always shows the latest available
    // reclustering — the previous set carries over until a new one lands.
    db.execute(sql`
      SELECT label, post_count
      FROM topics
      WHERE label NOT ILIKE 'Lainnya%'
      ORDER BY post_count DESC
      LIMIT 6
    `) as unknown as Promise<Array<{ label: string; post_count: number }>>,
  ]);

  return {
    briefings: (Array.isArray(briefingRows) ? briefingRows : []).map((r) => ({
      id: r.id,
      themeGroup: r.theme_group,
      generatedAt: new Date(r.generated_at),
    })),
    topics: (Array.isArray(topicRows) ? topicRows : []).map((r) => ({
      label: r.label,
      postCount: Number(r.post_count),
    })),
  };
}

/** What the landing page reads. Both are kept for `LANDING_TTL_MS` and
 *  reloaded behind a visit, never in front of one (stale-while-revalidate.ts).
 *  The landing page must not run its own query for either: a test pins that. */
export function getLandingCoverage(): Promise<LandingCoverage> {
  return cached("landing:coverage", loadCoverage, { ttlMs: LANDING_TTL_MS });
}

export function getLandingInsights(): Promise<LandingInsights> {
  return cached("landing:insights", loadInsights, { ttlMs: LANDING_TTL_MS });
}

/** Load both now. instrumentation.ts calls this at boot, so the first visit
 *  after a deploy finds them ready instead of waiting for the count. */
export function warmLanding(): Promise<unknown> {
  return Promise.all([getLandingCoverage(), getLandingInsights()]);
}
