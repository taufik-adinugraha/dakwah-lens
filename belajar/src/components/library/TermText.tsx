import { Link } from "@/i18n/navigation";
import { leadSpans, meaningSpans, termEmphasis } from "@/lib/emphasis";
import { conceptHref } from "@/lib/routes";
import { type HeadTerm, termDisplay, type Token } from "@/lib/terms";

import { MarkCircle } from "./MarkCircle";
import { MixedText, type Overlay } from "./MixedText";

/** The Harakat page (Dasar membaca); a harakah term's first use on a page links here. */
export const HARAKAT_PAGE = "harakat";

/**
 * Marked library prose (src/lib/terms.ts tokens): "majrur (مَجْرُور)", "bismi (بِسْمِ)", and for a
 * harakah term at its first use on a page "kasrah (كَسْرَة, tanda bunyi i di bawah huruf)" with
 * the word linked to the Harakat page (operator 2026-10-10: learners may not know kasrah,
 * dhammah, fathah). One pair of brackets at most (less clutter): where the prose glosses the word
 * in brackets itself the Arabic joins that gloss ("nahwu (نَحْو, tata bahasa Arab)"), an author
 * citation joins it after a semicolon ("mabni (مَبْنِيّ; Ibnu 'Aqil)"), a term already inside
 * the prose's brackets takes its Arabic right after it, one space and no comma ("(dalam keadaan
 * jar جَرّ)"), and a phrase of Qur'anic words has one bracket after the whole phrase ("yaum ad-dīn
 * (يَوْمِ ٱلدِّينِ)"; operator 2026-10-12) — grammar terms never form one, each keeps its own
 * ("dhamir (ضَمِير) munfashil (مُنْفَصِل)").
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
 *
 * `emphasis` (operator 2026-10-11): on prose, `true` — the meanings and the harakah sounds of the
 * text termDisplay builds, and the term tokens named ("disebut marfu’ (مَرْفُوع)", "perubahan itu
 * disebut i'rab" where the title already showed its Arabic), bold (src/lib/emphasis.ts
 * termEmphasis); on a title or a label, `"meaning"` — its quoted glosses alone ("Idhafah (sandaran
 * kata: “nama Allah”)", "fa'il tersimpan: “kami”"), forest like every meaning (operator
 * 2026-10-13, plan L22); on a Kosakata meaning, `"lead"`. After TermText's own styles, so a
 * term's or a Qur'anic word's colour stays as it is and a bold harakah term stays inside its link.
 */
export function TermText({
  tokens,
  links = true,
  emphasis = false,
}: {
  tokens: Token[];
  links?: boolean;
  /** true: termEmphasis; "meaning": the text's meanings alone (meaningSpans); "lead": a Kosakata
   *  meaning's lead and the glosses after it (leadSpans) — of the text drawn. */
  emphasis?: boolean | "lead" | "meaning";
}) {
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
  const spans =
    emphasis === "lead" ? leadSpans(text) : emphasis === "meaning" ? meaningSpans(text) : emphasis ? termEmphasis(tokens) : undefined;
  return <MixedText text={text} overlays={overlays} emphasis={spans} label={emphasis === "meaning"} />;
}

/**
 * A prose field that may have a marked twin (a lesson's word card, its ayah structure and facts, a
 * Kosakata page; 2026-10-12): its tokens (annotated by the caller in reading order, so "first use"
 * is the first one the reader meets: src/lib/terms.ts markedTokens) drawn by TermText; without a
 * marked twin (`tokens` null: a lesson not marked yet), the plain text exactly as before.
 */
export function Prose({
  tokens,
  plain,
  links,
  emphasis,
}: {
  tokens: Token[] | null;
  plain: string;
  links?: boolean;
  emphasis?: boolean | "lead" | "meaning";
}) {
  if (tokens) return <TermText tokens={tokens} links={links} emphasis={emphasis} />;
  const spans = emphasis === "lead" ? leadSpans(plain) : emphasis === "meaning" ? "meaning" : emphasis ? true : undefined;
  return <MixedText text={plain} emphasis={spans} />;
}

/**
 * A title's Arabic headword (its terms, e.g. حَرْف جَرّ · اِسْم مَجْرُور), shown large under it. It
 * wraps BETWEEN terms on a phone (review 2026-10-10: one unbreakable line ran off the left edge
 * of an RTL box): each term is one nowrap item with its separator after it, so a line may end
 * with "·" but never starts with one, and a term never breaks. A harakah term carries its sign on
 * a small dotted circle, as the Harakat page draws it ("ضَمَّة" with ـُ, never "u": operator
 * 2026-10-12), since the title is where a beginner meets it first. Right under the title, so it
 * has room for its marks (ar-clear, globals.css); `className` carries its size (text-ar-*), on this
 * same element, which the room is measured in.
 */
export function Headword({ head, className = "" }: { head: HeadTerm[]; className?: string }) {
  if (!head.length) return null;
  return (
    <span lang="ar" dir="rtl" className={`arabic-inline ar-clear flex flex-wrap items-baseline gap-x-3 text-forest ${className}`}>
      {head.map((h, i) => (
        <span key={h.ar} className="inline-flex items-baseline whitespace-nowrap">
          <bdi>{h.ar}</bdi>
          {h.mark ? (
            <span className="ms-2 self-center">
              <MarkCircle mark={h.mark} size="xs" />
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
