/**
 * Content contract of the lesson maps (content/map/<slug>.json) — per ayah, the Konsep that are
 * new there, repeated from an earlier ayah, or present but taught later, with the name each is
 * called by — built by pipeline/build_map.py and checked by pipeline/validate_map.py
 * (pipeline/lessonmap.py has the rules). Kept apart from schema.ts, whose zod shape
 * pipeline/validate.py mirrors field by field.
 *
 * Operator, 2026-10-13 (plan L23): "at the beginning of the ayat, better to inform what concept we
 * will learn in this ayat, also explain maybe we skip some concept and will visit later in next
 * ayat … so at the beginning we inform what will be learnt, in the end recap what we've learnt";
 * "if some concept already done in previous ayat, we say we repeat what we've learnt before".
 * A surah has a file only when it is switched on (pipeline/authored/<slug>.map.json).
 *
 * A TOPIC (`from: "topic"`) is an authored "later" item that is no Konsep (operator 2026-10-13: "in
 * ayat-1, it mentions 'bentuk tertentu' but no explanation about marfu' itself, better to inform it
 * will be learnt later"): what an ayah shows without explaining, with the narration line that
 * teaches it in a later ayah. It is only ever listed under `later`.
 */
import { z } from "zod";

const N = z.number().int().positive();
const ConceptId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const LessonMapConcept = z
  .object({
    /** The name as a caption shows it: dictionary terms with their Arabic, "Na’t (نَعْت)". */
    name: z.string().min(1),
    /** The same name as prose (no Arabic script). */
    latin: z.string().min(1).regex(/^[^\u0600-\u06FF]+$/),
    /** Cut from the concept's "Konsep baru: …" caption title, or an explicit authored name; or a
     *  topic: an authored later item that is not a Konsep. */
    from: z.enum(["title", "authored", "topic"]),
    /** Where it is taught: the ayah of a concept's first example, of a topic's teaching line. */
    surah: N,
    ayah: N,
    /** A topic: what the learner is left wondering (shown on the card, never spoken). */
    note: z.string().min(1).optional(),
    /** A topic: the narration line that teaches it ("al-fatihah:2:w1:compose:8"). */
    line: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[1-9][0-9]*:[a-z0-9:-]+$/).optional(),
  })
  .strict()
  .refine((c) => (c.from === "topic") === (c.note !== undefined) && (c.from === "topic") === (c.line !== undefined), {
    message: "a topic, and only a topic, has a note and its teaching line",
  });
export type LessonMapConcept = z.infer<typeof LessonMapConcept>;

export const LessonMapAyah = z
  .object({
    ayah: N,
    /** Taught in this ayah, in the order of its "Konsep baru" lines. */
    new: z.array(ConceptId),
    /** On this ayah's words, taught in an earlier ayah. */
    review: z.array(ConceptId),
    /** On this ayah's words, taught in a later ayah. */
    later: z.array(ConceptId),
  })
  .strict();
export type LessonMapAyah = z.infer<typeof LessonMapAyah>;

export const LessonMapFile = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    surah: N,
    concepts: z.record(ConceptId, LessonMapConcept),
    ayat: z.array(LessonMapAyah).min(1),
  })
  .strict();
export type LessonMapFile = z.infer<typeof LessonMapFile>;
