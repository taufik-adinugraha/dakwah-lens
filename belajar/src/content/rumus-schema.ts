/**
 * Content contract of the cheat sheet (content/rumus.json) — "Rumus singkat": one short formula per
 * step of the basic curriculum, each beside the kitab sentence it restates — built by
 * pipeline/build_rumus.py from pipeline/authored/rumus.json and checked by
 * pipeline/validate_rumus.py (pipeline/rumus.py has the format and the rules). Kept apart from
 * schema.ts, whose zod shape pipeline/validate.py mirrors field by field.
 *
 * Operator, 2026-10-13: "we can make some 'cheat sheet' to explain the rules, for example: harf jar
 * + ism = kasrah (give examples), isim followed by another ism is mudhof ilaih etc. this cheat
 * sheet is explained also along with formal explanation" — "of course we need to refer to valid
 * kitab, my example is just example"; 2026-10-14: "release cheat sheet".
 */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** "0" (the lesson with no ayah), "S:A" (an ayah), "S:A/N" (a segment of a long ayah). */
const LessonId = z.string().regex(/^(?:0|[1-9][0-9]{0,2}:[1-9][0-9]{0,2}(?:\/[1-9][0-9]?)?)$/);
/** The kitab's Arabic alone: letters, harakat, its punctuation, single spaces — never a tag or a digit. */
const Arabic = z
  .string()
  .min(1)
  .regex(/^[ء-غف-يٱً-ٰٟۖ-ۭـ ،؛؟.,:;!?"'“”()«»-]+$/);

/** One page of a kitab, pinned in pipeline/sources.json, and the sentences of it a formula restates. */
export const RumusSource = z
  .object({
    /** "<shamela book>/<page id>": the pin's key. */
    page: z.string().regex(/^[0-9]+\/[0-9]+$/),
    /** The kitab as sources.json names it. */
    kitab: z.string().min(3),
    /** The print page ("hlm."), the pin's. */
    hlm: z.string().regex(/^[0-9]+$/),
    /** The section the page sits in, as Shamela's own title names it (Arabic). */
    bab: Arabic,
    url: z.string().url().startsWith("https://shamela.ws/book/"),
    /** The kitab's own words, found in the pinned page by an anchor: never typed. */
    quotes: z.array(Arabic).min(1),
  })
  .strict();
export type RumusSource = z.infer<typeof RumusSource>;

export const RumusStep = z
  .object({
    /** A step id of content/curriculum.json. */
    step: Id,
    /** That step's lesson. */
    lesson: LessonId,
    /** The formula, in the Konsep records' markup, every term named by id ([[isim|isim]]). */
    rumus: z.string().min(5),
    /** Where the formula stops being true, when a quoted sentence says so. */
    awas: z.string().min(5).optional(),
    /** The first word of the lesson the step occurs on, by loc: the page draws it from the lesson file. */
    example: z.object({ loc: z.string().regex(/^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/) }).strict().optional(),
    sumber: z.array(RumusSource).min(1),
  })
  .strict();
export type RumusStep = z.infer<typeof RumusStep>;

export const RumusFile = z
  .object({
    version: z.literal(1),
    /** In the curriculum's teaching order. */
    steps: z.array(RumusStep).min(1),
    data_versions: z
      .object({
        /** Each cited page's pinned text hash. */
        pages: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
        pipeline: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type RumusFile = z.infer<typeof RumusFile>;
