import clsx from "clsx";
import { Fragment } from "react";

import { MixedText } from "@/components/library/MixedText";
import { hasArabic } from "@/lib/textUnits";

import type { StageCaption } from "./caption";

/**
 * The stage's caption: plain text, or KARAOKE words that follow the
 * narrator (operator, 2026-10-10: "highlight the text that is being read by
 * narrator"). The word being said is filled forest with paper text (7.9:1),
 * the words already said are normal ink, the words still to come muted
 * (ink-soft, 6.3:1: still readable ahead). Every word keeps the same padding
 * in every state, so nothing reflows as the highlight moves; with reduced
 * motion the colours switch without a transition. Arabic runs (a dictionary
 * term's form, "na’t (نَعْت)"; a letter as in the ayah, بِ) are isolated RTL in
 * the Amiri face (MixedText). Purely visual: a screen reader is told the line
 * from the stage's polite live region instead.
 *
 * Line breaks (operator, 2026-10-10: "sometime i see wrong line break
 * especially for arabic words"): a word is never cut (a plain word does not
 * wrap; "Al-Fatihah." stays whole), and a word carrying Arabic — a whole
 * dictionary term, "huruf jar (حَرْف جَرّ)," — goes through MixedText, which
 * keeps the term with its Arabic. The word itself stays an inline span with
 * its fill cloned on every line it covers (box-decoration-clone): a term
 * wider than the caption (at Sangat besar on a phone, "mudhaf ilaih
 * (مُضَاف إِلَيْه)") breaks in the flow ("mudhaf" ⏎ "ilaih (مُضَاف إِلَيْه)",
 * src/lib/lineFit.ts) and its fill follows the text line by line, never a box
 * the caption's full width (review, 2026-10-10). The Arabic inside the word
 * being said carries the fill too (--karaoke-fill, globals.css), so its
 * harakat, above and below the Inter line the fill covers, stay on forest
 * instead of paper on white. The fill's padding is cancelled by a negative
 * margin: the gaps between words are plain spaces, as in the text it follows.
 */
export function CaptionView({ caption }: { caption: StageCaption }) {
  if (caption.kind === "text") return <MixedText text={caption.text} />;
  return (
    <>
      {caption.words.map(([text], i) => {
        const now = i === caption.now;
        const said = !now && i < caption.said;
        return (
          <Fragment key={i}>
            {i > 0 ? " " : null}
            <span
              data-karaoke={now ? "now" : said ? "said" : "later"}
              className={clsx(
                "-mx-0.5 box-decoration-clone rounded-md px-0.5 motion-safe:transition-colors motion-safe:duration-150",
                !hasArabic(text) && "whitespace-nowrap",
                now ? "bg-forest text-paper [--karaoke-fill:var(--color-forest)]" : said ? "text-ink" : "text-ink-soft",
              )}
            >
              <MixedText text={text} />
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
