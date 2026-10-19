/**
 * Content contract of the lesson maps, version 2 (content/map/<slug>.json) — per ayah, the steps
 * that are new there, every step learnt so far (and which of them come up again), the steps
 * present but taught later, and the next-level topics, with the name each is called by — built by
 * pipeline/build_map.py and checked by pipeline/validate_map.py (pipeline/lessonmap.py has the
 * rules). Kept apart from schema.ts, whose zod shape pipeline/validate.py mirrors field by field.
 *
 * Operator, 2026-10-13 (plan L23): "at the beginning of the ayat, better to inform what concept we
 * will learn in this ayat, also explain maybe we skip some concept and will visit later in next
 * ayat … so at the beginning we inform what will be learnt, in the end recap what we've learnt";
 * "if some concept already done in previous ayat, we say we repeat what we've learnt before" —
 * and, with the basic curriculum (plan L26): "so the knowledge is accummulating and repeated";
 * "but separate new vs already knows concept, this is what new, this is what we've learnt so far".
 * A surah has a file only when it is switched on (pipeline/authored/<slug>.map.json).
 *
 * What is taught WHERE is the curriculum's (content/curriculum.json): the lists here are its own,
 * per ayah of this surah. Version 1 ({concepts, ayat: [{new, review, later}]}, with an authored
 * "topic" for marfu') derived them from each Konsep's first example.
 */
import { z } from "zod";

const N = z.number().int().positive();
const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const Latin = z.string().min(1).regex(/^[^؀-ۿ]+$/);

export const LessonMapStep = z
  .object({
    /** The name as a caption shows it: dictionary terms with their Arabic, "Na’t (نَعْت)". */
    name: z.string().min(1),
    /** The same name as prose (no Arabic script). */
    latin: Latin,
    /** The curriculum lesson that teaches it: "0", "1:4", "114:2", "2:255/3". */
    lesson: z.string().regex(/^(?:0|[1-9][0-9]{0,2}:[1-9][0-9]{0,2}(?:\/[1-9][0-9]?)?)$/),
  })
  .strict();
export type LessonMapStep = z.infer<typeof LessonMapStep>;

export const LessonMapRecord = z
  .object({
    name: z.string().min(1),
    latin: Latin,
    /** Cut from the record's Konsep title, or an explicit name of the authored file. */
    from: z.enum(["title", "authored"]),
  })
  .strict();
export type LessonMapRecord = z.infer<typeof LessonMapRecord>;

export const LessonMapAyah = z
  .object({
    ayah: N,
    /** Taught in this ayah's lesson, in the order of its "Konsep baru" lines (at most three). */
    new: z.array(Id).max(3),
    /** EVERY step of every earlier lesson, in teaching order; `here`: it occurs in this ayah. */
    learnt: z.array(z.object({ id: Id, here: z.boolean() }).strict()),
    /** In this ayah, taught in a later lesson. */
    later: z.array(Id),
    /** Next-level Konsep records on this ayah: named on the card, never taught at this level. */
    lanjut: z.array(Id),
    /** The kinds of word its words are made of, in the order isim, fi'il, huruf (the QAC tag of
     *  each part, as the warm-up derives it): a line that says the three kinds are met here names
     *  only these (operator 2026-10-18: "in that ayat (example ayat-3) we only have isim"). */
    kinds: z.array(z.enum(["isim", "fiil", "huruf"])).min(1).max(3),
    /** The running total said unit by unit (pipeline/lessonmap.py "THE RUNNING TOTAL, UNIT BY
     *  UNIT", 2026-10-19): [] while one sentence names every step (every Al-Fatihah ayah); else
     *  the groups of whole curriculum units, in teaching order, each a line of its own
     *  ("map:total:<k>") after the count ("map:total"). */
    total: z.array(z.object({ from: z.array(Id).min(1), steps: z.array(Id).min(1) }).strict()),
  })
  .strict();
export type LessonMapAyah = z.infer<typeof LessonMapAyah>;

/** The step of the three kinds of word, its name without its members and each kind's name. */
export const LessonMapKinds = z
  .object({
    step: Id,
    /** "Tiga jenis kata": as the caption shows it, and as prose. */
    name: z.string().min(1),
    latin: Latin,
    members: z
      .object({
        isim: z.object({ name: z.string().min(1), latin: Latin }).strict(),
        fiil: z.object({ name: z.string().min(1), latin: Latin }).strict(),
        huruf: z.object({ name: z.string().min(1), latin: Latin }).strict(),
      })
      .strict(),
  })
  .strict();
export type LessonMapKinds = z.infer<typeof LessonMapKinds>;

export const LessonMapFile = z
  .object({
    version: z.literal(2),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    surah: N,
    steps: z.record(Id, LessonMapStep),
    lanjut: z.record(Id, LessonMapRecord),
    ayat: z.array(LessonMapAyah).min(1),
    /** null: no ayah lists the step of the three kinds of word. */
    kinds: LessonMapKinds.nullable(),
    /** Each curriculum unit a running total's group names, as its line says it ("Surah
     *  Al-Fatihah", "pelajaran pengantar"); {} when no total is grouped. */
    units: z.record(Id, z.string().min(1)),
  })
  .strict();
export type LessonMapFile = z.infer<typeof LessonMapFile>;
