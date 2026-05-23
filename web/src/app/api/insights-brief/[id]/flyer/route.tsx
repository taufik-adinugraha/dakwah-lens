import { getBriefingBySlug } from "@/lib/insights-data";
import { renderFlyerPng } from "@/lib/flyer/render-flyer";

/**
 * Briefing flyer endpoint — 4 message-driven variants behind one route.
 *
 *   GET /api/insights-brief/{slug}/flyer
 *
 * Query params:
 *   `variant` = "general-a" (default) | "general-b" | "genz-a" | "genz-b"
 *   `lang`    = "id" (default) | "en"
 *
 * Each variant pulls from a different slice of the briefing (khutbah
 * tagline, aksi-sosial campaign, kreator hook, gen-z penutup) so the
 * four flyers shown side-by-side in the UI carry distinct messages.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

type Variant = "general-a" | "general-b" | "genz-a" | "genz-b";
const VARIANTS: ReadonlySet<Variant> = new Set([
  "general-a",
  "general-b",
  "genz-a",
  "genz-b",
]);

function parseVariant(input: string | null): Variant {
  if (input && (VARIANTS as ReadonlySet<string>).has(input)) {
    return input as Variant;
  }
  return "general-a";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "id";
  const variant = parseVariant(url.searchParams.get("variant"));

  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return new Response("Not Found", { status: 404 });
  }

  const body =
    lang === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;

  const slot = variant.startsWith("general")
    ? {
        kind: "general" as const,
        variant: variant.endsWith("a") ? ("a" as const) : ("b" as const),
        segment: brief.segment,
      }
    : {
        kind: "genz" as const,
        variant: variant.endsWith("a") ? ("a" as const) : ("b" as const),
        segment: brief.segment,
      };

  const png = await renderFlyerPng({
    generatedAt: brief.generatedAt,
    body,
    daleelRefs: brief.daleelRefs,
    slot,
    locale: lang,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
