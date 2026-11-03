/**
 * The Qur'an vocabulary list's data (content/kosakata/), SERVER ONLY. Read per request and never
 * bundled: the container has 256 MB (deploy/belajar/docker-compose.yml), and a page needs one word
 * at a time, so only the light index stays in memory. The Dockerfile copies the directory beside
 * the standalone server; process.cwd() is the app root in `next build` and in the container.
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { KosakataAyatFile, KosakataIndex, KosakataWord, KosakataWordsFile } from "@/content/kosakata-schema";

import { parseAyahLoc, type AyahPayload } from "./ayah";
import { IS_PUBLIC } from "./flags";
import { ayatFileName, wordsFileName } from "./kosakata-core";

const read = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), "content/kosakata", name), "utf8")) as T;

let index: KosakataIndex | null = null;

/** Every word's row: the list, the search and the counts. */
export function kosakataIndex(): KosakataIndex {
  if (!index) {
    const loaded = read<KosakataIndex>("index.json");
    // As lib/content.ts refuses draft lessons: going public is a decision, and this data is draft.
    if (IS_PUBLIC && loaded.status === "draft") {
      throw new Error("content/kosakata is marked draft; a public build must not serve it");
    }
    index = loaded;
  }
  return index;
}

/** One word in full, by rank. */
export function kosakataWord(rank: number): KosakataWord | null {
  const file = read<KosakataWordsFile>(wordsFileName(rank));
  return file.words.find((w) => w.rank === rank) ?? null;
}

/** One ayah a word cites, for /belajar/api/ayah: null when no word cites it. */
export function kosakataAyah(loc: unknown): AyahPayload | null {
  const r = parseAyahLoc(loc);
  if (!r) return null;
  let file: KosakataAyatFile;
  try {
    file = read<KosakataAyatFile>(ayatFileName(r.surah));
  } catch {
    return null; // no word cites this surah
  }
  const entry = file.ayat.find((e) => e.loc === loc);
  const { names, translation } = kosakataIndex();
  const name = names[String(r.surah)];
  if (!entry || !name) return null;
  return {
    loc: entry.loc,
    surah: r.surah,
    ayah: r.ayah,
    name,
    ar: entry.ar,
    translation: { text: entry.translation.text, footnotes: [...entry.translation.footnotes], ...translation },
  };
}
