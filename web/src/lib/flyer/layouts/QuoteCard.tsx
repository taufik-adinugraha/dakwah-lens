import type { FlyerLayoutComponent } from "./types";

/**
 * QuoteCard — pattern-backed centered card (genz-b slot).
 *
 * Soft pattern wash backdrop, the 4-5 word headline sits proud on top,
 * the 3-4 sentence message below, daleel in a tilted polaroid card.
 * Magazine/poster vibe — different visual language from HeroHeadline
 * so the two Gen-Z flyers don't visually duplicate.
 */
export const QuoteCard: FlyerLayoutComponent = ({
  content,
  image,
  palette,
  locale,
  assets,
}) => {
  const { daleel, headline, message, dateLabel, brand } = content;
  const isEnglish = locale === "en";
  const translation = daleel
    ? isEnglish
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || ""
    : "";

  const bgStops = palette.bgGradient;
  const bgStyle = {
    background: `linear-gradient(135deg, ${bgStops[0]} 0%, ${bgStops[1]} ${bgStops[2] ? "55%" : "100%"}${bgStops[2] ? `, ${bgStops[2]} 100%` : ""})`,
  };

  // Background pattern.
  const patternUrl =
    image.kind === "pattern" ? assets.primary : assets.dotsPattern;

  const headlineSize =
    headline.length < 18 ? "96px" : headline.length < 28 ? "78px" : "62px";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Pattern wash backdrop */}
      <div
        className="absolute inset-0 opacity-[0.13]"
        style={{ color: palette.accentDeep }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={patternUrl}
          alt=""
          className="h-full w-full object-cover"
          style={{ objectFit: "cover", objectPosition: "center" }}
        />
      </div>

      {/* If the registry handed us a photo, drop it as a soft round
          accent in the bottom-right — still ensures the flyer always
          carries some imagery for emotional weight. */}
      {image.kind === "photo" && (
        <div
          className="absolute bottom-[60px] right-[60px] h-[200px] w-[200px] overflow-hidden rounded-full shadow-2xl"
          style={{
            boxShadow: `0 0 0 5px ${palette.accent}33, 0 14px 32px ${palette.accent}55`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Top brand chip */}
      <div className="absolute left-[80px] top-[60px]">
        <div
          className="inline-flex rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
          style={{
            backgroundColor: palette.accent,
            color: palette.chipText,
            boxShadow: `0 4px 14px ${palette.accent}55`,
          }}
        >
          {brand}
        </div>
      </div>
      <div
        className="absolute right-[80px] top-[68px] text-[18px] font-bold"
        style={{ color: palette.accentDeep }}
      >
        {dateLabel}
      </div>

      {/* Main content stack */}
      <div className="relative z-10 flex h-full flex-col justify-center gap-[40px] px-[80px] pt-[160px] pb-[60px]">
        <div className="flex flex-col gap-[24px]">
          <div
            className="font-black leading-[1.03] tracking-tight"
            style={{
              fontSize: headlineSize,
              color: palette.accentDeep,
              letterSpacing: "-0.025em",
            }}
          >
            {headline}
          </div>
          {message && (
            <div
              className="max-w-[880px] text-[26px] font-semibold leading-[1.45]"
              style={{ color: "#1f1f1f" }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Tilted polaroid daleel card */}
        {daleel && (daleel.arabic || translation) && (
          <div
            className="max-w-[780px] rounded-3xl bg-white px-8 py-7 shadow-2xl"
            style={{
              transform: "rotate(-1.2deg)",
              boxShadow: `0 18px 48px ${palette.accent}44`,
              borderTop: `8px solid ${palette.accent}`,
            }}
          >
            <div className="flex flex-col gap-3">
              {daleel.arabic && (
                <div
                  dir="rtl"
                  className="font-amiri font-bold leading-[1.55]"
                  style={{
                    fontSize: daleel.arabic.length > 70 ? "28px" : "32px",
                    color: palette.accentDeep,
                  }}
                >
                  {daleel.arabic.length > 90
                    ? daleel.arabic.slice(0, 90) + "…"
                    : daleel.arabic}
                </div>
              )}
              {translation && (
                <div className="text-[19px] italic leading-[1.4] text-slate-800">
                  &ldquo;
                  {translation.length > 140
                    ? translation.slice(0, 140) + "…"
                    : translation}
                  &rdquo;
                </div>
              )}
              <div
                className="text-[15px] font-extrabold tracking-wider"
                style={{ color: palette.accent }}
              >
                — {daleel.citation}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
