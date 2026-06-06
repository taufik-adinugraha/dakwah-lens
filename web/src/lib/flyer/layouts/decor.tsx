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
