import QRCode from "qrcode";

import type { DaleelRef } from "@/db/schema";
import { briefingSlug } from "@/lib/briefing-data";

/** Hostname used inside the poster's article link + QR. Production
 *  domain by default; can be overridden by `PUBLIC_SITE_URL` for
 *  staging / preview builds. The bare host (no scheme) is what we
 *  show as visible text on the poster — easier to read + type. */
const ARTICLE_HOST = (() => {
  const env = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return "dakwah-lens.id";
})();

/** Build the canonical short URL for the Mahasiswa article page that
 *  the poster's QR + visible text both point at. */
function buildArticleUrl(generatedAt: Date, segment: string | null): {
  href: string;
  display: string;
} {
  const slug = briefingSlug(generatedAt, segment);
  return {
    href: `https://${ARTICLE_HOST}/m/${slug}`,
    display: `${ARTICLE_HOST}/m/${slug}`,
  };
}

/** Render a QR code to a base64 data URL for inline embedding in the
 *  poster HTML. `M` error correction tier survives partial occlusion
 *  (e.g., a wrinkle on a printed bulletin board) and keeps the QR
 *  visually compact. White background + dark accent is the typical
 *  high-contrast pairing. */
async function buildArticleQrDataUrl(
  href: string,
  darkColor: string,
): Promise<string> {
  return QRCode.toDataURL(href, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 480,
    color: { dark: darkColor, light: "#ffffff" },
  });
}

import {
  extractAksiMessage,
  extractBenangMerah,
  extractCampaignTagline,
  extractDedicatedFlyerBlock,
  extractDedicatedFlyerMessage,
  extractDeliverableHeadline,
  extractDeliverableMessage,
  extractGenZMessage,
  extractGenZTagline,
  extractKhutbahMessage,
  extractKhutbahTagline,
  extractKreatorHook,
  extractKreatorMessage,
  extractPosterQuestion,
  findDaleelByCitation,
  parseInlineDua,
  stripInlineDua,
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

export type SunnahVariant = "a" | "b";

export type FlyerSlot =
  | { kind: "general"; variant: GeneralVariant; segment: string | null }
  | { kind: "genz"; variant: GenZVariant; segment: string | null }
  | { kind: "sunnah"; variant: SunnahVariant; segment: string | null }
  | { kind: "poster"; segment: string | null }
  | {
      kind: "deliverable";
      deliverable: DeliverableSlug;
      segment: string | null;
    };

/** Thrown by composeFlyer when a message-bearing slot (general / genz /
 *  sunnah) has no dedicated `## Pesan Flyer N` block in the briefing
 *  markdown. The legacy behavior was to fall back to extracting analyst
 *  prose from elsewhere in the briefing — that produced flyers like the
 *  2026-06-07 Toleransi/genz-b which surfaced platform-mix statistics
 *  ("Hanya 4 post YouTube...") with a Quran citation (QS. Ar-Rahmaan:
 *  9) pulled from the unfiltered daleel pool. Now: the caller (API
 *  route) catches this and returns 404 so the gallery omits the
 *  persona rather than render garbage. */
export class FlyerSlotMissingError extends Error {
  readonly slot: FlyerSlot;
  constructor(slot: FlyerSlot) {
    super(
      `Briefing has no dedicated Pesan Flyer block for slot ${JSON.stringify(slot)}`,
    );
    this.name = "FlyerSlotMissingError";
    this.slot = slot;
  }
}

/** Briefing-level context passed into composeFlyer. `daleelRefs` is the
 *  thematic pool (used by general / genz flyers); `adhkarRefs` is the
 *  separate du'a / dzikir pool (used by sunnah / dua flyers).
 *  `adhkarRefs` is optional / null for older briefings written before
 *  the 2026-05-23 adhkar split. */
export type FlyerContext = {
  generatedAt: Date;
  body: string;
  daleelRefs: DaleelRef[] | null;
  adhkarRefs?: DaleelRef[] | null;
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

/** Sunnah invitation (slot 5a) — warm amber / gold that feels like
 *  invitation and barakah. */
const SUNNAH_A_PALETTES: PalettePreset[] = [
  {
    name: "amber-gold",
    bgGradient: ["#fffbeb", "#fde68a", "#92400e"],
    accent: "#b45309",
    accentDeep: "#78350f",
    accentSoft: "#fcd34d",
    chipText: "#fffbeb",
  },
  {
    name: "rose-warm",
    bgGradient: ["#fff7ed", "#fed7aa", "#9a3412"],
    accent: "#c2410c",
    accentDeep: "#7c2d12",
    accentSoft: "#fdba74",
    chipText: "#fff7ed",
  },
  {
    name: "honey-cream",
    bgGradient: ["#fefce8", "#fef08a", "#854d0e"],
    accent: "#a16207",
    accentDeep: "#713f12",
    accentSoft: "#fde68a",
    chipText: "#fefce8",
  },
  {
    name: "soft-clay",
    bgGradient: ["#fef2f2", "#fecaca", "#991b1b"],
    accent: "#b91c1c",
    accentDeep: "#7f1d1d",
    accentSoft: "#fca5a5",
    chipText: "#fef2f2",
  },
];

/** Du'a hero (slot 5b) — deep emerald / teal so the Arabic feels
 *  sacred and contemplative. */
const SUNNAH_B_PALETTES: PalettePreset[] = [
  {
    name: "deep-emerald",
    bgGradient: ["#f0fdf4", "#bbf7d0", "#064e3b"],
    accent: "#047857",
    accentDeep: "#022c22",
    accentSoft: "#6ee7b7",
    chipText: "#f0fdf4",
  },
  {
    name: "midnight-teal",
    bgGradient: ["#f0fdfa", "#99f6e4", "#134e4a"],
    accent: "#0f766e",
    accentDeep: "#042f2e",
    accentSoft: "#5eead4",
    chipText: "#f0fdfa",
  },
  {
    name: "blue-night",
    bgGradient: ["#eff6ff", "#bfdbfe", "#1e3a8a"],
    accent: "#1d4ed8",
    accentDeep: "#172554",
    accentSoft: "#93c5fd",
    chipText: "#eff6ff",
  },
  {
    name: "deep-violet",
    bgGradient: ["#faf5ff", "#e9d5ff", "#581c87"],
    accent: "#7e22ce",
    accentDeep: "#3b0764",
    accentSoft: "#d8b4fe",
    chipText: "#faf5ff",
  },
];

/** Mahasiswa poster palette — academic-feeling navy/indigo so it reads
 *  as "campus material" rather than IG share. Rotates 4 sub-tones per
 *  edition. */
const POSTER_PALETTES: PalettePreset[] = [
  {
    name: "campus-navy",
    bgGradient: ["#e0e7ff", "#c7d2fe", "#312e81"],
    accent: "#312e81",
    accentDeep: "#1e1b4b",
    accentSoft: "#a5b4fc",
    chipText: "#e0e7ff",
  },
  {
    name: "campus-forest",
    bgGradient: ["#ecfdf5", "#a7f3d0", "#064e3b"],
    accent: "#065f46",
    accentDeep: "#022c22",
    accentSoft: "#6ee7b7",
    chipText: "#ecfdf5",
  },
  {
    name: "campus-rust",
    bgGradient: ["#fff7ed", "#fed7aa", "#7c2d12"],
    accent: "#9a3412",
    accentDeep: "#431407",
    accentSoft: "#fdba74",
    chipText: "#fff7ed",
  },
  {
    name: "campus-slate",
    bgGradient: ["#f1f5f9", "#cbd5e1", "#0f172a"],
    accent: "#1e293b",
    accentDeep: "#020617",
    accentSoft: "#94a3b8",
    chipText: "#f8fafc",
  },
];

function palettesFor(slot: FlyerSlot): PalettePreset[] {
  if (slot.kind === "general") {
    return slot.variant === "a" ? GENERAL_A_PALETTES : GENERAL_B_PALETTES;
  }
  if (slot.kind === "genz") {
    return slot.variant === "a" ? GENZ_A_PALETTES : GENZ_B_PALETTES;
  }
  if (slot.kind === "sunnah") {
    return slot.variant === "a" ? SUNNAH_A_PALETTES : SUNNAH_B_PALETTES;
  }
  if (slot.kind === "poster") {
    return POSTER_PALETTES;
  }
  // Per-deliverable: keep the original tone (matches the on-screen card).
  return [];
}

// ──────────────────────────────────────────────────────────────────
// Layout sub-variants — visual variety within the same slot.
// ──────────────────────────────────────────────────────────────────

/** Optional sub-variant index so each layout can vary its decorations
 *  without us adding many distinct layout files. The layout component
 *  reads this off the palette ctx and switches accent positions /
 *  shapes / structural compositions. Range is 0..3; layouts that only
 *  define 3 variants can switch on `variant % 3` internally. */
export type LayoutVariant = 0 | 1 | 2 | 3;

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
  if (slot.kind === "sunnah") {
    // Sunnah invitation (variant a) reads best in split-image (action
    // call + photo of sunnah practice + a small daleel card for the
    // hadith that establishes the practice).
    // Du'a hero (variant b) uses the dedicated DuaHero layout that
    // makes Arabic with full harakat the visual centerpiece — the
    // whole point of the card is for a reader to recite the du'a.
    return slot.variant === "a" ? "split-image" : "dua-hero";
  }
  if (slot.kind === "poster") {
    return "poster-question";
  }
  return "hero-ayat";
}

function daleelRankForSlot(slot: FlyerSlot): number {
  if (slot.kind === "general" && slot.variant === "a") return 0;
  if (slot.kind === "general" && slot.variant === "b") return 1;
  if (slot.kind === "genz" && slot.variant === "a") return 2;
  if (slot.kind === "genz" && slot.variant === "b") return 3;
  if (slot.kind === "sunnah" && slot.variant === "a") return 4;
  if (slot.kind === "sunnah" && slot.variant === "b") return 5;
  return 0;
}

/** Map a flyer slot to its Pesan Flyer index (0..5). */
function pesanFlyerSlotIndex(slot: FlyerSlot): FlyerMessageSlot | null {
  if (slot.kind === "general") return slot.variant === "a" ? 0 : 1;
  if (slot.kind === "genz") return slot.variant === "a" ? 2 : 3;
  if (slot.kind === "sunnah") return slot.variant === "a" ? 4 : 5;
  return null;
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
// Inline-du'a vs pool-entry validation
// ──────────────────────────────────────────────────────────────────
//
// BUG / RATIONALE:
//   parseInlineDua greedily extracts the longest Arabic run from the
//   Pesan Flyer block + the nearest quoted ID translation + the
//   block's `**Daleel:**` citation. That citation is the authoritative
//   pool entry (e.g. HR. Muslim 1162) — but the Arabic run it pairs
//   with comes from FREE PROSE in the briefing. If the LLM (or an
//   operator hand-edit) included an Arabic phrase that does NOT
//   actually appear in the retrieved adhkar pool entry — e.g. a
//   plausible-looking but synthesized invocation — we'd render
//   hallucinated Arabic under a valid citation. That violates PRD §12
//   (every Islamic reference must be RETRIEVED, never freely
//   generated).
//
// FIX:
//   When BOTH an inline du'a and a matching pool entry exist, verify
//   the inline Arabic is substantially derived from the pool Arabic
//   before trusting it. Otherwise fall back to the pool entry as-is
//   (long isnad and all — pool entries are guaranteed retrieved).
//   When there is no pool entry to compare against (rare — e.g. QS
//   citation that isn't in the adhkar pool), we still trust the
//   inline parse since the alternative is dropping the daleel card
//   entirely.
//
// MATCHING:
//   Normalize Arabic by stripping whitespace + harakat + special
//   marks (tatweel, etc.), then check whether the first ~30 chars of
//   the inline Arabic appear inside the normalized pool Arabic. A
//   30-char prefix is long enough to be a specific phrase (not a
//   common stem like "اللهم") and short enough to survive minor
//   pool-vs-prose punctuation drift.
function normalizeArabic(s: string): string {
  return s
    // Strip harakat / tashkeel + Quranic marks + tatweel.
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
    // Strip all whitespace (incl. NBSP, Arabic spaces).
    .replace(/\s+/g, "");
}

function isInlineFromPool(inline: string, pool: string): boolean {
  const nInline = normalizeArabic(inline);
  const nPool = normalizeArabic(pool);
  if (nInline.length < 10 || nPool.length < 10) return false;
  const prefix = nInline.slice(0, Math.min(30, nInline.length));
  return nPool.includes(prefix);
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

/**
 * Last-resort headline when neither the dedicated `**Headline:**` marker
 * nor the legacy tagline extractors produced one. Pulls a short punch
 * line from the opening clause of the message body — a specific fragment
 * is always better than a static "Renungan/Pesan Pekan Ini" (which the
 * synthesis prompt now explicitly bans). Returns null when the body is
 * too thin to yield anything meaningful, so the caller's static default
 * still applies.
 */
function deriveHeadlineFromBody(body: string, maxWords = 6): string | null {
  const firstSentence =
    (body || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  // First clause only — stop at the first comma / semicolon / dash so the
  // headline is a single crisp thought, not a run-on.
  const clause = firstSentence.split(/[,;:—-]/)[0]?.trim() ?? "";
  const words = clause.split(" ").filter(Boolean);
  if (words.length < 2) return null;
  const picked = words
    .slice(0, maxWords)
    .join(" ")
    // Don't let the headline dangle on a conjunction/preposition.
    .replace(/\s+(dan|atau|yang|untuk|dari|ke|di|pada|serta|agar)$/i, "")
    .trim();
  return picked.length >= 3 ? picked : null;
}

async function buildContent(ctx: FlyerContext): Promise<FlyerContent> {
  const lang = ctx.locale;
  const brand = "dakwah-lens.id";
  const dateLabel = formatFlyerDate(ctx.generatedAt, lang);
  const rank = daleelRankForSlot(ctx.slot);

  // Try the dedicated `## Pesan Flyer` block first — when present (post
  // 2026-05-23 briefings), it carries an explicit headline + daleel
  // citation tailored to the message. Falls back to the legacy
  // tagline extractors when those markers are missing.
  const pesanSlot = pesanFlyerSlotIndex(ctx.slot);
  const dedicatedBlock =
    pesanSlot !== null ? extractDedicatedFlyerBlock(ctx.body, pesanSlot) : null;
  // Strict mode (2026-06-09): for message-bearing slots (general / genz
  // / sunnah), refuse to fall back to analysis-section prose when the
  // dedicated block is absent. The fallback path was responsible for
  // the 2026-06-07 Toleransi/genz-b incident where the renderer pulled
  // platform-mix analyst notes + a Quran citation into a flyer image.
  // The API route catches this and returns 404 so the gallery omits
  // the persona rather than show a manufactured flyer. Poster and
  // deliverable slots are unaffected (they don't use pesanFlyerSlot).
  if (pesanSlot !== null && !dedicatedBlock) {
    throw new FlyerSlotMissingError(ctx.slot);
  }
  // Find the dalil the briefing pinned to this slot. Try daleelRefs
  // first (the primary thematic pool), then fall back to adhkarRefs
  // (the separate du'a / dzikir pool). The fallback fixes the 2026-
  // 06-09 Teknologi/genz-a incident: the slot 3 dalil "Sahih al-Bukhari
  // 6377" (fitnah Dajjal) lives in adhkarRefs, not daleelRefs — the
  // validator accepts either pool, but this renderer used to only
  // search daleelRefs, so the lookup failed and silently fell back
  // to pickFlyerDaleel(rank), which returned the wrong hadith (Bulugh
  // 1596) for a body that explicitly framed deepfake = mini-Dajjal.
  const dedicatedDaleel =
    findDaleelByCitation(ctx.daleelRefs, dedicatedBlock?.daleelCitation) ??
    findDaleelByCitation(ctx.adhkarRefs ?? null, dedicatedBlock?.daleelCitation);
  const daleel = dedicatedDaleel ?? pickFlyerDaleel(ctx.daleelRefs, lang, rank);

  if (ctx.slot.kind === "general") {
    const fallbackHeadline =
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
        dedicatedBlock?.headline ||
        fallbackHeadline ||
        deriveHeadlineFromBody(message || ctx.body) ||
        "Pesan Pekan Ini",
      message: message || "",
      daleel,
    };
  }

  if (ctx.slot.kind === "genz") {
    const fallbackHeadline =
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
        dedicatedBlock?.headline ||
        fallbackHeadline ||
        deriveHeadlineFromBody(message || ctx.body) ||
        "Renungan Pekan Ini",
      message: message || "",
      daleel,
    };
  }

  if (ctx.slot.kind === "sunnah") {
    // Sunnah invitation (variant a) + Du'a hero (variant b).
    //
    // The Pesan Flyer 5 / 6 paragraphs carry the relevant du'a +
    // citation INLINE — that's the whole point of these flyers.
    //
    // Strategy (in priority order — UPDATED 2026-05-28):
    //   1. parseInlineDua — when the LLM (or operator) wrote the clean
    //      du'a portion inline in the Pesan Flyer block, USE THAT.
    //      Adhkar pool entries are often hadits panjang dengan isnad
    //      (600-800 char). Rendering the whole hadits on a 1080×1080
    //      flyer drowns the recitable du'a in narration. The LLM is
    //      instructed (prompt: "ATURAN JENIS KONTEN") to extract only
    //      the actual `الله ُمَّ ...` invocation portion and write it
    //      inline — that's the recitable du'a we want to render.
    //   2. The briefing's `adhkarRefs` pool — fallback when inline
    //      parsing fails (no Arabic in block, or no Indonesian quote).
    //      Citation still refers to a hadits in the pool; pool entry
    //      shows up as-is (long isnad and all). Last resort.
    //   3. null — for variant a (Sunnah call) we explicitly skip the
    //      daleel card so the inline short du'a in the message
    //      paragraph stays the only du'a reference.
    //   - The briefing's THEMATIC `daleelRefs` is never used for
    //     these slots — those are argumentative, not recitable.
    const adhkarPoolDaleel = findDaleelByCitation(
      ctx.adhkarRefs ?? null,
      dedicatedBlock?.daleelCitation,
    );
    const inlineDua = dedicatedBlock ? parseInlineDua(dedicatedBlock) : null;
    // Guard against hallucinated inline Arabic — see isInlineFromPool
    // comment block above. When both inline + pool exist, the inline
    // Arabic must be substantially derived from the pool entry; if
    // not, drop the inline parse and render the pool entry directly.
    // When there is no pool entry to compare against (rare), trust
    // the inline parse — dropping it would leave the slot without a
    // daleel card, which is worse than rendering an inline that the
    // operator authored manually.
    const validatedInline =
      inlineDua && adhkarPoolDaleel?.arabic
        ? isInlineFromPool(inlineDua.arabic, adhkarPoolDaleel.arabic)
          ? inlineDua
          : null
        : inlineDua;
    const fallbackMessage = extractBenangMerah(ctx.body);
    const rawMessage =
      (dedicatedBlock && ctx.slot.variant === "b"
        ? stripInlineDua(dedicatedBlock)
        : dedicatedBlock?.body) ||
      fallbackMessage ||
      "";
    // BOTH variants surface a daleel card now — Sunnah call (variant a)
    // needs the hadith that ESTABLISHES the practice (e.g. HR. Muslim
    // 1162 for puasa Arafah, HR. Bukhari 969 for the 10 days of
    // Dzulhijjah). Earlier we hid the card on variant a; that left a
    // ritual sunnah call without its evidence, which doesn't fly per
    // PRD §12 (every Islamic reference must be retrieved + cited).
    const resolvedDaleel = validatedInline ?? adhkarPoolDaleel;
    return {
      brand,
      dateLabel,
      headline:
        dedicatedBlock?.headline ||
        (ctx.slot.variant === "a"
          ? "Ajakan Sunnah Pekan Ini"
          : "Doa Pekan Ini"),
      message: rawMessage,
      daleel: resolvedDaleel,
    };
  }

  if (ctx.slot.kind === "poster") {
    // The Mahasiswa bulletin-board poster: question + URL + QR to the
    // article page. The poster intentionally CANNOT carry the full
    // article (too long for bulletin-board print real estate), so the
    // question hooks attention and the URL/QR pair carries readers to
    // the dedicated article page at `/m/{slug}` where the full prose +
    // Q&A live in a colorful magazine layout.
    const question = extractPosterQuestion(ctx.body);
    const { href, display } = buildArticleUrl(
      ctx.generatedAt,
      ctx.slot.segment,
    );
    const qrDataUrl = await buildArticleQrDataUrl(href, "#0f172a");
    return {
      brand,
      dateLabel,
      headline:
        question ||
        "Pertanyaan Mahasiswa untuk Pekan Ini",
      message: "",
      daleel: null,
      articleUrl: display,
      articleQrDataUrl: qrDataUrl,
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
    ctx.slot.kind === "general" ||
    ctx.slot.kind === "genz" ||
    ctx.slot.kind === "sunnah"
      ? ctx.slot.variant
      : ctx.slot.kind === "deliverable"
        ? ctx.slot.deliverable
        : "poster";

  const seed = seedFrom([
    ctx.generatedAt.toISOString().slice(0, 10),
    ctx.slot.segment ?? "all",
    ctx.slot.kind,
    slotKey,
  ]);

  const image = await pickImage(seed);
  const content = await buildContent(ctx);
  const palette = buildPalette(ctx.slot, seed);
  // Distinct seeds for layout variant so decorations rotate
  // independently of palette + photo (more visual variety). The
  // PosterQuestion layout defines 4 truly distinct top-level
  // compositions (side photo / top photo banner / pure typography /
  // photo backdrop) — give it the wider rotation. All other layouts
  // still cap at 3 variants and can mod themselves.
  const variantMod = ctx.slot.kind === "poster" ? 4 : 3;
  const layoutVariant = ((seed >>> 8) % variantMod) as LayoutVariant;

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
