import type { FlyerLayoutComponent } from "./types";

/**
 * PosterQuestion — campus bulletin-board poster.
 *
 * Single hero question, set very large. Designed to stop a student
 * walking past a jurusan noticeboard. No labels, no chips, no CTA
 * text — the question IS the entire message. Brand + date are kept
 * small at the corners so the typography stays the dominant element.
 *
 * Design constraints (learned the hard way):
 *   - No dark band at the bottom. Long questions overflow into it
 *     and a dark text on dark band is illegible.
 *   - Photo as a SIDE accent, not a full band — keeps the text area
 *     uniformly light.
 *   - All text colors checked against the gradient stops so nothing
 *     ever falls back into a low-contrast zone.
 *
 * Same 1080×1080 frame as the share flyers so the existing Puppeteer
 * pipeline + asset registry work unchanged.
 */
export const PosterQuestion: FlyerLayoutComponent = ({
  content,
  palette,
  assets,
  layoutVariant,
}) => {
  const { headline, dateLabel, brand } = content;
  const bgStops = palette.bgGradient;

  // 2-stop only — the 3rd stop in some palettes is the deep accent that
  // landed at the BOTTOM with the old design and caused the dark-text-
  // on-dark-background bug. Clamp to the lightest two stops so the
  // canvas stays bright top-to-bottom.
  const bgStyle = {
    background: `linear-gradient(140deg, ${bgStops[0]} 0%, ${bgStops[1]} 100%)`,
  };

  // Aggressive scaling — the question is the only thing on the card.
  const len = headline.length;
  const fontSize =
    len < 50 ? "132px" : len < 75 ? "106px" : len < 100 ? "88px" : "76px";

  // Photo accent shape rotates so a weekly viewer sees variety. All
  // three placements are SIDE accents, not full-width bands, so the
  // text column (left 60-65%) stays on the light gradient at every
  // vertical position.
  const PhotoAccent = (() => {
    if (layoutVariant === 0) {
      // Right-side rounded strip, full height
      return (
        <div
          className="absolute right-[60px] top-[120px] bottom-[120px] w-[280px] overflow-hidden rounded-[36px] shadow-2xl"
          style={{ boxShadow: `0 18px 40px ${palette.accent}55` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accent}20 0%, transparent 50%, ${palette.accent}30 100%)`,
            }}
          />
        </div>
      );
    }
    if (layoutVariant === 1) {
      // Top-right large circle
      return (
        <div
          className="absolute right-[80px] top-[100px] h-[280px] w-[280px] overflow-hidden rounded-full shadow-2xl"
          style={{
            boxShadow: `0 0 0 8px ${palette.accent}25, 0 18px 40px ${palette.accent}55`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="h-full w-full object-cover"
          />
        </div>
      );
    }
    // variant 2: small bottom-right square accent
    return (
      <div
        className="absolute right-[60px] bottom-[80px] h-[220px] w-[300px] overflow-hidden rounded-[28px] shadow-2xl"
        style={{ boxShadow: `0 18px 40px ${palette.accent}55` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assets.primary}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  })();

  // Reserve right column when the photo eats horizontal space.
  const textColWidth = "max-w-[650px]";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Decorative corner blobs — uses the lighter accentSoft so the
          page never gets darker at the edges than at the center. */}
      <div
        className="absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full opacity-30"
        style={{ background: palette.accentSoft }}
      />
      <div
        className="absolute -bottom-32 -left-24 h-[420px] w-[420px] rounded-full opacity-25"
        style={{ background: palette.accent }}
      />

      {PhotoAccent}

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[70px]">
        {/* Top: brand only, top-left (compact) */}
        <div className="flex items-start justify-between">
          <div
            className="text-[22px] font-extrabold tracking-tight"
            style={{ color: palette.accentDeep }}
          >
            {brand}
          </div>
          <div
            className="text-[18px] font-bold opacity-80"
            style={{ color: palette.accentDeep }}
          >
            {dateLabel}
          </div>
        </div>

        {/* Question hero — vertically centered in remaining space */}
        <div
          className={`flex flex-col justify-center ${textColWidth} flex-1 py-10`}
        >
          {/* Big opening quote mark, transparent so it reads as
              ornament. Sized large for visual weight. */}
          <div
            aria-hidden
            className="mb-[20px] text-[200px] font-black leading-none"
            style={{
              color: palette.accent,
              opacity: 0.22,
              letterSpacing: "-0.05em",
            }}
          >
            “
          </div>
          <div
            className="font-black leading-[1.06] tracking-tight"
            style={{
              fontSize,
              color: "#0f172a",
              letterSpacing: "-0.025em",
            }}
          >
            {headline}
          </div>

          {/* Tally-mark separator — same color family as accent, lower
              opacity so it doesn't fight the headline. */}
          <svg
            viewBox="0 0 600 60"
            width="380"
            height="28"
            aria-hidden
            className="mt-[40px]"
            style={{ color: palette.accent }}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <line
                key={i}
                x1={20 + i * 80}
                y1={30}
                x2={70 + i * 80}
                y2={30}
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                opacity="0.55"
              />
            ))}
          </svg>
        </div>

        {/* Bottom bar — empty placeholder to keep flex spacing. The
            brand already sat at the top, so the bottom is intentionally
            quiet to avoid pulling attention from the question. */}
        <div aria-hidden className="h-[10px]" />
      </div>
    </div>
  );
};
