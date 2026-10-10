/**
 * Caption templates of the autoplay lesson per locale (ON-SCREEN text).
 *
 * Indonesian is the engine's ID_TEXTS (src/lib/autoplay/texts.ts, checked by
 * scripts/autoplay-check.ts) with one change: the spotlight labels say
 * "Ketuk …", the word the narration uses for every control, and stay short
 * (they sit over the stage on a 360px phone). English follows the same
 * shape; the lesson content itself (glosses, explanations) stays Indonesian
 * in v1 (routing.ts, plan B12), as on the rest of the page.
 *
 * Rules (as ID_TEXTS): plain language for adults, sentence case, no ALL
 * CAPS, no Arabic script; captions may show digits and Latin
 * transliteration (the spoken narration carries neither). Nothing here
 * promises a human review (plan L11). Pure: the page builds the sequence on
 * the server, and stage.test.ts runs the engine's checks with these sets.
 */
import { ID_TEXTS, type AutoplayTexts } from "@/lib/autoplay";

const ID: AutoplayTexts = {
  ...ID_TEXTS,
  guide: {
    ...ID_TEXTS.guide,
    skip: "Ketuk untuk melewati",
    lanjut: "Ketuk di sini bila siap",
    part: {
      // The lesson's imam plays the word: listening, not tapping.
      play: "Dengarkan imam",
      options: "Ketuk salah satu",
      words: "1. Ketuk satu kata",
      bins: "2. Ketuk kelompoknya",
      reveal: "Atau lihat jawaban",
      next: "Ketuk untuk lanjut",
    },
  },
};

const EN: AutoplayTexts = {
  intro: ({ surah, ayah, total }) => `${surah}, ayah ${ayah} of ${total}. Listen, and watch the screen.`,
  recite: "Listen to the imam recite this ayah. The word being recited is marked.",
  wordIntro: ({ n, translit }) => `Word ${n}: ${translit}. Listen to the imam recite it.`,
  meaning: ({ n, gloss }) => `Word ${n} means “${gloss}”.`,
  structure: (summary) => `How this ayah's sentence is built: ${summary}`,
  structureBrief: "How this ayah's sentence is built is explained under Learn more.",
  concept: (title, summary) => `New concept — ${title}: ${summary}`,
  conceptBrief: (title) => `New concept — ${title}. It is explained under Learn more.`,
  exercise: {
    "tap-word": {
      intro: "Practice: Listen and tap. The imam recites one word of this ayah, then you tap that word.",
      play: "Listen to the imam recite one word of this ayah.",
      options: "Now tap the word the imam just recited.",
      reveal: "Try again, or tap the marked “Show the answer”.",
      next: "Tap the marked button to continue.",
    },
    "why-harakat": {
      intro: "Practice: Why this ending? Choose the reason the word ends the way it does.",
      options: "Tap one of the marked reasons.",
      reveal: "Try again, or tap the marked “Show the answer”.",
      next: "Tap the marked button to continue.",
    },
    "sort-case": {
      intro: "Practice: Group by ending. Put each word in the group for its ending.",
      words: "First tap one of the marked words.",
      bins: "Then tap the group that fits that word.",
      reveal: "Try another group, or tap the marked “Show the answer”.",
    },
    "label-role": {
      intro: "Practice: Guess the word's role. Choose each word's role in this ayah's sentence.",
      options: "Tap one of the marked roles.",
      reveal: "Try again, or tap the marked “Show the answer”.",
      next: "Tap the marked button to continue.",
    },
    "wazn-factory": {
      intro: "Practice: Word forms. Pick the form that matches its name.",
      options: "Tap one of the marked forms.",
      reveal: "Try again, or tap the marked “Show the answer”.",
      next: "Tap the marked button to continue.",
    },
  },
  recap: "Listen to the whole ayah once more, and recite along with the imam.",
  next: ({ ayah }) => `This ayah's lesson is complete. Next: ayah ${ayah}.`,
  done: ({ surah }) => `This ayah's lesson is complete. It is the last ayah of surah ${surah}.`,
  shared: {
    start: "The lesson begins. Just listen and watch the screen; when there is practice, you will be guided.",
    resume: "Let us continue.",
    correct: "Correct.",
    try_again: "Not quite. Please try again.",
    revealed: "Here is the answer. Take a moment to look at it.",
    reminder: "Take your time, there is no hurry.",
    skip_offer: "To continue without this practice, tap “Skip practice”.",
    surah_done: "Your next choices are on the screen.",
  },
  guide: {
    mushafLine: "The ayah being recited",
    mushafWord: (n) => `Word ${n}`,
    wordCard: "This word",
    skip: "Tap to skip",
    lanjut: "Tap here when ready",
    part: {
      play: "Listen to the imam",
      options: "Tap one of these",
      words: "1. Tap a word",
      bins: "2. Tap its group",
      reveal: "Or see the answer",
      next: "Tap to continue",
    },
  },
};

/** Caption templates for a locale (Indonesian for anything unknown). */
export function autoplayTexts(locale: string): AutoplayTexts {
  return locale === "en" ? EN : ID;
}

/** Every caption set the page can use, for the checks. */
export const AUTOPLAY_TEXT_SETS: Readonly<Record<"id" | "en", AutoplayTexts>> = { id: ID, en: EN };
