import type { DaleelRef } from "@/db/schema";

import {
  extractGenZHook,
  extractHeadline,
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
import { LAYOUT_IDS, type LayoutId } from "./layouts";
import type {
  FlyerComposition,
  FlyerContent,
  FlyerLocale,
  FlyerPalette,
} from "./layouts/types";

/**
 * Pick a layout + image + palette for a given briefing slot.
 *
 * "Rotating" mode: seed = generated_at + segment + kind. Same edition +
 * slot always produces the same flyer (so share-URLs are stable), but
 * different editions of the same slot get different looks over time.
 *
 * The rotation across editions matters more than the rotation within
 * an edition — readers see one flyer per slot per week, so variety
 * across weeks is what keeps the feed feeling fresh.
 */

export type FlyerSlot =
  | { kind: "general"; segment: string | null }
  | { kind: "genz"; segment: string | null }
  | { kind: "deliverable"; deliverable: DeliverableSlug; segment: string | null };

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

/** djb2 hash → 32-bit unsigned int. Used as a deterministic seed. */
function seedFrom(parts: (string | number)[]): number {
  let h = 5381;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function pickIndex(seed: number, length: number): number {
  return seed % Math.max(1, length);
}

/** Pick which layout fits this slot+seed. The Gen-Z slot is biased
 *  toward headline-driven layouts; the general slot toward ayat-led. */
function pickLayout(slot: FlyerSlot, seed: number): LayoutId {
  if (slot.kind === "genz") {
    // Bold layouts only — never ayat-led for Gen Z.
    const opts: LayoutId[] = ["hero-headline", "split-image"];
    return opts[pickIndex(seed, opts.length)];
  }
  // General + per-deliverable: rotate through all 4 layouts.
  return LAYOUT_IDS[pickIndex(seed, LAYOUT_IDS.length)];
}

/** Pick an image based on the chosen layout's needs. Reads candidate
 *  pool from the DB-backed registry (cached 60s). If the pool for the
 *  preferred kind is empty (e.g. admin deleted everything), this still
 *  throws — caller should guarantee at least one asset per kind exists
 *  or short-circuit before composing. */
async function pickImage(
  layout: LayoutId,
  seed: number,
): Promise<FlyerImageAsset> {
  if (layout === "split-image") {
    const photos = await getAssetsByKind("photo");
    if (photos.length) return photos[pickIndex(seed, photos.length)];
    // Photo pool empty → fall through to ornament so render doesn't crash.
    const ornaments = await getAssetsByKind("ornament");
    return ornaments[pickIndex(seed, ornaments.length)];
  }
  if (layout === "quote-card") {
    const patterns = await getAssetsByKind("pattern");
    if (patterns.length) return patterns[pickIndex(seed, patterns.length)];
    const ornaments = await getAssetsByKind("ornament");
    return ornaments[pickIndex(seed, ornaments.length)];
  }
  if (layout === "hero-headline") {
    const ornaments = await getAssetsByKind("ornament");
    return ornaments[pickIndex(seed, ornaments.length)];
  }
  // hero-ayat: rotate photos + ornaments — photo gives a contemplative
  // backdrop, ornament gives a classic engraved-page feel.
  const [photos, ornaments] = await Promise.all([
    getAssetsByKind("photo"),
    getAssetsByKind("ornament"),
  ]);
  const pool = [...photos, ...ornaments];
  return pool[pickIndex(seed, pool.length)];
}

function buildContent(ctx: FlyerContext): FlyerContent {
  const lang = ctx.locale;
  const brand = "dakwah-lens.id";
  const dateLabel = formatFlyerDate(ctx.generatedAt, lang);

  if (ctx.slot.kind === "genz") {
    return {
      brand,
      dateLabel,
      eyebrow: lang === "en" ? "Made for Gen Z" : "Buat Kamu, Gen Z",
      headline: extractGenZHook(ctx.body),
      daleel: pickFlyerDaleel(ctx.daleelRefs, lang, 1),
      cta: lang === "en" ? "Want to talk about this?" : "Mau ngobrol soal ini?",
    };
  }

  if (ctx.slot.kind === "deliverable") {
    const palette = DELIVERABLE_PALETTE[ctx.slot.deliverable];
    return {
      brand,
      dateLabel,
      eyebrow: palette.label[lang],
      headline: extractHeadline(ctx.body),
      daleel: pickFlyerDaleel(ctx.daleelRefs, lang, 0),
    };
  }

  // general
  const segPalette = SEGMENT_PALETTE[segmentToSlug(ctx.slot.segment)];
  return {
    brand,
    dateLabel,
    eyebrow: segPalette.label[lang],
    headline: extractHeadline(ctx.body),
    daleel: pickFlyerDaleel(ctx.daleelRefs, lang, 0),
  };
}

function buildPalette(slot: FlyerSlot): FlyerPalette {
  if (slot.kind === "genz") {
    return {
      bgGradient: ["#ede9fe", "#fae8ff", "#fef3c7"],
      accent: "#a21caf",
      accentDeep: "#6b21a8",
      accentSoft: "#fae8ff",
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
  const p = SEGMENT_PALETTE[segmentToSlug(slot.segment)];
  return {
    bgGradient: [p.bgGradient[0], p.bgGradient[1]],
    accent: p.accent,
    accentDeep: p.accent,
    accentSoft: p.accentSoft,
    chipText: p.chipText,
  };
}

export async function composeFlyer(ctx: FlyerContext): Promise<{
  layoutId: LayoutId;
  composition: FlyerComposition;
}> {
  // Seed: WIB date + segment + kind. Same edition + slot → same flyer;
  // next edition → new dice roll.
  const seed = seedFrom([
    ctx.generatedAt.toISOString().slice(0, 10),
    ctx.slot.segment ?? "all",
    ctx.slot.kind,
    ctx.slot.kind === "deliverable" ? ctx.slot.deliverable : "",
  ]);

  const layoutId = pickLayout(ctx.slot, seed);
  // Use a slightly-shifted seed for image so layout + image picks vary
  // independently — otherwise they always advance together.
  const image = await pickImage(layoutId, seed ^ 0x9e3779b9);
  const content = buildContent(ctx);
  const palette = buildPalette(ctx.slot);

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
