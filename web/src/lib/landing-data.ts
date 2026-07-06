import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

/** Lightweight rows for the landing "live Insights preview" — the
 *  redesign's proof that the product is real: latest briefing per
 *  theme (newest few) + the busiest live discussion themes. Kept
 *  deliberately skinny (no summary markdown) so the landing stays
 *  fast; the heavy lifting lives on /briefings. */
export type LandingBriefing = {
  id: string;
  themeGroup: string;
  generatedAt: Date;
};

export type LandingTheme = {
  label: string;
  postCount: number;
};

export type LandingInsights = {
  briefings: LandingBriefing[];
  themes: LandingTheme[];
};

export async function getLandingInsights(): Promise<LandingInsights> {
  const [briefingRows, themeRows] = await Promise.all([
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
    // Busiest live themes from the topics table, skipping the synthetic
    // catch-all bucket — it's real but reads as noise on a landing page.
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
    themes: (Array.isArray(themeRows) ? themeRows : []).map((r) => ({
      label: r.label,
      postCount: Number(r.post_count),
    })),
  };
}
