import type { FlyerLayoutComponent } from "./types";

/**
 * HeroAyat — ayat-centered classical layout.
 *
 * Big Arabic at the visual center, translation + citation below,
 * pull-quote callout near the bottom. Best with calm photo as
 * backdrop OR an ornament accent.
 */
export const HeroAyat: FlyerLayoutComponent = ({
  content,
  image,
  palette,
  locale,
  assets,
}) => {
  const { daleel, headline, eyebrow, dateLabel, brand } = content;
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
              background: `linear-gradient(180deg, ${palette.accentDeep}d0 0%, ${palette.accent}c0 60%, ${bgStops[bgStops[2] ? 2 : 1]}f0 100%)`,
            }}
          />
        </>
      )}

      {/* Top star border */}
      <div
        className="absolute left-0 right-0 top-0 h-[60px]"
        style={{ color: palette.accent }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.starsRow} alt="" className="block h-full w-full" />
      </div>

      {/* Ornament accent behind content when not photo-backed */}
      {!usePhotoBg && image.kind === "ornament" && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.10]"
          style={{ color: palette.accent }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className={
              image.aspect === "tall"
                ? "h-[700px] w-auto"
                : image.aspect === "wide"
                  ? "h-auto w-[900px]"
                  : "h-[600px] w-[600px]"
            }
          />
        </div>
      )}

      {/* Main content column */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-between px-[80px] pt-[100px] pb-[60px]">
        <div className="flex flex-col items-center gap-3">
          <div
            className="rounded-full px-6 py-2.5 text-[22px] font-bold uppercase tracking-widest"
            style={{
              backgroundColor: palette.accent,
              color: palette.chipText,
              boxShadow: `0 4px 14px ${palette.accent}55`,
            }}
          >
            {eyebrow}
          </div>
          <div
            className="text-[20px] font-medium"
            style={{
              color: usePhotoBg ? "#ffffffd0" : palette.accent,
              opacity: usePhotoBg ? 1 : 0.75,
            }}
          >
            {dateLabel}
          </div>
        </div>

        {daleel && daleel.arabic ? (
          <div className="flex max-w-[920px] flex-col items-center gap-[20px]">
            <div
              dir="rtl"
              className="font-amiri text-center font-bold leading-[1.75]"
              style={{
                fontSize: daleel.arabic.length > 80 ? "48px" : "58px",
                color: usePhotoBg ? "#ffffff" : palette.accentDeep,
              }}
            >
              {daleel.arabic.length > 140
                ? daleel.arabic.slice(0, 140) + "…"
                : daleel.arabic}
            </div>
            {translation && (
              <div
                className="max-w-[820px] text-center text-[26px] italic leading-[1.5]"
                style={{ color: usePhotoBg ? "#ffffffe8" : "#1f2937" }}
              >
                &ldquo;
                {translation.length > 220
                  ? translation.slice(0, 220) + "…"
                  : translation}
                &rdquo;
              </div>
            )}
            <div
              className="text-[24px] font-bold"
              style={{ color: usePhotoBg ? "#ffffff" : palette.accentDeep }}
            >
              — {daleel.citation}
            </div>
          </div>
        ) : (
          <div />
        )}

        <div className="flex w-full flex-col items-center gap-[28px]">
          <div
            className="max-w-[900px] rounded-3xl border-2 px-9 py-7 text-center text-[28px] font-semibold leading-[1.45] text-slate-900 shadow-lg"
            style={{
              backgroundColor: "rgba(255,255,255,0.92)",
              borderColor: palette.accent,
              boxShadow: `0 4px 14px ${palette.accent}33`,
            }}
          >
            {headline}
          </div>
          <div
            className="text-[24px] font-bold tracking-wider"
            style={{ color: usePhotoBg ? "#ffffff" : palette.accentDeep }}
          >
            {brand}
          </div>
        </div>
      </div>

      {/* Bottom star border */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[60px]"
        style={{ color: palette.accent }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.starsRow} alt="" className="block h-full w-full" />
      </div>
    </div>
  );
};
