import clsx from "clsx";
import { Fragment } from "react";

import { MixedText } from "@/components/library/MixedText";

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
                "rounded-md px-0.5 [box-decoration-break:clone] motion-safe:transition-colors motion-safe:duration-150",
                now ? "bg-forest text-paper" : said ? "text-ink" : "text-ink-soft",
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
