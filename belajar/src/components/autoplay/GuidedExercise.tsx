"use client";

import type { ExerciseGuide } from "@/components/exercises/guide";
import { LabelRole } from "@/components/exercises/LabelRole";
import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WaznFactory } from "@/components/exercises/WaznFactory";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import type { Lexeme, Word } from "@/content/schema";
import type { RecitationSource } from "@/hooks/useSegmentPlayer";
import type { ExerciseKey } from "@/lib/autoplay";

/** What the five exercises need, as the lesson page passes it to the stage. */
export type StageExerciseData = {
  /** The ayah's words. */
  words: Word[];
  /** Every word of the surah (distractor options). */
  pool: Word[];
  /** Lexemes of the ayah with a tashrif table (Bentuk-bentuk kata). */
  lexemes: Lexeme[];
};

/** Message key of each exercise's title in the Exercise namespace. */
export const EXERCISE_TITLE_KEY = {
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
  tapSource,
  guided,
}: {
  exercise: ExerciseKey;
  progressId: string;
  data: StageExerciseData;
  /** The mushaf words of the ayah (Dengar dan ketuk). */
  tapWords: { index: number; ar: string; translit: string; gloss: string }[];
  /** The page's first (default) recitation — the one the standalone copy uses. */
  tapSource: RecitationSource;
  guided: ExerciseGuide;
}) {
  switch (exercise) {
    case "tap-word":
      return <TapWord id={progressId} words={tapWords} source={tapSource} guided={guided} compact />;
    case "why-harakat":
      return <WhyHarakat id={progressId} words={data.words} pool={data.pool} guided={guided} compact />;
    case "sort-case":
      return <SortCase id={progressId} words={data.words} guided={guided} compact />;
    case "label-role":
      return <LabelRole id={progressId} words={data.words} pool={data.pool} guided={guided} compact />;
    case "wazn-factory":
      return <WaznFactory id={progressId} lexemes={data.lexemes} guided={guided} compact />;
    default:
      return null;
  }
}
