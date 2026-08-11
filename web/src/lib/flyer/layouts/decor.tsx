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
export const SOCIAL_HANDLES: {
  label: string;
  icon: keyof typeof SOCIAL_ICON_PATHS;
  handle: string;
}[] = [
  { label: "Instagram", icon: "instagram", handle: "dakwahlens" },
  { label: "TikTok", icon: "tiktok", handle: "dakwahlens" },
  { label: "Facebook", icon: "facebook", handle: "Dakwah Lens" },
  { label: "YouTube", icon: "youtube", handle: "dakwah lens" },
];

// Canonical brand glyphs (simple-icons, MIT) inlined as single-path SVGs
// so the render stays self-contained — no icon dependency and no remote
// fetch inside the Puppeteer screenshot.
const SOCIAL_ICON_PATHS = {
  instagram: "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
  tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  facebook: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  youtube: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
} as const;

function SocialIcon({ name, size = 30 }: { name: keyof typeof SOCIAL_ICON_PATHS; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="#ffffff"
      aria-hidden
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
    >
      <path d={SOCIAL_ICON_PATHS[name]} />
    </svg>
  );
}

export function SocialFooter() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "104px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: "42px",
        paddingBottom: "18px",
        background:
          "linear-gradient(to top, rgba(15,23,42,0.86) 0%, rgba(15,23,42,0.66) 58%, rgba(15,23,42,0) 100%)",
        zIndex: 40,
      }}
    >
      {SOCIAL_HANDLES.map(({ label, icon, handle }) => (
        <div
          key={label}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "7px",
            lineHeight: 1.1,
          }}
        >
          <SocialIcon name={icon} />
          <span
            style={{
              fontSize: "20px",
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
