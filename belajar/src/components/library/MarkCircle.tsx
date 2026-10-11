import { TATWEEL } from "@/lib/terms";

/**
 * One harakah mark on its own, large, on a dotted circle (`.mark-circle`): the mark itself is cut
 * from an ayah's letter by the caller (src/lib/terms.ts marksOf / vowelOf) and set on a tatweel.
 * `letter`: show a whole letter with its marks instead (a letter that changes as parts join,
 * عَلَىٰ's ىٰ → عَلَيْهِمْ's يْ), cut from the bytes too.
 * Decorative next to its name and sound, so the name carries the meaning for screen readers.
 * The glyph's line box is set inline (1.4): `.arabic-inline`'s 2 would push a lone mark off the
 * circle's centre, and an inline style is the one thing that overrides that unlayered rule.
 */
export function MarkCircle({ mark, size = "lg", letter = false }: { mark: string; size?: "lg" | "sm"; letter?: boolean }) {
  return (
    <span aria-hidden="true" className={size === "lg" ? "mark-circle" : "mark-circle h-12! w-12!"}>
      <span
        lang="ar"
        dir="rtl"
        className={`arabic-inline text-ink ${size === "lg" ? "text-[2.75rem]" : "text-ar-md"}`}
        style={{ lineHeight: 1.4 }}
      >
        {letter ? mark : TATWEEL + mark}
      </span>
    </span>
  );
}
