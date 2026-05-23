import type { DaleelRef } from "@/db/schema";

import {
  extractAksiMessage,
  extractCampaignTagline,
  extractDeliverableHeadline,
  extractDeliverableMessage,
  extractGenZMessage,
  extractGenZTagline,
  extractKhutbahMessage,
  extractKhutbahTagline,
  extractKreatorHook,
  extractKreatorMessage,
  formatFlyerDate,
  pickFlyerDaleel,
} from "./content";
import {
  DELIVERABLE_PALETTE,
  SEGMENT_PALETTE,
  type DeliverableSlug,
  type SegmentSlug,
} from "./design";
import {
  getAssetsByKind,
  type FlyerImageAsset,
} from "./images/registry";
import type { LayoutId } from "./layouts";
import type {
  FlyerComposition,
  FlyerContent,
  FlyerLocale,
  FlyerPalette,
} from "./layouts/types";

/**
 * Pick a layout + image + palette for a given briefing flyer slot.
 *
 * The brief surfaces FOUR shareable flyers, two general + two Gen-Z
 * themed. Each variant pulls from a different slice of the briefing so
 * the four don't visually duplicate:
 *
 *   general-a → Khutbah tagline + actionable steps  (HeroAyat layout)
 *   general-b → Aksi Sosial campaign tagline        (SplitImage layout)
 *   genz-a    → Kreator HOOK slogan                 (HeroHeadline)
 *   genz-b    → Gen Z framing punchline             (QuoteCard)
 *
 * Daleel is cycled by rank (0,1,2,3) so each flyer cites a different
 * entry from the retrieval pool. The legacy "deliverable" slot is kept
 * so the per-Section-4 download flow (BriefDeliverableCards) keeps
 * working unchanged.
 */

export type GeneralVariant = "a" | "b";
export type GenZVariant = "a" | "b";

export type FlyerSlot =
  | { kind: "general"; variant: GeneralVariant; segment: string | null }
  | { kind: "genz"; variant: GenZVariant; segment: string | null }
  | {
      kind: "deliverable";
      deliverable: DeliverableSlug;
      segment: string | null;
    };

export type FlyerContext = {
  generatedAt: Date;
  body: string;
  daleelRefs: DaleelRef[] | null;
  slot: FlyerSlot;
  locale: FlyerLocale;
};

const SEGMENT_VALUES = ["spiritual", "family", "youth", "justice"] as const;
type DbSegment = (typeof SEGMENT_VALUES)[number];

function segmentToSlug(s: string | null): SegmentSlug {
  if (s && (SEGMENT_VALUES as readonly string[]).includes(s)) {
    return s as DbSegment;
  }
  return "all";
}

/** Each slot gets a fixed layout so the four-card grid in the UI
 *  always shows visual variety (not all four are HeroAyat by chance). */
function layoutForSlot(slot: FlyerSlot): LayoutId {
  if (slot.kind === "general") {
    return slot.variant === "a" ? "hero-ayat" : "split-image";
  }
  if (slot.kind === "genz") {
    return slot.variant === "a" ? "hero-headline" : "quote-card";
  }
  // Per-deliverable: classical layout, image-backed.
  return "hero-ayat";
}

/** Pick the rank used to choose which daleel from the pool. Different
 *  ranks across the four flyers spread citations evenly. */
function daleelRankForSlot(slot: FlyerSlot): number {
  if (slot.kind === "general" && slot.variant === "a") return 0;
  if (slot.kind === "general" && slot.variant === "b") return 1;
  if (slot.kind === "genz" && slot.variant === "a") return 2;
  if (slot.kind === "genz" && slot.variant === "b") return 3;
  return 0; // deliverable
}

/** Pick an image for the chosen layout. Each layout has a preferred
 *  image kind (photo for image-prominent layouts, ornament for accent
 *  layouts) — we always pick something so the flyer never renders
 *  text-only. djb2 hash over generated_at + slot = deterministic. */
async function pickImage(
  layout: LayoutId,
  slotSeed: number,
): Promise<FlyerImageAsset> {
  const [photos, ornaments, patterns] = await Promise.all([
    getAssetsByKind("photo"),
    getAssetsByKind("ornament"),
    getAssetsByKind("pattern"),
  ]);

  const pick = (pool: FlyerImageAsset[]) =>
    pool[slotSeed % Math.max(1, pool.length)];

  // Image-prominent layouts → prefer photo (real emotion).
  if (layout === "split-image" || layout === "hero-ayat") {
    if (photos.length) return pick(photos);
    if (ornaments.length) return pick(ornaments);
    if (patterns.length) return pick(patterns);
  }
  // Bold/accent layouts → ornament adds nuance without competing with
  // the headline.
  if (layout === "hero-headline") {
    if (ornaments.length) return pick(ornaments);
    if (photos.length) return pick(photos);
    if (patterns.length) return pick(patterns);
  }
  // Quote card → soft pattern backdrop.
  if (patterns.length) return pick(patterns);
  if (ornaments.length) return pick(ornaments);
  if (photos.length) return pick(photos);

  // No assets at all — surface the failure rather than crash the render
  // pipeline downstream.
  throw new Error("flyer registry has no assets; upload at least one image");
}

function seedFrom(parts: (string | number)[]): number {
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function buildContent(ctx: FlyerContext): FlyerContent {
  const lang = ctx.locale;
  const brand = "dakwah-lens.id";
  const dateLabel = formatFlyerDate(ctx.generatedAt, lang);
  const rank = daleelRankForSlot(ctx.slot);
  const daleel = pickFlyerDaleel(ctx.daleelRefs, lang, rank);

  if (ctx.slot.kind === "general") {
    const headline =
      ctx.slot.variant === "a"
        ? extractKhutbahTagline(ctx.body)
        : extractCampaignTagline(ctx.body);
    const message =
      ctx.slot.variant === "a"
        ? extractKhutbahMessage(ctx.body)
        : extractAksiMessage(ctx.body);
    return {
      brand,
      dateLabel,
      headline: headline || extractKhutbahTagline(ctx.body) || "Pesan Pekan Ini",
      message: message || "",
      daleel,
    };
  }

  if (ctx.slot.kind === "genz") {
    const headline =
      ctx.slot.variant === "a"
        ? extractKreatorHook(ctx.body)
        : extractGenZTagline(ctx.body);
    const message =
      ctx.slot.variant === "a"
        ? extractKreatorMessage(ctx.body)
        : extractGenZMessage(ctx.body);
    return {
      brand,
      dateLabel,
      headline:
        headline || extractGenZTagline(ctx.body) || "Renungan Pekan Ini",
      message: message || "",
      daleel,
    };
  }

  // deliverable
  return {
    brand,
    dateLabel,
    headline: extractDeliverableHeadline(ctx.body, ctx.slot.deliverable) || "",
    message: extractDeliverableMessage(ctx.body, ctx.slot.deliverable) || "",
    daleel,
  };
}

function buildPalette(slot: FlyerSlot): FlyerPalette {
  // Gen-Z slots get the saturated violet/amber-coded palette regardless
  // of segment — playing with the THEME, never labeled "for Gen Z".
  if (slot.kind === "genz") {
    if (slot.variant === "a") {
      return {
        bgGradient: ["#ede9fe", "#fae8ff", "#fef3c7"],
        accent: "#a21caf",
        accentDeep: "#6b21a8",
        accentSoft: "#fae8ff",
        chipText: "#ffffff",
      };
    }
    return {
      bgGradient: ["#fef3c7", "#fbcfe8", "#ddd6fe"],
      accent: "#db2777",
      accentDeep: "#9d174d",
      accentSoft: "#fce7f3",
      chipText: "#ffffff",
    };
  }
  if (slot.kind === "deliverable") {
    const p = DELIVERABLE_PALETTE[slot.deliverable];
    return {
      bgGradient: [p.bgGradient[0], p.bgGradient[1]],
      accent: p.accent,
      accentDeep: p.accent,
      accentSoft: p.accentSoft,
      chipText: p.chipText,
    };
  }
  // General: lean on the brand emerald regardless of segment so the
  // flyer doesn't surface segment names visually.
  if (slot.variant === "a") {
    const p = SEGMENT_PALETTE.all;
    return {
      bgGradient: [p.bgGradient[0], p.bgGradient[1]],
      accent: p.accent,
      accentDeep: p.accent,
      accentSoft: p.accentSoft,
      chipText: p.chipText,
    };
  }
  // general-b → slate / warm cream so the two general flyers don't
  // look identical when shown side-by-side.
  return {
    bgGradient: ["#f8fafc", "#e2e8f0"],
    accent: "#0f172a",
    accentDeep: "#0f172a",
    accentSoft: "#cbd5e1",
    chipText: "#ffffff",
  };
}

export async function composeFlyer(ctx: FlyerContext): Promise<{
  layoutId: LayoutId;
  composition: FlyerComposition;
}> {
  const layoutId = layoutForSlot(ctx.slot);

  // Deterministic image seed per edition+slot.
  const seed = seedFrom([
    ctx.generatedAt.toISOString().slice(0, 10),
    ctx.slot.segment ?? "all",
    ctx.slot.kind,
    ctx.slot.kind === "general" || ctx.slot.kind === "genz"
      ? ctx.slot.variant
      : ctx.slot.deliverable,
  ]);

  const image = await pickImage(layoutId, seed);
  const content = buildContent(ctx);
  const palette = buildPalette(ctx.slot);

  // suppress unused symbol if segmentToSlug isn't otherwise referenced
  void segmentToSlug;

  return {
    layoutId,
    composition: {
      content,
      image,
      palette,
      locale: ctx.locale,
    },
  };
}
