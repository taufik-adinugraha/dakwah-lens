import { type ReactNode } from "react";

/**
 * Render translation strings that contain inline `*…*` markers from
 * Indonesian translations (used to flag English technical terms like
 * dashboard, brief, kitab, insights). Strips the asterisks so they
 * don't show literally in the UI.
 *
 * Italic rendering is currently DISABLED — the matched text renders
 * plain. The marker convention is kept in `messages/id.json` because
 * (a) we may want italic back later for a specific surface, (b) the
 * markers double as a semantic hint that the word is a borrowed
 * English term, and (c) removing them all from id.json would be a
 * destructive search-and-replace. So we keep the parser, drop the
 * styling.
 *
 * Convention in `messages/id.json`:
 *     "stat_briefs_this_week_label": "*Brief* minggu ini"
 * Rendered output:
 *     <span>Brief minggu ini</span>
 *
 * Escape an asterisk you want shown with `\*`. The parser matches
 * non-greedy `*…*` runs that don't span newlines.
 */
export function I18nText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <span className={className}>{stripMarkers(text)}</span>;
}

function stripMarkers(input: string): ReactNode[] {
  // Split on `*…*` runs that don't cross newlines. The capturing group
  // keeps the matched content in the split (without asterisks), so
  // positional logic stays simple: even indices = surrounding plain
  // text, odd indices = previously-marked content (now also plain).
  const tokens = input.split(/\*([^*\n]+)\*/g);
  return tokens.map((tok, i) => {
    if (i % 2 === 1) {
      // Was italic; now plain — render as a span so React still has a
      // keyed boundary if we ever want to flip italic back on.
      return <span key={i}>{tok}</span>;
    }
    // Escape sequence: `\*` → `*` literal.
    return tok.replace(/\\\*/g, "*");
  });
}
