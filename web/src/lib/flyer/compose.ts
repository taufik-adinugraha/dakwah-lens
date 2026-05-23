import type { DaleelRef } from "@/db/schema";

import {
  extractAksiMessage,
  extractBenangMerah,
  extractCampaignTagline,
  extractDedicatedFlyerMessage,
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
  type FlyerMessageSlot,
} from "./content";
import {
  DELIVERABLE_PALETTE,
  type DeliverableSlug,
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
 * Four variants per briefing, two general + two Gen-Z themed. Each
 * variant uses a fixed base layout, but the palette + image + sub-
 * variant are rotated weekly so the same slot doesn't look identical
 * edition-to-edition.
 *
 * Content rules:
 *   - Headline = 4-5 word tagline per variant.
 *   - Message  = 3-4 wholistic sentences. Default = the "Benang merah"
 *     synthesis from Section 3 (works for every briefing because it's
 *     standalone — no reference to khutbah/kajian/diskusi format).
 *     Some variants enrich with their variant-specific source if the
 *     extractor returns clean, format-free text.
 *   - Daleel   = translation + citation only. NO Arabic on the flyer
 *     (the daleel pool's Arabic is preserved at retrieval level for
 *     other features but trimmed out of the flyer surface).
 *   - Image    = always a photo. The 200+ photo pool gives enough
 *     variety; ornament fallback is only used if the photo pool
 *     somehow runs empty.
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

// ──────────────────────────────────────────────────────────────────
// Palette rotation — 4 options per slot, seeded by edition+variant.
// Tones picked so the four flyers stay visually distinct from each
// other AND from previous weeks' flyers.
// ──────────────────────────────────────────────────────────────────

type PalettePreset = {
  bgGradient: [string, string, string?];
  accent: string;
  accentDeep: string;
  accentSoft: string;
  chipText: string;
  /** A nickname; helps debugging when you want to know which palette
   *  fired for a given edition. */
  name: string;
};

const GENERAL_A_PALETTES: PalettePreset[] = [
  {
    name: "emerald",
    bgGradient: ["#ecfdf5", "#d1fae5"],
    accent: "#047857",
    accentDeep: "#064e3b",
    accentSoft: "#a7f3d0",
    chipText: "#ecfdf5",
  },
  {
    name: "indigo",
    bgGradient: ["#eef2ff", "#e0e7ff"],
    accent: "#4338ca",
    accentDeep: "#312e81",
    accentSoft: "#c7d2fe",
    chipText: "#eef2ff",
  },
  {
    name: "teal",
    bgGradient: ["#f0fdfa", "#ccfbf1"],
    accent: "#0f766e",
    accentDeep: "#134e4a",
    accentSoft: "#99f6e4",
    chipText: "#f0fdfa",
  },
  {
    name: "amber",
    bgGradient: ["#fefce8", "#fef3c7"],
    accent: "#a16207",
    accentDeep: "#713f12",
    accentSoft: "#fde68a",
    chipText: "#fefce8",
  },
];

const GENERAL_B_PALETTES: PalettePreset[] = [
  {
    name: "slate",
    bgGradient: ["#f8fafc", "#e2e8f0"],
    accent: "#0f172a",
    accentDeep: "#020617",
    accentSoft: "#cbd5e1",
    chipText: "#ffffff",
  },
  {
    name: "burgundy",
    bgGradient: ["#fff1f2", "#ffe4e6"],
    accent: "#9f1239",
    accentDeep: "#4c0519",
    accentSoft: "#fecdd3",
    chipText: "#fff1f2",
  },
  {
    name: "forest",
    bgGradient: ["#f0fdf4", "#dcfce7"],
    accent: "#15803d",
    accentDeep: "#14532d",
    accentSoft: "#bbf7d0",
    chipText: "#f0fdf4",
  },
  {
    name: "navy",
    bgGradient: ["#eff6ff", "#dbeafe"],
    accent: "#1e40af",
    accentDeep: "#172554",
    accentSoft: "#bfdbfe",
    chipText: "#eff6ff",
  },
];

const GENZ_A_PALETTES: PalettePreset[] = [
  {
    name: "violet-yellow",
    bgGradient: ["#ede9fe", "#fae8ff", "#fef3c7"],
    accent: "#a21caf",
    accentDeep: "#581c87",
    accentSoft: "#fae8ff",
    chipText: "#ffffff",
  },
  {
    name: "magenta-cyan",
    bgGradient: ["#fdf2f8", "#fce7f3", "#cffafe"],
    accent: "#be185d",
    accentDeep: "#831843",
    accentSoft: "#fce7f3",
    chipText: "#ffffff",
  },
  {
    name: "orange-purple",
    bgGradient: ["#fff7ed", "#ffedd5", "#ede9fe"],
    accent: "#ea580c",
    accentDeep: "#7c2d12",
    accentSoft: "#fed7aa",
    chipText: "#fff7ed",
  },
  {
    name: "electric-lime",
    bgGradient: ["#eff6ff", "#dbeafe", "#ecfccb"],
    accent: "#1d4ed8",
    accentDeep: "#1e3a8a",
    accentSoft: "#bfdbfe",
    chipText: "#eff6ff",
  },
];

const GENZ_B_PALETTES: PalettePreset[] = [
  {
    name: "pink-coral",
    bgGradient: ["#fef3c7", "#fbcfe8", "#ddd6fe"],
    accent: "#db2777",
    accentDeep: "#831843",
    accentSoft: "#fce7f3",
    chipText: "#ffffff",
  },
  {
    name: "coral-yellow",
    bgGradient: ["#fff7ed", "#ffe4e6", "#fef9c3"],
    accent: "#dc2626",
    accentDeep: "#7f1d1d",
    accentSoft: "#fed7aa",
    chipText: "#fff7ed",
  },
  {
    name: "purple-mint",
    bgGradient: ["#f5f3ff", "#ede9fe", "#d1fae5"],
    accent: "#7c3aed",
    accentDeep: "#4c1d95",
    accentSoft: "#ddd6fe",
    chipText: "#f5f3ff",
  },
  {
    name: "forest-lime",
    bgGradient: ["#f0fdf4", "#ecfccb", "#fef3c7"],
    accent: "#166534",
    accentDeep: "#14532d",
    accentSoft: "#bbf7d0",
    chipText: "#f0fdf4",
  },
];

function palettesFor(slot: FlyerSlot): PalettePreset[] {
  if (slot.kind === "general") {
    return slot.variant === "a" ? GENERAL_A_PALETTES : GENERAL_B_PALETTES;
  }
  if (slot.kind === "genz") {
    return slot.variant === "a" ? GENZ_A_PALETTES : GENZ_B_PALETTES;
  }
  // Per-deliverable: keep the original tone (matches the on-screen card).
  return [];
}

// ──────────────────────────────────────────────────────────────────
// Layout sub-variants — visual variety within the same slot.
// ──────────────────────────────────────────────────────────────────

/** Optional sub-variant index (0-2) so each layout can vary its
 *  decorations without us adding 12 distinct layout files. The layout
 *  component reads this off the palette ctx and switches accent
 *  positions / shapes. */
export type LayoutVariant = 0 | 1 | 2;

// ──────────────────────────────────────────────────────────────────

/** Each slot gets a fixed base layout so the four-card grid in the
 *  UI always carries visual variety. Sub-variants (accent positions
 *  etc.) are rotated separately via the layoutVariant index. */
function layoutForSlot(slot: FlyerSlot): LayoutId {
  if (slot.kind === "general") {
    return slot.variant === "a" ? "hero-ayat" : "split-image";
  }
  if (slot.kind === "genz") {
    return slot.variant === "a" ? "hero-headline" : "quote-card";
  }
  return "hero-ayat";
}

function daleelRankForSlot(slot: FlyerSlot): number {
  if (slot.kind === "general" && slot.variant === "a") return 0;
  if (slot.kind === "general" && slot.variant === "b") return 1;
  if (slot.kind === "genz" && slot.variant === "a") return 2;
  if (slot.kind === "genz" && slot.variant === "b") return 3;
  return 0;
}

/** Pick an image for the chosen slot. ALWAYS prefers a photo across
 *  every slot (including Gen-Z) — the 200+ photo pool gives plenty of
 *  variety, and earlier ornament-corner styling looked thin. Ornament
 *  is only the last-ditch fallback if the photo pool is empty. */
async function pickImage(slotSeed: number): Promise<FlyerImageAsset> {
  const photos = await getAssetsByKind("photo");
  const pick = (pool: FlyerImageAsset[]) =>
    pool[slotSeed % Math.max(1, pool.length)];
  if (photos.length) return pick(photos);
  const ornaments = await getAssetsByKind("ornament");
  if (ornaments.length) return pick(ornaments);
  const patterns = await getAssetsByKind("pattern");
  if (patterns.length) return pick(patterns);
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

// ──────────────────────────────────────────────────────────────────
// Message routing — wholistic-first, with variant-specific enrichment.
// ──────────────────────────────────────────────────────────────────

/** Wrap a per-variant fallback in the dedicated-section lookup. New
 *  briefings (those written after the 2026-05-23 prompt update) carry
 *  a `## Pesan Flyer` block with 4 standalone paragraphs already
 *  scrubbed of khutbah/diskusi references; we prefer those when
 *  present. Older briefings fall through to the deliverable extractors
 *  + benang merah filter. */
function preferDedicated(body: string, slot: FlyerMessageSlot, fallback: () => string): string {
  const dedicated = extractDedicatedFlyerMessage(body, slot);
  if (dedicated.length > 80) return dedicated;
  return fallback();
}

function messageForGeneralA(body: string): string {
  return preferDedicated(body, 0, () => {
    const khutbah = extractKhutbahMessage(body);
    if (khutbah.length > 80) return khutbah;
    return extractBenangMerah(body);
  });
}

function messageForGeneralB(body: string): string {
  return preferDedicated(body, 1, () => {
    const aksi = extractAksiMessage(body);
    if (aksi.length > 80) return aksi;
    return extractBenangMerah(body);
  });
}

function messageForGenZA(body: string): string {
  return preferDedicated(body, 2, () => {
    const kreator = extractKreatorMessage(body);
    if (kreator.length > 80) return kreator;
    return extractBenangMerah(body);
  });
}

function messageForGenZB(body: string): string {
  return preferDedicated(body, 3, () => {
    const benang = extractBenangMerah(body);
    if (benang.length > 80) return benang;
    return extractGenZMessage(body);
  });
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
        ? messageForGeneralA(ctx.body)
        : messageForGeneralB(ctx.body);
    return {
      brand,
      dateLabel,
      headline:
        headline ||
        extractKhutbahTagline(ctx.body) ||
        "Pesan Pekan Ini",
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
        ? messageForGenZA(ctx.body)
        : messageForGenZB(ctx.body);
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

function buildPalette(slot: FlyerSlot, seed: number): FlyerPalette {
  const presets = palettesFor(slot);
  if (presets.length > 0) {
    const p = presets[seed % presets.length];
    return {
      bgGradient: p.bgGradient,
      accent: p.accent,
      accentDeep: p.accentDeep,
      accentSoft: p.accentSoft,
      chipText: p.chipText,
    };
  }
  // Per-deliverable slot: pull tone from DELIVERABLE_PALETTE so flyer
  // matches the on-screen card the user clicked.
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
  // Unreachable in practice — preset arrays cover general + genz.
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
  /** 0..2 — read by layout components to switch decoration patterns. */
  layoutVariant: LayoutVariant;
}> {
  const layoutId = layoutForSlot(ctx.slot);
  const slotKey =
    ctx.slot.kind === "general" || ctx.slot.kind === "genz"
      ? ctx.slot.variant
      : ctx.slot.deliverable;

  const seed = seedFrom([
    ctx.generatedAt.toISOString().slice(0, 10),
    ctx.slot.segment ?? "all",
    ctx.slot.kind,
    slotKey,
  ]);

  const image = await pickImage(seed);
  const content = buildContent(ctx);
  const palette = buildPalette(ctx.slot, seed);
  // Distinct seeds for layout variant so decorations rotate
  // independently of palette + photo (more visual variety).
  const layoutVariant = ((seed >>> 8) % 3) as LayoutVariant;

  return {
    layoutId,
    layoutVariant,
    composition: {
      content,
      image,
      palette,
      locale: ctx.locale,
    },
  };
}
