/**
 * The fact cards' ayah popup data (content/ayat/locations.json, ~1 MB: every ayah a fact locates),
 * SERVER ONLY: /belajar/api/ayah answers one ayah from it, and the pages pass their dialog the few
 * surah names it needs. Never imported by a client component, so it is never shipped to a page.
 *
 * Validated when it loads, which is at build time (the prerendered surah and lesson pages import
 * it): the zod shape, and that every location a lesson's fact card shows has its ayah here — a
 * file not rebuilt after a fact changed fails `next build`, not a learner's click. The bytes
 * themselves are checked by belajar/pipeline/validate_ayat.py (Tanzil, QuranEnc, the lessons).
 */
import "server-only";

import raw from "../../content/ayat/locations.json";

import { AyatFile } from "@/content/ayat-schema";

import { ayahLookup, namesFor, type AyahPayload } from "./ayah";
import { SURAHS } from "./content";

function load(): AyatFile {
  const result = AyatFile.safeParse(raw);
  if (!result.success) {
    throw new Error(
      "content/ayat/locations.json does not match the schema:\n" + JSON.stringify(result.error.issues.slice(0, 10), null, 2),
    );
  }
  const have = new Set(result.data.ayat.map((e) => e.loc));
  const missing = [...new Set(SURAHS.flatMap((s) => s.facts.flatMap((f) => f.locations)))].filter((loc) => !have.has(loc));
  if (missing.length) {
    throw new Error(
      `content/ayat/locations.json has no entry for ${missing.length} fact location(s) (${missing.slice(0, 5).join(", ")}…); ` +
        "run belajar/pipeline/build_ayat.py",
    );
  }
  return result.data;
}

const AYAT = load();
const lookup = ayahLookup(AYAT);

/** One ayah of the popup, or null when the file has none for `loc`. */
export function ayahPayload(loc: unknown): AyahPayload | null {
  return lookup(loc);
}

/** Its pinned inputs, for the Kredit page's "Versi data" (names no surah: nothing hidden leaks). */
export const AYAT_DATA_VERSIONS: Readonly<Record<string, string>> = AYAT.data_versions;

/** The names of the surahs `locs` belong to ("2" → "Al-Baqarah"), for a page's AyahDialogProvider. */
export function surahNamesFor(locs: Iterable<string>): Record<string, string> {
  return namesFor(locs, AYAT.names);
}
