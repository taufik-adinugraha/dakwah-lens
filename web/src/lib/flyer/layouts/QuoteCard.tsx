import type { FlyerLayoutComponent } from "./types";

/**
 * QuoteCard — polaroid-style centered card.
 *
 * Soft pattern wash background, tilted white card in the center with
 * Arabic + translation + citation. Brand + date frame top and bottom.
 * Good when we want the daleel itself to be the focus on a calm canvas.
 */
export const QuoteCard: FlyerLayoutComponent = ({
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

  // Background pattern — use the picked asset if it's a pattern,
  // else fall back to dots.
  const patternUrl =
    image.kind === "pattern" ? assets.primary : assets.dotsPattern;

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col items-center justify-center overflow-hidden"
      style={bgStyle}
    >
      {/* Pattern wash backdrop */}
      <div
        className="absolute inset-0 opacity-[0.10]"
        style={{ color: palette.accentDeep }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={patternUrl}
          alt=""
          className="h-full w-full object-cover"
          style={{
            // SVG patterns tile small; setting object-fit:cover keeps
            // them filling without stretching.
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      </div>

      {/* Top frame: brand */}
      <div
        className="absolute left-0 right-0 top-[60px] flex justify-center"
      >
        <div
          className="rounded-full px-6 py-2.5 text-[18px] font-extrabold uppercase tracking-widest"
          style={{
            backgroundColor: palette.accent,
            color: palette.chipText,
            boxShadow: `0 4px 14px ${palette.accent}55`,
          }}
        >
          {eyebrow}
        </div>
      </div>

      {/* Center: polaroid quote card */}
      {daleel && (daleel.arabic || translation) && (
        <div
          className="relative max-w-[860px] rounded-3xl bg-white px-[60px] py-[55px] shadow-2xl"
          style={{
            transform: "rotate(-1.5deg)",
            boxShadow: `0 20px 60px ${palette.accent}44`,
            borderTop: `8px solid ${palette.accent}`,
          }}
        >
          <div className="flex flex-col items-center gap-6">
            {daleel.arabic && (
              <div
                dir="rtl"
                className="font-amiri text-center font-bold leading-[1.7]"
                style={{
                  fontSize: daleel.arabic.length > 80 ? "44px" : "52px",
                  color: palette.accentDeep,
                }}
              >
                {daleel.arabic.length > 120
                  ? daleel.arabic.slice(0, 120) + "…"
                  : daleel.arabic}
              </div>
            )}
            {translation && (
              <div className="max-w-[680px] text-center text-[22px] italic leading-[1.45] text-slate-800">
                &ldquo;
                {translation.length > 200
                  ? translation.slice(0, 200) + "…"
                  : translation}
                &rdquo;
              </div>
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className="h-[2px] w-12 rounded-full"
                style={{ background: palette.accent }}
              />
              <div
                className="text-[18px] font-extrabold tracking-wider"
                style={{ color: palette.accent }}
              >
                {daleel.citation}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Headline below card */}
      <div
        className="absolute bottom-[170px] left-0 right-0 mx-auto max-w-[800px] px-[80px] text-center text-[24px] font-semibold leading-[1.4] text-slate-900"
      >
        {headline.length > 140
          ? headline.slice(0, 139).trimEnd() + "…"
          : headline}
      </div>

      {/* Bottom frame: date + brand */}
      <div
        className="absolute bottom-[60px] left-0 right-0 flex items-center justify-between px-[80px] text-[18px] font-bold"
        style={{ color: palette.accentDeep }}
      >
        <span>{dateLabel}</span>
        <span className="tracking-wider">{brand}</span>
      </div>
    </div>
  );
};
