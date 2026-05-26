import "server-only";
import { createElement } from "react";

import type { FlyerImageAsset } from "@/lib/flyer/images/registry";
import { findAsset } from "@/lib/flyer/images/registry";
import { resolveAssets } from "@/lib/flyer/images/resolve";
import { LAYOUTS, type LayoutId } from "@/lib/flyer/layouts";
import type {
  FlyerComposition,
  FlyerPalette,
} from "@/lib/flyer/layouts/types";
import { buildHtmlDocument } from "@/lib/flyer/render/document";
import { snapHtmlToPng } from "@/lib/flyer/render/snap";
import { localeAwareFormat } from "@/lib/date-id";

import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/**
 * Render a user-generated flyer to PNG.
 *
 * Mirrors `renderFlyerPng` (briefing flyers) but maps the input from
 * a `user_flyers` row instead of a briefing slot. Same pipeline:
 *   resolveAssets → React tree → buildHtmlDocument → snapHtmlToPng.
 */
export async function renderUserFlyerPng(row: {
  id: string;
  layout: string;
  imageRef: string;
  headline: string;
  body: string;
  daleelCitation: string | null;
  daleelArabic: string | null;
  daleelTranslation: string | null;
  daleelCorpus: string | null;
  createdAt: Date;
}): Promise<Buffer> {
  const layoutId = row.layout as LayoutId;
  if (!(layoutId in LAYOUTS)) {
    throw new Error(`Unknown layout for user_flyers row: ${row.layout}`);
  }

  const image = await loadImageForRef(row.imageRef);
  const palette = paletteForLayout(layoutId, row.id);

  const composition: FlyerComposition = {
    content: {
      brand: "dakwah-lens.id",
      dateLabel: localeAwareFormat(row.createdAt, "id", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      headline: row.headline,
      message: row.body,
      daleel:
        row.daleelArabic && row.daleelTranslation && row.daleelCitation
          ? {
              corpus: row.daleelCorpus || "kitab",
              citation: row.daleelCitation,
              arabic: row.daleelArabic,
              translation_id: row.daleelTranslation,
              translation_en: row.daleelTranslation,
              score: null,
              ref_id: `user-flyer:${row.id}`,
            }
          : null,
    },
    image,
    palette,
    locale: "id",
  };

  const assets = await resolveAssets(image);
  const Layout = LAYOUTS[layoutId];
  // Stable variant from the row id so the same flyer always renders
  // identically across refreshes.
  const variant = (deterministicSeed(row.id) % 3) as 0 | 1 | 2;
  const tree = createElement(Layout, {
    ...composition,
    assets,
    layoutVariant: variant,
  });
  const html = await buildHtmlDocument(tree);
  return await snapHtmlToPng(html);
}

async function loadImageForRef(imageRef: string): Promise<FlyerImageAsset> {
  if (imageRef.startsWith("upload:")) {
    const uploadId = imageRef.slice("upload:".length);
    const [row] = await db
      .select({
        id: schema.userFlyerUploads.id,
        src: schema.userFlyerUploads.src,
      })
      .from(schema.userFlyerUploads)
      .where(eq(schema.userFlyerUploads.id, uploadId))
      .limit(1);
    if (!row) {
      throw new Error(`User upload not found: ${uploadId}`);
    }
    return {
      id: `upload-${row.id}`,
      kind: "photo",
      src: row.src,
      aspect: "1:1",
      tags: ["user-upload"],
    };
  }

  const asset = await findAsset(imageRef);
  if (!asset) {
    throw new Error(`flyer_assets row not found: ${imageRef}`);
  }
  return asset;
}

// Deterministic palette assignment — picks one of 4 presets per layout
// based on a hash of the flyer id so the same flyer is stable across
// renders, but two different flyers don't share the same look unless by
// coincidence.
function paletteForLayout(layout: LayoutId, id: string): FlyerPalette {
  const presets = PALETTES_BY_LAYOUT[layout] ?? FALLBACK_PALETTES;
  return presets[deterministicSeed(id) % presets.length];
}

function deterministicSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Palette presets re-using the same color decisions as compose.ts's
// GENERAL/GENZ banks, lightly trimmed. Keeping a single locale here
// (no per-segment tinting) since user flyers aren't scoped to a segment.
const EMERALD: FlyerPalette = {
  bgGradient: ["#ecfdf5", "#d1fae5"],
  accent: "#047857",
  accentDeep: "#064e3b",
  accentSoft: "#a7f3d0",
  chipText: "#ecfdf5",
};
const INDIGO: FlyerPalette = {
  bgGradient: ["#eef2ff", "#e0e7ff"],
  accent: "#4338ca",
  accentDeep: "#312e81",
  accentSoft: "#c7d2fe",
  chipText: "#eef2ff",
};
const AMBER: FlyerPalette = {
  bgGradient: ["#fefce8", "#fef3c7"],
  accent: "#a16207",
  accentDeep: "#713f12",
  accentSoft: "#fde68a",
  chipText: "#fefce8",
};
const TEAL: FlyerPalette = {
  bgGradient: ["#f0fdfa", "#ccfbf1"],
  accent: "#0f766e",
  accentDeep: "#134e4a",
  accentSoft: "#99f6e4",
  chipText: "#f0fdfa",
};
const VIOLET: FlyerPalette = {
  bgGradient: ["#ede9fe", "#fae8ff", "#fef3c7"],
  accent: "#a21caf",
  accentDeep: "#581c87",
  accentSoft: "#fae8ff",
  chipText: "#ffffff",
};

const FALLBACK_PALETTES: FlyerPalette[] = [EMERALD, INDIGO, AMBER, TEAL];

const PALETTES_BY_LAYOUT: Partial<Record<LayoutId, FlyerPalette[]>> = {
  "hero-ayat": [EMERALD, INDIGO, TEAL],
  "hero-headline": [INDIGO, EMERALD, AMBER],
  "split-image": [EMERALD, AMBER, INDIGO, TEAL],
  "quote-card": [AMBER, EMERALD, VIOLET],
  "dua-hero": [EMERALD, TEAL, INDIGO],
};
