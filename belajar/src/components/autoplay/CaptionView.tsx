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
 *
 * Emphasis (operator 2026-10-11: "we can also use bold text or different
 * color to highlight the meanings or important things"): a meaning, the
 * term being taught and a harakah's sound are bold — in a text caption its
 * part's slice of the line's (caption.ts `emphasis`), in a karaoke one per
 * word (caption.ts `emph`); every meaning of the line (operator 2026-10-13,
 * plan L22: a meaning is always in “…” and always forest), and in a quiz
 * explanation the answer beside them. A word keeps its weight in every state, so the
 * highlight moving never reflows the line; its colour follows the state:
 * the word being said is paper on forest whatever it is (7.9:1; no forest
 * inside it, its Arabic would vanish into the fill), a meaning is forest
 * before and after (8.3:1 on the panel's white), any other word ink once said
 * and ink-soft still to come, a term's Arabic forest. Never colour alone:
 * the bold says it too.
 */
export function CaptionView({ caption }: { caption: StageCaption }) {
  if (caption.kind === "text") return <MixedText text={caption.text} emphasis={caption.emphasis} />;
  return (
    <>
      {caption.words.map(([text], i) => {
        const now = i === caption.now;
        const said = !now && i < caption.said;
        const emph = caption.emph[i] ?? null;
        return (
          <Fragment key={i}>
            {i > 0 ? " " : null}
            <span
              data-karaoke={now ? "now" : said ? "said" : "later"}
              data-emph={emph ?? undefined}
              className={clsx(
                "-mx-0.5 box-decoration-clone rounded-md px-0.5 motion-safe:transition-colors motion-safe:duration-150",
                !hasArabic(text) && "whitespace-nowrap",
                emph && "font-semibold [&_bdi]:font-normal",
                now
                  ? "bg-forest text-paper [--karaoke-fill:var(--color-forest)]"
                  : emph === "meaning"
                    ? "text-forest"
                    : said
                      ? "text-ink"
                      : "text-ink-soft",
              )}
            >
              <MixedText text={text} overlays={emph === "term" && !now ? [{ from: 0, to: text.length, arabic: "text-forest" }] : undefined} />
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
