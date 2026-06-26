import { Citation } from "./decor";
import type { FlyerLayoutComponent, FlyerPalette } from "./types";

/**
 * DuaHero — the du'a flyer (sunnah-b slot). The reader RECITES the du'a,
 * so the harakat-complete Arabic is the centerpiece.
 *
 * Layout: centered white card floating over an UN-VEILED background
 * photo. The card has its own opaque white background; the surrounding
 * photo shows through at full fidelity (no white-gradient overlay).
 *
 * Previously rotated between three compositions (backdrop / card /
 * banner) — the backdrop + banner variants relied on a white-gradient
 * overlay washing out the photo to keep the dark Arabic readable, which
 * the user removed on 2026-06-11. Card is the only variant now; the
 * backdrop + banner functions were deleted (git history preserves them
 * if a future rotation needs to resurrect).
 *
 * The background photo is chosen upstream in compose.ts
 * (pickDuaBackground) from the vetted 70-photo du'a pool and arrives as
 * `assets.primary`, hashed on the du'a content so successive du'a
 * flyers don't all look identical.
 */

export const DuaHero: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
}) => {
  const { daleel, dateLabel, brand } = content;
  const isEnglish = locale === "en";
  const arabic = daleel?.arabic ?? "";
  const translation = daleel
    ? isEnglish
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || ""
    : "";
  const citation = daleel?.citation ?? "";

  const arLen = arabic.length;
  // Starting Arabic size by length; the runtime auto-fit pass (snap.ts)
  // shrinks it further if it still overflows its bounded slot.
  const arabicSize =
    arLen < 70
      ? "104px"
      : arLen < 130
        ? "80px"
        : arLen < 200
          ? "58px"
          : arLen < 300
            ? "44px"
            : arLen < 400
              ? "34px"
              : arLen < 550
                ? "28px"
                : "24px";
  const arabicLine =
    arLen < 130 ? "1.7" : arLen < 300 ? "1.7" : arLen < 550 ? "1.55" : "1.45";
  const weight = arLen * 3 + translation.length;
  let transSize = 22;
  if (weight > 700) transSize = 20;
  if (weight > 1100) transSize = 17;
  if (weight > 1700) transSize = 15;

  const bgSrc = assets.primary;

  const p: DuaProps = {
    arabic,
    translation,
    citation,
    brand,
    dateLabel,
    kicker: isEnglish ? "Du'a of the Week" : "Doa Pekan Ini",
    palette,
    bgSrc,
    arabicSize,
    arabicLine,
    transSize,
  };

  return <CardComposition {...p} />;
};

type DuaProps = {
  arabic: string;
  translation: string;
  citation: string;
  brand: string;
  dateLabel: string;
  kicker: string;
  palette: FlyerPalette;
  bgSrc: string;
  arabicSize: string;
  arabicLine: string;
  transSize: number;
};

/** Shared: the Arabic du'a block. `flex-1 min-h-0 overflow-hidden` makes
 *  it the bounded box the auto-fit pass shrinks into, so it always fits
 *  whatever slot the composition gives it.
 *
 *  Padding rationale (2026-06-09): line-height alone reserves space
 *  WITHIN the first line-box, but harakat ascenders (fathah, dhammah,
 *  sukūn, shaddah) on the first line render ABOVE the line-box top —
 *  and the container's `overflow: hidden` (kept for autofit) clips
 *  them at the container's top edge. `paddingTop: "0.32em"` gives the
 *  first-line ascenders headroom that scales with the font size, so
 *  a 104px Arabic gets ~33px of clearance and a 28px Arabic gets ~9px.
 *  `paddingBottom: "0.12em"` does the same for kasrah-style descenders
 *  on the last line. The autofit pass measures clientHeight which
 *  already includes padding, so no recalibration needed there. */
function ArabicBlock({
  arabic,
  size,
  line,
}: {
  arabic: string;
  size: string;
  line: string;
}) {
  if (!arabic) {
    return (
      <div className="mt-2 text-center text-[44px] font-black tracking-tight text-slate-900">
        Doa Pekan Ini
      </div>
    );
  }
  return (
    <div
      dir="rtl"
      lang="ar"
      data-autofit
      data-fit-min="20"
      className="mt-2 w-full max-w-[920px] text-center font-amiri"
      style={{
        fontSize: size,
        lineHeight: line,
        paddingTop: "0.32em",
        paddingBottom: "0.12em",
        color: "#0f172a",
        flex: "1 1 0%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {arabic}
    </div>
  );
}


// ── Composition 1: centered white card over the photo ─────────────
function CardComposition({
  arabic,
  translation,
  citation,
  brand,
  dateLabel,
  kicker,
  palette,
  bgSrc,
  arabicSize,
  arabicLine,
  transSize,
}: DuaProps) {
  return (
    <div className="relative flex h-[1080px] w-[1080px] items-center justify-center overflow-hidden bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* No white-gradient overlay on the photo — the centered card has
          its own opaque white background; the photo can show through
          fully outside the card (2026-06-11). */}

      <div className="absolute left-0 right-0 top-[60px] z-10 flex items-center justify-between px-[64px]">
        <span
          className="rounded-full bg-white/90 px-4 py-1.5 text-[18px] font-extrabold tracking-tight shadow-sm"
          style={{ color: palette.accentDeep }}
        >
          {brand}
        </span>
        <span
          className="rounded-full bg-white/85 px-3 py-1 text-[15px] font-bold shadow-sm"
          style={{ color: palette.accentDeep }}
        >
          {dateLabel}
        </span>
      </div>

      <div
        className="relative z-10 flex max-h-[820px] w-[900px] flex-col items-center overflow-hidden rounded-[36px] bg-white px-10 py-9 text-center"
        style={{
          boxShadow: `0 30px 80px ${palette.accentDeep}45`,
          borderTop: `10px solid ${palette.accent}`,
        }}
      >
        <span
          className="shrink-0 rounded-full px-3 py-1 text-[13px] font-extrabold uppercase tracking-[0.2em]"
          style={{ backgroundColor: palette.accentSoft, color: palette.accentDeep }}
        >
          {kicker}
        </span>
        <ArabicBlock arabic={arabic} size={arabicSize} line={arabicLine} />
        <div
          className="my-4 h-[3px] w-20 shrink-0 rounded-full"
          style={{ backgroundColor: palette.accent }}
          aria-hidden
        />
        {translation && (
          <div
            data-autofit
            data-fit-min="13"
            className="max-h-[230px] w-full overflow-hidden font-medium italic leading-relaxed text-slate-700"
            style={{ fontSize: `${transSize}px` }}
          >
            &ldquo;{translation}&rdquo;
          </div>
        )}
        {citation && (
          <div className="shrink-0 pt-4">
            <Citation citation={citation} color={palette.accentDeep} align="center" />
          </div>
        )}
      </div>
    </div>
  );
}
