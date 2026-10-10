"use client";

import { useTranslations } from "next-intl";

export type PlayerWord = { index: number; ar: string; translit: string; gloss: string };

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) =>
  String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

/**
 * The ayah as a mushaf line: every word is a light chip, so it looks
 * tappable; tapping replays just that word (the stage seeks within the
 * streamed recording). The word the imam is reciting is filled forest with
 * paper text (7.9:1). Arabic is rendered from content data only, never
 * retyped.
 *
 * While the autoplay lesson runs (`numbered`), every chip carries its place
 * under the word — "1", "2", … in Latin digits, 16px — because the
 * narration names words by their place ("kata kedua"), never by the word
 * itself. The words the line on screen is about (`marked`: the word being
 * explained, and the places the narration names) get a thick ring with a
 * white gap and a filled number: an outline and a shape change, never
 * colour alone.
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
  /** Show each word's place under it (the lesson runs). */
  numbered?: boolean;
  canPlay: (index: number) => boolean;
  onTap: (index: number) => void;
}) {
  const t = useTranslations("Player");
  // lang="ar" sits on the Arabic text only, never on the container: the word
  // buttons' labels are in the page language, and a screen reader picks its
  // voice from the lang the label inherits.
  return (
    <div
      dir="rtl"
      className="quran flex flex-wrap items-start justify-center gap-x-2 gap-y-3 text-ar-lg text-ink sm:text-ar-xl"
    >
      {words.map((w) => {
        const isMarked = marked.includes(w.index);
        // The place under the word: LTR digits in the body face, 16px.
        const place = numbered ? (
          <span
            aria-hidden
            dir="ltr"
            className={`mx-auto mt-0.5 mb-1 inline-flex min-w-7 items-center justify-center rounded-full px-1.5 font-body text-sm font-semibold tabular-nums ${
              isMarked ? "bg-forest text-paper" : "text-ink-muted"
            }`}
          >
            {w.index}
          </span>
        ) : null;
        if (!canPlay(w.index)) {
          // No timing for this word in the chosen recording: plain text.
          return (
            <span
              key={w.index}
              className={`inline-flex flex-col rounded-xl px-2.5 ${
                isMarked ? "ring-4 ring-forest ring-offset-2 ring-offset-white" : ""
              }`}
            >
              <span lang="ar">{w.ar}</span>
              {place}
            </span>
          );
        }
        const active = activeWord === w.index;
        return (
          <button
            key={w.index}
            type="button"
            onClick={() => onTap(w.index)}
            aria-label={t("play_word", { translit: w.translit, gloss: w.gloss })}
            aria-current={active ? "true" : undefined}
            className={`inline-flex flex-col rounded-xl border-[1.5px] px-2.5 motion-safe:transition-colors ${
              active
                ? "border-forest bg-forest text-paper"
                : "border-border-ui bg-paper-deep text-ink hover:border-forest"
            } ${isMarked ? "ring-4 ring-forest ring-offset-2 ring-offset-white" : ""}`}
          >
            <span lang="ar">{w.ar}</span>
            {active && place ? (
              // On the forest fill the number is paper, so it stays readable.
              <span
                aria-hidden
                dir="ltr"
                className="mx-auto mt-0.5 mb-1 inline-flex min-w-7 items-center justify-center rounded-full px-1.5 font-body text-sm font-semibold tabular-nums text-paper"
              >
                {w.index}
              </span>
            ) : (
              place
            )}
          </button>
        );
      })}
      <span aria-hidden lang="ar" className="select-none self-center px-1 text-ink-soft">
        ﴿{toArabicDigits(ayah)}﴾
      </span>
    </div>
  );
}
