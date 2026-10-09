/**
 * Guided lesson ("Mode Pelajaran") step script for one ayah, derived from
 * the content — never hand-written per ayah, so it updates with the content
 * and its review status. Pure: unit-tested, rendered by GuidedLesson.
 *
 * Step kinds:
 *  - recite_ayah : the imam recites the whole ayah (human recitation)
 *  - recite_word : the imam's recitation, seeked to one word
 *  - explain     : an explanation caption (later: narration audio, rendered
 *                  once on ElevenLabs v3 — the narrator NEVER voices Qur'an;
 *                  captions carry Latin transliteration only, plan §6.1 A1)
 *  - practice    : pause for the learner to do the exercises
 *
 * Audience: adults (operator decision, 2026-10-09).
 */
import type { Ayah, Concept } from "@/content/schema";

export type LessonStep =
  | { kind: "recite_ayah"; id: string; caption: string }
  | { kind: "recite_word"; id: string; word: number; loc: string; caption: string }
  | { kind: "explain"; id: string; caption: string; focus?: string }
  | { kind: "practice"; id: string; caption: string };

export type StepTexts = {
  intro: (n: number) => string;
  wordIntro: (translit: string) => string;
  meaning: (gloss: string) => string;
  concept: (title: string, summary: string) => string;
  structure: (summary: string) => string;
  practice: string;
  recap: string;
};

/** Reading-pace duration for a caption with no narration audio yet. */
export function captionMs(text: string): number {
  // ~15 characters/second for adult readers, 3–12 s per step.
  return Math.min(12_000, Math.max(3_000, Math.round((text.length / 15) * 1000)));
}

export function buildLessonSteps(
  ayah: Ayah,
  introduced: Concept[],
  texts: StepTexts,
): LessonStep[] {
  const steps: LessonStep[] = [
    { kind: "recite_ayah", id: "intro", caption: texts.intro(ayah.ayah) },
  ];

  ayah.words.forEach((w, i) => {
    const n = i + 1;
    steps.push({
      kind: "recite_word",
      id: `w${n}`,
      word: n,
      loc: w.loc,
      caption: texts.wordIntro(w.translit),
    });
    steps.push({
      kind: "explain",
      id: `w${n}-meaning`,
      caption: `${texts.meaning(w.gloss)} ${w.why}`,
      focus: w.loc,
    });
  });

  for (const c of introduced) {
    steps.push({ kind: "explain", id: `c-${c.id}`, caption: texts.concept(c.title, c.summary) });
  }
  if (ayah.structure) {
    steps.push({ kind: "explain", id: "structure", caption: texts.structure(ayah.structure.summary) });
  }
  steps.push({ kind: "practice", id: "practice", caption: texts.practice });
  steps.push({ kind: "recite_ayah", id: "recap", caption: texts.recap });
  return steps;
}
