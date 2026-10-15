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
    /** LESSON ZERO's slide before its "Konsep baru" line (operator 2026-10-15: "kalimah in Arabic
     *  means word, while in bahasa it means sentence/kalimat"): its line's text (≤ 400 characters,
     *  one file), the cards it shows (a term with the term table's Arabic, or an Indonesian word)
     *  and its kitab sources. */
    lead: z
      .object({
        say: z.string().min(15).max(400).regex(/^[^؀-ۿ]+$/),
        cards: z
          .array(
            z
              .object({
                lang: z.enum(["ar", "id"]),
                means: z.string().min(2),
                word: z.string().min(2).regex(/^[^؀-ۿ]+$/).optional(),
                term: z.object({ id: Id, latin: z.string().min(2), ar: z.string().regex(/^[؀-ۿ ]+$/) }).strict().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(3),
        sources: z.array(Source).min(1),
      })
      .strict()
      .optional(),
    /** … and the examples its card shows after the line, each with the narrator's line about it
     *  (operator 2026-10-15: "ṣirāṭ, yang artinya jalan, adalah sebuah isim, yaitu nama benda") and
     *  the card's label (`about`, the record's own note without the word). */
    examples: z
      .array(z.object({ loc: z.string().regex(/^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/), say: z.string().min(10).max(400).regex(/^[^؀-ۿ]+$/), about: z.string().min(3) }).strict())
      .min(1)
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
