import { pickDaleelTranslation } from "../content";
import { Citation, QuoteGlyph } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * QuoteCard — full-bleed photo background + floating quote card (genz-b
 * slot, Gen Z dakwah).
 *
 * Photo fills the entire 1080×1080 canvas; content (headline + message +
 * daleel quote card) sits on top of a dark gradient that keeps text
 * legible. Three direction variants share the same full-bg image:
 *
 *   - variant 0: bottom-up dark gradient, content bottom-anchored
 *   - variant 1: top-down dark gradient, content top-anchored
 *   - variant 2: diagonal gradient (top-left → bottom-right), centered
 *
 * Earlier iteration rotated between three distinct compositions
 * (dark-tinted full backdrop / photo top-banner / polaroid card on
 * pattern bg). Switched to a unified full-bleed photo on 2026-06-10 per
 * user feedback: "make the image full and overlayed". Git history
 * preserves the polaroid / top-banner variants if a future rotation
 * needs them.
 */
export const QuoteCard: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
  layoutVariant,
}) => {
  const { daleel, headline, message, dateLabel, brand } = content;
  const translation = pickDaleelTranslation(daleel, locale, {
    keywords: [headline, message].filter(Boolean) as string[],
  });
  const transLen = translation.length;
  // Tiered to match the full-bleed photo backdrop (2026-06-10): bumped
  // from 26/22/19/17/15 → 32/28/24/21/18. The opaque white quote card
  // sits on a busy photo + dark overlay, so the translation needs to
  // read as a confident statement; a 26px italic was getting visually
  // shrunk by the surrounding contrast. Floor stays above autofit's
  // data-fit-min=14 so we don't slip below readable.
  const transSize =
    transLen < 220
      ? 32
      : transLen < 320
        ? 28
        : transLen < 480
          ? 24
          : transLen < 620
            ? 21
            : 18;

  const headlineSize =
    headline.length < 18 ? "92px" : headline.length < 28 ? "76px" : "60px";

  const dark = palette.accentDeep;

  const overlayStyle = (() => {
    if (layoutVariant === 1) {
      return {
        background: `linear-gradient(180deg, ${dark}f2 0%, ${dark}cc 35%, ${dark}66 65%, ${dark}10 100%)`,
      };
    }
    if (layoutVariant === 2) {
      return {
        background: `linear-gradient(135deg, ${dark}f0 0%, ${dark}b8 45%, ${dark}55 85%, ${dark}10 100%)`,
      };
    }
    return {
      background: `linear-gradient(0deg, ${dark}f2 0%, ${dark}cc 35%, ${dark}66 65%, ${dark}10 100%)`,
    };
  })();

  const contentJustify =
    layoutVariant === 1
      ? "justify-start"
      : layoutVariant === 2
        ? "justify-center"
        : "justify-end";

  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden">
      {/* Full-bleed photo background */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assets.primary}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Dark readable overlay (direction rotates per variant) */}
      <div className="absolute inset-0" style={overlayStyle} />

      {/* Top chrome: brand chip + date — pinned regardless of variant */}
      <div className="absolute left-[80px] right-[80px] top-[70px] z-20 flex items-center justify-between">
        <div
          className="inline-flex items-center rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
          style={{
            backgroundColor: "rgba(255,255,255,0.95)",
            color: palette.accentDeep,
            boxShadow: `0 4px 14px ${dark}88`,
          }}
        >
          {brand}
        </div>
        <div className="rounded-full bg-white/90 px-4 py-1.5 text-[18px] font-bold" style={{ color: palette.accentDeep }}>
          {dateLabel}
        </div>
      </div>

      <div
        className={`relative z-10 flex h-full flex-col ${contentJustify} gap-[32px] px-[80px] pb-[80px] pt-[170px]`}
      >
        {/* Headline + message (white over dark overlay) */}
        <div className="flex max-w-[940px] flex-col gap-[26px]">
          <div
            className="font-black leading-[1.05] text-white"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.025em",
              textShadow: `0 4px 18px ${dark}cc`,
            }}
          >
            {headline}
          </div>
          {message && (
            <div
              className="text-[24px] font-semibold leading-[1.55] text-white/95"
              style={{ textShadow: `0 2px 10px ${dark}aa` }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Daleel quote card — opaque white, accent top border, decorative quote glyph */}
        {daleel && translation && (
          <div
            data-autofit
            data-fit-min="14"
            className="relative flex max-w-[940px] flex-col gap-3 rounded-3xl bg-white px-9 py-7 shadow-2xl"
            style={{
              boxShadow: `0 18px 48px ${dark}aa`,
              borderTop: `8px solid ${palette.accent}`,
              maxHeight: "360px",
              overflow: "hidden",
            }}
          >
            <QuoteGlyph
              color={palette.accent}
              className="absolute left-4 top-1 z-0"
            />
            <div
              className="relative z-10 font-medium italic leading-[1.55] text-slate-800"
              style={{ fontSize: `${transSize}px` }}
            >
              &ldquo;{translation}&rdquo;
            </div>
            <Citation
              citation={daleel.citation}
              color={palette.accent}
              className="relative z-10"
            />
          </div>
        )}
      </div>
    </div>
  );
};
