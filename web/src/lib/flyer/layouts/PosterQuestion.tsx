import type { FlyerLayoutComponent } from "./types";

/** QR + URL badge — a white card with the article-page QR code on top
 *  and the visible URL underneath, so a phoneless reader can still
 *  type the URL by hand. White background guarantees the QR remains
 *  scannable on any palette / photo backdrop.
 *
 *  The italicized invitation under the URL nudges the scanner past
 *  passive reading into the public discussion section — the article
 *  page hosts a moderated comment thread per slug. */
function ArticleBadge({
  qrDataUrl,
  url,
  size = 196,
  align = "left",
}: {
  qrDataUrl?: string;
  url?: string;
  size?: number;
  align?: "left" | "right" | "center";
}) {
  if (!qrDataUrl || !url) return null;
  const justify =
    align === "right"
      ? "items-end text-right"
      : align === "center"
        ? "items-center text-center"
        : "items-start";
  return (
    <div className={`flex flex-col gap-3 ${justify}`}>
      <div
        className="rounded-2xl bg-white p-3 shadow-2xl"
        style={{ boxShadow: "0 14px 38px rgba(15,23,42,0.25)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="QR ke artikel"
          width={size}
          height={size}
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[14px] font-bold uppercase tracking-[0.18em] opacity-70">
          Scan / Kunjungi
        </div>
        <div className="text-[20px] font-extrabold tracking-tight">
          {url}
        </div>
        <div
          className="mt-1.5 max-w-[440px] text-[14px] font-semibold italic leading-snug"
          style={{ opacity: 0.85 }}
        >
          Yuk lanjut diskusi — tulis pikiranmu di artikel.
        </div>
      </div>
    </div>
  );
}

function Tally({ color, marks = 6 }: { color: string; marks?: number }) {
  return (
    <svg
      viewBox={`0 0 ${marks * 90} 60`}
      width="320"
      height="24"
      aria-hidden
      style={{ color }}
    >
      {Array.from({ length: marks }).map((_, i) => (
        <line
          key={i}
          x1={20 + i * 90}
          y1={30}
          x2={70 + i * 90}
          y2={30}
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.55"
        />
      ))}
    </svg>
  );
}

/**
 * PosterQuestion — campus bulletin-board poster.
 *
 * Single hero question, set very large. Designed to stop a student
 * walking past a jurusan noticeboard. Four truly distinct top-level
 * compositions rotate per edition so a weekly viewer never sees the
 * same shape twice in a row:
 *
 *   variant 0 — SIDE PHOTO        photo right strip, text left column
 *   variant 1 — TOP PHOTO BANNER  photo across top 38%, text below
 *   variant 2 — TYPOGRAPHY ONLY   no photo, geometric ornament + text
 *   variant 3 — PHOTO BACKDROP    full-bleed photo + accent overlay
 *
 * All four:
 *   - Reuse the same font-size scale based on headline length so any
 *     50-130 char question stays inside the 1080×1080 canvas.
 *   - Guard against dark-text-on-dark-background by clamping the
 *     gradient to the lightest palette stops AND switching text to
 *     white for the photo-backdrop variant where the overlay is dark.
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
  const { headline, dateLabel, brand, articleUrl, articleQrDataUrl } =
    content;
  const len = headline.length;

  // Font sizing tuned against the actual text column width (~650px
  // with side photo). Each tier's chars-per-line × line-count must
  // fit in ~820px of vertical room.
  const fontSize =
    len < 45
      ? "118px"
      : len < 65
        ? "94px"
        : len < 85
          ? "78px"
          : len < 110
            ? "66px"
            : "56px";
  const lineHeight = len < 45 ? "1.06" : len < 85 ? "1.08" : "1.12";

  const bgStops = palette.bgGradient;

  // ─────────────────────────────────────────────────────────────────
  // VARIANT 1 — Top photo banner
  // ─────────────────────────────────────────────────────────────────
  if (layoutVariant === 1) {
    const bgStyle = {
      background: `linear-gradient(160deg, ${bgStops[0]} 0%, ${bgStops[1]} 100%)`,
    };
    return (
      <div
        className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
        style={bgStyle}
      >
        {/* Photo banner across top 38% with rounded bottom corners */}
        <div className="absolute left-0 right-0 top-0 h-[412px] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={assets.primary}
            alt=""
            className="h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${palette.accent}20 0%, transparent 50%, ${palette.accent}55 100%)`,
            }}
          />
          {/* Brand chip floating on the photo */}
          <div className="absolute left-[60px] top-[50px]">
            <div
              className="inline-flex items-center rounded-full px-5 py-2.5 text-[20px] font-extrabold tracking-tight shadow-xl backdrop-blur"
              style={{
                background: "rgba(255,255,255,0.94)",
                color: palette.accentDeep,
              }}
            >
              {brand}
            </div>
          </div>
          <div
            className="absolute right-[60px] top-[58px] text-[18px] font-bold"
            style={{ color: "#ffffff" }}
          >
            {dateLabel}
          </div>
        </div>

        {/* Accent stripe between photo and text */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: "412px",
            height: "8px",
            background: palette.accent,
          }}
        />

        {/* Text area in the lower 60% */}
        <div className="relative z-10 flex h-full flex-col justify-between px-[80px] pt-[450px] pb-[60px]">
          <div className="flex flex-1 flex-col justify-center pr-[260px]">
            <div
              className="font-black tracking-tight"
              style={{
                fontSize,
                lineHeight,
                color: "#0f172a",
                letterSpacing: "-0.022em",
              }}
            >
              <span
                aria-hidden
                className="mr-[6px]"
                style={{ color: palette.accent, opacity: 0.7 }}
              >
                “
              </span>
              {headline}
            </div>
            <div className="mt-[28px]">
              <Tally color={palette.accent} />
            </div>
          </div>
          <div
            className="absolute right-[80px] bottom-[60px]"
            style={{ color: palette.accentDeep }}
          >
            <ArticleBadge
              qrDataUrl={articleQrDataUrl}
              url={articleUrl}
              size={180}
              align="right"
            />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // VARIANT 2 — Pure typography (no photo, geometric ornament)
  // ─────────────────────────────────────────────────────────────────
  if (layoutVariant === 2) {
    const bgStyle = {
      background: `linear-gradient(135deg, ${bgStops[0]} 0%, ${bgStops[1]} 100%)`,
    };
    return (
      <div
        className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
        style={bgStyle}
      >
        {/* Concentric arcs ornament — top-right corner */}
        <svg
          className="absolute -right-[180px] -top-[180px] h-[720px] w-[720px]"
          viewBox="0 0 720 720"
          aria-hidden
          style={{ color: palette.accent }}
        >
          {[260, 200, 140, 80].map((r, i) => (
            <circle
              key={r}
              cx={360}
              cy={360}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={i % 2 === 0 ? 4 : 2}
              opacity={0.18 - i * 0.03}
            />
          ))}
        </svg>
        {/* Dot grid — bottom-left */}
        <svg
          className="absolute -bottom-[40px] -left-[40px] h-[420px] w-[420px]"
          viewBox="0 0 420 420"
          aria-hidden
          style={{ color: palette.accent }}
        >
          {Array.from({ length: 7 }).map((_, row) =>
            Array.from({ length: 7 }).map((_, col) => (
              <circle
                key={`${row}-${col}`}
                cx={50 + col * 50}
                cy={50 + row * 50}
                r="6"
                fill="currentColor"
                opacity={0.22}
              />
            )),
          )}
        </svg>

        <div className="relative z-10 flex h-full flex-col justify-between px-[100px] py-[80px]">
          <div className="flex items-center justify-between">
            <div
              className="text-[24px] font-extrabold tracking-tight"
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
          <div className="flex flex-col items-center text-center">
            <Tally color={palette.accent} marks={5} />
            <div
              className="mt-[40px] font-black tracking-tight"
              style={{
                fontSize,
                lineHeight,
                color: "#0f172a",
                letterSpacing: "-0.022em",
                maxWidth: "880px",
              }}
            >
              {headline}
            </div>
            <Tally color={palette.accent} marks={5} />
          </div>
          <div
            className="flex justify-center"
            style={{ color: palette.accentDeep }}
          >
            <ArticleBadge
              qrDataUrl={articleQrDataUrl}
              url={articleUrl}
              size={160}
              align="center"
            />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // VARIANT 3 — Photo backdrop (full bleed + dark overlay + white text)
  // ─────────────────────────────────────────────────────────────────
  if (layoutVariant === 3) {
    return (
      <div className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={assets.primary}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Strong accent overlay so the white text is always readable */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(155deg, ${palette.accentDeep}f0 0%, ${palette.accent}e0 60%, ${palette.accentDeep}f0 100%)`,
          }}
        />
        {/* Subtle vignette so corners feel framed */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.35) 100%)",
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[80px] text-white">
          <div className="flex items-start justify-between">
            <div className="text-[24px] font-extrabold tracking-tight drop-shadow-md">
              {brand}
            </div>
            <div className="text-[18px] font-bold opacity-90 drop-shadow-md">
              {dateLabel}
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-center pr-[260px] py-6">
            <div
              aria-hidden
              className="mb-[14px] text-[120px] font-black leading-none drop-shadow-lg"
              style={{
                color: "#ffffff",
                opacity: 0.35,
                letterSpacing: "-0.05em",
              }}
            >
              “
            </div>
            <div
              className="font-black tracking-tight drop-shadow-lg"
              style={{
                fontSize,
                lineHeight,
                color: "#ffffff",
                letterSpacing: "-0.022em",
                maxWidth: "740px",
              }}
            >
              {headline}
            </div>
            <div className="mt-[28px]">
              <Tally color="#ffffff" />
            </div>
          </div>
          {/* QR + URL — placed on a white card so it scans cleanly
              against the dark photo backdrop. */}
          <div
            className="absolute right-[80px] bottom-[80px]"
            style={{ color: "#ffffff" }}
          >
            <ArticleBadge
              qrDataUrl={articleQrDataUrl}
              url={articleUrl}
              size={180}
              align="right"
            />
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // VARIANT 0 (default) — Side photo strip, text left column
  // ─────────────────────────────────────────────────────────────────
  const bgStyle = {
    background: `linear-gradient(140deg, ${bgStops[0]} 0%, ${bgStops[1]} 100%)`,
  };
  return (
    <div
      className="relative flex h-[1080px] w-[1080px] flex-col overflow-hidden"
      style={bgStyle}
    >
      {/* Corner blobs */}
      <div
        className="absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full opacity-30"
        style={{ background: palette.accentSoft }}
      />
      <div
        className="absolute -bottom-32 -left-24 h-[420px] w-[420px] rounded-full opacity-25"
        style={{ background: palette.accent }}
      />

      {/* Photo accent — right-side rounded strip */}
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

      <div className="relative z-10 flex h-full flex-col justify-between px-[80px] py-[70px]">
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

        <div className="flex max-w-[620px] flex-1 flex-col justify-center">
          <div
            className="font-black tracking-tight"
            style={{
              fontSize,
              lineHeight,
              color: "#0f172a",
              letterSpacing: "-0.022em",
            }}
          >
            <span
              aria-hidden
              className="mr-[6px]"
              style={{ color: palette.accent, opacity: 0.7 }}
            >
              “
            </span>
            {headline}
          </div>
          <div className="mt-[28px]">
            <Tally color={palette.accent} />
          </div>
        </div>

        {/* QR + URL — bottom-left, under the text column. Side photo
            already occupies the right side of the canvas so we keep
            the QR with the typography for a coherent reading flow. */}
        <div style={{ color: palette.accentDeep }}>
          <ArticleBadge
            qrDataUrl={articleQrDataUrl}
            url={articleUrl}
            size={170}
            align="left"
          />
        </div>
      </div>
    </div>
  );
};
