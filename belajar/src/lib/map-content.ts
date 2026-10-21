/**
 * The lesson maps (content/map/<slug>.json, pipeline/build_map.py), validated at BUILD time like
 * the lesson content: the zod shape, then against the curriculum (./autoplay/lessonMap.ts
 * lessonMapProblems) — the new / learnt / later / next-level lists the file gives must be the ones
 * the curriculum gives for that ayah's lesson (./curriculum.ts holds the curriculum itself to the
 * lessons' own words), and every listed step must be named and placed as the curriculum has it. A
 * mismatch fails `next build` instead of reaching a learner.
 *
 * A surah has a map only when the pipeline switched it on (pipeline/authored/<slug>.map.json; plan
 * L23: Al-Fatihah, Al-Ikhlas since 2026-10-19, An-Nas and Al-Falaq since 2026-10-20): a surah without a file here gets no map /
 * learned step and no card — nothing in the app names a surah to decide that. A map says nothing
 * about publishing: a hidden surah's pages answer 404 (src/lib/features.ts BELAJAR_SURAHS). lesson-map.test.ts checks that this
 * list is exactly the files in content/map/.
 */
import alFatihah from "../../content/map/al-fatihah.json";
import alIkhlas from "../../content/map/al-ikhlas.json";
import alFalaq from "../../content/map/al-falaq.json";
import anNas from "../../content/map/an-nas.json";

import { LessonMapFile, type LessonMapFile as File } from "@/content/map-schema";

import { lessonMapInputOf, lessonMapProblems, type LessonMapInput } from "./autoplay/lessonMap";
import { CURRICULUM } from "./curriculum";

function load(raw: unknown, name: string): File {
  const result = LessonMapFile.safeParse(raw);
  if (!result.success) {
    throw new Error(`content/map/${name}.json does not match the schema:\n${JSON.stringify(result.error.issues.slice(0, 10), null, 2)}`);
  }
  if (result.data.slug !== name) throw new Error(`content/map/${name}.json carries slug "${result.data.slug}"`);
  const problems = lessonMapProblems(result.data, CURRICULUM);
  if (problems.length) throw new Error(`content/map/${name}.json:\n${problems.slice(0, 10).join("\n")}`);
  return result.data;
}

const BY_SLUG: Readonly<Record<string, File>> = {
  "al-fatihah": load(alFatihah, "al-fatihah"),
  "al-ikhlas": load(alIkhlas, "al-ikhlas"),
  "al-falaq": load(alFalaq, "al-falaq"),
  "an-nas": load(anNas, "an-nas"),
};

/** Slugs with a lesson map (for the checks). */
export const MAPPED_SLUGS: readonly string[] = Object.keys(BY_SLUG);

/** content/map/${slug}.json, or null: the surah has no lesson map. */
export function lessonMapFor(slug: string): File | null {
  return Object.prototype.hasOwnProperty.call(BY_SLUG, slug) ? BY_SLUG[slug] : null;
}

/** One ayah's lesson map (what is new, learnt so far, taught later, next-level; each with its
 *  name), or null. */
export function lessonMapInput(slug: string, ayah: number): LessonMapInput | null {
  return lessonMapInputOf(lessonMapFor(slug), ayah);
}
