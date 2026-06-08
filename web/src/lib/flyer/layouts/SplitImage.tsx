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
  // Bumped 2026-06-06 — see QuoteCard for rationale.
  const transSize =
    transLen < 220 ? 25 : transLen < 320 ? 22 : transLen < 440 ? 19 : transLen < 560 ? 17 : 15;

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
  const ContentPanel = (
    <div
      className="relative flex h-full w-full flex-col justify-between"
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
            maxHeight: "300px",
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
