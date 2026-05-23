import type { FlyerLayoutComponent } from "./types";

/**
 * HeroHeadline — headline-driven, Gen-Z-coded.
 *
 * The hook line is the focal element (Inter Black 64-78px). The ayat
 * is demoted to a tilted supporting card. Saturated 3-stop gradient
 * background, two soft corner blobs, scroll-hint dashes under the
 * headline. CTA + brand at the bottom.
 */
export const HeroHeadline: FlyerLayoutComponent = ({
  content,
  image,
  palette,
  locale,
  assets,
}) => {
  const { daleel, headline, eyebrow, dateLabel, brand, cta } = content;
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

  const truncatedHook =
    headline.length > 110 ? headline.slice(0, 109).trimEnd() + "…" : headline;
  const headlineSize = truncatedHook.length > 75 ? "64px" : "78px";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Two corner gradient blobs */}
      <div
        className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full opacity-[0.22]"
        style={{ background: palette.accent }}
      />
      <div
        className="absolute -bottom-24 -right-24 h-[520px] w-[520px] rounded-full opacity-[0.28]"
        style={{ background: "#f59e0b" }}
      />

      {/* Optional decorative ornament in corner — lantern, star8 */}
      {image.kind === "ornament" && (
        <div
          className="absolute top-[80px] right-[80px] opacity-[0.22]"
          style={{ color: palette.accent }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className={
              image.aspect === "tall"
                ? "h-[280px] w-auto"
                : image.aspect === "wide"
                  ? "h-auto w-[400px]"
                  : "h-[260px] w-[260px]"
            }
          />
        </div>
      )}

      {/* Main content column */}
      <div className="relative z-10 flex flex-1 flex-col justify-between px-[80px] py-[70px]">
        {/* Top: eyebrow chip + date */}
        <div className="flex flex-col items-start gap-[14px]">
          <div
            className="inline-flex items-center rounded-full px-6 py-2.5 text-[22px] font-extrabold uppercase tracking-widest"
            style={{
              backgroundColor: palette.accent,
              color: palette.chipText,
              boxShadow: `0 4px 14px ${palette.accent}66`,
            }}
          >
            ★ {eyebrow}
          </div>
          <div
            className="text-[20px] font-semibold opacity-75"
            style={{ color: palette.accentDeep }}
          >
            {dateLabel}
          </div>
        </div>

        {/* Middle: HERO hook */}
        <div className="flex max-w-[920px] flex-col gap-[28px]">
          <div
            className="font-black leading-[1.08] text-slate-900"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.02em",
            }}
          >
            {truncatedHook}
          </div>

          {/* Scroll-hint dashes */}
          <svg
            viewBox="0 0 1080 60"
            width="700"
            height="40"
            aria-hidden
            style={{ color: palette.accent }}
          >
            {Array.from({ length: 11 }).map((_, i) => (
              <line
                key={i}
                x1={60 + i * 90}
                y1={30}
                x2={120 + i * 90}
                y2={30}
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                opacity="0.5"
              />
            ))}
          </svg>
        </div>

        {/* Bottom: tilted daleel card + CTA */}
        <div className="flex flex-col gap-[26px]">
          {daleel && (daleel.arabic || translation) && (
            <div
              className="flex max-w-[820px] flex-col gap-3 rounded-3xl border-2 bg-white px-7 py-6 shadow-xl"
              style={{
                borderColor: "#d8b4fe",
                boxShadow: `0 8px 24px ${palette.accent}33`,
                transform: "rotate(-1.2deg)",
              }}
            >
              {daleel.arabic && (
                <div
                  dir="rtl"
                  className="font-amiri font-bold leading-[1.5]"
                  style={{
                    fontSize: "38px",
                    color: palette.accentDeep,
                  }}
                >
                  {daleel.arabic.length > 100
                    ? daleel.arabic.slice(0, 100) + "…"
                    : daleel.arabic}
                </div>
              )}
              {translation && (
                <div
                  className="text-[22px] italic leading-[1.4]"
                  style={{ color: "#0f172a" }}
                >
                  &ldquo;
                  {translation.length > 180
                    ? translation.slice(0, 180) + "…"
                    : translation}
                  &rdquo;
                </div>
              )}
              <div
                className="text-[18px] font-extrabold tracking-wider"
                style={{ color: palette.accent }}
              >
                — {daleel.citation}
              </div>
            </div>
          )}

          {/* CTA + brand */}
          <div className="flex items-center justify-between gap-6">
            {cta && (
              <div
                className="flex items-center gap-2 text-[26px] font-bold"
                style={{ color: palette.accentDeep }}
              >
                {cta}
                <span className="text-[28px]">→</span>
              </div>
            )}
            <div
              className="text-[22px] font-extrabold tracking-wider"
              style={{ color: palette.accentDeep }}
            >
              {brand}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
