import { getBriefingBySlug } from "@/lib/briefing-data";
import { FlyerSlotMissingError } from "@/lib/flyer/compose";
import { renderFlyerPng } from "@/lib/flyer/render-flyer";

/**
 * Legacy alias for the unified flyer route — returns the `genz-a`
 * variant. Kept so external links to /flyer-genz (download URLs in old
 * messages, etc.) still resolve.
 *
 *   GET /api/briefings/{slug}/flyer-genz
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";

  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return new Response("Not Found", { status: 404 });
  }

  const body =
    lang === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;

  let png: Buffer;
  try {
    png = await renderFlyerPng({
      generatedAt: brief.generatedAt,
      body,
      daleelRefs: brief.daleelRefs,
      slot: { kind: "genz", variant: "a", segment: brief.themeGroup },
      locale: lang,
    });
  } catch (err) {
    if (err instanceof FlyerSlotMissingError) {
      return new Response("Flyer slot not present in this briefing", {
        status: 404,
      });
    }
    throw err;
  }

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
