import { Citation, HeadlineRule } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * HeroAyat — full-bleed photo backdrop (general-a slot).
 *
 * Photo fills the canvas with a brand-tinted gradient overlay so the
 * text stays legible. Big 4-5 word headline, 3-4 sentence message,
 * compact translation-only daleel card. No Arabic — keeps the visible
 * text predictable in length. Three sub-variants rotate the decorative
 * accent (star border / corner stripe / diagonal sweep) so successive
 * editions feel fresh.
 */
export const HeroAyat: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
  layoutVariant,
}) => {
  const { daleel, headline, message, dateLabel, brand } = content;
  const isEnglish = locale === "en";
  const rawTranslation = daleel
    ? isEnglish
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || ""
    : "";
  const transLen = rawTranslation.length;
  // Starting size; the runtime auto-fit pass (snap.ts) scales the card
  // down to fit the FULL text, so we no longer truncate.
  const transSize =
    transLen < 240 ? 22 : transLen < 360 ? 19 : transLen < 440 ? 17 : 15;
  const translation = rawTranslation;

  const headlineSize =
    headline.length < 18 ? "108px" : headline.length < 28 ? "92px" : "76px";

  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden">
      {/* Full-bleed photo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assets.primary}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${palette.accentDeep}d4 0%, ${palette.accentDeep}a8 35%, ${palette.accent}b8 70%, ${palette.accentDeep}f0 100%)`,
        }}
      />

      {/* Variant decoration */}
      {layoutVariant === 0 && (
        <>
          <div className="absolute left-0 right-0 top-0 h-[44px]" style={{ color: palette.accent }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-[44px]" style={{ color: palette.accent }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
        </>
      )}
      {layoutVariant === 1 && (
        <>
          <div
            className="absolute -left-20 -top-20 h-[260px] w-[260px] rounded-full"
            style={{ background: palette.accent, opacity: 0.35 }}
          />
          <div
            className="absolute -bottom-24 -right-24 h-[340px] w-[340px] rounded-full"
            style={{ background: palette.accentSoft, opacity: 0.45 }}
          />
        </>
      )}
      {layoutVariant === 2 && (
        <svg
          className="absolute bottom-0 left-0 right-0"
          viewBox="0 0 1080 220"
          width="1080"
          height="220"
          aria-hidden
        >
          <path
            d="M0,80 C260,180 540,30 780,110 C920,160 1020,90 1080,140 L1080,220 L0,220 Z"
            fill={palette.accent}
            opacity="0.7"
          />
          <path
            d="M0,140 C220,220 580,90 820,170 C960,210 1020,160 1080,190 L1080,220 L0,220 Z"
            fill={palette.accentDeep}
            opacity="0.85"
          />
        </svg>
      )}

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] pt-[80px] pb-[60px]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div
            className="rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
            style={{
              backgroundColor: "rgba(255,255,255,0.94)",
              color: palette.accentDeep,
              boxShadow: `0 4px 14px ${palette.accentDeep}55`,
            }}
          >
            {brand}
          </div>
          <div className="text-[20px] font-bold tracking-wide" style={{ color: "#ffffffe0" }}>
            {dateLabel}
          </div>
        </div>

        {/* Hero block */}
        <div className="flex flex-col gap-[28px]">
          <div
            className="font-black leading-[1.04] tracking-tight text-white"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.02em",
              textShadow: "0 2px 12px rgba(0,0,0,0.35)",
            }}
          >
            {headline}
          </div>
          <HeadlineRule palette={palette} />
          {message && (
            <div
              className="max-w-[920px] text-[26px] font-medium leading-[1.45]"
              style={{ color: "#ffffffec" }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Translation-only daleel card. Bounded height + dynamic
            font so a long hadith narration can't push the citation
            off the canvas. */}
        {daleel && translation && (
          <div
            data-autofit
            data-fit-min="13"
            className="flex max-w-[940px] flex-col gap-[12px] rounded-3xl px-7 py-6"
            style={{
              backgroundColor: "rgba(255,255,255,0.94)",
              boxShadow: `0 12px 32px ${palette.accentDeep}55`,
              maxHeight: "280px",
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
