import { pickDaleelTranslation } from "../content";
import { Citation } from "./decor";
import type { FlyerLayoutComponent } from "./types";

/**
 * SplitImage — half-photo, half-content (general-b slot).
 *
 * Three sub-variants rotate the split orientation so successive
 * editions feel different:
 *   - variant 0: photo LEFT, content right (magazine cover)
 *   - variant 1: photo RIGHT, content left (mirrored cover)
 *   - variant 2: photo TOP, content bottom (landscape banner)
 */
export const SplitImage: FlyerLayoutComponent = ({
  content,
  palette,
  locale,
  assets,
  layoutVariant,
}) => {
  const { daleel, headline, message, dateLabel, brand } = content;
  const translation = pickDaleelTranslation(daleel, locale, {
    keywords: [headline, message].filter(Boolean) as string[],
  });
  const transLen = translation.length;
  // Tiers extended 2026-06-09: pickDaleelTranslation v3 returns up to
  // ~560 chars (was 400), since narrator-intro stripping freed budget
  // for the teaching. Tier breakpoints widened so longer translations
  // still land at a reading-friendly size before autofit kicks in.
  const transSize =
    transLen < 220 ? 25 : transLen < 320 ? 22 : transLen < 460 ? 19 : transLen < 620 ? 17 : 15;

  const isHorizontalSplit = layoutVariant !== 2;
  const isPhotoLeft = layoutVariant === 0;

  // Content panel width / height depends on split orientation.
  const headlineSize = isHorizontalSplit
    ? headline.length < 18
      ? "62px"
      : headline.length < 28
        ? "52px"
        : "42px"
    : headline.length < 18
      ? "92px"
      : headline.length < 28
        ? "76px"
        : "62px";

  // Re-usable photo panel.
  const PhotoPanel = (
    <div className="relative h-full w-full overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={assets.primary}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${palette.accentDeep}55 0%, transparent 30%, transparent 65%, ${palette.accentDeep}cc 100%)`,
        }}
      />
      <div className="absolute left-[40px] top-[50px]">
        <div
          className="inline-flex rounded-full bg-white/95 px-5 py-2 text-[16px] font-extrabold tracking-widest"
          style={{ color: palette.accentDeep }}
        >
          {brand}
        </div>
      </div>
      {daleel && (
        <div className="absolute bottom-[50px] left-[40px] right-[40px] text-white">
          <div className="text-xs font-bold uppercase tracking-[0.25em] opacity-80">
            {dateLabel}
          </div>
          <div className="mt-2 text-[20px] font-extrabold leading-tight">
            {daleel.citation}
          </div>
        </div>
      )}
    </div>
  );

  // Re-usable content panel.
  //
  // `gap-[32px]` on the outer flex sets the MINIMUM vertical breathing
  // room between sections (title → message → daleel → stars). Combined
  // with `justify-between`, any excess vertical space is then
  // distributed on top of that floor — so dense content (long body +
  // long daleel) doesn't squeeze sections to touch each other (the
  // 2026-06-09 incident: title and body merged into the daleel quote
  // box with zero gap, making the panel feel cramped).
  const ContentPanel = (
    <div
      className="relative flex h-full w-full flex-col justify-between gap-[32px]"
      style={{
        padding: isHorizontalSplit ? "60px 55px" : "70px 80px",
      }}
    >
      <div className="flex flex-col gap-[22px]">
        <div
          className="h-[5px] w-16 rounded-full"
          style={{ background: palette.accent }}
        />
        <h2
          className="font-black leading-[1.08] tracking-tight text-slate-900"
          style={{ fontSize: headlineSize, letterSpacing: "-0.015em" }}
        >
          {headline}
        </h2>
      </div>

      {message && (
        <div
          className={`text-[22px] font-medium leading-[1.5] text-slate-700 ${isHorizontalSplit ? "max-w-none" : "max-w-[920px]"}`}
        >
          {message}
        </div>
      )}

      {daleel && translation && (
        <div
          data-autofit
          data-fit-min="12"
          className="flex flex-col gap-3 border-l-4 pl-5"
          style={{
            borderColor: palette.accent,
            // Bounded box for the auto-fit pass: the full translation +
            // citation are scaled down together until they fit here.
            // Reduced from 300px → 260px (2026-06-09) so the outer
            // `gap-[32px]` always has room to apply even on full
            // densely-packed flyers (title + 4-sentence body + long
            // hadith translation).
            maxHeight: "260px",
            overflow: "hidden",
          }}
        >
          <div
            className="font-medium italic leading-[1.45] text-slate-700"
            style={{ fontSize: `${transSize}px` }}
          >
            &ldquo;{translation}&rdquo;
          </div>
          <Citation citation={daleel.citation} color={palette.accent} />
        </div>
      )}

      <div className="h-[36px]" style={{ color: palette.accent }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assets.starsRow} alt="" className="block h-full w-full" />
      </div>
    </div>
  );

  if (isHorizontalSplit) {
    return (
      <div className="relative flex h-[1080px] w-[1080px] overflow-hidden bg-white">
        {isPhotoLeft ? (
          <>
            <div className="h-full w-[480px]">{PhotoPanel}</div>
            <div className="flex-1">{ContentPanel}</div>
          </>
        ) : (
          <>
            <div className="flex-1">{ContentPanel}</div>
            <div className="h-full w-[480px]">{PhotoPanel}</div>
          </>
        )}
      </div>
    );
  }

  // variant 2: photo TOP, content BOTTOM.
  return (
    <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden bg-white">
      <div className="h-[440px] w-full">{PhotoPanel}</div>
      <div className="flex-1">{ContentPanel}</div>
    </div>
  );
};
