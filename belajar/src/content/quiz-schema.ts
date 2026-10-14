/**
 * Content contract of the quizzes (content/quiz/<slug>.json) — the questions each ayah's
 * exercises ask, with their answers and wrong options, built by pipeline/build_quiz.py and
 * checked by pipeline/validate_quiz.py (pipeline/quiz.py has the rules). Kept apart from
 * schema.ts, whose zod shape pipeline/validate.py mirrors field by field.
 *
 * Operator, 2026-10-10 (narration rule 16): "make sure all questions in quiz already have lesson
 * beforehand when exploring ayat". The plan, not the component, now decides what an exercise
 * asks: an authored plan (Al-Fatihah) asks only what the lesson has taught by then, with wrong
 * options from the ayat already studied that differ in cause; the other surahs get the
 * components' old rules with the wrong options drawn from the ayat studied so far. Texts that
 * name a grammar term carry its Arabic from the verified term table ("majrur (مَجْرُور)").
 * The first option of a question is its answer (the exercise shuffles them for display).
 */
import { z } from "zod";

import { CaseState, WordLoc } from "./schema";

const N = z.number().int().positive();

/** A wrong or right option that is another word's reason (why-harakat) or role (label-role). */
export const QuizOption = z.object({
  /** The word whose reason or role this is (the answer's own word for option 0). */
  from: WordLoc,
  /** Shown as given (MixedText): content bytes, grammar terms with their Arabic. */
  text: z.string().min(1),
});
export type QuizOption = z.infer<typeof QuizOption>;

/** `n`: the question's number in its exercise (1-based, the narration's ex:<key>:<n>:why line);
 *  `word`: the word of the ayah (1-based) it asks about. */
const TapQ = z.object({ n: N, word: N });
const WhyQ = z.object({
  n: N,
  word: N,
  /** The ending's sign, shown with the question ("kasrah (كَسْرَة)"); null when it has none. */
  sign: z.string().min(1).nullable(),
  /** The word's own reason, shown after the answer. */
  why: z.string().min(1),
  options: z.array(QuizOption).min(2),
});
const SortQ = z.object({ n: N, word: N, sign: z.string().min(1).nullable(), why: z.string().min(1) });
const RoleQ = z.object({ n: N, word: N, why: z.string().min(1), options: z.array(QuizOption).min(2) });
const WaznQ = z.object({
  n: N,
  /** library.json lexicon id: the forms come from its tashrif table. */
  lexeme: z.string().regex(/^[a-z0-9-]+$/),
  /** The form asked for (a tashrif label, "fi'il mudhari'"). */
  label: z.string().min(2),
  /** Form labels offered; the first is `label`. */
  options: z.array(z.string().min(2)).min(2),
});

/** The three kinds of word, by their term ids (authored/library.terms.json): the warm-up's answers. */
export const WordKind = z.enum(["isim", "fiil", "huruf"]);
export type WordKind = z.infer<typeof WordKind>;

/**
 * A question of the WARM-UP that opens an ayah's lesson (operator 2026-10-13: "in every ayat we
 * identify first each words fall into which category: ismu, fi'il or harf. it's kind of exercise,
 * kind of warming up"; pipeline/quiz.py "the warm-up"). Derived, never authored. `ask` says what
 * kind of question it is — "kind" today: which of the three kinds is this part of a word? A later
 * kind (decision 8 of the basic curriculum: questions on earlier topics met again in the ayah)
 * is one more member of this union, numbered on in the same exercise.
 */
const KindQ = z.object({
  n: N,
  ask: z.literal("kind"),
  /** The word of the ayah (1-based) … */
  word: N,
  /** … and which of its parts (1-based; a word of one part: 1 of 1). A compound word is its QAC
   *  segments, the article counted with the part it stands on ("dengan" + "nama": two). */
  part: N,
  of: N,
  /** The part as the mushaf writes it: the lesson content's own bytes (the word, or its QAC
   *  segments), never typed. The parts of a word, joined, are the word. */
  ar: z.string().min(1),
  /** The answer: from the part's QAC tag, agreeing with the word's `pos`. */
  kind: WordKind,
  /** The visible signs its explanation gives (an isim only, and only what an earlier lesson
   *  taught): "jar" — the part before it is a huruf jar; "al" — it carries alif lam. */
  signs: z.array(z.enum(["jar", "al"])),
  /** false: the explanation says the kind and stops, without the kind's plain meaning — an isim
   *  that is no noun, proper noun or adjective (a pronoun, a relative …: the Kalimah record's
   *  gloss does not cover it), and the Name of Allah (pipeline/quiz.py `glossed`). */
  gloss: z.literal(false).optional(),
  /** The one sentence shown after the answer, which the narrator says too. */
  why: z.string().min(1),
});
export const WarmupQuestion = z.discriminatedUnion("ask", [KindQ]);
export type WarmupQuestion = z.infer<typeof WarmupQuestion>;

export const QuizExercise = z.discriminatedUnion("key", [
  z.object({ key: z.literal("word-kind"), questions: z.array(WarmupQuestion).min(1) }),
  z.object({ key: z.literal("tap-word"), questions: z.array(TapQ).min(1) }),
  z.object({ key: z.literal("why-harakat"), questions: z.array(WhyQ).min(1) }),
  z.object({
    key: z.literal("sort-case"),
    /** The groups offered: the case states taught so far (authored plans). */
    bins: z.array(CaseState).min(2),
    questions: z.array(SortQ).min(1),
  }),
  z.object({ key: z.literal("label-role"), questions: z.array(RoleQ).min(1) }),
  z.object({ key: z.literal("wazn-factory"), questions: z.array(WaznQ).min(1) }),
]);
export type QuizExercise = z.infer<typeof QuizExercise>;
export type QuizExerciseOf<K extends QuizExercise["key"]> = Extract<QuizExercise, { key: K }>;

export const QuizFile = z.object({
  version: z.literal(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** An authored, taught-checked plan (pipeline/authored/<slug>.quiz.json), else mechanical. */
  authored: z.boolean(),
  /** Each case state the quiz shows, as its label: "majrur (مَجْرُور)". */
  states: z.record(z.string(), z.string().min(1)),
  /** Each wazan form label the quiz shows, with its Arabic: "fi'il mudhari' (فِعْل مُضَارِع)". */
  labels: z.record(z.string(), z.string().min(1)),
  /** The warm-up's three answers as its buttons show them, "isim (اِسْم)"; empty for a surah
   *  without a lesson map (it has no warm-up). */
  kinds: z.record(z.string(), z.string().min(1)),
  ayat: z.array(z.object({ ayah: N, exercises: z.array(QuizExercise) })),
});
export type QuizFile = z.infer<typeof QuizFile>;

/** One ayah's quiz as the lesson page passes it on: its exercises and the labels they show. */
export type QuizAyah = {
  exercises: QuizExercise[];
  states: Record<string, string>;
  labels: Record<string, string>;
  kinds: Record<string, string>;
};
