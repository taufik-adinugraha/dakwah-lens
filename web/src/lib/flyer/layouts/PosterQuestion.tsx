import type { FlyerLayoutComponent } from "./types";

/**
 * PosterQuestion — the campus bulletin-board poster. Single hero
 * question, set very large, designed to stop a student walking past a
 * jurusan noticeboard. No message body, no daleel — the article + Q&A
 * sit on a separate sheet (or in the briefing modal); this poster only
 * has to hook attention from across the corridor.
 *
 * Same 1080×1080 frame as the share flyers so the existing Puppeteer
 * pipeline + asset registry work unchanged.
 */
export const PosterQuestion: FlyerLayoutComponent = ({
  content,
  palette,
  assets,
}) => {
  const { headline, dateLabel, brand } = content;
  const bgStops = palette.bgGradient;
  const bgStyle = {
    background: `linear-gradient(135deg, ${bgStops[0]} 0%, ${bgStops[1]} ${bgStops[2] ? "55%" : "100%"}${bgStops[2] ? `, ${bgStops[2]} 100%` : ""})`,
  };

  // Aggressive scaling — the question is the only thing on the card, so
  // size it to dominate. Length here is rough character count of the
  // full sentence (10-18 Indonesian words ≈ 60-120 chars).
  const len = headline.length;
  const fontSize =
    len < 50 ? "138px" : len < 75 ? "112px" : len < 100 ? "94px" : "82px";

  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Photo backdrop: 35% bottom band with strong gradient overlay so
          the typography stays the dominant element. */}
      <div className="absolute bottom-0 left-0 right-0 h-[380px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assets.primary}
          alt=""
          className="h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${bgStops[bgStops[2] ? 2 : 1]}f5 0%, ${bgStops[bgStops[2] ? 2 : 1]}d8 40%, transparent 75%, ${palette.accentDeep}aa 100%)`,
          }}
        />
      </div>

      {/* Corner blobs */}
      <div
        className="absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full opacity-[0.30]"
        style={{ background: palette.accent }}
      />
      <div
        className="absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full opacity-[0.20]"
        style={{ background: palette.accentSoft }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[70px]">
        {/* Top bar: small Mahasiswa pack chip + date */}
        <div className="flex items-center justify-between">
          <div className="inline-flex flex-col gap-1">
            <div
              className="inline-flex items-center rounded-full px-5 py-2 text-[16px] font-extrabold uppercase tracking-[0.18em]"
              style={{
                backgroundColor: palette.accent,
                color: palette.chipText,
                boxShadow: `0 4px 14px ${palette.accent}55`,
              }}
            >
              Mahasiswa Pack
            </div>
            <div
              className="ml-2 text-[15px] font-semibold uppercase tracking-[0.15em] opacity-80"
              style={{ color: palette.accentDeep }}
            >
              Papan Pengumuman Pekan Ini
            </div>
          </div>
          <div
            className="text-[18px] font-bold opacity-80"
            style={{ color: palette.accentDeep }}
          >
            {dateLabel}
          </div>
        </div>

        {/* Question hero — flex-1 + items-start so it sits in the upper
            third, leaving room for the photo band below. */}
        <div className="flex flex-1 flex-col justify-center pr-[24px]">
          <div
            aria-hidden
            className="mb-[28px] text-[180px] font-black leading-none"
            style={{
              color: palette.accent,
              opacity: 0.18,
              letterSpacing: "-0.05em",
            }}
          >
            “
          </div>
          <div
            className="font-black leading-[1.05] text-slate-900"
            style={{
              fontSize,
              letterSpacing: "-0.028em",
            }}
          >
            {headline}
          </div>

          {/* Tally-mark separator */}
          <svg
            viewBox="0 0 1080 60"
            width="500"
            height="32"
            aria-hidden
            className="mt-[36px]"
            style={{ color: palette.accent }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <line
                key={i}
                x1={20 + i * 90}
                y1={30}
                x2={80 + i * 90}
                y2={30}
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                opacity="0.55"
              />
            ))}
          </svg>
        </div>

        {/* Footer: CTA + brand. Sits above the photo band thanks to z-10. */}
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <div
              className="text-[20px] font-bold uppercase tracking-[0.15em]"
              style={{ color: palette.accentDeep }}
            >
              Diskusi & Artikel Lengkap
            </div>
            <div className="text-[26px] font-extrabold text-white drop-shadow-md">
              {brand}
            </div>
          </div>
          <div
            className="rounded-2xl bg-white/95 px-5 py-3 text-[16px] font-bold uppercase tracking-[0.12em] shadow-xl"
            style={{ color: palette.accentDeep }}
          >
            Pasang di Papan Pengumuman →
          </div>
        </div>
      </div>
    </div>
  );
};
