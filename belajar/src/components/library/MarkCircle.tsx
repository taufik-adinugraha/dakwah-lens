import { inkShift } from "@/lib/markInk";
import { TATWEEL } from "@/lib/terms";

/** Circle size → [circle classes, glyph size for a mark, glyph size for a whole letter]. The glyph
 *  sizes keep every sign's ink within about 0.8 of the circle's inner radius once centred
 *  (src/lib/markInk.ts): a whole letter is taller than a mark, so it is set smaller. */
const SIZES = {
  lg: ["mark-circle", "text-[2.75rem]", "text-[2.25rem]"],
  sm: ["mark-circle h-12! w-12!", "text-[1.75rem]", "text-[1.375rem]"],
  xs: ["mark-circle h-9! w-9! border-[1.5px]!", "text-[1.25rem]", "text-[1rem]"],
} as const;

/**
 * One harakah mark on its own, large, on a dotted circle (`.mark-circle`): the mark itself is cut
 * from an ayah's letter by the caller (src/lib/terms.ts marksOf / vowelOf) and set on a tatweel.
 * `letter`: show a whole letter with its marks instead (a letter that changes as parts join,
 * عَلَىٰ's ىٰ → عَلَيْهِمْ's يْ), cut from the bytes too.
 * Decorative next to its name and sound, so the name carries the meaning for screen readers.
 * The glyph's line box is set inline (1.4): `.arabic-inline`'s 2 would push a lone mark off the
 * circle's centre, and an inline style is the one thing that overrides that unlayered rule. The
 * glyph is then moved so that its INK, not its line box, sits on the centre (markInk.ts; operator
 * 2026-10-12: the marks overlapped the circle).
 * `xs`: the sign beside a harakah's name in a title's Arabic headword ("ضَمَّة" with ـُ, not "u").
 */
export function MarkCircle({ mark, size = "lg", letter = false }: { mark: string; size?: "lg" | "sm" | "xs"; letter?: boolean }) {
  const [circle, markSize, letterSize] = SIZES[size];
  return (
    <span aria-hidden="true" className={circle}>
      <span
        lang="ar"
        dir="rtl"
        className={`arabic-inline text-ink ${letter ? letterSize : markSize}`}
        style={{ lineHeight: 1.4, transform: `translateY(${inkShift(mark, letter).toFixed(3)}em)` }}
      >
        {letter ? mark : TATWEEL + mark}
      </span>
    </span>
  );
}
