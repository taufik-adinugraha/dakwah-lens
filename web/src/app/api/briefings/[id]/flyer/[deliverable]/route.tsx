import { getBriefingBySlug } from "@/lib/briefing-data";
import { renderFlyerPng } from "@/lib/flyer/render-flyer";
import { type DeliverableSlug } from "@/lib/flyer/design";

/**
 * Per-deliverable flyer endpoint — renders a 1080×1080 PNG themed to
 * ONE Section-4 sub-section (khutbah / kajian / home / content / genz /
 * action). Pulls the headline from THAT sub-section's body so the flyer
 * reflects the deliverable's specific message.
 *
 *   GET /api/briefings/{slug}/flyer/{deliverable}
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const VALID: ReadonlySet<DeliverableSlug> = new Set([
  "khutbah",
  "kajian",
  "home",
  "content",
  "genz",
  "action",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; deliverable: string }> },
) {
  const { id, deliverable } = await params;
  if (!(VALID as ReadonlySet<string>).has(deliverable)) {
    return new Response("Not Found", { status: 404 });
  }
  const slug = deliverable as DeliverableSlug;

  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";

  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return new Response("Not Found", { status: 404 });
  }

  const body =
    lang === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;

  const png = await renderFlyerPng({
    generatedAt: brief.generatedAt,
    body,
    daleelRefs: brief.daleelRefs,
    slot: { kind: "deliverable", deliverable: slug, segment: brief.themeGroup },
    locale: lang,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
