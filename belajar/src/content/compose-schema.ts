/**
 * Content contract of the word compositions and the harakat primer
 * (content/compose/<slug>.json) — kept apart from schema.ts, whose zod shape
 * pipeline/validate.py mirrors field by field (as waris-schema.ts is); the
 * pipeline's own checks of these files are pipeline/compose.py
 * (validate_compose.py).
 */
import { z } from "zod";

import { Clip, ReviewStatus, SourceRef, WordLoc } from "./schema";

// ───────────────────────── Word composition & harakat primer ─────────────────────────
// content/compose/<slug>.json, built by pipeline/build_compose.py from
// pipeline/authored/<slug>.compose.json (operator 2026-10-10, narration rule 14:
// a word is explained by its parts, with an animation bi + ismu → bismi; and
// a harakat primer opens the first lesson, because its learners do not know
// the marks yet). The Arabic here is not the ayah's verbatim text only: a
// FORM is a lesson word or a slice of it in whole pieces (a letter and its
// marks), a Tanzil token or a QAC segment from elsewhere in the Qur'an, or a
// deterministic edit of one (a vowel swapped, a mark taken off or put on, a
// piece dropped, parts written together) — every one named by its `src` and
// re-derived by pipeline/validate_compose.py (locally against the corpus, in
// CI without it) and by src/lib/compose.test.ts. `attested` lists where exactly those
// bytes stand as a token in the Qur'an; [] marks a teaching form (رَحْمَٰن
// without article or ending), never shown in mushaf typography.

/** The harakat, sukun, shaddah and — in the primer only — the small upright alif (U+0670) of
 *  ٱلرَّحْمَٰنِ, a letter the mushaf leaves out in writing but which is read (a long a). */
export const ComposeMark = z.enum(["fathah", "kasrah", "dhammah", "fathatain", "dhammatain", "kasratain", "sukun", "shaddah", "small_alif"]);
export type ComposeMark = z.infer<typeof ComposeMark>;

/** parts · base · change · join · drop · whole (a word); overview · mark (the primer). */
export const ComposeStage = z.enum(["parts", "base", "change", "join", "drop", "whole", "overview", "mark"]);
export type ComposeStage = z.infer<typeof ComposeStage>;

export const ComposeForm = z.object({
  ar: z.string().min(1),
  /** Shown under the tile (SKB), never spoken: the narrator says sounds, letter names, terms. */
  translit: z.string().min(1),
  /** Its role ("huruf jar", "isim", "alif lam") or, in the primer, its spelling ("b + i"). */
  label: z.string().min(1).optional(),
  /** Indonesian meaning, shown as "yang artinya …". */
  gloss: z.string().min(1).optional(),
  /** Where the bytes come from (pipeline/compose.py: word | tanzil | qac | from+ops | join). */
  src: z.record(z.string(), z.unknown()),
  attested: z.array(WordLoc),
});
export type ComposeForm = z.infer<typeof ComposeForm>;

/** A piece the frame is about, cut by the pipeline (the browser never slices Arabic). */
export const ComposeChip = z.object({
  from: z.string().min(1),
  /** "" for a piece left out in writing. */
  to: z.string(),
  marks: z.tuple([ComposeMark.nullable(), ComposeMark.nullable()]).optional(),
  /** Written but not read (the alif of بِٱسْمِ). */
  silent: z.boolean().optional(),
});
export type ComposeChip = z.infer<typeof ComposeChip>;

export const ComposeFrame = z.object({
  stage: ComposeStage,
  /** Form names, in reading order (the first is rightmost). */
  tiles: z.array(z.string().min(1)),
  marks: z.array(ComposeMark).optional(),
  focus: z.string().min(1).optional(),
  from: z.union([z.string().min(1), z.array(z.string().min(1)).min(2)]).optional(),
  to: z.string().min(1).optional(),
  cause: z.string().min(1).optional(),
  /** A short Indonesian note on screen (≤ 60 characters). One note is read by the lesson: "imam
   *  berhenti di sini", on the last frame of an ayah's last word — the imam then recites that
   *  word once more (src/lib/composition.ts STOP_NOTE; refused on any other frame). */
  note: z.string().min(1).max(60).optional(),
  silent: z.array(z.number().int()).optional(),
  chips: z.array(ComposeChip).optional(),
  /** Primer: the ayah's words whose letters the frame shows as they are. */
  words: z.array(z.number().int().positive()).optional(),
  /** Base: the ending of a mabni word's bentuk dasar (an‘ama: fathah); otherwise the marfu' dhammah. */
  base_mark: ComposeMark.optional(),
  /** [form, piece]: which piece the narration's letter terms show (pipeline only: the caption's لِّ). */
  letters: z.array(z.tuple([z.string(), z.number().int()])).optional(),
});
export type ComposeFrame = z.infer<typeof ComposeFrame>;

/** One narration line: said while frame `frame` (1-based) is on screen. */
export const ComposeLine = z.object({ frame: z.number().int().positive(), say: z.string().min(5) });

const ComposeUnit = {
  forms: z.record(z.string(), ComposeForm),
  frames: z.array(ComposeFrame).min(1),
  lines: z.array(ComposeLine).min(1),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
};

export const Composition = z.object({
  loc: WordLoc,
  /** The word as the ayah writes it (= the lesson word's Tanzil bytes). */
  ar: z.string().min(1),
  /** Said after the gloss on the word's own line ("Kata ini terdiri dari dua bagian."). */
  lead: z.string().min(5).optional(),
  ...ComposeUnit,
});
export type Composition = z.infer<typeof Composition>;

/** `ayah`: the ayah whose words its frames show. `lesson`: the lesson that PLAYS it when that is
 *  not that ayah's — "0", the curriculum's lesson with no ayah that opens the course (the basic
 *  curriculum, decision 1; since 2026-10-13 the primer plays there and Al-Fatihah 1 does not). */
export const Primer = z.object({ ayah: z.number().int().positive(), lesson: z.literal("0").optional(), ...ComposeUnit });
export type Primer = z.infer<typeof Primer>;

/**
 * The imam's voice of the bentuk dasar a `base` frame shows (operator 2026-10-12: "e.g ismu (read
 * by voice + show visual) when combined with harf jar, it becomes ismi (read by voice + visual)";
 * plan L20): one entry per base frame, written by pipeline/build_compose.py and chosen by what is
 * HEARD (pipeline/compose.py "THE IMAM'S VOICE OF A BENTUK DASAR"). Voiced: the place in the Qur'an
 * (`loc`), the clip key the lesson plays (`key`: that word, or — a word that starts with hamzat
 * washal mid-ayah — the run with the word before it, with `washal` saying what is heard) and the
 * clip itself, [start, end) of that ayah's streamed recording. Unvoiced: why — "own" (the base
 * form is the lesson word itself, which the imam recites when its step opens; until 2026-10-13,
 * plan L24, again at the end of its step, as an ayah's last word still is), "unattested" (no
 * word of the Qur'an has those bytes), "unheard" (none of its places is heard as shown).
 */
export const ComposeExample = z.union([
  z
    .object({
      frame: z.number().int().positive(),
      form: z.string().min(1),
      loc: WordLoc,
      key: z.string().regex(/^\d{1,3}:\d{1,3}:\d{1,3}(?:-\d{1,3})?$/),
      clip: Clip,
      washal: z.object({ run: z.string().min(1), before: z.string().min(1), heard: z.string().min(1) }).strict().optional(),
    })
    .strict(),
  z.object({ frame: z.number().int().positive(), form: z.string().min(1), unvoiced: z.enum(["own", "unattested", "unheard"]) }).strict(),
]);
export type ComposeExample = z.infer<typeof ComposeExample>;

export const ComposeFile = z.object({
  version: z.literal(1),
  slug: z.string(),
  surah: z.number().int().positive(),
  /** The marks the stage names: the character, its sound (a / i / u) and the
   *  pronunciation dictionary's display form when it has the term. */
  marks: z.record(z.string(), z.object({ char: z.string().length(1), sound: z.string().nullable(), display: z.string() })),
  primer: Primer.nullable(),
  words: z.record(WordLoc, Composition),
  /** By composed word: the voice of each of its base frames, or why it has none. */
  examples: z.record(WordLoc, z.array(ComposeExample)),
  data_versions: z.record(z.string(), z.string()),
});
export type ComposeFile = z.infer<typeof ComposeFile>;
