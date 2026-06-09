import { Citation } from "./decor";
import type { FlyerLayoutComponent, FlyerPalette } from "./types";

/**
 * DuaHero — the du'a flyer (sunnah-b slot). The reader RECITES the du'a,
 * so the harakat-complete Arabic is the centerpiece.
 *
 * To stop successive editions looking identical, this rotates on a
 * content-derived hash (citation + Arabic length + date) across:
 *   - a curated set of calm white-veiled backdrop photos, AND
 *   - three genuinely distinct compositions:
 *       0 — veiled backdrop (photo behind, Arabic centered, bottom card)
 *       1 — centered white card floating over the photo
 *       2 — photo top-banner + clean white lower half
 * Every variant stays white-dominated so the dark Arabic stays crisp.
 */

// FNV-1a — small stable hash so a given du'a always maps to the same
// look (good for caching) while different du'a get different looks.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

  const bgPool =
    assets.duaBackgrounds.length > 0 ? assets.duaBackgrounds : [assets.primary];
  const rot = hashStr(`${citation}|${arLen}|${dateLabel}`);
  const bgSrc = bgPool[rot % bgPool.length];
  // Decorrelate composition from the bg index (different bits of the
  // hash) so image and layout vary independently — otherwise composition
  // i would always pair with background i.
  const composition = (rot >>> 8) % 3;

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

  if (composition === 1) return <CardComposition {...p} />;
  if (composition === 2) return <BannerComposition {...p} />;
  return <BackdropComposition {...p} />;
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

// ── Composition 0: veiled backdrop ────────────────────────────────
function BackdropComposition({
  arabic,
  translation,
  citation,
  brand,
  dateLabel,
  palette,
  bgSrc,
  arabicSize,
  arabicLine,
  transSize,
}: DuaProps) {
  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.9) 42%, rgba(255,255,255,0.72) 100%)",
        }}
      />

      <div
        className="absolute left-0 right-0 z-10 flex items-center justify-between px-[70px]"
        style={{ top: "70px" }}
      >
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

      <div
        className="absolute left-0 right-0 z-10 flex flex-col items-center"
        style={{
          top: "150px",
          bottom: "400px",
          paddingLeft: "70px",
          paddingRight: "70px",
        }}
      >
        <div
          aria-hidden
          className="text-[130px] font-black leading-none"
          style={{
            color: palette.accent,
            opacity: 0.2,
            letterSpacing: "-0.05em",
          }}
        >
          ﴾
        </div>
        <ArabicBlock arabic={arabic} size={arabicSize} line={arabicLine} />
      </div>

      <div
        className="absolute left-0 right-0 z-10 flex flex-col items-center px-[70px]"
        style={{ bottom: "70px" }}
      >
        <div
          className="mb-[18px] h-[4px] w-24 rounded-full"
          style={{ backgroundColor: palette.accent, opacity: 0.6 }}
          aria-hidden
        />
        {(translation || citation) && (
          <div
            className="flex max-w-[940px] flex-col gap-3 rounded-3xl px-7 py-6"
            style={{
              backgroundColor: "rgba(255,255,255,0.96)",
              boxShadow: `0 14px 36px ${palette.accentDeep}40`,
              border: `1px solid ${palette.accentSoft}`,
              maxHeight: "300px",
              overflow: "hidden",
            }}
          >
            {translation && (
              <div
                data-autofit
                data-fit-min="13"
                className="min-h-0 flex-1 overflow-hidden text-center font-medium italic text-slate-800"
                style={{ fontSize: `${transSize}px`, lineHeight: 1.45 }}
              >
                &ldquo;{translation}&rdquo;
              </div>
            )}
            {citation && (
              <Citation
                citation={citation}
                color={palette.accentDeep}
                align="center"
                className="shrink-0"
              />
            )}
          </div>
        )}
      </div>
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
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.68) 50%, rgba(255,255,255,0.85) 100%)",
        }}
      />

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

// ── Composition 2: photo top-banner + clean white lower half ──────
function BannerComposition({
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
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden bg-white">
      <div className="relative h-[380px] w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bgSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${palette.accentDeep}40 0%, transparent 40%, rgba(255,255,255,0.96) 100%)`,
          }}
        />
        <div className="absolute left-[64px] right-[64px] top-[58px] flex items-center justify-between">
          <span
            className="rounded-full bg-white/90 px-4 py-1.5 text-[18px] font-extrabold tracking-tight shadow-sm"
            style={{ color: palette.accentDeep }}
          >
            {brand}
          </span>
          <span className="text-[16px] font-bold text-white drop-shadow-md">
            {dateLabel}
          </span>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col items-center px-[80px] pb-[70px] pt-[20px] text-center">
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
            className="max-h-[240px] w-full max-w-[860px] overflow-hidden font-medium italic leading-relaxed text-slate-700"
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
