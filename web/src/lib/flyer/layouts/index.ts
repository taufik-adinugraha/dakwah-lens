import { HeroAyat } from "./HeroAyat";
import { HeroHeadline } from "./HeroHeadline";
import { SplitImage } from "./SplitImage";
import { QuoteCard } from "./QuoteCard";
import type { FlyerLayoutComponent } from "./types";

export type LayoutId = "hero-ayat" | "hero-headline" | "split-image" | "quote-card";

export const LAYOUTS: Record<LayoutId, FlyerLayoutComponent> = {
  "hero-ayat": HeroAyat,
  "hero-headline": HeroHeadline,
  "split-image": SplitImage,
  "quote-card": QuoteCard,
};

export const LAYOUT_IDS: LayoutId[] = [
  "hero-ayat",
  "hero-headline",
  "split-image",
  "quote-card",
];

export type { FlyerLayoutComponent };
export type {
  FlyerComposition,
  FlyerContent,
  FlyerPalette,
  FlyerLocale,
  FlyerRenderProps,
  ResolvedAssets,
} from "./types";
