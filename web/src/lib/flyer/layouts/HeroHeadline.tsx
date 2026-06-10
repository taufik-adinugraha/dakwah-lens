import { pickDaleelTranslation } from "../content";
import { Citation } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * HeroHeadline — bold typography on a full-bleed photo background
 * (genz-a / Kreator Konten slot).
 *
 * Photo fills the entire 1080×1080 canvas as the background; content
 * (headline + message + translation-only daleel card) sits on top of a
 * dark gradient that keeps text legible. The gradient direction rotates
 * per edition via layoutVariant so successive flyers don't look
 * identical.
 *
 *   - variant 0: bottom-up dark gradient, content bottom-anchored
 *   - variant 1: top-down dark gradient, content top-anchored
 *   - variant 2: diagonal gradient (top-left → bottom-right), centered
 *
 * Earlier iteration overlaid the photo as a circular avatar / side strip
 * / bottom band on a flat gradient backdrop. Switched to full-bg photo
 * on 2026-06-10 per user feedback ("make the image bigger, the whole
 * page is fine, then overlayed as background"). Git history preserves
 * the earlier PhotoAccent variants if a future rotation needs them.
 */
export const HeroHeadline: FlyerLayoutComponent = ({
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
  // Bumped 2026-06-10 (22/19/17/15 → 28/24/20/17): the daleel card now
  // floats over a busy photo + dark overlay; the smaller tiers were
  // hard to read against that contrast.
  const transSize =
    transLen < 220 ? 28 : transLen < 340 ? 24 : transLen < 420 ? 20 : 17;

  const headlineSize =
    headline.length < 18 ? "112px" : headline.length < 28 ? "94px" : "76px";

  const dark = palette.accentDeep;

  // Three gradient/positional variants share the same full-bleed photo.
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

  // Anchor content to whichever edge the gradient is densest at.
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

      {/* Top chrome: brand chip + date — pinned to top regardless of variant */}
      <div className="absolute left-[80px] right-[80px] top-[70px] z-20 flex items-center justify-between">
        <div
          className="inline-flex items-center rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
          style={{
            backgroundColor: palette.accent,
            color: palette.chipText,
            boxShadow: `0 4px 14px ${dark}88`,
          }}
        >
          ★ {brand}
        </div>
        <div
          className="rounded-full bg-white/90 px-4 py-1.5 text-[18px] font-bold"
          style={{ color: palette.accentDeep }}
        >
          {dateLabel}
        </div>
      </div>

      <div
        className={`relative z-10 flex h-full flex-col ${contentJustify} gap-[28px] px-[80px] pb-[80px] pt-[170px]`}
      >
        {/* HERO block: headline + dashes + message (white text on dark overlay) */}
        <div className="flex max-w-[940px] flex-col gap-[24px]">
          <div
            className="font-black leading-[1.04] text-white"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.025em",
              textShadow: `0 4px 18px ${dark}cc`,
            }}
          >
            {headline}
          </div>
          <svg
            viewBox="0 0 1080 60"
            width="500"
            height="28"
            aria-hidden
            style={{ color: palette.accent }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <line
                key={i}
                x1={20 + i * 90}
                y1={30}
                x2={80 + i * 90}
                y2={30}
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                opacity="0.95"
              />
            ))}
          </svg>
          {message && (
            <div
              className="text-[24px] font-semibold leading-[1.45] text-white/95"
              style={{ textShadow: `0 2px 10px ${dark}aa` }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Translation-only daleel card — opaque white stays readable on any bg */}
        {daleel && translation && (
          <div
            data-autofit
            data-fit-min="14"
            className="flex max-w-[940px] flex-col gap-3 rounded-3xl border-2 bg-white px-7 py-6 shadow-2xl"
            style={{
              borderColor: palette.accentSoft,
              boxShadow: `0 18px 40px ${dark}aa`,
              transform: "rotate(-1.5deg)",
              maxHeight: "320px",
              overflow: "hidden",
            }}
          >
            <div
              className="font-medium italic leading-[1.45] text-slate-800"
              style={{ fontSize: `${transSize}px` }}
            >
              &ldquo;{translation}&rdquo;
            </div>
            <Citation citation={daleel.citation} color={palette.accent} />
          </div>
        )}
      </div>
    </div>
  );
};
