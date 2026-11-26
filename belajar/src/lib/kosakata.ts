/**
 * The Qur'an vocabulary list's data (content/kosakata/), SERVER ONLY. Read per request and never
 * bundled: the container has 256 MB (deploy/belajar/docker-compose.yml), and a page needs one word
 * at a time, so only the light index stays in memory. The Dockerfile copies the directory beside
 * the standalone server; process.cwd() is the app root in `next build` and in the container.
 */
import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { KosakataAyatFile, KosakataIndex, KosakataPath, KosakataWord, KosakataWordsFile } from "@/content/kosakata-schema";

import { parseAyahLoc, type AyahPayload } from "./ayah";
import { ayatFileName, wordsFileName } from "./kosakata-core";

const read = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), "content/kosakata", name), "utf8")) as T;

let index: KosakataIndex | null = null;

/** Every word's row: the list, the search and the counts. */
export function kosakataIndex(): KosakataIndex {
  // `status` is "draft" here as everywhere: pipeline state, not a review (docs/belajar-plan.md L11), so it
  // does not keep a public module from serving the list. That the files claim no review and hold no
  // unfinished text is checked on every file by src/lib/publishable.test.ts (they are read per request,
  // too large to scan at run time; lib/publishable.ts has the rule).
  if (!index) index = read<KosakataIndex>("index.json");
  return index;
}

let path: KosakataPath | null = null;

/** The learning path: its levels, its batches and Level 0. Small, so it stays in memory with the index. */
export function kosakataPath(): KosakataPath {
  if (!path) path = read<KosakataPath>("path.json");
  return path;
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
