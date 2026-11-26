/**
 * Lesson content, validated at BUILD time (lesson pages are prerendered):
 * a malformed or unsourced value fails `next build` in CI instead of
 * reaching a learner. So does content that claims a human review or is left
 * unfinished (lib/publishable.ts): the module is public (plan L42), and
 * "draft" is only pipeline state, since there is no human review step (L11).
 *
 * One JSON per surah, in mushaf order: Al-Fatihah, then Al-Mu'awwidzat
 * (Al-Ikhlas, Al-Falaq, An-Nas). belajar/pipeline/validate.py checks that
 * this list, SURAH_SLUGS in ./routes.ts and the files in content/ agree.
 */
import alFatihah from "../../content/al-fatihah.json";
import alIkhlas from "../../content/al-ikhlas.json";
import alFalaq from "../../content/al-falaq.json";
import anNas from "../../content/an-nas.json";

import { SurahContent, type Ayah, type SurahContent as Surah } from "@/content/schema";

import { assertReferences } from "./library";
import { assertPublishable } from "./publishable";

function load(raw: unknown, name: string): Surah {
  const result = SurahContent.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `content/${name}.json does not match the schema:\n` +
        JSON.stringify(result.error.issues.slice(0, 10), null, 2),
    );
  }
  if (result.data.slug !== name) {
    throw new Error(`content/${name}.json carries slug "${result.data.slug}"`);
  }
  return result.data;
}

export const SURAHS: Surah[] = [
  load(alFatihah, "al-fatihah"),
  load(alIkhlas, "al-ikhlas"),
  load(alFalaq, "al-falaq"),
  load(anNas, "an-nas"),
];

// Mushaf order: the track page lists surahs, and its first one gets the
// primary action.
for (let i = 1; i < SURAHS.length; i++) {
  if (SURAHS[i].surah <= SURAHS[i - 1].surah) {
    throw new Error(
      `content: ${SURAHS[i].slug} is listed after ${SURAHS[i - 1].slug} (not mushaf order)`,
    );
  }
}

// Every lemma / concept a lesson points at must exist in the libraries.
assertReferences(SURAHS);

// Every record's `status` is "draft": pipeline state, not a review (plan L11), so it is not a reason to
// keep a build from going public. What would be a reason is content that promises a review nobody
// does, or that is left unfinished: refused here, in every build (lib/publishable.ts).
for (const s of SURAHS) assertPublishable(s, `content/${s.slug}.json`);

export function getSurah(slug: string): Surah | undefined {
  return SURAHS.find((s) => s.slug === slug);
}

export function getAyah(s: Surah, n: number): Ayah | undefined {
  return s.ayat.find((a) => a.ayah === n);
}

/** Surah number → slug + display name, for links built from a word loc
 *  ("112:3:2") now that concept examples span several surahs. */
export const SURAH_INDEX: Record<number, { slug: string; name: string }> = Object.fromEntries(
  SURAHS.map((s) => [s.surah, { slug: s.slug, name: s.name_id }]),
);

/** Arabic of every lesson word, keyed by loc, across all surahs. */
export const WORD_AR: Record<string, string> = Object.fromEntries(
  SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w.ar]))),
);

/** Arabic, transliteration and meaning of every lesson word, keyed by loc: a Konsep example row
 *  shows the word as "بِسْمِ bismi, yang artinya “dengan nama”" from these content bytes
 *  (operator 2026-10-10: Arabic with transliteration, meanings with "yang artinya"). */
export const WORD_INFO: Record<string, { ar: string; translit: string; gloss: string }> = Object.fromEntries(
  SURAHS.flatMap((s) =>
    s.ayat.flatMap((a) => a.words.map((w) => [w.loc, { ar: w.ar, translit: w.translit, gloss: w.gloss }])),
  ),
);
