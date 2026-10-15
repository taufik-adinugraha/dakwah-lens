"use client";

import type { ReactNode } from "react";

import type { ExerciseGuide } from "@/components/exercises/guide";
import { LabelRole } from "@/components/exercises/LabelRole";
import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WaznFactory } from "@/components/exercises/WaznFactory";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import { WordKind } from "@/components/exercises/WordKind";
import type { QuizAyah } from "@/content/quiz-schema";
import type { Clip, Lexeme, Word } from "@/content/schema";
import type { ExerciseKey } from "@/lib/autoplay";
import { planOf } from "@/lib/quiz-plan";

/** What the exercises need, as the lesson page passes it to the stage. */
export type StageExerciseData = {
  /** The ayah's words. */
  words: Word[];
  /** Lexemes of the ayah with a tashrif table (Bentuk-bentuk kata). */
  lexemes: Lexeme[];
  /** The ayah's quiz (content/quiz): every question each exercise asks, and the labels it shows
   *  with their Arabic (operator 2026-10-10: test only what was taught). */
  quiz: QuizAyah;
};


/** Message key of each exercise's title in the Exercise namespace. */
export const EXERCISE_TITLE_KEY = {
  "word-kind": "kind_title",
  "tap-word": "tap_title",
  "why-harakat": "why_title",
  "sort-case": "sort_title",
  "label-role": "role_title",
  "wazn-factory": "wazn_title",
} as const satisfies Record<ExerciseKey, string>;

/**
 * One exercise inside the lesson stage, in guided compact mode: it marks
 * its controls with data-guide (for the Spotlight), reports answers, the
 * next control and done to the runner, and hides its own heading (the stage
 * shows the prompt). `progressId` is the id the page's standalone copy
 * uses, so the same questions come up and finishing here marks that copy
 * "Sudah dikerjakan" too.
 */
export function GuidedExercise({
  exercise,
  progressId,
  data,
  tapWords,
  guided,
}: {
  exercise: ExerciseKey;
  progressId: string;
  data: StageExerciseData;
  /** The mushaf words of the ayah (Dengar dan klik), each with the narrator's recording of it
   *  (what is played: never the imam's recitation cut at the word, operator 2026-10-14). */
  tapWords: { index: number; ar: string; translit: string; gloss: string; voice: Clip | null }[];
  guided: ExerciseGuide;
}) {
  const { quiz } = data;
  // data-exercise: the exercise on screen, by key (the CI exercise check finds its step by it).
  const wrap = (node: ReactNode) => <div data-exercise={exercise}>{node}</div>;
  switch (exercise) {
    case "word-kind": {
      const p = planOf(quiz, "word-kind");
      return p && wrap(<WordKind id={progressId} words={data.words} questions={p.questions} kinds={quiz.kinds} guided={guided} compact />);
    }
    case "tap-word": {
      const p = planOf(quiz, "tap-word");
      return p && wrap(<TapWord id={progressId} words={tapWords} questions={p.questions} guided={guided} compact />);
    }
    case "why-harakat": {
      const p = planOf(quiz, "why-harakat");
      return p && wrap(<WhyHarakat id={progressId} words={data.words} questions={p.questions} states={quiz.states} guided={guided} compact />);
    }
    case "sort-case": {
      const p = planOf(quiz, "sort-case");
      return (
        p &&
        wrap(<SortCase id={progressId} words={data.words} questions={p.questions} bins={p.bins} states={quiz.states} guided={guided} compact />)
      );
    }
    case "label-role": {
      const p = planOf(quiz, "label-role");
      return p && wrap(<LabelRole id={progressId} words={data.words} questions={p.questions} guided={guided} compact />);
    }
    case "wazn-factory": {
      const p = planOf(quiz, "wazn-factory");
      return (
        p &&
        wrap(<WaznFactory id={progressId} lexemes={data.lexemes} questions={p.questions} labels={quiz.labels} guided={guided} compact />)
      );
    }
    default:
      return null;
  }
}
