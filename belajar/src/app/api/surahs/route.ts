import { NextResponse } from "next/server";

import { publishedSurahs } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * The published surahs (BELAJAR_SURAHS, lib/features.ts), in mushaf order. Read client-side by the
 * end of a surah's lesson (components/autoplay/useUpNext.ts) so that the lesson pages stay
 * statically prerendered, as /api/me does for identity: the switch is read per request, and a
 * prerendered page would carry the build machine's value. Lists only what visitors can reach.
 */
export async function GET() {
  return NextResponse.json({ published: publishedSurahs() }, { headers: { "cache-control": "no-store" } });
}
