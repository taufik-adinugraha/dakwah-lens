import { Link } from "@/i18n/navigation";
import { conceptHref } from "@/lib/routes";
import { type HeadTerm, termDisplay, type Token } from "@/lib/terms";

import { MixedText, type Overlay } from "./MixedText";

/** The Harakat page (Dasar membaca); a harakah term's first use on a page links here. */
export const HARAKAT_PAGE = "harakat";

/**
 * Marked library prose (src/lib/terms.ts tokens): "majrur (مَجْرُور)", "bismi (بِسْمِ)", and for a
 * harakah term at its first use on a page "kasrah (كَسْرَة, tanda bunyi i di bawah huruf)" with
 * the word linked to the Harakat page (operator 2026-10-10: learners may not know kasrah,
 * dhammah, fathah). One pair of brackets at most (less clutter): where the prose glosses the word
 * in brackets itself the Arabic joins that gloss ("nahwu (نَحْو, tata bahasa Arab)"), an author
 * citation joins it after a semicolon ("mabni (مَبْنِيّ; Ibnu 'Aqil)"), and a term already inside
 * the prose's brackets takes its Arabic after a comma ("(dalam keadaan jar, جَرّ)").
 *
 * Line breaks (rule 15): the tokens become ONE text (termDisplay) that MixedText draws — the same
 * pieces and the same rules as every other text in the module, so a term keeps its last word, the
 * bracket, the Arabic and the punctuation after it in one seam, a hyphenated or en-dashed word is
 * never cut ("al-qaul", "waswasa–yuwaswisu"), and no line ends on "(" or "“" (CI 2026-10-11:
 * drawn token by token, the boxes left a break next to every term). The styles are overlays on
 * that text: a term's Arabic in forest, a Qur'anic word's in ink, the link on the harakah term's
 * word. Arabic is bidi-isolated (`bdi`) in the Amiri face at the 24px floor; a run of four or more
 * Qur'anic words is a quotation with nothing glued to it, wrapping right to left in its own box
 * when it is wider than a phone's line.
 */
export function TermText({ tokens, links = true }: { tokens: Token[]; links?: boolean }) {
  const { text, marks } = termDisplay(tokens);
  const overlays = marks.flatMap((m): Overlay[] =>
    m.kind !== "link"
      ? [{ from: m.from, to: m.to, arabic: m.kind === "term" ? "text-forest" : "text-ink" }]
      : links
        ? [
            {
              from: m.from,
              to: m.to,
              wrap: (word) => (
                <Link href={conceptHref(HARAKAT_PAGE)} className="link-text">
                  {word}
                </Link>
              ),
            },
          ]
        : [],
  );
  return <MixedText text={text} overlays={overlays} />;
}

/**
 * A title's Arabic headword (its terms, e.g. حَرْف جَرّ · اِسْم مَجْرُور), shown large under it. It
 * wraps BETWEEN terms on a phone (review 2026-10-10: one unbreakable line ran off the left edge
 * of an RTL box): each term is one nowrap item with its separator after it, so a line may end
 * with "·" but never starts with one, and a term never breaks. A harakah term carries its sound
 * ("ضَمَّة u"), since the title is where a beginner meets it first.
 */
export function Headword({ head, className = "" }: { head: HeadTerm[]; className?: string }) {
  if (!head.length) return null;
  return (
    <span lang="ar" dir="rtl" className={`arabic-inline flex flex-wrap items-baseline gap-x-3 text-forest ${className}`}>
      {head.map((h, i) => (
        <span key={h.ar} className="inline-flex items-baseline whitespace-nowrap">
          <bdi>{h.ar}</bdi>
          {h.sound ? (
            <span lang="id" dir="ltr" className="ms-1.5 font-body text-base text-ink-muted">
              {h.sound}
            </span>
          ) : null}
          {i < head.length - 1 ? (
            <span aria-hidden="true" className="ps-3 text-ink-soft">
              ·
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
