import { Fragment, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { conceptHref } from "@/lib/routes";
import type { HeadTerm, Token } from "@/lib/terms";

import { MixedText } from "./MixedText";

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
 * Line breaks (rule 15): the transliteration's last word, the opening bracket, the Arabic and the
 * punctuation after it are one unbreakable seam; a term of several words is one inline box, so it
 * moves to the next line whole and only wraps inside (between its Latin words, never at the
 * seam) when it is wider than a whole line at a large text size. Arabic is bidi-isolated (`bdi`)
 * in the Amiri face at the 24px floor. A run of four or more Qur'anic words may take a line of
 * its own rather than overflow a phone. Plain text between spans goes through MixedText, so a
 * «…» Tanzil quotation or a single letter in the prose is isolated as before.
 */
export function TermText({ tokens, links = true }: { tokens: Token[]; links?: boolean }) {
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "text") return <MixedText key={i} text={t.text} />;
        if (!t.arabic) return <Fragment key={i}>{t.surface}</Fragment>;
        const words = t.surface.split(" ");
        const lead = words.slice(0, -1).join(" ");
        const lastWord = words[words.length - 1];
        const ar = t.kind === "term" ? t.term.ar! : t.ar;
        const long = t.kind === "quran" && ar.split(" ").length >= 4;
        const hint = t.kind === "term" && t.hint && !t.merge ? t.term.hint : null;
        const arabic = (
          <bdi
            lang="ar"
            dir="rtl"
            className={`arabic-inline text-ar-sm ${t.kind === "term" ? "text-forest" : "text-ink"}${long ? " inline-block max-w-full whitespace-normal" : ""}`}
          >
            {ar}
          </bdi>
        );
        const word: ReactNode =
          t.kind === "term" && t.hint && links ? (
            <Link href={conceptHref(HARAKAT_PAGE)} className="link-text">
              {lastWord}
            </Link>
          ) : (
            lastWord
          );
        // What opens before the Arabic and closes right after it (kept in the seam), and the
        // wrappable rest (a reminder) after the seam.
        const open = t.inBracket ? ", " : " (";
        const close = hint || t.merge ? "," : t.cite ? ";" : t.inBracket ? t.after : `)${t.after}`;
        const rest = hint ? (
          <>
            {" "}
            {hint}
            {t.inBracket ? t.after : t.cite ? ";" : `)${t.after}`}
          </>
        ) : null;
        const seam = long ? (
          <>
            <span className="whitespace-nowrap">
              {word}
              {open}
            </span>
            <span className="whitespace-nowrap">
              {arabic}
              {close}
            </span>
          </>
        ) : (
          <span className="whitespace-nowrap">
            {word}
            {open}
            {arabic}
            {close}
          </span>
        );
        const unit = (
          <>
            {lead ? `${lead} ` : null}
            {seam}
          </>
        );
        return (
          <Fragment key={i}>
            {lead && !long ? <span className="inline-block max-w-full">{unit}</span> : unit}
            {rest}
            {t.merge || t.cite ? " " : null}
          </Fragment>
        );
      })}
    </>
  );
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
