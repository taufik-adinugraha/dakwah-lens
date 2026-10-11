import type { ComposeMark } from "@/content/compose-schema";

/**
 * One harakah drawn on a dotted circle (◌َ ◌ِ ◌ُ ◌ْ ◌ّ), for the harakat primer
 * (operator, 2026-10-10: "expect also people dont understand what is kasrah,
 * dhommah, and fathah"). Drawn, not typeset: no Amiri subset the module
 * serves has the dotted circle U+25CC, and a mark set on a fallback font's
 * circle lands anywhere (UX research, hb-shape 11.4.1). So the circle stands
 * for "a letter" and the mark sits where it sits on a real letter: fathah a
 * short slanted stroke ABOVE, kasrah the same stroke BELOW, dhammah a small
 * waw-shaped mark above, sukun a small ring above, shaddah a small "w" above,
 * the small upright alif (ٰ) a short upright stroke above.
 * The real marks on real letters (بَ بِ بُ, typeset in Amiri from the content
 * bytes) stand next to it on the stage. Decorative: the figure's text says it.
 */
export function MarkGlyph({ mark, className }: { mark: ComposeMark; className?: string }) {
  return (
    <svg viewBox="0 0 64 72" aria-hidden className={className} focusable="false">
      <circle cx="32" cy="36" r="14" fill="none" stroke="var(--color-border-ui)" strokeWidth="2" strokeDasharray="2.6 3.4" />
      <g fill="none" stroke="var(--color-forest)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        {mark === "fathah" || mark === "fathatain" ? <path d="M25 14.5 L39 7.5" /> : null}
        {mark === "fathatain" ? <path d="M25 21.5 L39 14.5" /> : null}
        {mark === "kasrah" || mark === "kasratain" ? <path d="M25 64.5 L39 57.5" /> : null}
        {mark === "kasratain" ? <path d="M25 70 L39 63" /> : null}
        {mark === "dhammah" || mark === "dhammatain" ? (
          <path d="M35.5 15.5 C31.5 15.5 30 12.5 31.2 9.8 C32.4 7.2 36 7 37.6 9.4 C39.6 12.4 37 17.6 28 20" />
        ) : null}
        {mark === "sukun" ? <circle cx="32" cy="11" r="4.6" /> : null}
        {mark === "shaddah" ? <path d="M23.5 7 C24.5 14 28.5 14 29.5 9.5 C30.5 14 34.5 14 35.5 9.5 C36.5 14 40 13 40.5 7" /> : null}
        {mark === "small_alif" ? <path d="M32 5 L32 18.5" /> : null}
      </g>
    </svg>
  );
}
