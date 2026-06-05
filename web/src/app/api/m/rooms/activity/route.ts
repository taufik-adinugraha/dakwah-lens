import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";

/**
 * Compact activity probe used by the /briefings sticky-nudge chip.
 *
 * GET /api/m/rooms/activity?slugs=a,b,c
 *   → { rooms: [{ slug, approvedTotal, lastActivityAt }] }
 *
 * Only returns the trio the chip needs. Caps the request to 12
 * slugs (the localStorage `dl_watched` set should never grow that
 * big in normal use). Slugs are filtered for the canonical shape
 * before hitting the DB.
 */
export const runtime = "nodejs";

// Stricter than `^\d{4}-\d{2}-\d{2}-…$` — disallows impossible months
// (13+) and days (32+). Still permits Feb 30 etc., but those just
// resolve to zero DB rows downstream and pose no security risk.
const SLUG_RE =
  /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(all|family|youth|justice|spiritual)$/;
const MAX_SLUGS = 12;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("slugs") || "";
  const slugs = Array.from(
    new Set(raw.split(",").map((s) => s.trim()).filter((s) => SLUG_RE.test(s))),
  ).slice(0, MAX_SLUGS);

  if (slugs.length === 0) {
    return NextResponse.json({ rooms: [] });
  }

  const rows = await db
    .select({
      slug: schema.mahasiswaComments.briefingSlug,
      approvedTotal: sql<number>`COUNT(*)::int`,
      lastActivityAt: sql<Date | null>`MAX(${schema.mahasiswaComments.createdAt})`,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.status, "approved"),
        inArray(schema.mahasiswaComments.briefingSlug, slugs),
      ),
    )
    .groupBy(schema.mahasiswaComments.briefingSlug);

  return NextResponse.json({
    rooms: rows.map((r) => ({
      slug: r.slug,
      approvedTotal: Number(r.approvedTotal),
      lastActivityAt: r.lastActivityAt ? r.lastActivityAt.toString() : null,
    })),
  });
}
