"use client";

import { useTranslations } from "next-intl";
import type { ReactElement } from "react";

export type PlayerWord = { index: number; ar: string; translit: string; gloss: string };

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) =>
  String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

/**
 * The ayah as a mushaf line: every word is a light chip, so it looks
 * clickable; clicking replays just that word (the stage seeks within the
 * streamed recording). The word the imam is reciting is filled forest with
 * paper text (7.9:1). Arabic is rendered from content data only, never
 * retyped.
 *
 * On the lesson stage (`numbered`: before "Mulai" and while the lesson
 * runs), every chip carries its place under the word in a badge — "1", "2", … in Latin digits, right to left
 * (word 1 rightmost), 16px — because the narration names words by their
 * place ("kata kedua"), never by the word itself. The words the line on
 * screen is about (`marked`: the whole ayah, the word explained, a concept's
 * words) get a thick ring with a white gap and a filled badge: an outline
 * and a shape change, never colour alone. On the imam's forest fill the
 * badge turns paper with forest digits, so it stays readable.
 *
 * Presentational: the one player lives in LessonStage, shared with the
 * guided lesson so the line highlights during the lesson too.
 */
export function MushafLine({
  ayah,
  words,
  activeWord,
  marked = [],
  numbered = false,
  canPlay,
  onTap,
}: {
  ayah: number;
  words: PlayerWord[];
  /** Word being recited right now. */
  activeWord: number | null;
  /** Words the lesson is talking about (thick ring + filled number). */
  marked?: readonly number[];
  /** Show each word's place under it (the lesson stage). */
  numbered?: boolean;
  canPlay: (index: number) => boolean;
  onTap: (index: number) => void;
}) {
  const t = useTranslations("Player");
  // The ayah marker never starts a row of its own (line breaks, operator
  // 2026-10-10): it is glued to the last word, as a mushaf prints it. Same
  // 8px gap; centred on that word's chip.
  const marker = (
    <span aria-hidden lang="ar" data-lb="ayah-marker" className="select-none self-center px-1 text-ink-soft">
      ﴿{toArabicDigits(ayah)}﴾
    </span>
  );
  const withMarker = (i: number, chip: ReactElement) =>
    i < words.length - 1 ? (
      chip
    ) : (
      <span key="ayah-end" data-lb="ayah-end" className="flex items-start gap-x-2">
        {chip}
        {marker}
      </span>
    );
  // lang="ar" sits on the Arabic text only, never on the container: the word
  // buttons' labels are in the page language, and a screen reader picks its
  // voice from the lang the label inherits.
  return (
    <div
      dir="rtl"
      className="quran flex flex-wrap items-start justify-center gap-x-2 gap-y-3 text-ar-lg text-ink sm:text-ar-xl"
    >
      {words.map((w, i) => {
        const isMarked = marked.includes(w.index);
        // The place under the word: LTR digits in the body face, 16px, in a
        // badge (filled when the word is marked).
        const place = numbered ? (
          <span
            aria-hidden
            dir="ltr"
            className={`mx-auto mt-0.5 mb-1 inline-flex min-w-7 items-center justify-center rounded-full border-[1.5px] px-1.5 font-body text-sm leading-6 font-semibold tabular-nums ${
              isMarked ? "border-forest bg-forest text-paper" : "border-border-ui bg-white text-ink"
            }`}
          >
            {w.index}
          </span>
        ) : null;
        if (!canPlay(w.index)) {
          // No timing for this word in the chosen recording: plain text.
          return withMarker(
            i,
            <span
              key={w.index}
              className={`inline-flex flex-col rounded-xl px-2.5 ${
                isMarked ? "ring-4 ring-forest ring-offset-2 ring-offset-white" : ""
              }`}
            >
              {/* The narration names words by place ("kata kedua"); the
                  badge is aria-hidden, so its place is said here. */}
              {numbered ? <span className="sr-only">{t("word_place", { n: w.index })}</span> : null}
              <span lang="ar">{w.ar}</span>
              {place}
            </span>,
          );
        }
        const active = activeWord === w.index;
        return withMarker(
          i,
          <button
            key={w.index}
            type="button"
            onClick={() => onTap(w.index)}
            // The place first ("Kata ke-2: dengar …"): the narration names
            // words by place, and the number badge itself is aria-hidden.
            aria-label={t("play_word", { n: w.index, translit: w.translit, gloss: w.gloss })}
            aria-current={active ? "true" : undefined}
            className={`inline-flex flex-col rounded-xl border-[1.5px] px-2.5 motion-safe:transition-colors ${
              active
                ? "border-forest bg-forest text-paper"
                : "border-border-ui bg-paper-deep text-ink hover:border-forest"
            } ${isMarked ? "ring-4 ring-forest ring-offset-2 ring-offset-white" : ""}`}
          >
            <span lang="ar">{w.ar}</span>
            {active && place ? (
              // On the forest fill the badge is paper with forest digits.
              <span
                aria-hidden
                dir="ltr"
                className="mx-auto mt-0.5 mb-1 inline-flex min-w-7 items-center justify-center rounded-full border-[1.5px] border-paper bg-paper px-1.5 font-body text-sm leading-6 font-semibold tabular-nums text-forest"
              >
                {w.index}
              </span>
            ) : (
              place
            )}
          </button>,
        );
      })}
      {words.length === 0 ? marker : null}
    </div>
  );
}
