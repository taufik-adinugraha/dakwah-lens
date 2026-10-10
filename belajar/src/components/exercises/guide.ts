/**
 * Names for the exercises' guided mode, shared by three parties:
 * - the exercises, which mark the control the learner should use next with
 *   `data-guide="<target>"` (only in guided mode) and report it through
 *   `guided.onGuide`;
 * - the lesson runner, which voices a prompt for each target and waits for
 *   `guided.onDone`;
 * - the spotlight overlay, which finds the marked control with
 *   `document.querySelector(guideSelector(target))`.
 *
 * Pure: no React and no "use client", so server code, lesson-step builders
 * and unit tests can import it. The full API is documented at the top of
 * ExerciseShell.tsx.
 */

/** The five exercises, by the key used in targets and narration line ids
 *  (`${slug}:${ayah}:ex:${key}:${lineKey}`). */
export const EXERCISE_KEYS = ["tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory"] as const;
export type ExerciseKey = (typeof EXERCISE_KEYS)[number];

/**
 * What a target points at:
 * - play    : "Dengarkan kata" (Dengar dan klik, before the word is heard)
 * - options : the answer options (the words, for Dengar dan klik)
 * - words   : the words still to sort (Kelompokkan, step 1)
 * - bins    : the four groups (Kelompokkan, step 2)
 * - reveal  : "Tunjukkan jawaban" (after two misses; the options stay usable)
 * - next    : "Lanjut", or "Selesai" on the last question
 */
export const GUIDE_PARTS = ["play", "options", "words", "bins", "reveal", "next"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

/** The parts each exercise can point at, in the order a question meets them. */
export const EXERCISE_GUIDE_PARTS: Readonly<Record<ExerciseKey, readonly GuidePart[]>> = {
  "tap-word": ["play", "options", "reveal", "next"],
  "why-harakat": ["options", "reveal", "next"],
  "sort-case": ["words", "bins", "reveal"],
  "label-role": ["options", "reveal", "next"],
  "wazn-factory": ["options", "reveal", "next"],
};

/** e.g. "exercise:tap-word:play". */
export type GuideTarget = `exercise:${ExerciseKey}:${GuidePart}`;

/** What a guide report says besides its target. */
export type GuideInfo = {
  /** Dengar dan klik, with "play": the word (1-based) the question asks
   *  about — the lesson's imam recites it, so the learner needs no tap. */
  word?: number;
};

/** The optional `guided` prop of every exercise. */
export type ExerciseGuide = {
  /** Every answer: true when right. A tap the exercise ignores (a settled
   *  question, an option already tried, a group tapped with no word chosen)
   *  is not an answer; neither is "Tunjukkan jawaban". */
  onAnswer?: (correct: boolean) => void;
  /** The exercise is finished (or has nothing to ask on this ayah). */
  onDone?: () => void;
  /** The control the learner should use next has changed. */
  onGuide?: (target: GuideTarget, info?: GuideInfo) => void;
  /** The lesson's count of "move on" signals: each time it goes up, a
   *  settled question moves to the next one (or finishes) as if "Lanjut" /
   *  "Selesai" were tapped — the learner only answers. */
  advance?: number;
  /** Dengar dan klik: the word the lesson's imam has just recited to its
   *  end; the question whose word it is offers its words. */
  heard?: number | null;
};

export function guideTarget(key: ExerciseKey, part: GuidePart): GuideTarget {
  return `exercise:${key}:${part}`;
}

/** The exercise and part a target names; null for anything else. */
export function parseGuideTarget(target: string): { key: ExerciseKey; part: GuidePart } | null {
  const m = /^exercise:([a-z-]+):([a-z]+)$/.exec(target);
  if (!m) return null;
  const key = EXERCISE_KEYS.find((k) => k === m[1]);
  const part = GUIDE_PARTS.find((p) => p === m[2]);
  if (!key || !part || !EXERCISE_GUIDE_PARTS[key].includes(part)) return null;
  return { key, part };
}

/** CSS selector of the element a target marks. */
export function guideSelector(target: string): string {
  return `[data-guide="${target.replace(/["\\]/g, "\\$&")}"]`;
}

/**
 * The `data-guide` value for each part of one exercise: the target in
 * guided mode, undefined otherwise — so a standalone exercise carries no
 * markers and a page can hold a guided copy and a standalone copy of the
 * same exercise without the overlay finding the wrong one.
 */
export function guideMarker(guided: ExerciseGuide | undefined, key: ExerciseKey) {
  return (part: GuidePart): GuideTarget | undefined => (guided ? guideTarget(key, part) : undefined);
}

/** Where one question of a choose-one exercise stands. */
type ChoiceState = {
  finished: boolean;
  /** The question is answered right or revealed. */
  settled: boolean;
  /** "Tunjukkan jawaban" is offered (two misses). */
  canReveal: boolean;
};

/** Kenapa harakat, Tebak peran, Bentuk kata: options → (reveal) → next. */
export function choiceGuidePart(s: ChoiceState): GuidePart | null {
  if (s.finished) return null;
  if (s.settled) return "next";
  return s.canReveal ? "reveal" : "options";
}

/**
 * Dengar dan klik: play → options → (reveal) → next. The spotlight leaves
 * "Dengarkan kata" only once the imam's word has played to its end, so a
 * voiced prompt never starts over the recitation.
 */
export function tapWordGuidePart(s: ChoiceState & { heard: boolean }): GuidePart | null {
  if (s.finished) return null;
  if (s.settled) return "next";
  if (!s.heard) return "play";
  return s.canReveal ? "reveal" : "options";
}

/** Kelompokkan menurut akhiran: words → bins (→ reveal), per word. */
export function sortCaseGuidePart(s: { finished: boolean; selected: boolean; canReveal: boolean }): GuidePart | null {
  if (s.finished) return null;
  if (!s.selected) return "words";
  return s.canReveal ? "reveal" : "bins";
}
