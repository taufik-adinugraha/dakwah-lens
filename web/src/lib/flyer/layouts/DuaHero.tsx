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
  const arLen = arabic.length;
  const arabicSize =
    arLen < 70
      ? "108px"
      : arLen < 130
        ? "84px"
        : arLen < 200
          ? "68px"
          : arLen < 300
            ? "54px"
            : "44px";
  const arabicLine = arLen < 130 ? "1.7" : "1.85";

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

      <div className="relative z-10 flex h-full flex-col px-[70px] pt-[70px] pb-[70px]">
        {/* Top bar — small brand + date so the Arabic gets all the focus. */}
        <div className="flex items-center justify-between">
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

        {/* Decorative opening quote glyph */}
        <div
          aria-hidden
          className="mx-auto mt-[34px] text-[160px] font-black leading-none"
          style={{
            color: palette.accent,
            opacity: 0.22,
            letterSpacing: "-0.05em",
          }}
        >
          ﴾
        </div>

        {/* Arabic du'a — RTL, Amiri, the visual focal point. */}
        {arabic ? (
          <div
            dir="rtl"
            lang="ar"
            className="mx-auto mt-[8px] max-w-[920px] text-center font-amiri text-emerald-950"
            style={{
              fontSize: arabicSize,
              lineHeight: arabicLine,
              color: "#0f172a",
            }}
          >
            {arabic}
          </div>
        ) : (
          <div
            className="mx-auto mt-[8px] max-w-[820px] text-center text-[44px] font-black tracking-tight text-slate-900"
            style={{ letterSpacing: "-0.022em" }}
          >
            Doa Pekan Ini
          </div>
        )}

        {/* Tally separator between Arabic and translation card */}
        <svg
          viewBox="0 0 600 60"
          width="280"
          height="22"
          aria-hidden
          className="mx-auto mt-[28px]"
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

        {/* Translation + citation card */}
        {(translation || citation) && (
          <div
            className="mx-auto mt-auto flex max-w-[940px] flex-col gap-3 rounded-3xl px-7 py-6"
            style={{
              backgroundColor: "rgba(255,255,255,0.94)",
              boxShadow: `0 14px 36px ${palette.accentDeep}40`,
              border: `1px solid ${palette.accentSoft}`,
            }}
          >
            {translation && (
              <div className="text-[22px] italic leading-[1.5] text-slate-800">
                &ldquo;{translation}&rdquo;
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
