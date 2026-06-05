import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { extractPosterQuestion } from "@/lib/flyer/content";

/**
 * Public-facing view of a single discussion room. Mirrors the admin
 * `RoomOverview` shape but strips moderator-only fields (blocked
 * counts, unique IP counts, admin reply counts) — readers shouldn't
 * see how aggressive the spam filter has been, or who's a returning
 * visitor.
 */
export type PublicRoomOverview = {
  /** Briefing slug — `YYYY-MM-DD-{segment}`. Doubles as the room's
   *  canonical URL: /m/{slug}. */
  slug: string;
  /** Topic — null for the overall-view briefing. */
  segment: string | null;
  /** Briefing publish time. The WIB date portion is the "week" the
   *  room belongs to in the listing filters. */
  generatedAt: Date;
  /** The discussion question extracted from the Mahasiswa section
   *  of the briefing markdown — same headline that's on the
   *  `/m/{slug}` hero. `null` when the briefing markdown didn't
   *  carry a Poster Question marker (older briefings, mostly). */
  title: string | null;
  /** Approved (public) comments under this room. */
  totalApproved: number;
  /** Approved comments in the last 7 days. Drives the active /
   *  dormant filter chip. */
  approved7d: number;
  /** Newest approved comment's timestamp, or null when the room has
   *  never received one. */
  lastActivityAt: Date | null;
  /** True when an admin has muted the room (read-only mode). */
  muted: boolean;
};

/** Active = at least one approved comment in the last 7 days. Anything
 *  else is dormant. Same line the existing `WatchedRoomsNudge` uses
 *  for "this room has new activity" signal, keeps the UX consistent. */
export const ACTIVE_THRESHOLD_DAYS = 7;

/**
 * Public-safe roll-up of every discussion room published in the last
 * `windowDays` (default 90). One row per logical room — a briefing
 * regenerated 5× still shows as one card thanks to the DISTINCT ON.
 *
 * No auth. Single SQL round-trip so /discussions stays cheap to load.
 */
export async function listPublicRoomOverviews(
  windowDays = 90,
): Promise<PublicRoomOverview[]> {
  type Row = {
    slug: string;
    segment: string | null;
    generated_at: Date | string;
    summary_md: string | null;
    total_approved: number;
    approved_7d: number;
    last_activity_at: Date | string | null;
    muted: boolean;
  };
  // CTE picks the freshest briefing per (WIB-date, segment) — same
  // dedup as the admin query — and surfaces the summary_md so the
  // post-query extractor can pull the discussion title without a
  // second round-trip.
  const rows = (await db.execute(sql`
    WITH latest_briefings AS (
      SELECT DISTINCT ON (briefing_slug)
        to_char(generated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
          || '-' || COALESCE(theme_group, 'all') AS briefing_slug,
        theme_group AS segment,
        generated_at,
        summary_md
      FROM briefings
      WHERE generated_at >= now() - (${windowDays} || ' days')::interval
      ORDER BY briefing_slug, generated_at DESC
    )
    SELECT
      lb.briefing_slug AS slug,
      lb.segment       AS segment,
      lb.generated_at  AS generated_at,
      lb.summary_md    AS summary_md,
      COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0)::int AS total_approved,
      COALESCE(SUM(CASE WHEN c.status = 'approved' AND c.created_at >= now() - interval '7 days' THEN 1 ELSE 0 END), 0)::int AS approved_7d,
      MAX(CASE WHEN c.status = 'approved' THEN c.created_at END) AS last_activity_at,
      (r.muted_at IS NOT NULL) AS muted
    FROM latest_briefings lb
    LEFT JOIN mahasiswa_comments c
      ON c.briefing_slug = lb.briefing_slug
    LEFT JOIN mahasiswa_room_settings r
      ON r.briefing_slug = lb.briefing_slug
    GROUP BY lb.briefing_slug, lb.segment, lb.generated_at, lb.summary_md, r.muted_at
    ORDER BY MAX(CASE WHEN c.status = 'approved' THEN c.created_at END) DESC NULLS LAST,
             lb.generated_at DESC
  `)) as unknown as Row[];

  return rows.map((r) => {
    const extractedTitle = r.summary_md
      ? extractPosterQuestion(r.summary_md)
      : "";
    return {
      slug: r.slug,
      segment: r.segment,
      generatedAt:
        r.generated_at instanceof Date
          ? r.generated_at
          : new Date(r.generated_at),
      title: extractedTitle.trim() || null,
      totalApproved: r.total_approved,
      approved7d: r.approved_7d,
      lastActivityAt: r.last_activity_at
        ? r.last_activity_at instanceof Date
          ? r.last_activity_at
          : new Date(r.last_activity_at)
        : null,
      muted: r.muted,
    };
  });
}

/** WIB-date of a briefing as the canonical "week" string the URL
 *  filter uses. Avoids depending on the user's locale tz on the
 *  server. */
export function wibDateString(d: Date): string {
  // Add 7h, then take the UTC date — same trick as briefingSlug.
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const day = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Coarse status taxonomy for the public listing. Anything muted
 *  wins — readers should see a closed room as closed regardless of
 *  prior activity. */
export type PublicRoomStatus = "active" | "dormant" | "muted";

export function roomStatus(o: PublicRoomOverview): PublicRoomStatus {
  if (o.muted) return "muted";
  return o.approved7d > 0 ? "active" : "dormant";
}
