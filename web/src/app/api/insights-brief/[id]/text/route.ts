import { NextResponse } from "next/server";

import { getBriefingBySlug } from "@/lib/insights-data";

/**
 * GET /api/insights-brief/{slug}/text
 *
 * Markdown-stripped plain-text download for universal compatibility
 * (email body paste, older readers, accessibility tools that struggle
 * with markdown). Strips H2/H3 markers, blockquote markers, bold/italic
 * marks, and collapses extra whitespace.
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

  const md =
    lang === "en" && brief.summaryMdEn
      ? brief.summaryMdEn
      : brief.summaryMd;

  const text = stripMarkdown(md);
  const filename = `dakwah-lens-briefing-${id}.txt`;

  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Minimal markdown-to-plain-text. We don't pull a full library because
 * the LLM emits a known subset: H2/H3 headings, blockquotes, bold,
 * italic, ordered/unordered lists. Anything fancier (tables, fenced
 * code) shouldn't appear in a da'wah briefing.
 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#+\s+/gm, "") // strip heading markers
    .replace(/^>\s?/gm, "") // strip blockquote markers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // strip bold
    .replace(/(?<![a-zA-Z0-9])\*([^*\n]+)\*(?![a-zA-Z0-9])/g, "$1") // strip italic (best-effort)
    .replace(/^[-*]\s+/gm, "• ") // bullets → •
    .replace(/^\d+\.\s+/gm, (m) => m) // keep numbered list intact
    .replace(/\n{3,}/g, "\n\n") // collapse extra blanks
    .trim();
}
