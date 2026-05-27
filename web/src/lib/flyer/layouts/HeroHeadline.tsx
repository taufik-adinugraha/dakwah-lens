import { Citation } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * HeroHeadline — bold typography meets prominent photo (genz-a slot).
 *
 * Saturated 3-stop gradient backdrop. Photo always present, but its
 * shape rotates per edition for visual variety:
 *   - variant 0: large circular avatar top-right
 *   - variant 1: rounded square photo strip right side
 *   - variant 2: photo half-bleed bottom band
 *
 * Headline (Inter Black, 90-110px) is the focal element. Message and
 * translation-only daleel card sit underneath.
 */
export const HeroHeadline: FlyerLayoutComponent = ({
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
  const transSize =
    transLen < 220 ? 22 : transLen < 340 ? 19 : transLen < 420 ? 17 : 15;
  // Auto-fit (snap.ts) scales the card to fit the full text; no truncation.
  const translation = rawTranslation;

  const bgStops = palette.bgGradient;
  const bgStyle = {
    background: `linear-gradient(135deg, ${bgStops[0]} 0%, ${bgStops[1]} ${bgStops[2] ? "55%" : "100%"}${bgStops[2] ? `, ${bgStops[2]} 100%` : ""})`,
  };

  const headlineSize =
    headline.length < 18 ? "112px" : headline.length < 28 ? "94px" : "76px";

  const PhotoAccent = (() => {
    if (layoutVariant === 0) {
      return (
        <div
          className="absolute right-[60px] top-[60px] h-[260px] w-[260px] overflow-hidden rounded-full shadow-2xl"
          style={{ boxShadow: `0 0 0 6px ${palette.accent}33, 0 14px 32px ${palette.accent}66` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assets.primary} alt="" className="h-full w-full object-cover" />
        </div>
      );
    }
    if (layoutVariant === 1) {
      return (
        <div
          className="absolute right-0 top-[40px] h-[1000px] w-[360px] overflow-hidden rounded-l-[40px] shadow-2xl"
          style={{ boxShadow: `0 14px 32px ${palette.accent}66` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assets.primary} alt="" className="h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, transparent 60%, ${palette.accentDeep}aa 100%)`,
            }}
          />
        </div>
      );
    }
    // variant 2: photo band along bottom.
    return (
      <div className="absolute bottom-0 left-0 right-0 h-[360px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.primary} alt="" className="h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${bgStops[bgStops[2] ? 2 : 1]}d0 0%, transparent 30%, transparent 70%, ${palette.accentDeep}cc 100%)`,
          }}
        />
      </div>
    );
  })();

  // Container width for headline + message — narrower when photo is on
  // the right side (variant 1) so they don't overlap.
  const contentWidth = layoutVariant === 1 ? "max-w-[640px]" : "max-w-[940px]";

  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden" style={bgStyle}>
      {/* Decorative corner blobs */}
      <div
        className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full opacity-[0.30]"
        style={{ background: palette.accent }}
      />
      {layoutVariant !== 2 && (
        <div
          className="absolute -bottom-28 -left-28 h-[420px] w-[420px] rounded-full opacity-[0.25]"
          style={{ background: palette.accentSoft }}
        />
      )}

      {PhotoAccent}

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[70px]">
        {/* Top: brand chip + date */}
        <div className="flex items-center justify-between">
          <div
            className="inline-flex items-center rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
            style={{
              backgroundColor: palette.accent,
              color: palette.chipText,
              boxShadow: `0 4px 14px ${palette.accent}55`,
            }}
          >
            ★ {brand}
          </div>
          <div
            className="text-[18px] font-bold opacity-80"
            style={{ color: palette.accentDeep }}
          >
            {dateLabel}
          </div>
        </div>

        {/* HERO block: headline + dashes + message */}
        <div className={`flex flex-col gap-[24px] ${contentWidth}`}>
          <div
            className="font-black leading-[1.04] text-slate-900"
            style={{ fontSize: headlineSize, letterSpacing: "-0.025em" }}
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
                opacity="0.55"
              />
            ))}
          </svg>
          {message && (
            <div
              className="text-[24px] font-semibold leading-[1.45]"
              style={{ color: "#1f1f1f" }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Translation-only daleel card */}
        {daleel && translation && (
          <div
            data-autofit
            data-fit-min="13"
            className={`flex flex-col gap-3 rounded-3xl border-2 bg-white px-7 py-6 shadow-xl ${contentWidth}`}
            style={{
              borderColor: palette.accentSoft,
              boxShadow: `0 12px 28px ${palette.accent}40`,
              transform: "rotate(-1.5deg)",
              maxHeight: "260px",
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
