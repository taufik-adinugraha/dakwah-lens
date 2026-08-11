import type { FlyerPalette } from "./types";

/**
 * Shared decorative primitives for the flyer layouts (Pass 2 redesign).
 *
 * The reference posters (Borneo Desain, Pelajar Sunnah, Nisaa
 * As-Sunnah, etc.) share a consistent vocabulary that our layouts were
 * missing: a big quotation ornament over the quote, a distinct citation
 * block (not a thin "— …" line), and a short accent rule anchoring the
 * headline. Centralising them here keeps the treatment identical across
 * every layout and makes a single tweak propagate everywhere.
 */

/**
 * Oversized decorative opening-quote glyph. Position it absolutely from
 * the caller (it's `pointer-events-none`, purely visual) so it sits
 * BEHIND/above the quote text without affecting the auto-fit box that
 * measures the translation card.
 */
export function QuoteGlyph({
  color,
  size = 160,
  className = "",
  style = {},
}: {
  color: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none select-none font-amiri leading-none ${className}`}
      style={{
        color,
        fontSize: `${size}px`,
        opacity: 0.18,
        lineHeight: 0.8,
        ...style,
      }}
    >
      &rdquo;
    </span>
  );
}

/**
 * Citation block — a short accent rule followed by the citation in
 * uppercase, letter-spaced caps. Reads as a deliberate "source" stamp
 * (matches "HILYATUL AULIYA', JILID 8 HLM. 338" on the refs) instead of
 * the old em-dash prefix.
 */
export function Citation({
  citation,
  color,
  align = "start",
  className = "",
}: {
  citation: string;
  color: string;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 ${
        align === "center" ? "justify-center" : ""
      } ${className}`}
    >
      <span
        aria-hidden
        className="block h-[3px] w-7 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className="text-[20px] font-extrabold uppercase leading-tight tracking-[0.12em]"
        style={{ color }}
      >
        {citation}
      </span>
    </div>
  );
}

/**
 * Compact source-credit chip — rendered in place of the full
 * translation quote card when a daleel has no short, flyer-sized
 * translation (e.g. a section-length classic-kitab chunk whose specific
 * saying is already woven into the body). Keeps the daleel CREDITED so
 * the source is never invisible. Opaque white pill so it reads on any
 * background (pattern or dark-photo overlay).
 */
export function DaleelSourceChip({
  citation,
  palette,
  label,
  align = "start",
  className = "",
}: {
  citation: string;
  palette: FlyerPalette;
  label: string;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <div
      className={`flex ${align === "center" ? "justify-center" : ""} ${className}`}
    >
      <div
        className="inline-flex max-w-[880px] flex-col gap-1.5 rounded-2xl bg-white px-7 py-5 shadow-xl"
        style={{
          boxShadow: `0 14px 40px ${palette.accentDeep}55`,
          borderLeft: `8px solid ${palette.accent}`,
        }}
      >
        <span
          className="text-[12px] font-extrabold uppercase tracking-[0.2em]"
          style={{ color: palette.accent }}
        >
          {label}
        </span>
        <span
          className="text-[24px] font-extrabold leading-tight"
          style={{ color: palette.accentDeep }}
        >
          {citation}
        </span>
      </div>
    </div>
  );
}

/**
 * Social-media footer strip (experiment 2026-08-11) — a uniform bottom
 * bar carrying the Dakwah-Lens social handles, overlaid on every square
 * Pesan-Flyer share-card. Full-width dark-gradient backing (fades up to
 * transparent) so the white text reads on ANY background — photo, pattern
 * or solid — without needing the per-flyer palette. Rendered at the
 * document level by renderFlyerPng (NOT the A4 poster / Mahasiswa poster,
 * whose own footer + QR own the bottom edge).
 *
 * Handles are display text (the flyer is a rendered PNG, not clickable),
 * so they're centralised here as the single source of truth.
 */
export const SOCIAL_HANDLES: { label: string; handle: string }[] = [
  { label: "Instagram", handle: "dakwahlens" },
  { label: "TikTok", handle: "dakwahlens" },
  { label: "Facebook", handle: "Dakwah Lens" },
  { label: "YouTube", handle: "dakwah lens" },
];

export function SocialFooter() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "88px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: "34px",
        paddingBottom: "18px",
        background:
          "linear-gradient(to top, rgba(15,23,42,0.86) 0%, rgba(15,23,42,0.66) 55%, rgba(15,23,42,0) 100%)",
        zIndex: 40,
      }}
    >
      {SOCIAL_HANDLES.map(({ label, handle }) => (
        <div
          key={label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            lineHeight: 1.15,
          }}
        >
          <span
            style={{
              fontSize: "13px",
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.72)",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: "21px",
              fontWeight: 800,
              color: "#ffffff",
              textShadow: "0 1px 3px rgba(0,0,0,0.45)",
            }}
          >
            {handle}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Short rounded accent bar placed under a headline — a small visual
 * anchor lifted from the reference posters' bold-title treatment.
 */
export function HeadlineRule({
  palette,
  className = "",
}: {
  palette: FlyerPalette;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block h-[8px] w-[88px] rounded-full ${className}`}
      style={{ backgroundColor: palette.accent }}
    />
  );
}
