/**
 * The vocabulary list's pure parts: paging, search and the coverage figures. No file access, so the
 * tests can run them on the real data; src/lib/kosakata.ts reads the files.
 */
import type { KosakataRow, KosakataVoice } from "@/content/kosakata-schema";
import type { Clip } from "@/content/schema";

/** Words on one page of the list, and in one file of content/kosakata (pipeline/kosakata.py). */
export const PAGE_SIZE = 100;
/** At most this many search results: the list is for browsing, the page stays light. */
export const SEARCH_LIMIT = 50;
/** The "how far does this take you" figures. */
export const MILESTONES = [100, 300, 500, 1000, 2000] as const;

/** Page of the list that holds `rank`. */
export const pageOfRank = (rank: number) => Math.ceil(rank / PAGE_SIZE);

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** `?hal=` as a page number; anything malformed or out of range is the first page. */
export function parsePage(raw: unknown, total: number): number {
  const n = typeof raw === "string" && /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : 1;
  return n <= pageCount(total) ? n : 1;
}

/** The rows of one page. */
export function pageRows<T>(rows: readonly T[], page: number): readonly T[] {
  return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
}

/** A word's rank from its URL; null unless it is a plain number within the list. */
export function parseRank(raw: unknown, total: number): number | null {
  const n = typeof raw === "string" && /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : 0;
  return n >= 1 && n <= total ? n : null;
}

/** The file that holds `rank` (pipeline/kosakata.py file_for_rank). */
export const wordsFileName = (rank: number) => `words-${String(pageOfRank(rank)).padStart(3, "0")}.json`;

/** The file that holds a surah's cited ayat (pipeline/kosakata.py file_for_sura). */
export const ayatFileName = (surah: number) => `ayat-${String(surah).padStart(3, "0")}.json`;

/**
 * What the search compares: lowercase, no diacritics or harakat, one form of each Arabic letter that
 * is spelt several ways. The same rule as pipeline/kosakata.py fold, which folded the rows.
 */
export function foldSearch(text: string): string {
  const bare = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/ٱ/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ءـۖ-ۭ‘’'`]/g, "");
  return bare.split(/\s+/).filter(Boolean).join(" ");
}

/** Rows matching the query, most frequent first, with how many matched in all. */
export function searchRows(rows: readonly KosakataRow[], query: string): { rows: KosakataRow[]; total: number } {
  const q = foldSearch(query);
  if (!q) return { rows: [], total: 0 };
  const hits = rows.filter((r) => r.s.includes(q));
  return { rows: hits.slice(0, SEARCH_LIMIT), total: hits.length };
}

/** Our copy of Quran.com's recording of the word at `loc` (pipeline/kosakata_voice.py url_of). */
export function voiceUrl(loc: string): string {
  const [s, a, w] = loc.split(":").map((n) => n.padStart(3, "0"));
  return `/belajar/media/narration/quran-com/wbw/${s}_${a}_${w}.mp3`;
}

/** What a list row plays, from its `v` ("<loc> <start> <end>"): the word's place and its clip. */
export function rowVoice(v: string): { loc: string; clip: Clip } {
  const [loc, start, end] = v.split(" ");
  return { loc, clip: { url: voiceUrl(loc), start: Number(start), end: Number(end), source: "quran.com" } };
}

/** What a word page plays. */
export const wordClip = (voice: KosakataVoice): Clip => ({ url: voice.url, start: voice.start, end: voice.end, source: "quran.com" });

/** "2:30:2" as its surah, ayah and word numbers. */
export function placeOf(loc: string): { surah: string; ayah: number; word: number } {
  const [surah, ayah, word] = loc.split(":");
  return { surah, ayah: Number(ayah), word: Number(word) };
}

/** A basis-point share as a percentage with one decimal: 5750 → 57.5. */
export const percent = (cum: number) => Math.round(cum / 10) / 10;
