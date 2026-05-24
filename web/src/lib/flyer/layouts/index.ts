import { DuaHero } from "./DuaHero";
import { HeroAyat } from "./HeroAyat";
import { HeroHeadline } from "./HeroHeadline";
import { PosterQuestion } from "./PosterQuestion";
import { PosterQuestionA4 } from "./PosterQuestionA4";
import { SplitImage } from "./SplitImage";
import { QuoteCard } from "./QuoteCard";
import type { FlyerLayoutComponent } from "./types";

export type LayoutId =
  | "hero-ayat"
  | "hero-headline"
  | "split-image"
  | "quote-card"
  | "poster-question"
  | "poster-question-a4"
  | "dua-hero";

export const LAYOUTS: Record<LayoutId, FlyerLayoutComponent> = {
  "hero-ayat": HeroAyat,
  "hero-headline": HeroHeadline,
  "split-image": SplitImage,
  "quote-card": QuoteCard,
  "poster-question": PosterQuestion,
  "poster-question-a4": PosterQuestionA4,
  "dua-hero": DuaHero,
};

export const LAYOUT_IDS: LayoutId[] = [
  "hero-ayat",
  "hero-headline",
  "split-image",
  "quote-card",
  "poster-question",
  "poster-question-a4",
  "dua-hero",
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
