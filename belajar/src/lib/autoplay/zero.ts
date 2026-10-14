/**
 * LESSON ZERO — the lesson with no ayah that opens the course (the basic curriculum,
 * docs/belajar-research/kurikulum-dasar.md decision 1, operator-approved 2026-10-13: "A 'lesson
 * zero' with no ayah opens the course. It teaches harakat and the three kinds of word (kalimah:
 * isim, fi'il, huruf), so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into
 * lesson zero."). The curriculum's lesson "0".
 *
 * It is hosted by the surah whose harakat primer says `lesson: "0"` (content/compose/<slug>.json;
 * Al-Fatihah): its narration lines are "<slug>:0:<part>" in that surah's manifest — so a primer
 * line that moved there keeps its recorded file — and the engine takes it as that surah's "ayah
 * 0", an ayah with no word: no mushaf line, no recitation of an ayah, no recap, nothing to light.
 * Its sequence (sequence.ts, `zero`): intro → primer → the "Konsep baru" line of each step the
 * curriculum teaches there that has one, each followed by its examples (the imam's clips of
 * other ayat) → next, which leads to ayah 1 as an ayah leads to the next.
 *
 * The twin of pipeline/validate_narration.py lesson_zero / primer_of and
 * pipeline/curriculum.py LESSON_ZERO. Pure: scripts/autoplay-check.ts runs it under tsx.
 */
import { LESSON_ZERO } from "./curriculum";
import { ZERO_AYAH } from "./ids";

/** What is read of a harakat primer to place it. */
type PrimerPlace = { ayah: number; lesson?: string };

/** The "ayah" whose lesson plays a primer: its own, or 0 when it is lesson zero's. */
export const primerAyah = (primer: PrimerPlace): number => (primer.lesson === LESSON_ZERO ? ZERO_AYAH : primer.ayah);

/** Does this surah host lesson zero (its primer is played there)? */
export const hostsZero = (compose: { primer?: PrimerPlace | null } | null | undefined): boolean => compose?.primer?.lesson === LESSON_ZERO;

/** Lesson zero as the engine takes it: "ayah 0" of its host surah, with no word. */
export type ZeroAyah = { surah: number; ayah: number; loc: string; words: never[]; structure?: undefined };
export const zeroAyah = (surah: number): ZeroAyah => ({ surah, ayah: ZERO_AYAH, loc: `${surah}:${ZERO_AYAH}`, words: [] });
