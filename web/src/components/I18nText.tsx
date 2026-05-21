import { Fragment, type ReactNode } from "react";

/**
 * Render translation strings with inline `*italic*` markdown for emphasis
 * on English technical terms within Indonesian copy.
 *
 * Why this exists
 * ---------------
 * Indonesian web copy commonly mixes English technical terms (dashboard,
 * brief, kitab, insight). Convention is to italicise the English term to
 * mark it as a borrowed word. next-intl's plain `t("key")` returns a
 * raw string, so the asterisks would show literally.
 *
 * Convention
 * ----------
 * In `messages/id.json` write:
 *     "stat_briefs_this_week_label": "*Brief* minggu ini"
 *
 * Components render with:
 *     <I18nText text={t("stat_briefs_this_week_label")} />
 *
 * Renders as:
 *     <span>
 *       <em className="italic">Brief</em> minggu ini
 *     </span>
 *
 * Escape an asterisk you actually want shown with `\*`. The parser
 * matches non-greedy `*…*` runs that don't span newlines.
 */
export function I18nText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <span className={className}>{renderInlineItalic(text)}</span>;
}

function renderInlineItalic(input: string): ReactNode[] {
  // Split on `*…*` runs that don't cross newlines. The capturing group
  // keeps the delimiters in the split, so positional logic stays simple:
  // even indices = plain text, odd = italic content (without asterisks).
  const tokens = input.split(/\*([^*\n]+)\*/g);
  return tokens.map((tok, i) => {
    if (i % 2 === 1) {
      return (
        <em key={i} className="not-italic">
          {/* `not-italic` keeps it from inheriting parent italic styles —
              we apply italic directly so emphasis is precise even
              when nested. */}
          <span className="italic">{tok}</span>
        </em>
      );
    }
    // Escape sequence: `\*` → `*` literal.
    return tok.replace(/\\\*/g, "*");
  });
}
