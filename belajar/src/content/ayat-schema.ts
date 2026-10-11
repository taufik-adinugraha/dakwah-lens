/**
 * Content contract of content/ayat/locations.json: every ayah a "Tahukah Anda?" fact card locates,
 * for the popup its location chip opens (operator 2026-10-12). Built by
 * belajar/pipeline/build_ayat.py and checked by validate_ayat.py (the rules are in
 * pipeline/ayat.py): the Arabic is Tanzil's line verbatim (surah-heading basmalah sliced off, as
 * the lessons show ayah 1), the translation QuranEnc's verbatim with its footnotes split as the
 * lessons split them, one entry per fact location and no other. This schema only shapes it; the
 * file is read on the server only (src/lib/ayat.ts) and served one ayah at a time.
 */
import { z } from "zod";

import { AyahLoc } from "./schema";

export const AyatEntry = z
  .object({
    loc: AyahLoc,
    /** Tanzil Uthmani 1.1, verbatim (heading basmalah sliced off: common.lesson_ayah). */
    ar: z.string().min(1),
    translation: z
      .object({
        /** QuranEnc text verbatim, footnote markers ("[96]") included. */
        text: z.string().min(1),
        /** Its footnotes verbatim, one per [n] marker (as Ayah.translation.footnotes). */
        footnotes: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();
export type AyatEntry = z.infer<typeof AyatEntry>;

const SuraKey = z.string().regex(/^\d{1,3}$/);

export const AyatFile = z
  .object({
    data_versions: z.record(z.string(), z.string()),
    /** The credit, as the lessons give it: QuranEnc's own title and version. */
    translation: z.object({ source_label: z.string().min(3), version: z.string().min(1) }).strict(),
    /** sha256 of each pinned QuranEnc sura file the entries come from. */
    sura_files: z.record(SuraKey, z.string().regex(/^[0-9a-f]{64}$/)),
    /** Surah number → the name the popup prints ("Al-Baqarah"), for every sura with an entry. */
    names: z.record(SuraKey, z.string().min(2)),
    /** Mushaf order. */
    ayat: z.array(AyatEntry).min(1),
  })
  .strict();
export type AyatFile = z.infer<typeof AyatFile>;
