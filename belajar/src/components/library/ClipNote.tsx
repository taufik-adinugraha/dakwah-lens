import clsx from "clsx";
import { Info } from "lucide-react";

import { MixedText } from "./MixedText";

/**
 * One short line under an example's "▶ Dengarkan" saying what the learner will HEAR where that
 * differs from what the page writes (review 2026-10-12; src/lib/heard.ts):
 * - "waqf": the word ends its ayah, the imam stops there, so its final harakah or tanwin is not
 *   pronounced — "Di akhir ayat imam berhenti (waqaf), jadi harakat akhirnya tidak terdengar.";
 * - "washal": a base-form tile that starts with hamzat washal is played with the word before it —
 *   "Di tengah bacaan, alif di awal kata ini tidak dibaca: bersama kata sebelumnya terdengar
 *   “tabārakasmu”."
 * Visible text at the module's reading size (never a tooltip), and the button's description for a
 * screen reader: the caller gives the same `id` to ClipButton's `noteId` (aria-describedby).
 * `data-clip-note` names the kind for the CI checks. Which examples get one is decided from
 * library.json (`clips[].last`, `parts[].tiles[].washal`), never from a list here.
 *
 * `icon`: the small "i" before the line, its text hanging beside it. Off inside a parts tile, a
 * narrow box on a phone, where the line needs the tile's whole width (at Sangat besar the text
 * column beside an icon would be about 160px, hardly more than “tabārakasmu”.).
 */
export function ClipNote({
  id,
  kind,
  text,
  icon = true,
  className,
}: {
  id: string;
  kind: "waqf" | "washal";
  text: string;
  icon?: boolean;
  className?: string;
}) {
  return (
    <p id={id} data-clip-note={kind} className={clsx("text-pretty text-ink-muted", icon && "flex items-start gap-2", className)}>
      {icon ? <Info aria-hidden className="mt-[0.2em] h-5 w-5 shrink-0 text-forest" /> : null}
      <span className="min-w-0">
        <MixedText text={text} />
      </span>
    </p>
  );
}

/** The id that ties a note to its button on one page: one per example (`scope`: the card or
 *  diagram it sits in; `loc`: the example in it), letters, digits and hyphens only. */
export const clipNoteId = (scope: string, loc: string): string => `clip-note-${scope}-${loc}`.replace(/[^0-9a-z]+/gi, "-");
