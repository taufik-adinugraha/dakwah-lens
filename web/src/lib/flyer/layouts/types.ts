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
  /** Eyebrow chip text — segment label, "Buat Kamu Gen Z", etc. */
  eyebrow: string;
  /** The visual focal text — extracted from Section 1 (general) or
   *  the Gen Z hook (genz slot). */
  headline: string;
  /** The cited daleel — may be null if retrieval returned nothing. */
  daleel: DaleelRef | null;
  /** Optional CTA line at the bottom — used by Gen-Z slot only. */
  cta?: string;
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
};

/** Every layout component conforms to this shape. */
export type FlyerLayoutComponent = (
  props: FlyerRenderProps,
) => React.JSX.Element;
