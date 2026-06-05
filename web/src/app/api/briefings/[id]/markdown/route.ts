import { NextResponse } from "next/server";

import { getBriefingBySlug } from "@/lib/briefing-data";

/**
 * GET /api/briefings/{slug}/markdown
 *
 * Returns the raw `summary_md` (or `summary_md_en` when `?lang=en`) as
 * a `.md` file download. Used by:
 *   - BriefDownloadMenu's "Markdown" option
 *   - BriefShareMenu's "Copy as markdown" (fetches the text, then
 *     navigator.clipboard.writeText)
 *
 * Public — same access policy as the briefing page itself.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";

  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const body =
    lang === "en" && brief.summaryMdEn
      ? brief.summaryMdEn
      : brief.summaryMd;

  const filename = `dakwah-lens-briefing-${id}.md`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Cache for 1h — briefings are write-once and re-runs produce a new
      // slug pair, so we can safely cache by slug.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
