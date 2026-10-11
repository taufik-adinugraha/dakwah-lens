/**
 * Word compositions and the harakat primer (content/compose/<slug>.json),
 * validated at BUILD time like the lesson content: the zod shape, then the
 * replay (./composition.ts) that re-derives every Arabic form from the lesson
 * words' bytes and the declared edits, and checks that each word's last frame
 * is the word exactly as the ayah writes it — a mismatch fails `next build`
 * instead of reaching a learner. A surah without a file has no compositions
 * (its words keep their one-line explanation).
 */
import alFatihah from "../../content/compose/al-fatihah.json";

import { ComposeFile, type ComposeFile as File } from "@/content/compose-schema";

import { composeFileProblems, composeInputFor, type ComposeInput } from "./composition";
import { SURAHS } from "./content";

const WORDS = new Map(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w.ar] as const))));

function load(raw: unknown, name: string): File {
  const result = ComposeFile.safeParse(raw);
  if (!result.success) {
    throw new Error(`content/compose/${name}.json does not match the schema:\n${JSON.stringify(result.error.issues.slice(0, 10), null, 2)}`);
  }
  if (result.data.slug !== name) throw new Error(`content/compose/${name}.json carries slug "${result.data.slug}"`);
  const problems = composeFileProblems(result.data, WORDS);
  if (problems.length) throw new Error(`content/compose/${name}.json:\n${problems.slice(0, 10).join("\n")}`);
  return result.data;
}

const BY_SLUG: Readonly<Record<string, File>> = {
  "al-fatihah": load(alFatihah, "al-fatihah"),
};

/** content/compose/${slug}.json, or null. */
export function composeFor(slug: string): File | null {
  return Object.prototype.hasOwnProperty.call(BY_SLUG, slug) ? BY_SLUG[slug] : null;
}

/** Slugs with a composition file (for the checks). */
export const COMPOSED_SLUGS: readonly string[] = Object.keys(BY_SLUG);

/** What the autoplay sequence of one ayah needs (no Arabic). */
export function composeInput(slug: string, ayah: { ayah: number; words: readonly { loc: string }[] }): ComposeInput | null {
  return composeInputFor(composeFor(slug), ayah);
}
