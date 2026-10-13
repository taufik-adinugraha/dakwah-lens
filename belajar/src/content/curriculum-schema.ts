/**
 * Content contract of the basic curriculum (content/curriculum.json) — the lessons in teaching
 * order, the steps each one teaches (at most three), the next-level records and, for every lesson
 * whose ayah is on disk, the derived lines and lists — built by pipeline/build_curriculum.py from
 * pipeline/authored/curriculum.json and checked by pipeline/validate_curriculum.py
 * (pipeline/curriculum.py has the format and the rules). Kept apart from schema.ts, whose zod shape
 * pipeline/validate.py mirrors field by field.
 *
 * Operator-approved 2026-10-13 (docs/belajar-research/kurikulum-dasar.md decisions 1–9; plan L26):
 * "we distribute the lessons into these ayats" — "let's focus on the basic first" — "so the
 * knowledge is accummulating and repeated" — "but separate new vs already knows concept, this is
 * what new, this is what we've learnt so far".
 */
import { z } from "zod";

const N = z.number().int().positive();
const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** "0" (the lesson with no ayah), "S:A" (an ayah), "S:A/N" (a segment of a long ayah). */
const LessonId = z.string().regex(/^(?:0|[1-9][0-9]{0,2}:[1-9][0-9]{0,2}(?:\/[1-9][0-9]?)?)$/);
const Source = z.object({ kitab: z.string().min(2), ref: z.string().min(1), url: z.string().url() }).strict();

export const CurriculumStep = z
  .object({
    id: Id,
    lesson: LessonId,
    /** The caption form: dictionary terms with their Arabic. */
    name: z.string().min(1),
    /** The same name as prose (no Arabic script). */
    latin: z.string().min(1).regex(/^[^؀-ۿ]+$/),
    concept: Id.optional(),
    part: N.optional(),
    basics: Id.optional(),
    occurs: z.union([z.object({ case: z.string() }).strict(), z.object({ qac: z.string() }).strict(), z.object({ always: z.literal(true) }).strict()]).optional(),
    /** "concept:<record id>" (a whole record) or "concept:<step id>" (its own text); null: none. */
    line: z.string().regex(/^concept:[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
    teach: z
      .object({
        title: z.string().min(3),
        summary: z.string().min(15),
        marked: z.object({ title: z.string().min(3), summary: z.string().min(15) }).strict(),
        sources: z.array(Source).min(1),
      })
      .strict()
      .optional(),
    terms: z.array(Id),
  })
  .strict();
export type CurriculumStep = z.infer<typeof CurriculumStep>;

const Map_ = z
  .object({
    new: z.array(Id),
    learnt: z.array(z.object({ id: Id, here: z.boolean() }).strict()),
    later: z.array(Id),
    lanjut: z.array(Id),
  })
  .strict();

export const CurriculumLesson = z
  .object({
    id: LessonId,
    unit: Id,
    surah: N.optional(),
    ayah: N.optional(),
    segment: N.optional(),
    words: z.array(N).length(2).optional(),
    steps: z.array(Id).max(3),
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
    lines: z.array(z.object({ line: z.string(), step: Id, words: z.array(N) }).strict()).optional(),
    map: Map_.optional(),
  })
  .strict();
export type CurriculumLesson = z.infer<typeof CurriculumLesson>;

export const CurriculumFile = z
  .object({
    version: z.literal(1),
    units: z.array(z.object({ id: Id, name: z.string().min(1), surah: N.optional(), ayah: N.optional(), slug: z.string().optional() }).strict()).min(1),
    lessons: z.array(CurriculumLesson).min(1),
    steps: z.array(CurriculumStep).min(1),
    free: z.array(Id),
    lanjut: z.array(Id),
  })
  .strict();
export type CurriculumFile = z.infer<typeof CurriculumFile>;
