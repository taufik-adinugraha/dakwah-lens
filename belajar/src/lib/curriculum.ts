/**
 * The basic curriculum (content/curriculum.json, pipeline/build_curriculum.py), validated at BUILD
 * time like the lesson content: the zod shape, then the derivation (./autoplay/curriculum.ts) —
 * every ayah on disk is a lesson, and the lines and lists the file gives for it are the ones the
 * lessons' own words give under the curriculum's steps. A mismatch fails `next build` instead of
 * reaching a learner.
 *
 * WHERE a topic is taught comes from here (operator-approved 2026-10-13, plan L26). `taughtAt` is
 * what library.conceptsIntroducedIn was until then (the Konsep records whose first example stood
 * in the ayah): the "Konsep baru" items of the ayah's lesson — at most three, a whole record or a
 * step's own text.
 */
import raw from "../../content/curriculum.json";

import { CurriculumFile, type CurriculumFile as File } from "@/content/curriculum-schema";
import type { Ayah } from "@/content/schema";

import { curriculumProblems, taughtEarlier, taughtIn, type Taught } from "./autoplay/curriculum";
import { hostsZero, zeroAyah } from "./autoplay/zero";
import { composeFor } from "./compose-content";
import { SURAHS } from "./content";
import { LIBRARY } from "./library";

const parsed = CurriculumFile.safeParse(raw);
if (!parsed.success) {
  throw new Error(`content/curriculum.json does not match the schema:\n${JSON.stringify(parsed.error.issues.slice(0, 10), null, 2)}`);
}
/** The surah that hosts LESSON ZERO — the curriculum's lesson with no ayah, which opens the
 *  course (autoplay/zero.ts): the one whose harakat primer is played there. null: no surah
 *  does, and lesson zero has no page. */
export const ZERO_HOST = SURAHS.find((s) => hostsZero(composeFor(s.slug))) ?? null;

/**
 * May lesson zero be SHOWN as a link? The one rule (operator-approved gate of 2026-10-13: its
 * card on the track page, its row on the curriculum page): it is written — a surah hosts it —
 * and that surah is one visitors can reach (`published`: lib/features.ts visibleSurahs()). Its
 * narration, its frames and the lesson it hands over to are all that surah's, so with the surah
 * hidden a link to it would open a lesson that leads into a 404.
 */
export function introOpen(published: ReadonlySet<string>): boolean {
  return ZERO_HOST !== null && published.has(ZERO_HOST.slug);
}

const problems = curriculumProblems(parsed.data, SURAHS, LIBRARY.concepts, ZERO_HOST !== null);
if (problems.length) throw new Error(`content/curriculum.json:\n${problems.slice(0, 10).join("\n")}`);

export const CURRICULUM: File = parsed.data;

/** The "Konsep baru" items of an ayah's lesson, in the order their lines are said. */
export function taughtAt(ayah: Ayah): Taught[] {
  return taughtIn(CURRICULUM, LIBRARY.concepts, ayah);
}

/** The "Konsep baru" items of lesson zero (the kalimah record), in the order their lines are
 *  said; [] when no surah hosts it. */
export function taughtInZero(): Taught[] {
  return ZERO_HOST ? taughtIn(CURRICULUM, LIBRARY.concepts, zeroAyah(ZERO_HOST.surah)) : [];
}

/** Where an EARLIER lesson taught what a Konsep tag on `word` shows — an ayah, or lesson zero —
 *  or null (the word card's "sudah dipelajari di ayat N" / "… di Pengantar";
 *  ./autoplay/curriculum.ts taughtEarlier). */
export function taughtBefore(ayah: Ayah, word: Ayah["words"][number], record: string) {
  return taughtEarlier(CURRICULUM, ayah, word, record);
}
