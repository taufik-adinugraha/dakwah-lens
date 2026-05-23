import type { FlyerLayoutComponent } from "./types";

/**
 * HeroHeadline — bold headline-driven layout (genz-a slot).
 *
 * The 4-5 word headline IS the visual focus (Inter Black, 90-110px).
 * Saturated 3-stop gradient backdrop, 3-4 sentence message below the
 * headline, daleel demoted to a tilted supporting card. No "made for
 * Gen Z" label — the design itself plays the role.
 */
export const HeroHeadline: FlyerLayoutComponent = ({
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

  const headlineSize =
    headline.length < 18 ? "118px" : headline.length < 28 ? "98px" : "78px";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Two corner gradient blobs */}
      <div
        className="absolute -left-32 -top-32 h-[500px] w-[500px] rounded-full opacity-[0.30]"
        style={{ background: palette.accent }}
      />
      <div
        className="absolute -bottom-28 -right-28 h-[520px] w-[520px] rounded-full opacity-[0.32]"
        style={{ background: "#f59e0b" }}
      />

      {/* Ornament corner accent — gives emotional nuance without
          competing with the headline. */}
      {image.kind === "ornament" && (
        <div
          className="absolute -right-[40px] top-[160px] opacity-[0.30]"
          style={{ color: palette.accent }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className={
              image.aspect === "tall"
                ? "h-[420px] w-auto"
                : image.aspect === "wide"
                  ? "h-auto w-[480px]"
                  : "h-[400px] w-[400px]"
            }
          />
        </div>
      )}
      {/* If we got a photo instead of ornament, anchor it as a small
          circular accent in the corner so the layout still always has
          an image. */}
      {image.kind === "photo" && (
        <div
          className="absolute right-[60px] top-[60px] h-[180px] w-[180px] overflow-hidden rounded-full shadow-2xl ring-4"
          style={{
            // Avoid optional-chaining (Satori still mid-flight in toolchain)
            borderColor: palette.accent,
            // ring shadow approx via boxShadow
            boxShadow: `0 0 0 6px ${palette.accent}33, 0 12px 28px ${palette.accent}66`,
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

        {/* HERO block: headline + scroll-hint dashes + message */}
        <div className="flex max-w-[940px] flex-col gap-[26px]">
          <div
            className="font-black leading-[1.04] text-slate-900"
            style={{
              fontSize: headlineSize,
              letterSpacing: "-0.025em",
            }}
          >
            {headline}
          </div>
          <svg
            viewBox="0 0 1080 60"
            width="700"
            height="32"
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
                strokeWidth="5"
                strokeLinecap="round"
                opacity="0.55"
              />
            ))}
          </svg>
          {message && (
            <div
              className="max-w-[860px] text-[26px] font-semibold leading-[1.45]"
              style={{ color: "#1f1f1f" }}
            >
              {message}
            </div>
          )}
        </div>

        {/* Daleel tilted card */}
        {daleel && (daleel.arabic || translation) && (
          <div
            className="flex max-w-[820px] flex-col gap-3 rounded-3xl border-2 bg-white px-7 py-6 shadow-xl"
            style={{
              borderColor: palette.accentSoft,
              boxShadow: `0 12px 28px ${palette.accent}40`,
              transform: "rotate(-1.5deg)",
            }}
          >
            {daleel.arabic && (
              <div
                dir="rtl"
                className="font-amiri font-bold leading-[1.5]"
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
              <div className="text-[20px] italic leading-[1.4] text-slate-800">
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
    </div>
  );
};
