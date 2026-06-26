import { isQuotableDaleel, pickDaleelTranslation } from "../content";
import { Citation, DaleelSourceChip } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * SplitImage — full-bleed photo background + floating content panel
 * (general-b / sunnah-a slots: Aksi Sosial + Ajakan Sunnah).
 *
 * Photo fills the entire 1080×1080 canvas; content (headline + message +
 * daleel quote with accent rule) sits on a dark accent-deep gradient
 * overlay. Three direction variants:
 *
 *   - variant 0: bottom-up dark gradient, content bottom-anchored
 *   - variant 1: top-down dark gradient, content top-anchored
 *   - variant 2: diagonal gradient (top-left → bottom-right), centered
 *
 * Earlier iteration used a literal half/half split (photo-left,
 * photo-right, photo-top) with the photo in a 480px panel. Switched to
 * unified full-bleed on 2026-06-10 per user feedback: the half-split
 * panel pattern wasted half the canvas on a cropped photo while the
 * content side felt cramped. Git history preserves the split variants.
 */
export const SplitImage: FlyerLayoutComponent = ({
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
  const quotable = isQuotableDaleel(daleel, locale);
  // Bumped 2026-06-10 (25/22/19/17/15 → 30/26/22/19/17): the daleel
  // card now sits on a full-bleed photo + dark overlay; the smaller
  // tiers were hard to read against that contrast.
  const transSize =
    transLen < 220
      ? 30
      : transLen < 320
        ? 26
        : transLen < 460
          ? 22
          : transLen < 620
            ? 19
            : 17;

  const headlineSize =
    headline.length < 18 ? "92px" : headline.length < 28 ? "76px" : "62px";

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
        {/* Headline + accent rule */}
        <div className="flex max-w-[940px] flex-col gap-[22px]">
          <div
            className="h-[5px] w-16 rounded-full"
            style={{ background: palette.accent }}
          />
          <h2
            className="font-black leading-[1.08] tracking-tight text-white"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.015em",
              textShadow: `0 4px 18px ${dark}cc`,
            }}
          >
            {headline}
          </h2>
        </div>

        {message && (
          <div
            className="max-w-[940px] text-[22px] font-medium leading-[1.5] text-white/95"
            style={{ textShadow: `0 2px 10px ${dark}aa` }}
          >
            {message}
          </div>
        )}

        {/* Daleel quote card — opaque white stays legible over any bg */}
        {daleel &&
          (quotable && translation ? (
            <div
              data-autofit
              data-fit-min="14"
              className="flex max-w-[940px] flex-col gap-3 rounded-3xl bg-white px-7 py-6 shadow-2xl"
              style={{
                borderLeft: `8px solid ${palette.accent}`,
                boxShadow: `0 18px 40px ${dark}aa`,
                maxHeight: "360px",
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
          ) : (
            <DaleelSourceChip
              citation={daleel.citation}
              palette={palette}
              label={locale === "en" ? "Source" : "Sumber"}
            />
          ))}
      </div>
    </div>
  );
};
