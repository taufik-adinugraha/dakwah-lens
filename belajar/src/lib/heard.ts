/**
 * What the learner HEARS beside an example's "▶ Dengarkan", where it differs from what the page
 * writes (review 2026-10-12 of the example voices: every clip pointed at the right word, yet the
 * Harakat card for tanwin showed دٌ = d + un "dari أَحَدٌ (aḥadun)" and played "aḥad"). An example
 * is labelled by tajwid, not only by its bytes. Pure: no React, no DOM (heard.test.ts).
 *
 * Waqf: the imam stops on an ayah's last word, so a final harakah or tanwin is not pronounced
 * there — nasta‘īnu is heard "nasta‘īn", khalaqa "khalaq", aḥadun "aḥad". library.json marks such
 * a clip `last` (pipeline/clips.py, from the ayah's word count); the page adds one line beside
 * its button when the word's ending is one the pause drops. pipeline/clips.py pause_drop is the
 * same rule: the build refuses an ayah-final example whose ending is "other", so the note never
 * says something untrue.
 *
 * Hamzat washal (a base-form tile such as ٱسْمُ, cut from tabāraka-smu) is the build's:
 * library.json parts tiles carry `washal` {run, before, heard} and WordParts shows it.
 *
 * A Harakat sign card teaches the sound of its sign, so its example is a place where the sign is
 * heard (signNotHeard; pipeline/clips.py sign_heard_problems is the build's check of the same).
 */
import type { Clip } from "@/content/schema";

import { letters } from "./terms";

const FATHATAIN = "\u064B";
const DHAMMATAIN = "\u064C";
const KASRATAIN = "\u064D";
const SHORT_VOWELS = ["\u064E", "\u064F", "\u0650"]; // fathah, dhammah, kasrah
const SUKUN_AND_SHADDAH = ["\u0651", "\u0652"];
const TA_MARBUTHAH = "\u0629";
/** The small waw / ya' after a pronoun's ha' (لَهُۥ): its long vowel. */
const SILAH = ["\u06E5", "\u06E6"];

/** What the pause on an ayah's last word does to its ending:
 *  - "harakat": its last letter carries a short vowel or a dhammah / kasrah tanwin, which is not
 *    pronounced there (the note's "harakat akhirnya tidak terdengar");
 *  - "none": nothing is dropped (a sukun, a long vowel: yūlad, ihdinā);
 *  - "other": the pause changes it another way (fathatain is read ā, ta' marbuthah h, a pronoun's
 *    ha' loses its long vowel): no wording yet, and the build lets no such example end an ayah. */
export type WaqfDrop = "harakat" | "none" | "other";

export function waqfDrop(word: string): WaqfDrop {
  const ls = letters(word);
  if (!ls.length) return "none";
  const end = ls[ls.length - 1];
  const marks = [...end].slice(1);
  const before = ls.length > 1 ? ls[ls.length - 2] : "";
  if (marks.includes(FATHATAIN) || end.startsWith(TA_MARBUTHAH) || marks.some((m) => SILAH.includes(m))) return "other";
  const voweled = marks.some((m) => SHORT_VOWELS.includes(m) || m === DHAMMATAIN || m === KASRATAIN);
  // كُفُوًا: the alif after the tanwin ends the word
  if (!voweled && !marks.some((m) => SUKUN_AND_SHADDAH.includes(m)) && before.includes(FATHATAIN)) return "other";
  return voweled ? "harakat" : "none";
}

/** Does the button of `clip` carry the waqf note? `ar`: the Arabic the page shows for the
 *  example (a word, or a run: its last word is the one the imam stops on). */
export function hasWaqfNote(clip: Pick<Clip, "last"> | null | undefined, ar: string | null | undefined): boolean {
  if (!clip?.last || !ar) return false;
  const words = ar.trim().split(/\s+/u);
  return waqfDrop(words[words.length - 1]) === "harakat";
}

/** The letters that keep a tanwin's n clearly heard when the next word starts with one (izhar
 *  halqi): hamzah as the Tanzil text writes it at a word's start (ء أ إ آ; never ٱ, a hamzat
 *  washal), ha', ‘ain, ḥa', ghain, kha'. */
const IZHAR: ReadonlySet<string> = new Set(["\u0621", "\u0623", "\u0625", "\u0622", "\u0647", "\u0639", "\u062D", "\u063A", "\u062E"]);
const TANWIN_MARKS: ReadonlySet<string> = new Set(["fathatain", "kasratain", "dhammatain"]);

/** Why the sign of a Harakat card is NOT heard where its example is, or null when it is:
 *  a tanwin on an ayah's last word (the imam stops: "aḥad"), a tanwin before a letter that hides
 *  its n (idgham, ikhfa', iqlab), or any sign on the last letter of an ayah's last word.
 *  `marks`: the sign's mark names; `letter`, `word`: 1-based places of the example letter in its
 *  word and of the word in its ayah; `tokens`: the ayah's words. */
export function signNotHeard(
  marks: readonly string[],
  letter: number,
  word: number,
  tokens: readonly string[],
): "tanwin-at-ayah-end" | "tanwin-not-izhar" | "last-letter-at-ayah-end" | null {
  const last = word === tokens.length;
  if (marks.some((m) => TANWIN_MARKS.has(m))) {
    if (last) return "tanwin-at-ayah-end";
    return IZHAR.has([...tokens[word]][0]) ? null : "tanwin-not-izhar";
  }
  return last && letter === letters(tokens[word - 1]).length ? "last-letter-at-ayah-end" : null;
}
