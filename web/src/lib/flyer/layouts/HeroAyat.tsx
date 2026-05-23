import type { FlyerLayoutComponent } from "./types";

/**
 * HeroAyat — image-backed classical layout (general-a slot).
 *
 * Photo backdrop with brand-tinted overlay, big 4-5 word headline,
 * 3-4 sentence message paragraph, compact daleel block. No segment
 * label — the flyer carries the message, not the metadata.
 */
export const HeroAyat: FlyerLayoutComponent = ({
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
  const usePhotoBg = image.kind === "photo";

  // Headline sizing: cap word count is done upstream — here we size by
  // character length so super-short ("Tegakkan Timbangan") feels heroic
  // and slightly-longer still fits comfortably.
  const headlineSize =
    headline.length < 18 ? "108px" : headline.length < 28 ? "92px" : "76px";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {usePhotoBg && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accentDeep}cc 0%, ${palette.accentDeep}99 35%, ${palette.accent}b3 70%, ${palette.accentDeep}e6 100%)`,
            }}
          />
        </>
      )}

      {!usePhotoBg && image.kind === "ornament" && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.10]"
          style={{ color: palette.accent }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={assets.primary} alt="" className="h-[680px] w-auto" />
        </div>
      )}

      {/* Top star border */}
      <div
        className="absolute left-0 right-0 top-0 h-[44px]"
        style={{ color: palette.accent }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.starsRow} alt="" className="block h-full w-full" />
      </div>

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] pt-[90px] pb-[60px]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div
            className="rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
            style={{
              backgroundColor: usePhotoBg ? "rgba(255,255,255,0.92)" : palette.accent,
              color: usePhotoBg ? palette.accentDeep : palette.chipText,
              boxShadow: `0 4px 14px ${palette.accent}33`,
            }}
          >
            {brand}
          </div>
          <div
            className="text-[20px] font-bold tracking-wide"
            style={{ color: usePhotoBg ? "#ffffffd0" : palette.accentDeep }}
          >
            {dateLabel}
          </div>
        </div>

        {/* Hero block: headline + message */}
        <div className="flex flex-col gap-[28px]">
          <div
            className="font-black leading-[1.04] tracking-tight"
            style={{
              fontSize: headlineSize,
              color: usePhotoBg ? "#ffffff" : palette.accentDeep,
              letterSpacing: "-0.02em",
              textShadow: usePhotoBg ? "0 2px 10px rgba(0,0,0,0.25)" : "none",
            }}
          >
            {headline}
          </div>
          {message && (
            <div
              className="max-w-[920px] text-[28px] font-medium leading-[1.45]"
              style={{
                color: usePhotoBg ? "#ffffffec" : "#1f2937",
              }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Daleel block — compact, on a translucent card so it reads
            against any backdrop. */}
        {daleel && (daleel.arabic || translation) && (
          <div
            className="flex max-w-[940px] flex-col gap-[14px] rounded-3xl border px-7 py-6"
            style={{
              backgroundColor: usePhotoBg
                ? "rgba(255,255,255,0.94)"
                : "rgba(255,255,255,0.85)",
              borderColor: palette.accent + "55",
              boxShadow: `0 8px 24px ${palette.accent}22`,
            }}
          >
            {daleel.arabic && (
              <div
                dir="rtl"
                className="font-amiri font-bold leading-[1.55]"
                style={{
                  fontSize: daleel.arabic.length > 70 ? "30px" : "36px",
                  color: palette.accentDeep,
                }}
              >
                {daleel.arabic.length > 90
                  ? daleel.arabic.slice(0, 90) + "…"
                  : daleel.arabic}
              </div>
            )}
            {translation && (
              <div className="text-[20px] italic leading-[1.4] text-slate-700">
                &ldquo;
                {translation.length > 150
                  ? translation.slice(0, 150) + "…"
                  : translation}
                &rdquo;
              </div>
            )}
            <div
              className="text-[16px] font-extrabold tracking-wider"
              style={{ color: palette.accent }}
            >
              — {daleel.citation}
            </div>
          </div>
        )}
      </div>

      {/* Bottom star border */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[44px]"
        style={{ color: palette.accent }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.starsRow} alt="" className="block h-full w-full" />
      </div>
    </div>
  );
};
