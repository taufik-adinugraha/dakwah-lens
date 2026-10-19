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
import { ID_TEXTS, mapLaterWhere, type AutoplayTexts, type MapKindsSaid, type MapLaterName } from "@/lib/autoplay";

const things = (n: number) => (n === 1 ? "thing" : "things");

/** "a", "a and b", "a, b, and c" (the names are the lesson's Latin ones: "mu’rab dan mabni" keeps
 *  its Indonesian "dan"). */
const listEn = (names: readonly string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

/** The reassurance's word for what was put aside (the Indonesian yang satu ini / keduanya /
 *  ketiganya / semuanya). */
const pronounEn = (n: number) => (n === 1 ? "this one" : n === 2 ? "both of them" : n === 3 ? "all three" : "all of them");

/** The postponed steps, every one named, with where they are taught (ID_TEXTS' rule). */
function laterEn(later: readonly MapLaterName[]): string {
  const n = later.length;
  const lead = `${n} more ${n === 1 ? "thing is" : "things are"} in this ayah`;
  const where = mapLaterWhere(later);
  const names = listEn(later.map((x) => x.name));
  if (where === null) return `${lead}, namely ${names}, but we only cover ${n === 1 ? "it" : "them"} later.`;
  if (where !== "each") return `${lead}, namely ${names}, but we only cover ${n === 1 ? "it" : "them"} in ayah ${where}.`;
  return `${lead}, but we only cover them later: ${listEn(later.map((x) => `${x.name} in ayah ${x.ayah}`))}.`;
}

/** After a list of the steps met here, when the ayah has fewer than all three kinds of word (the
 *  Indonesian "Dari tiga jenis kata itu, di ayat ini hanya ada …"; operator 2026-10-18). */
const kindsEn = (k: MapKindsSaid | null | undefined) => (k && Array.isArray(k.kinds) ? ` Of ${k.step}, this ayah has only ${listEn(k.kinds)}.` : "");

const ID: AutoplayTexts = {
  ...ID_TEXTS,
  guide: {
    ...ID_TEXTS.guide,
    skip: "Klik untuk melewati",
    lanjut: "Klik di sini bila siap",
    part: {
      // The lesson plays the word (the narrator's recording of it): listening, not clicking.
      play: "Dengarkan kata",
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
  wordIntro: ({ n, translit }) => `Word ${n}: ${translit}. Listen to it.`,
  meaning: ({ n, gloss }) => `Word ${n} means “${gloss}”.`,
  structure: (summary) => `How this ayah's sentence is built: ${summary}`,
  structureItems: (item) => `Now how its sentence is built. ${item}`,
  structureBrief: "How this ayah's sentence is built is explained under Learn more.",
  concept: (title, summary) => `New concept — ${title}: ${summary}`,
  conceptBrief: (title) => `New concept — ${title}. It is explained under Learn more.`,
  exercise: {
    "word-kind": {
      intro: "Warm-up: isim, fi'il, or huruf? Guess the kind of each word of this ayah first.",
      options: "Click one of the marked kinds.",
      reveal: "Try again, or click the marked “Show the answer”.",
      next: "Click the marked button to continue.",
    },
    "tap-word": {
      intro: "Practice: Listen and click. One word of this ayah is read out, then you click that word.",
      play: "Listen to one word of this ayah.",
      options: "Now click the word you just heard.",
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
  // The Indonesian templates (ID_TEXTS; pipeline/build_narration.py map_new … map_total) in
  // English: every counted step named, in teaching order, by its Latin name; a next-level topic
  // counted, never named; the reassurance after what is put aside (operator 2026-10-15).
  lessonMap: {
    new: ({ new: fresh }) =>
      fresh.length ? `This ayah has ${fresh.length} new ${things(fresh.length)} to learn: ${listEn(fresh)}.` : "This ayah has nothing new.",
    again: ({ again, kinds }) =>
      again.length === 0
        ? "Nothing we have learnt comes up again in this ayah."
        : again.length === 1
          ? `Of what we have learnt, the one we meet again in this ayah is ${again[0]}.${kindsEn(kinds)}`
          : `Of what we have learnt, the ones we meet again in this ayah are ${listEn(again)}.${kindsEn(kinds)}`,
    later: ({ later, lanjut }) =>
      [
        later.length ? laterEn(later) : "",
        lanjut ? `${later.length ? "There" : "In this ayah there"} ${lanjut === 1 ? "is" : "are"}${later.length ? " also" : ""} ${lanjut} advanced ${lanjut === 1 ? "topic" : "topics"}, which the basic level does not cover.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    focus: ({ later, lanjut, new: fresh, again, kinds }) =>
      [
        later ? `You do not need to memorise ${pronounEn(later)} now${lanjut ? ", nor think about the advanced topics" : ""}.` : `You do not need to think about ${pronounEn(lanjut)} now.`,
        fresh.length ? `Let us focus on ${listEn(fresh)} first.` : again.length ? `Let us focus on going over ${listEn(again)} first.${kindsEn(kinds)}` : "Let us focus on this ayah first.",
      ].join(" "),
  },
  learned: ({ new: fresh, again, kinds }) =>
    fresh.length
      ? `In this ayah we learnt ${fresh.length} new ${things(fresh.length)}: ${listEn(fresh)}.`
      : again.length
        ? `This ayah had nothing new; it repeated ${again.length} ${things(again.length)} we have already learnt, namely ${listEn(again)}.${kindsEn(kinds)}`
        : "This ayah had nothing new.",
  total: ({ total, fresh, grouped }) =>
    fresh
      ? `That makes ${total.length} ${things(total.length)} learnt so far${grouped ? "" : `, namely ${listEn(total)}`}.`
      : `So far we have learnt ${total.length} ${things(total.length)}${grouped ? "" : `, namely ${listEn(total)}`}.`,
  totalGroup: ({ from, steps }) => `From ${listEn(from)}: ${steps.length} ${things(steps.length)}, namely ${listEn(steps)}.`,
  recap: "Listen to the whole ayah once more, and recite along with the imam.",
  next: ({ ayah }) => `This ayah's lesson is complete. Next: ayah ${ayah}.`,
  done: ({ surah }) => `This ayah's lesson is complete. It is the last ayah of surah ${surah}.`,
  zeroIntro: ({ surah }) =>
    `This is the introductory lesson, before we study Surah ${surah}. It covers two things: the vowel marks (harakat), then the three kinds of word in Arabic.`,
  zeroNext: ({ surah }) => `The introductory lesson is complete. Next: the first ayah of Surah ${surah}; the lesson continues by itself.`,
  example: {
    word: ({ n, translit }) => `Example: word ${n}, ${translit}.`,
    other: ({ translit, surah, ayah }) => `Another example: ${translit}, in QS ${surah}:${ayah}.`,
    zero: ({ translit, surah, ayah }) => `Example: ${translit}, in QS ${surah}:${ayah}.`,
    base: ({ translit, surah, ayah }) => `Example: ${translit}, in QS ${surah}:${ayah}.`,
    form: ({ translit }) => `Example of the base form: ${translit}.`,
    waqf: "The imam stops at the end of the ayah, so its last vowel is not heard.",
    washal: ({ heard }) => `With the word before it you hear “${heard}”, because its first alif is not read.`,
  },
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
      play: "Listen to the word",
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
