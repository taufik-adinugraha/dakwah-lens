/**
 * Which exercises an ayah's lesson renders — the autoplay sequence waits only at exercises that
 * actually appear. Since 2026-10-11 ONE plan decides it for the page, its exercises and the
 * engine alike: content/quiz/<slug>.json (pipeline/build_quiz.py; operator 2026-10-10, narration
 * rule 16: test only what was taught), whose exercises each render exactly the questions listed
 * there. An exercise with no questions is not in the plan, so nothing has to mirror a
 * component's "render nothing" rule any more (an exercise that never reported done would leave
 * the lesson waiting; the "Lewati latihan" button is the learner's way out either way).
 */
import type { Ayah } from "@/content/schema";

import { EXERCISE_KEYS, type ExerciseKey } from "./types";

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

/** What the engine reads of one ayah's quiz (content/quiz, src/content/quiz-schema.ts): no zod
 *  here, so scripts/autoplay-check.ts can run the engine on raw JSON. */
export type QuizAyahLike = {
  exercises: readonly { key: string; questions: readonly { n: number }[] }[];
};

const isKey = (k: string): k is ExerciseKey => (EXERCISE_KEYS as readonly string[]).includes(k);

/** The exercises this ayah renders, in page order: those of its quiz with at least one question. */
export function availableExercises(quiz: QuizAyahLike | null | undefined): ExerciseKey[] {
  const keys = (quiz?.exercises ?? []).filter((e) => e.questions.length > 0).map((e) => e.key).filter(isKey);
  return canonicalExercises(keys);
}

/** The question numbers of each exercise of the ayah (their explanation lines,
 *  "${slug}:${ayah}:ex:${key}:${n}:why"). */
export function questionNumbers(quiz: QuizAyahLike | null | undefined): Partial<Record<ExerciseKey, number[]>> {
  const out: Partial<Record<ExerciseKey, number[]>> = {};
  for (const e of quiz?.exercises ?? []) if (isKey(e.key)) out[e.key] = e.questions.map((q) => q.n);
  return out;
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
