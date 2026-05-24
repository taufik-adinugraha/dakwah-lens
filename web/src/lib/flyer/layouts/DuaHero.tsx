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

  const bgStops = palette.bgGradient;
  const bgStyle = {
    // Soft 2-stop light gradient so the dark Arabic text stays readable.
    background: `linear-gradient(155deg, ${bgStops[0]} 0%, ${bgStops[1]} 100%)`,
  };

  // Tier the Arabic font size against character count — short du'a
  // (e.g. QS. Al-Anbiya: 87 "Lā ilāha illā anta…") gets very large
  // typography; long du'a (Hisnul Muslim morning adhkar paragraphs)
  // step down so the whole text still fits inside the canvas.
  // Tiers were tightened 2026-05-24 after Riyad as-Salihin 776 (a
  // ~640-char evening-adhkar paragraph) blew through the canvas and
  // pushed the translation card past the bottom edge — the bottom
  // bounds at 32/28 px keep even the longest Hisnul Muslim entries
  // inside the Arabic slot.
  const arLen = arabic.length;
  const arabicSize =
    arLen < 70
      ? "108px"
      : arLen < 130
        ? "84px"
        : arLen < 200
          ? "62px"
          : arLen < 300
            ? "48px"
            : arLen < 450
              ? "38px"
              : arLen < 650
                ? "32px"
                : "28px";
  const arabicLine =
    arLen < 130 ? "1.7" : arLen < 300 ? "1.75" : arLen < 650 ? "1.6" : "1.5";

  // Translation card sits at the bottom of the 1080-tall canvas. The
  // Arabic block above consumes vertical space proportional to its
  // length × font-size, so the translation must scale DOWN as Arabic
  // grows, and the text itself must truncate when even the smallest
  // size won't fit. Numbers below are calibrated to keep the card
  // inside the canvas across short-Quran (50 chars) → long-hadith
  // (500+ chars) content.
  const transRaw = translation;
  // Combined "weight": Arabic contributes ~3x its length, translation
  // its own length. Captures the "even small Arabic with massive
  // translation needs aggressive truncation" case too.
  const weight = arLen * 3 + transRaw.length;
  let transSize = 22;
  let transMax = 360;
  if (weight > 700) {
    transSize = 20;
    transMax = 320;
  }
  if (weight > 1100) {
    transSize = 17;
    transMax = 280;
  }
  if (weight > 1700) {
    transSize = 15;
    transMax = 240;
  }
  const truncatedTranslation =
    transRaw.length > transMax
      ? transRaw.slice(0, transMax).trimEnd().replace(/[,;:.]$/, "") + "…"
      : transRaw;

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
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
            className="mt-[8px] max-w-[920px] text-center font-amiri"
            style={{
              fontSize: arabicSize,
              lineHeight: arabicLine,
              color: "#0f172a",
              flex: "1 1 0%",
              minHeight: 0,
              overflow: "hidden",
              // Soft fade at the bottom so a clipped long du'a reads
              // as "more below" rather than abruptly cut. No-op when
              // the text fits comfortably.
              maskImage:
                "linear-gradient(to bottom, black 88%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black 88%, transparent 100%)",
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
              // Hard ceiling matches the bottom-410px reservation
              // above. Translation truncation guarantees we land
              // inside this; the cap is defense-in-depth.
              maxHeight: "300px",
              overflow: "hidden",
            }}
          >
            {truncatedTranslation && (
              <div
                className="italic text-slate-800"
                style={{
                  fontSize: `${transSize}px`,
                  lineHeight: 1.45,
                }}
              >
                &ldquo;{truncatedTranslation}&rdquo;
              </div>
            )}
            {citation && (
              <div
                className="text-[16px] font-extrabold tracking-wider"
                style={{ color: palette.accentDeep }}
              >
                — {citation}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
