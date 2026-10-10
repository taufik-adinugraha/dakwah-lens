/**
 * Which exercises an ayah's lesson renders — the autoplay sequence waits
 * only at exercises that actually appear. The conditions MIRROR the
 * exercise components' own early returns (an exercise with too little to
 * ask renders nothing):
 *   TapWord      `order.length < 2`  → words timed in the page's FIRST source
 *   WhyHarakat   `items.length === 0` → words in a graded case
 *   SortCase     `items.length < 2`  → words in a SORT_BINS case
 *   LabelRole    `items.length < 2`  → words with a role
 *   WaznFactory  `items.length < 2`  → tashrif forms of lexemes with ≥ 3 forms
 * When a component's condition changes, change it here too (an exercise
 * that never reports done would leave the lesson waiting; the "Lewati
 * latihan" button is the learner's way out either way).
 */
import type { Ayah, Lexeme, Word } from "@/content/schema";

import { SORT_BINS } from "../cases";
import { EXERCISE_KEYS, type ExerciseKey } from "./types";

/** Cases WhyHarakat asks about (its GRADED set). */
const GRADED = new Set(["marfu", "manshub", "majrur", "mabni"]);

/**
 * Reciter order of the lesson page (its RECITER_ORDER): Mishary Alafasy is
 * the default (operator, 2026-10-09), Husary Mu'allim second. The page's
 * first source is the one TapWord plays.
 */
export const RECITER_ORDER = ["Alafasy_128kbps", "Husary_Muallim_128kbps"] as const;

const reciterRank = (id: string) => {
  const i = (RECITER_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? RECITER_ORDER.length : i;
};

/** An ayah's recitations in the page's order (stable for equal ranks). */
export function orderRecitations<R extends { reciter: string }>(recitation: readonly R[]): R[] {
  return [...recitation].sort((x, y) => reciterRank(x.reciter) - reciterRank(y.reciter));
}

/** 1-based word indices timed in the page's first (default) recitation. */
export function timedWords(ayah: Pick<Ayah, "recitation">): number[] {
  const first = orderRecitations(ayah.recitation)[0];
  return first ? [...new Set(first.segments.map(([w]) => w))] : [];
}

export type ExerciseInput = {
  words: readonly Pick<Word, "case" | "role" | "lemma_id">[];
  /** Word indices with timings in the first source (timedWords). */
  timed: Iterable<number>;
  /** Lexicon lookup (library.getLexeme). */
  lexeme: (id: string) => Pick<Lexeme, "tashrif"> | undefined;
};

/** The exercises this ayah renders, in page order. */
export function availableExercises(input: ExerciseInput): ExerciseKey[] {
  const { words } = input;
  const timed = new Set(input.timed);
  const tapCount = words.filter((_, i) => timed.has(i + 1)).length;
  const whyCount = words.filter((w) => GRADED.has(w.case.state)).length;
  const sortCount = words.filter((w) => SORT_BINS.includes(w.case.state)).length;
  const roleCount = words.filter((w) => !!w.role).length;
  const lemmaIds = [...new Set(words.map((w) => w.lemma_id).filter((x): x is string => !!x))];
  const waznCount = lemmaIds.reduce((n, id) => {
    const forms = input.lexeme(id)?.tashrif?.forms ?? [];
    return n + (forms.length >= 3 ? forms.length : 0);
  }, 0);
  const has: Record<ExerciseKey, boolean> = {
    "tap-word": tapCount >= 2,
    "why-harakat": whyCount >= 1,
    "sort-case": sortCount >= 2,
    "label-role": roleCount >= 2,
    "wazn-factory": waznCount >= 2,
  };
  return EXERCISE_KEYS.filter((k) => has[k]);
}

/** Suffix of each exercise's progress id on the lesson page. */
const PROGRESS_SUFFIX: Record<ExerciseKey, string> = {
  "tap-word": "tap",
  "why-harakat": "why",
  "sort-case": "sort",
  "label-role": "role",
  "wazn-factory": "wazn",
};

/** useProgress id the lesson page gives this exercise ("al-fatihah/2/tap"). */
export const exerciseProgressId = (lessonKey: string, key: ExerciseKey) => `${lessonKey}/${PROGRESS_SUFFIX[key]}`;

/** Canonical order + de-duplication of a list of exercise keys. */
export function canonicalExercises(keys: Iterable<ExerciseKey>): ExerciseKey[] {
  const set = new Set(keys);
  return EXERCISE_KEYS.filter((k) => set.has(k));
}
