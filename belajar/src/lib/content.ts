/**
 * Lesson content, validated at BUILD time (lesson pages are prerendered):
 * a malformed or unsourced value fails `next build` in CI instead of
 * reaching a learner. Public builds refuse unreviewed content (plan §8).
 */
import alFatihah from "../../content/al-fatihah.json";

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
  return result.data;
}

export const SURAHS: Surah[] = [load(alFatihah, "al-fatihah")];

// Every lemma / concept a lesson points at must exist in the libraries.
assertReferences(SURAHS);

/** Does any record in this surah still await ustadz review? */
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
      `BELAJAR_PUBLIC build refused: unreviewed content in ${pending.join(", ")}. ` +
        "Every value needs an ustadz sign-off before a public build (plan §8).",
    );
  }
}

export function getSurah(slug: string): Surah | undefined {
  return SURAHS.find((s) => s.slug === slug);
}

export function getAyah(s: Surah, n: number): Ayah | undefined {
  return s.ayat.find((a) => a.ayah === n);
}
