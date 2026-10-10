/**
 * Lesson content, validated at BUILD time (lesson pages are prerendered):
 * a malformed or unsourced value fails `next build` in CI instead of
 * reaching a learner. Public builds refuse content still marked "draft"
 * (pipeline state; there is no human review step, plan L11).
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

import { IS_PUBLIC } from "./flags";
import { assertReferences } from "./library";

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

/** Is any record in this surah still marked "draft" (pipeline state, plan L11)? */
export function hasDrafts(s: Surah): boolean {
  return (
    s.ayat.some(
      (a) =>
        a.status === "draft" ||
        a.tafsir?.status === "draft" ||
        a.words.some((w) => w.status === "draft"),
    ) ||
    s.facts.some((f) => f.status === "draft") ||
    s.hadith.some((h) => h.status === "draft")
  );
}

if (IS_PUBLIC) {
  const pending = SURAHS.filter(hasDrafts).map((s) => s.slug);
  if (pending.length) {
    throw new Error(
      `BELAJAR_PUBLIC build refused: content still marked "draft" in ${pending.join(", ")}. ` +
        "Revisit this gate before any indexed build (plan L11: there is no human review step).",
    );
  }
}

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
