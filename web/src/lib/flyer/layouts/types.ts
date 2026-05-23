import type { DaleelRef } from "@/db/schema";
import type { FlyerImageAsset } from "../images/registry";

/**
 * Everything a layout needs to render — content (from the briefing),
 * a visual asset (from the image registry), and a palette (from the
 * compose() decision). One shape, used by all 4 layouts.
 */

export type FlyerLocale = "id" | "en";

export type FlyerContent = {
  /** Brand mark, always shown — "dakwah-lens.id". */
  brand: string;
  /** Short formatted date for the footer ("23 Mei 2026"). */
  dateLabel: string;
  /** The visual focal text — a 4-5 word impactful tagline extracted
   *  from the briefing (Khutbah tema / Aksi campaign / Kreator hook). */
  headline: string;
  /** A 3-4 sentence concise actionable message (problem → what we can
   *  do → small first step). Not stats narration. */
  message: string;
  /** The cited daleel — may be null if retrieval returned nothing. */
  daleel: DaleelRef | null;
};

export type FlyerPalette = {
  /** Two-stop diagonal background gradient. */
  bgGradient: [string, string, string?];
  /** Primary accent — chip background, headline color, accents. */
  accent: string;
  /** Darker variant for headings on light backgrounds. */
  accentDeep: string;
  /** Soft tint — used for callout cards. */
  accentSoft: string;
  /** Chip text color (high contrast on `accent`). */
  chipText: string;
};

export type FlyerComposition = {
  content: FlyerContent;
  image: FlyerImageAsset;
  palette: FlyerPalette;
  locale: FlyerLocale;
};

/** Pre-resolved data URLs for every asset the layout may reference.
 *  Pre-resolved because Puppeteer's `setContent` has no base URL, so
 *  relative paths to /flyer-assets/... would 404 at render time. */
export type ResolvedAssets = {
  /** The composition.image, already converted to a data URL. */
  primary: string;
  /** Shared decorative SVGs. Each layout uses a subset. */
  starsRow: string;
  dotsPattern: string;
  arabesque: string;
  arch: string;
  star8: string;
  lantern: string;
  calligraphyFrame: string;
};

export type FlyerRenderProps = FlyerComposition & {
  assets: ResolvedAssets;
  /** 0-3 — drives decoration variation within a single layout so
   *  successive editions don't look identical. Most layouts only
   *  consume 0..2; PosterQuestion uses all 4. compose.ts caps the
   *  rotation modulo the layout's own count via the `variantMod`
   *  branch. */
  layoutVariant: 0 | 1 | 2 | 3;
};

/** Every layout component conforms to this shape. */
export type FlyerLayoutComponent = (
  props: FlyerRenderProps,
) => React.JSX.Element;
