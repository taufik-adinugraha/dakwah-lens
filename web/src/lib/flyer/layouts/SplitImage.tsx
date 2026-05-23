import type { FlyerLayoutComponent } from "./types";

/**
 * SplitImage — magazine-cover split (general-b slot).
 *
 * Photo fills the left half (with brand-tinted overlay), content lives
 * in the right white panel. No segment label. Headline is 4-5 word
 * tagline; message is 3-4 sentence actionable paragraph; daleel sits
 * in a compact card. Best layout when the image is a strong photo.
 */
export const SplitImage: FlyerLayoutComponent = ({
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

  const usePhoto = image.kind === "photo";

  // Right-panel width = 1080 - 480 = 600px. Headline sized to fit.
  const headlineSize =
    headline.length < 18 ? "64px" : headline.length < 28 ? "52px" : "42px";

  return (
    <div className="relative flex h-[1080px] w-[1080px] overflow-hidden bg-white">
      {/* LEFT PANEL — photo (or ornament tile / gradient) */}
      <div className="relative h-full w-[480px] overflow-hidden">
        {usePhoto ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={assets.primary}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accentDeep} 100%)`,
              }}
            />
            {image.kind === "ornament" && (
              <div
                className="absolute inset-0 flex items-center justify-center opacity-30"
                style={{ color: "#ffffff" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assets.primary} alt="" className="h-[360px] w-auto" />
              </div>
            )}
          </>
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${palette.accentDeep}55 0%, transparent 30%, transparent 65%, ${palette.accentDeep}cc 100%)`,
          }}
        />

        {/* Brand chip top-left */}
        <div className="absolute left-[40px] top-[50px]">
          <div
            className="inline-flex rounded-full bg-white/95 px-5 py-2 text-[16px] font-extrabold tracking-widest"
            style={{ color: palette.accentDeep }}
          >
            {brand}
          </div>
        </div>

        {/* Citation overlay bottom-left */}
        {daleel && (
          <div className="absolute bottom-[50px] left-[40px] right-[40px] text-white">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] opacity-80">
              {dateLabel}
            </div>
            <div className="mt-2 text-[18px] font-extrabold leading-tight">
              {daleel.citation}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL — content */}
      <div className="relative flex flex-1 flex-col justify-between px-[55px] py-[60px]">
        {/* Headline + decorative bar */}
        <div className="flex flex-col gap-[22px]">
          <div
            className="h-[5px] w-16 rounded-full"
            style={{ background: palette.accent }}
          />
          <h2
            className="font-black leading-[1.08] tracking-tight text-slate-900"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.015em",
            }}
          >
            {headline}
          </h2>
        </div>

        {/* Message */}
        {message && (
          <div className="text-[22px] font-medium leading-[1.5] text-slate-700">
            {message}
          </div>
        )}

        {/* Daleel block */}
        {daleel && (daleel.arabic || translation) && (
          <div
            className="flex flex-col gap-3 border-l-4 pl-5"
            style={{ borderColor: palette.accent }}
          >
            {daleel.arabic && (
              <div
                dir="rtl"
                className="font-amiri font-bold leading-[1.55]"
                style={{
                  fontSize: daleel.arabic.length > 70 ? "26px" : "30px",
                  color: palette.accentDeep,
                }}
              >
                {daleel.arabic.length > 90
                  ? daleel.arabic.slice(0, 90) + "…"
                  : daleel.arabic}
              </div>
            )}
            {translation && (
              <div className="text-[17px] italic leading-[1.45] text-slate-700">
                &ldquo;
                {translation.length > 140
                  ? translation.slice(0, 140) + "…"
                  : translation}
                &rdquo;
              </div>
            )}
            <div
              className="text-[14px] font-extrabold tracking-wider"
              style={{ color: palette.accent }}
            >
              {daleel.citation}
            </div>
          </div>
        )}

        {/* Footer brand + stars */}
        <div>
          <div className="h-[36px]" style={{ color: palette.accent }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  );
};
