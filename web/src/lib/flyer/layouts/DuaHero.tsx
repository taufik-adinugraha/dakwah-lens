import { Citation } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * DuaHero — Arabic du'a as the visual centerpiece.
 *
 * Use for the sunnah-b slot ("Doa Pekan Ini"). The whole point of this
 * flyer is for a reader to RECITE the du'a — so the Arabic with full
 * harakat needs the biggest visual real-estate the canvas can give.
 * Translation card sits underneath as supporting context.
 *
 * Differs from HeroAyat in two ways:
 *   - HeroAyat intentionally hides Arabic (predictable text length on
 *     the general-a slot). DuaHero requires it.
 *   - Brand chip + date small at the top, big-quote ornament + Arabic
 *     fill the middle 65% of the canvas, translation + citation card
 *     sits at the bottom 30%.
 *
 * Layout variants rotate the corner ornament (geometric / arabesque /
 * star border) so successive editions feel fresh.
 */
export const DuaHero: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
  layoutVariant,
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

  // Tier the Arabic font size against character count — short du'a
  // (e.g. QS. Al-Anbiya: 87 "Lā ilāha illā anta…") gets very large
  // typography; long du'a (Hisnul Muslim morning adhkar paragraphs)
  // step down so the whole text still fits inside the canvas.
  // Tightened twice (2026-05-24): once after RaS 776 (~640 chars)
  // overflowed, again after RaS 753 (~400 visible-line chars) also
  // overflowed under the previous tiers — bottom-half sizes pulled
  // down so even at the longest du'a the Arabic stays inside the
  // ~430px slot (530px outer minus the 100px decorative glyph).
  const arLen = arabic.length;
  const arabicSize =
    arLen < 70
      ? "108px"
      : arLen < 130
        ? "82px"
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

  // Translation card sits absolutely at the bottom of the canvas
  // (~300px max-height after the layout refactor). The translation
  // font shrinks with combined Arabic+translation weight, and a
  // generous per-tier char cap matches how many chars actually fit
  // in the card at that size. Previous tiers (capping at 240 chars
  // on the smallest tier) were calibrated for the older flex layout
  // when the card could be pushed off-canvas — that's not a concern
  // anymore so we can keep more translation text on screen.
  const transRaw = translation;
  // Starting translation size — the runtime auto-fit pass (snap.ts,
  // `data-autofit`) shrinks from here until the FULL text fits the
  // card, so we no longer truncate. This is just a sensible ceiling so
  // a short du'a translation doesn't render comically large.
  const weight = arLen * 3 + transRaw.length;
  let transSize = 22;
  if (weight > 700) transSize = 20;
  if (weight > 1100) transSize = 17;
  if (weight > 1700) transSize = 15;

  // Rotate the backdrop photo + white-veil treatment by edition variant
  // so successive du'a flyers don't look identical. Always white-
  // dominated (the veil keeps min ~0.7 white), so the dark Arabic stays
  // crisp whichever photo lands.
  const bgPool =
    assets.duaBackgrounds.length > 0 ? assets.duaBackgrounds : [assets.primary];
  const bgSrc = bgPool[layoutVariant % bgPool.length];
  const veils = [
    // image strongest at the bottom
    "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.9) 45%, rgba(255,255,255,0.74) 100%)",
    // image strongest at the top
    "linear-gradient(0deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.9) 45%, rgba(255,255,255,0.76) 100%)",
    // image faint, concentrated lower-center
    "radial-gradient(120% 90% at 50% 78%, rgba(255,255,255,0.66) 0%, rgba(255,255,255,0.9) 55%, rgba(255,255,255,0.98) 100%)",
    // image strongest on the right
    "linear-gradient(270deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.76) 100%)",
  ];
  const veil = veils[layoutVariant % veils.length];

  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden bg-white">
      {/* Default du'a-flyer backdrop: a calm contemplative photo (rotated
          per edition) under a heavy white veil — white-dominated so the
          dark Arabic stays crisp and the page reads clean. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bgSrc}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0" style={{ background: veil }} />

      {/* Corner ornament — variant rotates star border / arabesque /
          geometric arcs. All three are subtle so the Arabic stays
          dominant. */}
      {layoutVariant === 0 && (
        <>
          <div
            className="absolute left-0 right-0 top-0 h-[40px]"
            style={{ color: palette.accent, opacity: 0.45 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 h-[40px]"
            style={{ color: palette.accent, opacity: 0.45 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={assets.starsRow} alt="" className="block h-full w-full" />
          </div>
        </>
      )}
      {layoutVariant === 1 && (
        <>
          <div
            className="absolute -left-32 -top-32 h-[440px] w-[440px] rounded-full opacity-30"
            style={{ background: palette.accentSoft }}
          />
          <div
            className="absolute -bottom-28 -right-28 h-[460px] w-[460px] rounded-full opacity-25"
            style={{ background: palette.accent }}
          />
        </>
      )}
      {layoutVariant === 2 && (
        <svg
          className="absolute -right-[160px] -top-[160px] h-[600px] w-[600px]"
          viewBox="0 0 600 600"
          aria-hidden
          style={{ color: palette.accent }}
        >
          {[220, 170, 120, 70].map((r, i) => (
            <circle
              key={r}
              cx={300}
              cy={300}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={i % 2 === 0 ? 4 : 2}
              opacity={0.2 - i * 0.03}
            />
          ))}
        </svg>
      )}
      {layoutVariant === 3 && (
        <>
          <div
            className="absolute left-0 right-0 top-0 h-[14px]"
            style={{ background: palette.accent, opacity: 0.55 }}
          />
          <div
            className="absolute bottom-0 left-0 right-0 h-[14px]"
            style={{ background: palette.accent, opacity: 0.55 }}
          />
        </>
      )}

      {/* Top bar — small brand + date so the Arabic gets all the focus. */}
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

      {/* Arabic block: fills the vertical space BETWEEN the top bar
          (~120px) and the translation card (~410px from bottom). Hard
          maxHeight + overflow:hidden means even a worst-case du'a
          can't push the card off the canvas — the Arabic clips
          gracefully via the fade mask below instead. The top offset
          covers brand + decorative glyph; the bottom offset reserves
          card height + outer padding. */}
      <div
        className="absolute left-0 right-0 z-10 flex flex-col items-center"
        style={{
          top: "140px",
          bottom: "410px",
          paddingLeft: "70px",
          paddingRight: "70px",
        }}
      >
        {/* Decorative opening quote glyph */}
        <div
          aria-hidden
          className="text-[140px] font-black leading-none"
          style={{
            color: palette.accent,
            opacity: 0.22,
            letterSpacing: "-0.05em",
          }}
        >
          ﴾
        </div>

        {/* Arabic du'a — RTL, Amiri. Hard-clipped inside the slot so
            the bottom card stays at its reserved position. */}
        {arabic ? (
          <div
            dir="rtl"
            lang="ar"
            data-autofit
            data-fit-min="20"
            className="mt-[8px] w-full max-w-[920px] text-center font-amiri"
            style={{
              fontSize: arabicSize,
              lineHeight: arabicLine,
              color: "#0f172a",
              flex: "1 1 0%",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {arabic}
          </div>
        ) : (
          <div
            className="mt-[8px] max-w-[820px] text-center text-[44px] font-black tracking-tight text-slate-900"
            style={{ letterSpacing: "-0.022em" }}
          >
            Doa Pekan Ini
          </div>
        )}
      </div>

      {/* Tally separator + Translation + citation card. Anchored to
          the canvas bottom so the Arabic block above can never push
          this off-canvas, regardless of du'a length. */}
      <div
        className="absolute left-0 right-0 z-10 flex flex-col items-center px-[70px]"
        style={{ bottom: "70px" }}
      >
        <svg
          viewBox="0 0 600 60"
          width="280"
          height="22"
          aria-hidden
          className="mb-[18px]"
          style={{ color: palette.accent }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <line
              key={i}
              x1={20 + i * 95}
              y1={30}
              x2={75 + i * 95}
              y2={30}
              stroke="currentColor"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.55"
            />
          ))}
        </svg>

        {(translation || citation) && (
          <div
            className="flex max-w-[940px] flex-col gap-3 rounded-3xl px-7 py-6"
            style={{
              backgroundColor: "rgba(255,255,255,0.94)",
              boxShadow: `0 14px 36px ${palette.accentDeep}40`,
              border: `1px solid ${palette.accentSoft}`,
              // Hard ceiling matches the bottom-410px reservation above.
              // The card is a flex column: when the translation is long
              // and the card hits this ceiling, the translation row
              // (flex-1, min-h-0) is the bounded box the auto-fit pass
              // shrinks the FULL text into — so nothing is truncated.
              maxHeight: "300px",
              overflow: "hidden",
            }}
          >
            {transRaw && (
              <div
                data-autofit
                data-fit-min="13"
                className="min-h-0 flex-1 overflow-hidden text-center font-medium italic text-slate-800"
                style={{
                  fontSize: `${transSize}px`,
                  lineHeight: 1.45,
                }}
              >
                &ldquo;{transRaw}&rdquo;
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
};
