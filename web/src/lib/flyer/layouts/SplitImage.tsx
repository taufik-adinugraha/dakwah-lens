import type { FlyerLayoutComponent } from "./types";

/**
 * SplitImage — magazine-cover split. Photo fills the left half (with a
 * subtle tinted overlay), content lives in the right white panel.
 * Best layout when the image is a strong photo.
 */
export const SplitImage: FlyerLayoutComponent = ({
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

  // If the chosen asset isn't a photo, fall back to a gradient panel —
  // SplitImage really needs an image; without one the layout looks empty.
  const usePhoto = image.kind === "photo";

  return (
    <div className="relative flex h-[1080px] w-[1080px] overflow-hidden bg-white">
      {/* LEFT PANEL — photo or gradient */}
      <div className="relative h-full w-[520px] overflow-hidden">
        {usePhoto ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={assets.primary}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accentDeep} 100%)`,
            }}
          />
        )}
        {/* Tint overlay so the eyebrow/citation stays legible */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${palette.accentDeep}66 0%, transparent 30%, transparent 70%, ${palette.accentDeep}aa 100%)`,
          }}
        />

        {/* Citation overlay on photo bottom */}
        {daleel && (
          <div className="absolute bottom-[60px] left-[50px] right-[50px] text-white">
            <div className="text-[12px] font-bold uppercase tracking-[0.25em] opacity-90">
              {brand}
            </div>
            <div className="mt-2 text-[20px] font-bold">{daleel.citation}</div>
          </div>
        )}

        {/* Eyebrow chip overlay on photo top */}
        <div className="absolute left-[50px] top-[60px]">
          <div
            className="inline-flex rounded-full bg-white/95 px-5 py-2 text-[16px] font-extrabold uppercase tracking-widest"
            style={{ color: palette.accentDeep }}
          >
            {eyebrow}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL — content */}
      <div className="relative flex flex-1 flex-col justify-between p-[60px]">
        {/* Top: date + thin divider */}
        <div>
          <div
            className="text-[14px] font-bold uppercase tracking-[0.25em]"
            style={{ color: palette.accent }}
          >
            {dateLabel}
          </div>
          <div
            className="mt-3 h-1 w-14 rounded-full"
            style={{ background: palette.accent }}
          />
        </div>

        {/* Middle: headline */}
        <div className="flex flex-col gap-[24px]">
          <h2
            className="text-[40px] font-extrabold leading-[1.18] tracking-tight text-slate-900"
            style={{ letterSpacing: "-0.01em" }}
          >
            {headline.length > 180
              ? headline.slice(0, 179).trimEnd() + "…"
              : headline}
          </h2>

          {/* Arabic ayat — smaller than HeroAyat, treated as supporting */}
          {daleel && daleel.arabic && (
            <div
              dir="rtl"
              className="font-amiri leading-[1.6] font-bold"
              style={{
                fontSize: "32px",
                color: palette.accentDeep,
              }}
            >
              {daleel.arabic.length > 80
                ? daleel.arabic.slice(0, 80) + "…"
                : daleel.arabic}
            </div>
          )}

          {translation && (
            <div className="border-l-4 pl-5 text-[18px] italic leading-[1.5] text-slate-700"
              style={{ borderColor: palette.accent }}
            >
              &ldquo;
              {translation.length > 160
                ? translation.slice(0, 160) + "…"
                : translation}
              &rdquo;
            </div>
          )}
        </div>

        {/* Bottom: shared star border + brand */}
        <div>
          <div className="h-[40px]" style={{ color: palette.accent }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
          <div
            className="mt-3 text-[18px] font-extrabold tracking-wider"
            style={{ color: palette.accentDeep }}
          >
            {brand}
          </div>
        </div>
      </div>
    </div>
  );
};
