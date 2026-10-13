/**
 * The autoplay engine keeps its own copies of a few rules so that it stays
 * pure (scripts/autoplay-check.ts runs it under tsx without zod). Each copy
 * is pinned here to the one the app uses, so the two can never drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EXERCISE_GUIDE_PARTS as UI_PARTS_OF,
  EXERCISE_KEYS as UI_EXERCISE_KEYS,
  GUIDE_PARTS as UI_GUIDE_PARTS,
  parseGuideTarget,
} from "@/components/exercises/guide";

import { SURAHS } from "../content";
import { CURRICULUM, taughtAt } from "../curriculum";
import { quizAyah } from "../quiz-content";
import { loadCheckInput, quizAyahOf } from "./checks";
import { ayahLessonId, taughtIn, type CurriculumFile } from "./curriculum";
import { availableExercises, questionNumbers } from "./exercises";
import { buildAutoplaySequence } from "./sequence";
import { ID_TEXTS } from "./texts";
import { EXERCISE_KEYS, GUIDE_PARTS, PARTS_OF } from "./types";

const CONTENT = fileURLToPath(new URL("../../../content/", import.meta.url));
const raw = loadCheckInput((rel) => {
  const path = join(CONTENT, rel);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}).input;

describe("autoplay parity", () => {
  it("names the exercises and their controls exactly as components/exercises/guide.ts", () => {
    expect([...EXERCISE_KEYS]).toEqual([...UI_EXERCISE_KEYS]);
    expect([...GUIDE_PARTS]).toEqual([...UI_GUIDE_PARTS]);
    for (const k of EXERCISE_KEYS) expect([...PARTS_OF[k]]).toEqual([...UI_PARTS_OF[k]]);
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = buildAutoplaySequence({
          slug: s.slug,
          surahName: s.name_id,
          ayahCount: s.ayat.length,
          ayah: a,
          introduced: taughtAt(a),
          exercises: availableExercises(quizAyah(s.slug, a.ayah)),
          texts: ID_TEXTS,
        });
        for (const step of seq.steps) {
          const ex = step.exercise;
          if (!ex) continue;
          for (const part of ex.parts) expect(parseGuideTarget(ex.guides[part]?.target ?? "")).not.toBeNull();
        }
      }
    }
  });

  it("teaches what the curriculum gives each ayah's lesson — the page from the validated file, the check script from raw JSON", () => {
    // Until 2026-10-13 a concept was introduced in the ayah of its first example, a rule the app
    // (library.conceptsIntroducedIn) and the engine (introducedConcepts) each had a copy of. Both
    // now read content/curriculum.json (plan L26).
    const file = raw.curriculum as CurriculumFile;
    expect(JSON.stringify(file)).toBe(JSON.stringify(CURRICULUM));
    for (const s of SURAHS) {
      const r = raw.surahs.find((x) => x.slug === s.slug)!;
      for (const a of s.ayat) {
        const ra = r.ayat.find((x) => x.ayah === a.ayah)!;
        const page = taughtAt(a);
        expect(JSON.stringify(taughtIn(file, raw.concepts, ra)), a.loc).toBe(JSON.stringify(page));
        const lesson = CURRICULUM.lessons.find((l) => l.id === ayahLessonId(a.surah, a.ayah))!;
        expect(page.map((t) => `concept:${t.id}`), a.loc).toEqual((lesson.lines ?? []).map((l) => l.line));
        expect(page.length, a.loc).toBeLessThanOrEqual(3);
      }
    }
  });

  it("builds the same sequences from the validated content as the check script does from raw JSON", () => {
    for (const s of SURAHS) {
      const r = raw.surahs.find((x) => x.slug === s.slug);
      expect(r).toBeDefined();
      for (const a of s.ayat) {
        const ra = r?.ayat.find((x) => x.ayah === a.ayah);
        expect(ra).toBeDefined();
        if (!r || !ra) continue;
        const app = buildAutoplaySequence({
          slug: s.slug,
          surahName: s.name_id,
          ayahCount: s.ayat.length,
          ayah: a,
          introduced: taughtAt(a),
          exercises: availableExercises(quizAyah(s.slug, a.ayah)),
          questions: questionNumbers(quizAyah(s.slug, a.ayah)),
          texts: ID_TEXTS,
        });
        const script = buildAutoplaySequence({
          slug: r.slug,
          surahName: r.name_id,
          ayahCount: r.ayat.length,
          ayah: ra,
          introduced: taughtIn(raw.curriculum as CurriculumFile, raw.concepts, ra),
          exercises: availableExercises(quizAyahOf(raw.quiz?.[r.slug], ra.ayah)),
          questions: questionNumbers(quizAyahOf(raw.quiz?.[r.slug], ra.ayah)),
          texts: ID_TEXTS,
        });
        expect(JSON.stringify(script)).toBe(JSON.stringify(app));
        // The page's validated quiz and the raw file the check script reads ask the same questions.
        expect(JSON.stringify(quizAyahOf(raw.quiz?.[r.slug], ra.ayah).exercises)).toBe(JSON.stringify(quizAyah(s.slug, a.ayah).exercises));
      }
    }
  });
});
