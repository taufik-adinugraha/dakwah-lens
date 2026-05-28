import { Citation, QuoteGlyph } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * QuoteCard — photo backdrop + floating content (genz-b slot).
 *
 * Three sub-variants:
 *   - variant 0: photo as full backdrop with strong tinted overlay
 *   - variant 1: photo cropped to top-half banner, content on a soft
 *     pattern below
 *   - variant 2: photo as polaroid-style square card centered on
 *     pattern background, content wrapped around it
 */
export const QuoteCard: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
  layoutVariant,
}) => {
  const { daleel, headline, message, dateLabel, brand } = content;
  const isEnglish = locale === "en";
  const translation = daleel
    ? isEnglish
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || ""
    : "";
  const transLen = translation.length;
  const transSize =
    transLen < 280 ? 22 : transLen < 440 ? 19 : transLen < 560 ? 17 : 15;

  const bgStops = palette.bgGradient;
  const bgStyle = {
    background: `linear-gradient(135deg, ${bgStops[0]} 0%, ${bgStops[1]} ${bgStops[2] ? "55%" : "100%"}${bgStops[2] ? `, ${bgStops[2]} 100%` : ""})`,
  };

  const headlineSize =
    headline.length < 18 ? "92px" : headline.length < 28 ? "76px" : "60px";

  // Variant 0: photo backdrop, dark overlay → text in white
  if (layoutVariant === 0) {
    return (
      <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assets.primary}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${palette.accent}d0 0%, ${palette.accentDeep}cc 60%, ${palette.accentDeep}f0 100%)`,
          }}
        />
        {/* Decorative offset circles */}
        <div
          className="absolute -right-32 -top-32 h-[420px] w-[420px] rounded-full"
          style={{ background: palette.accentSoft, opacity: 0.25 }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[70px]">
          <div className="flex items-center justify-between">
            <div
              className="inline-flex rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
              style={{
                backgroundColor: "rgba(255,255,255,0.95)",
                color: palette.accentDeep,
              }}
            >
              {brand}
            </div>
            <div className="text-[18px] font-bold text-white opacity-90">
              {dateLabel}
            </div>
          </div>

          <div className="flex flex-col gap-[26px]">
            <div
              className="font-black leading-[1.05] text-white"
              style={{
                fontSize: headlineSize,
                letterSpacing: "-0.025em",
                textShadow: "0 2px 12px rgba(0,0,0,0.4)",
              }}
            >
              {headline}
            </div>
            {message && (
              <div
                className="max-w-[900px] text-[24px] font-semibold leading-[1.45]"
                style={{ color: "#ffffffec" }}
              >
                {message}
              </div>
            )}
          </div>

          {daleel && translation && (
            <div
              data-autofit
              data-fit-min="13"
              className="relative flex max-w-[860px] flex-col gap-3 rounded-3xl bg-white px-8 py-6 shadow-2xl"
              style={{
                boxShadow: `0 18px 48px ${palette.accentDeep}88`,
                borderTop: `8px solid ${palette.accent}`,
                maxHeight: "340px",
                overflow: "hidden",
              }}
            >
              <QuoteGlyph
                color={palette.accent}
                className="absolute left-4 top-1 z-0"
              />
              <div
                className="relative z-10 font-medium italic leading-[1.45] text-slate-800"
                style={{ fontSize: `${transSize}px` }}
              >
                &ldquo;{translation}&rdquo;
              </div>
              <Citation
                citation={daleel.citation}
                color={palette.accent}
                className="relative z-10"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Variant 1: photo top-banner, content on gradient pattern below
  if (layoutVariant === 1) {
    return (
      <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden" style={bgStyle}>
        {/* Top photo banner */}
        <div className="relative h-[440px] w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accentDeep}66 0%, transparent 30%, transparent 60%, ${bgStops[bgStops[2] ? 2 : 1]}f0 100%)`,
            }}
          />
          <div className="absolute left-[80px] top-[60px]">
            <div
              className="inline-flex rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
              style={{ backgroundColor: "rgba(255,255,255,0.95)", color: palette.accentDeep }}
            >
              {brand}
            </div>
          </div>
          <div className="absolute right-[80px] top-[68px] text-[18px] font-bold text-white opacity-95">
            {dateLabel}
          </div>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-1 flex-col justify-between px-[80px] pb-[60px] pt-[40px]">
          <div className="flex flex-col gap-[24px]">
            <div
              className="font-black leading-[1.05]"
              style={{
                fontSize: headlineSize,
                color: palette.accentDeep,
                letterSpacing: "-0.025em",
              }}
            >
              {headline}
            </div>
            {message && (
              <div className="max-w-[920px] text-[24px] font-semibold leading-[1.45]" style={{ color: "#1f1f1f" }}>
                {message}
              </div>
            )}
          </div>

          {daleel && translation && (
            <div
              data-autofit
              data-fit-min="13"
              className="flex max-w-[880px] flex-col gap-3 rounded-3xl bg-white px-8 py-6 shadow-2xl"
              style={{
                boxShadow: `0 14px 36px ${palette.accent}55`,
                borderTop: `8px solid ${palette.accent}`,
                maxHeight: "340px",
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
  }

  // Variant 2: polaroid photo card + content
  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden" style={bgStyle}>
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{ color: palette.accentDeep }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.dotsPattern} alt="" className="h-full w-full object-cover" />
      </div>

      {/* Top frame */}
      <div className="absolute left-[80px] top-[60px]">
        <div
          className="inline-flex rounded-full px-5 py-2 text-[18px] font-extrabold tracking-widest"
          style={{ backgroundColor: palette.accent, color: palette.chipText }}
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

      <div className="relative z-10 flex h-full items-center justify-center px-[60px]">
        <div className="flex w-full items-center gap-[40px]">
          {/* Polaroid photo */}
          <div
            className="h-[440px] w-[400px] flex-shrink-0 rounded-3xl bg-white p-3 shadow-2xl"
            style={{
              boxShadow: `0 22px 48px ${palette.accent}55`,
              transform: "rotate(-3deg)",
            }}
          >
            <div className="h-full w-full overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assets.primary} alt="" className="h-full w-full object-cover" />
            </div>
          </div>

          {/* Text column */}
          <div className="flex flex-1 flex-col gap-[22px]">
            <div
              className="font-black leading-[1.05]"
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
                className="text-[22px] font-semibold leading-[1.45]"
                style={{ color: "#1f1f1f" }}
              >
                {message}
              </div>
            )}
            {daleel && translation && (
              <div
                data-autofit
                data-fit-min="12"
                className="flex flex-col gap-2 rounded-2xl bg-white px-6 py-4 shadow-lg"
                style={{
                  borderLeft: `6px solid ${palette.accent}`,
                  maxHeight: "260px",
                  overflow: "hidden",
                }}
              >
                <div
                  className="font-medium italic leading-[1.4] text-slate-800"
                  style={{ fontSize: `${Math.min(transSize, 18)}px` }}
                >
                  &ldquo;{translation}&rdquo;
                </div>
                <Citation citation={daleel.citation} color={palette.accent} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
