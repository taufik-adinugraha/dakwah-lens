/**
 * The learning path's pure parts: which batch is open, what a test asks and what counts as a pass. No
 * file access and no React, so the tests run them on the real data; src/lib/kosakata-path.ts reads the
 * files and src/hooks/useKosakataProgress.ts keeps the progress.
 *
 * The lock paces the learner and guards nothing: the list shows every word to everyone, and progress
 * lives in this browser (plan L16, no sign-in). So any level's test can be taken at any time, which is
 * also how a learner on a new device gets back to where they were.
 */
import type { Clip } from "@/content/schema";

import { foldSearch } from "./kosakata-core";

/** The word a card or a question is about: a word of the list, or a part attached to words (Level 0). */
export type TestItem = {
  /** "w12" for the word of rank 12, "p-wa" for a part. */
  key: string;
  ar: string;
  translit: string;
  /** The first sense: what the test asks for. */
  meaning: { id: string; en: string };
  kind: string;
  /** Every word of every sense, folded: a wrong option may share none of them. */
  taken: string[];
  loc: string;
  clip: Clip;
  /** Level 0: the example a question shows, as [before, the part, after]. */
  word?: readonly [string, string, string];
  /** The ayah an "ayah" question shows. */
  ayah?: AyahLine;
};

export type AyahLine = {
  loc: string;
  surah: string;
  ayah: number;
  tokens: string[];
  /** Where the word stands in `tokens`. */
  hi: number[];
  text: string;
  footnotes: string[];
};

export type QuestionKind = "word" | "hear" | "ayah" | "part";
export type Question = { item: TestItem; kind: QuestionKind; options: TestItem[] };

/** A sense is one stretch of the list's "; "-joined meanings: the build keeps ";" out of a gloss. */
export const firstSense = (joined: string) => joined.split("; ")[0];

/** The words of a gloss, folded, without what is in parentheses. */
export const meaningWords = (gloss: string) =>
  foldSearch(gloss.replace(/\(.*?\)/g, " "))
    .split(/[\s,;/]+/)
    .filter(Boolean);

/** The words of a row's folded search text, which holds every sense of the word. */
export const takenWords = (folded: string) => [...new Set(folded.split(/[\s,;/()]+/).filter(Boolean))];

const firstWords = (it: TestItem) => [...meaningWords(it.meaning.id), ...meaningWords(it.meaning.en)];

export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Three wrong options for `item`. None shares a word of meaning with any sense of the right answer, so
 * a learner who knows the word's other meaning is never marked wrong for it, and no two share one with
 * each other. They come from the same kind of word where there are enough, because an option that can
 * be ruled out by its grammar tests nothing, and from words already met before words still to come.
 */
export function wrongOptions(item: TestItem, pool: readonly TestItem[], seen: ReadonlySet<string>, rand: () => number = Math.random): TestItem[] {
  const taken = new Set(item.taken);
  const usable = pool.filter((c) => c.key !== item.key && !firstWords(c).some((w) => taken.has(w)));
  const tiers = [
    usable.filter((c) => c.kind === item.kind && seen.has(c.key)),
    usable.filter((c) => c.kind === item.kind),
    usable,
  ];
  const out: TestItem[] = [];
  for (const tier of tiers) {
    for (const c of shuffled(tier, rand)) {
      if (out.length === 3) return out;
      if (out.includes(c)) continue;
      const words = firstWords(c);
      if (out.some((o) => firstWords(o).some((w) => words.includes(w)))) continue;
      out.push(c);
    }
  }
  return out;
}

const WORD_KINDS: readonly QuestionKind[] = ["word", "hear", "word", "ayah"];

/** The questions for `targets`, in a new order each time, with the question kinds taking turns. */
function questionsFor(targets: readonly TestItem[], pool: readonly TestItem[], seen: ReadonlySet<string>, isPart: boolean, rand: () => number): Question[] {
  return shuffled(targets, rand).map((item, i) => {
    let kind: QuestionKind = isPart ? "part" : WORD_KINDS[i % WORD_KINDS.length];
    if (kind === "ayah" && !item.ayah) kind = "word";
    return { item, kind, options: shuffled([item, ...wrongOptions(item, pool, seen, rand)], rand) };
  });
}

/** Up to `n` earlier words: the ones this learner has missed first, then any. */
export function chooseReview(earlier: readonly TestItem[], missed: Readonly<Record<string, number>>, n: number, rand: () => number = Math.random): TestItem[] {
  return shuffled(earlier, rand)
    .sort((a, b) => (missed[b.key] ?? 0) - (missed[a.key] ?? 0))
    .slice(0, n);
}

/** A batch's test: every new word once, and some earlier ones, so that passing means remembering. */
export function batchTest(opts: {
  fresh: readonly TestItem[];
  earlier: readonly TestItem[];
  pool: readonly TestItem[];
  missed: Readonly<Record<string, number>>;
  review: number;
  isPart: boolean;
  rand?: () => number;
}): Question[] {
  const rand = opts.rand ?? Math.random;
  const targets = [...opts.fresh, ...chooseReview(opts.earlier, opts.missed, opts.review, rand)];
  const seen = new Set([...opts.fresh, ...opts.earlier].map((i) => i.key));
  return questionsFor(targets, opts.pool, seen, opts.isPart, rand);
}

/** A level's test: a sample across the level. Anyone can take it at any time. */
export function levelTest(opts: { items: readonly TestItem[]; pool: readonly TestItem[]; count: number; isPart: boolean; rand?: () => number }): Question[] {
  const rand = opts.rand ?? Math.random;
  const targets = shuffled(opts.items, rand).slice(0, opts.count);
  return questionsFor(targets, opts.pool, new Set(opts.pool.map((i) => i.key)), opts.isPart, rand);
}

/** How many right answers pass a test of `total` questions. */
export const passMark = (total: number, percent: number) => Math.ceil((total * percent) / 100);

export const batchId = (level: number, batch: number) => `${level}-${batch}`;
export const levelTestId = (level: number) => `${level}-tes`;

/** Every batch in order, the way they open. */
export function batchOrder(levels: readonly { n: number; batches: number }[]): string[] {
  return levels.flatMap((l) => Array.from({ length: l.batches }, (_, i) => batchId(l.n, i + 1)));
}

export type PassedTest = { score: number; total: number; at: number; viaLevel?: boolean };
export type PathProgress = { passed: Record<string, PassedTest>; missed: Record<string, number> };
export const NO_PROGRESS: PathProgress = { passed: {}, missed: {} };

/** A batch is open when it is the first, it was passed, or the one before it was passed. */
export function isOpen(progress: PathProgress, order: readonly string[], id: string): boolean {
  const i = order.indexOf(id);
  return i === 0 || id in progress.passed || (i > 0 && order[i - 1] in progress.passed);
}

/** The first batch not passed yet: where to go on from. null when all are passed. */
export const nextBatch = (progress: PathProgress, order: readonly string[]): string | null =>
  order.find((id) => !(id in progress.passed)) ?? null;

/** "2-14" as its level and batch. */
export function parseBatchId(id: string): { level: number; batch: number } {
  const [level, batch] = id.split("-").map(Number);
  return { level, batch };
}

/**
 * The progress after a finished test. A pass marks `opens`: the batch, or for a level test every batch
 * of the level. A word that was missed counts up and a word answered right counts down, so a later
 * test asks again what this learner keeps missing.
 */
export function afterTest(
  progress: PathProgress,
  result: { passed: boolean; opens: readonly string[]; score: number; total: number; at: number; viaLevel: boolean; missedKeys: readonly string[]; rightKeys: readonly string[] },
): PathProgress {
  const missed = { ...progress.missed };
  for (const k of result.missedKeys) missed[k] = (missed[k] ?? 0) + 1;
  for (const k of result.rightKeys) {
    if (missed[k]) {
      missed[k] -= 1;
      if (missed[k] === 0) delete missed[k];
    }
  }
  const passed = { ...progress.passed };
  if (result.passed) {
    for (const id of result.opens) {
      if (!passed[id] || !result.viaLevel) {
        passed[id] = { score: result.score, total: result.total, at: result.at, ...(result.viaLevel ? { viaLevel: true } : {}) };
      }
    }
  }
  return { passed, missed };
}

/** The share of the Qur'an's words the passed batches cover, in percent. */
export function coveredPercent(progress: PathProgress, levels: readonly { n: number; tokens?: readonly number[] }[], totalTokens: number): number {
  let sum = 0;
  for (const l of levels) {
    (l.tokens ?? []).forEach((t, i) => {
      if (batchId(l.n, i + 1) in progress.passed) sum += t;
    });
  }
  return (sum * 100) / totalTokens;
}

/** A progress object out of storage: anything malformed is no progress. */
export function parseProgress(raw: string | null): PathProgress {
  if (!raw) return NO_PROGRESS;
  try {
    const v = JSON.parse(raw) as Partial<PathProgress> | null;
    if (!v || typeof v !== "object" || typeof v.passed !== "object" || typeof v.missed !== "object" || !v.passed || !v.missed) return NO_PROGRESS;
    return { passed: v.passed, missed: v.missed };
  } catch {
    return NO_PROGRESS;
  }
}
