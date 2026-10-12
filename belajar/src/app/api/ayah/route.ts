import { type NextRequest, NextResponse } from "next/server";

import { ayahPayload } from "@/lib/ayat";

export const dynamic = "force-dynamic";

/**
 * One ayah of the fact cards' popup (operator 2026-10-12; src/components/surah/AyahDialog.tsx):
 * GET /belajar/api/ayah?loc=2:255 → its Arabic (Tanzil), translation (QuranEnc, with footnotes and
 * credit) and surah name, from content/ayat/locations.json (src/lib/ayat.ts). A location the file
 * has no entry for, or a malformed one, answers 404.
 *
 * Why a route and not the data in the page: the file holds every ayah any fact locates (~1 MB);
 * a page needs one at a time, on a click. Same origin, as the CSP requires (connect-src 'self').
 * Not gated by BELAJAR_SURAHS: it serves Qur'an text only, and a surah shown later finds its
 * facts' ayat here (the proxy skips /api). The answer only changes with a deploy, so the browser
 * may keep it a day; the dialog also keeps what it fetched for the visit.
 */
export async function GET(request: NextRequest) {
  const payload = ayahPayload(request.nextUrl.searchParams.get("loc"));
  if (!payload) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(payload, { headers: { "cache-control": "public, max-age=86400" } });
}
