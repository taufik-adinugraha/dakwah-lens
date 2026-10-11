/**
 * Reading an ayah's quiz (content/quiz, src/content/quiz-schema.ts) without zod: type imports
 * only, so the client exercises can use it without the schema in their bundle.
 */
import type { QuizAyah, QuizExercise, QuizExerciseOf } from "@/content/quiz-schema";

/** The plan of exercise `key` in an ayah's quiz, or null (the page renders only those it has). */
export function planOf<K extends QuizExercise["key"]>(quiz: Pick<QuizAyah, "exercises">, key: K): QuizExerciseOf<K> | null {
  const ex = quiz.exercises.find((e) => e.key === key);
  return (ex as QuizExerciseOf<K> | undefined) ?? null;
}
