/**
 * Caption templates of the autoplay lesson per locale (ON-SCREEN text).
 *
 * Indonesian is the engine's ID_TEXTS (src/lib/autoplay/texts.ts, checked by
 * scripts/autoplay-check.ts) with one change: the spotlight labels say
 * "Klik …", the word the narration uses for every control (operator,
 * 2026-10-10: never "ketuk"), and stay short (they sit over the stage on a
 * 360px phone). English follows the same shape ("click"); the lesson
 * content itself (glosses, explanations) stays Indonesian in v1
 * (routing.ts, plan B12), as on the rest of the page.
 *
 * Rules (as ID_TEXTS): plain language for adults, sentence case, no ALL
 * CAPS, no Arabic script; captions may show digits and Latin
 * transliteration. These are the captions of lines without a narration
 * display text (an English page, or a line the manifest lacks). Nothing here
 * promises a human review (plan L11). Pure: the page builds the sequence on
 * the server, and stage.test.ts runs the engine's checks with these sets.
 */
import { ID_TEXTS, type AutoplayTexts } from "@/lib/autoplay";

const ID: AutoplayTexts = {
  ...ID_TEXTS,
  guide: {
    ...ID_TEXTS.guide,
    skip: "Klik untuk melewati",
    lanjut: "Klik di sini bila siap",
    part: {
      // The lesson's imam plays the word: listening, not clicking.
      play: "Dengarkan imam",
      options: "Klik salah satu",
      words: "1. Klik satu kata",
      bins: "2. Klik kelompoknya",
      reveal: "Atau lihat jawaban",
      next: "Klik untuk lanjut",
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
      intro: "Practice: Listen and click. The imam recites one word of this ayah, then you click that word.",
      play: "Listen to the imam recite one word of this ayah.",
      options: "Now click the word the imam just recited.",
      reveal: "Try again, or click the marked “Show the answer”.",
      next: "Click the marked button to continue.",
    },
    "why-harakat": {
      intro: "Practice: Why this ending? Choose the reason the word ends the way it does.",
      options: "Click one of the marked reasons.",
      reveal: "Try again, or click the marked “Show the answer”.",
      next: "Click the marked button to continue.",
    },
    "sort-case": {
      intro: "Practice: Group by ending. Put each word in the group for its ending.",
      words: "First click one of the marked words.",
      bins: "Then click the group that fits that word.",
      reveal: "Try another group, or click the marked “Show the answer”.",
    },
    "label-role": {
      intro: "Practice: Guess the word's role. Choose each word's role in this ayah's sentence.",
      options: "Click one of the marked roles.",
      reveal: "Try again, or click the marked “Show the answer”.",
      next: "Click the marked button to continue.",
    },
    "wazn-factory": {
      intro: "Practice: Word forms. Pick the form that matches its name.",
      options: "Click one of the marked forms.",
      reveal: "Try again, or click the marked “Show the answer”.",
      next: "Click the marked button to continue.",
    },
  },
  recap: "Listen to the whole ayah once more, and recite along with the imam.",
  next: ({ ayah }) => `This ayah's lesson is complete. Next: ayah ${ayah}.`,
  done: ({ surah }) => `This ayah's lesson is complete. It is the last ayah of surah ${surah}.`,
  shared: {
    start: "The lesson begins. Just listen and watch the screen; when there is practice, you will be guided.",
    resume: "Let us continue.",
    correct: "Correct.",
    revealed: "Here is the answer.",
    reminder: "Take your time, there is no hurry.",
    skip_offer: "To continue without this practice, click “Skip practice”.",
    surah_done: "Your next choices are on the screen.",
  },
  guide: {
    mushafLine: "The ayah being recited",
    mushafWord: (n) => `Word ${n}`,
    wordCard: "This word",
    skip: "Click to skip",
    lanjut: "Click here when ready",
    part: {
      play: "Listen to the imam",
      options: "Click one of these",
      words: "1. Click a word",
      bins: "2. Click its group",
      reveal: "Or see the answer",
      next: "Click to continue",
    },
  },
};

/** Caption templates for a locale (Indonesian for anything unknown). */
export function autoplayTexts(locale: string): AutoplayTexts {
  return locale === "en" ? EN : ID;
}

/** Every caption set the page can use, for the checks. */
export const AUTOPLAY_TEXT_SETS: Readonly<Record<"id" | "en", AutoplayTexts>> = { id: ID, en: EN };
