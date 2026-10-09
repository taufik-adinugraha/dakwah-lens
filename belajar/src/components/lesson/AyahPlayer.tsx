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
 * paper text (7.9:1), and the word the guided lesson is explaining carries a
 * ring. Arabic is rendered from content data only, never retyped.
 *
 * Presentational: the one player lives in LessonStage, shared with the
 * guided lesson so the line highlights during the lesson too.
 */
export function MushafLine({
  ayah,
  words,
  activeWord,
  focusWord,
  canPlay,
  onTap,
}: {
  ayah: number;
  words: PlayerWord[];
  /** Word being recited right now. */
  activeWord: number | null;
  /** Word the guided lesson is about (ring, no fill). */
  focusWord?: number;
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
      className="quran flex flex-wrap items-center justify-center gap-x-2 gap-y-3 text-ar-lg text-ink sm:text-ar-xl"
    >
      {words.map((w) => {
        if (!canPlay(w.index)) {
          // No timing for this word in the chosen recording: plain text.
          return (
            <span key={w.index} lang="ar" className="px-2.5">
              {w.ar}
            </span>
          );
        }
        const active = activeWord === w.index;
        const focus = !active && focusWord === w.index;
        return (
          <button
            key={w.index}
            type="button"
            onClick={() => onTap(w.index)}
            aria-label={t("play_word", { translit: w.translit, gloss: w.gloss })}
            aria-current={active ? "true" : undefined}
            className={`rounded-xl border-[1.5px] px-2.5 motion-safe:transition-colors ${
              active
                ? "border-forest bg-forest text-paper"
                : "border-border-ui bg-paper-deep text-ink hover:border-forest"
            } ${focus ? "ring-2 ring-forest ring-offset-2 ring-offset-white" : ""}`}
          >
            <span lang="ar">{w.ar}</span>
          </button>
        );
      })}
      <span aria-hidden lang="ar" className="select-none px-1 text-ink-soft">
        ﴿{toArabicDigits(ayah)}﴾
      </span>
    </div>
  );
}
