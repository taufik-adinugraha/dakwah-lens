/**
 * What the learning path's pages hand the browser, built from the list's files. Pure: the files come in
 * as `PathSource`, so the tests run this on the real data; src/lib/kosakata-path.ts is the server's way
 * of calling it. A page sends one batch's cards, or one test's words: never a whole level.
 */
import type { KosakataIndex, KosakataPart, KosakataPath, KosakataRow, KosakataVoice, KosakataWord } from "@/content/kosakata-schema";
import type { Clip } from "@/content/schema";

import { placeOf, rowVoice, wordClip } from "./kosakata-core";
import { type AyahLine, firstSense, meaningWords, takenWords, type TestItem } from "./kosakata-path-core";

export type PathSource = {
  index: KosakataIndex;
  path: KosakataPath;
  word: (rank: number) => KosakataWord | null;
  /** An ayah some word cites: its text and translation. */
  ayah: (loc: string) => { ar: string; text: string; footnotes: readonly string[]; surah: string; ayah: number } | null;
};

/** An ayah longer than this is not asked about: the question would not fit a phone's screen. */
const SHORT_AYAH_CHARS = 170;
/** How many earlier words a test carries to review and to draw wrong options from. */
const EARLIER_CAP = 150;
/** Words after the batch that may stand as wrong options, when the level is young. */
const LATER_POOL = 30;

export type MapLevel = { n: number; from?: number; to?: number; cum?: number; batches: number; tokens?: number[]; questions: number };

/** What the map shows: each level's size and, per batch, how many words of the Qur'an it covers. */
export function mapLevels(src: PathSource): MapLevel[] {
  const { rows } = src.index;
  const skip = new Set(src.path.no_test);
  return src.path.levels.map((l) => {
    const testable = l.n === 0 ? l.batches.flat().length : l.batches.flat().filter((r) => !skip.has(r as number)).length;
    return {
      n: l.n,
      from: l.from,
      to: l.to,
      cum: l.cum,
      batches: l.batches.length,
      tokens: l.n === 0 ? undefined : l.batches.map((b) => b.reduce<number>((sum, r) => sum + rows[(r as number) - 1].count, 0)),
      questions: Math.min(src.path.level_test_questions, testable),
    };
  });
}

/** A word's or a part's place, as the page says it. */
export type VoiceView = { loc: string; clip: Clip; form: string; final: boolean; surah: string; ayah: number; word: number };

function voiceView(src: PathSource, v: KosakataVoice): VoiceView {
  const p = placeOf(v.loc);
  return { loc: v.loc, clip: wordClip(v), form: v.form, final: v.final === true, surah: src.index.names[p.surah], ayah: p.ayah, word: p.word };
}

export type WordCard = {
  type: "word";
  key: string;
  rank: number;
  ar: string;
  translit: string;
  count: number;
  senses: { id: string; en: string }[];
  tested: boolean;
  voice: VoiceView;
  example: AyahLine | null;
};

export type PartCard = {
  type: "part";
  key: string;
  ar: string;
  translit: string;
  count: number;
  meaning: { id: string; en: string };
  concept?: string;
  word: readonly [string, string, string];
  pieces: { id: string; en: string };
  voice: VoiceView;
};

export type Card = WordCard | PartCard;

function ayahLine(src: PathSource, w: KosakataWord): AyahLine | null {
  if (!w.example) return null;
  const a = src.ayah(w.example.loc);
  if (!a) return null;
  return { loc: w.example.loc, surah: a.surah, ayah: a.ayah, tokens: a.ar.split(" "), hi: w.example.hi, text: a.text, footnotes: [...a.footnotes] };
}

/** The level, or null for anything that is not one. */
export function levelOf(src: PathSource, raw: unknown) {
  const n = typeof raw === "string" && /^\d$/.test(raw) ? Number(raw) : -1;
  return src.path.levels.find((l) => l.n === n) ?? null;
}

/** A batch's number from its URL, or null. */
export function batchOf(level: { batches: readonly unknown[] }, raw: unknown): number | null {
  const n = typeof raw === "string" && /^[1-9]\d{0,2}$/.test(raw) ? Number(raw) : 0;
  return n >= 1 && n <= level.batches.length ? n : null;
}

/** One batch's cards. */
export function batchCards(src: PathSource, level: KosakataPath["levels"][number], batch: number): Card[] {
  const noTest = new Set(src.path.no_test);
  return level.batches[batch - 1].map((k): Card => {
    if (level.n === 0) {
      const p = src.path.parts[k as string];
      const e = p.examples[0];
      return {
        type: "part",
        key: `p-${p.key}`,
        ar: p.ar,
        translit: p.translit,
        count: p.count,
        meaning: { id: p.id, en: p.en },
        concept: p.concept,
        word: e.word,
        pieces: e.pieces,
        voice: voiceView(src, e.voice),
      };
    }
    const w = src.word(k as number) as KosakataWord;
    return {
      type: "word",
      key: `w${w.rank}`,
      rank: w.rank,
      ar: w.ar,
      translit: w.translit,
      count: w.count,
      senses: w.senses.map((s) => ({ id: s.id, en: s.en })),
      tested: !noTest.has(w.rank),
      voice: voiceView(src, w.voice),
      example: ayahLine(src, w),
    };
  });
}

function rowItem(row: KosakataRow): TestItem {
  const { loc, clip } = rowVoice(row.v);
  return {
    key: `w${row.rank}`,
    ar: row.ar,
    translit: row.translit,
    meaning: { id: firstSense(row.id), en: firstSense(row.en) },
    kind: row.k,
    taken: takenWords(row.s),
    loc,
    clip,
  };
}

function partItem(p: KosakataPart): TestItem {
  const e = p.examples[1];
  return {
    key: `p-${p.key}`,
    ar: p.ar,
    translit: p.translit,
    meaning: { id: p.id, en: p.en },
    kind: "part",
    taken: [...new Set([...meaningWords(p.id), ...meaningWords(p.en)])],
    loc: e.voice.loc,
    clip: wordClip(e.voice),
    word: e.word,
  };
}

export type TestData = {
  /** The test's id for the anonymous counts, and what it opens when passed. */
  id: string;
  opens: string[];
  fresh: TestItem[];
  earlier: TestItem[];
  pool: TestItem[];
  /** How many earlier words to review (a batch test), or how many questions in all (a level test). */
  review: number;
  questions: number;
  isPart: boolean;
};

/** Spread `items` to at most `cap`, keeping the whole range rather than its start. */
function spread<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return [...items];
  const step = items.length / cap;
  return Array.from({ length: cap }, (_, i) => items[Math.floor(i * step)]);
}

/** A batch's test: batch === null is the level's. */
export function testData(src: PathSource, level: KosakataPath["levels"][number], batch: number | null): TestData {
  const { rows } = src.index;
  const skip = new Set(src.path.no_test);
  const isPart = level.n === 0;
  const items = (keys: readonly (string | number)[]) =>
    isPart ? keys.map((k) => partItem(src.path.parts[k as string])) : keys.filter((r) => !skip.has(r as number)).map((r) => rowItem(rows[(r as number) - 1]));
  const allIds = level.batches.map((_, i) => `${level.n}-${i + 1}`);
  if (batch === null) {
    const all = spread(items(level.batches.flat()), EARLIER_CAP);
    return { id: `${level.n}-tes`, opens: allIds, fresh: all, earlier: [], pool: all, review: 0, questions: src.path.level_test_questions, isPart };
  }
  const keys = level.batches[batch - 1];
  const fresh = isPart
    ? items(keys)
    : keys
        .filter((r) => !skip.has(r as number))
        .map((r) => {
          const w = src.word(r as number) as KosakataWord;
          const line = ayahLine(src, w);
          return { ...rowItem(rows[w.rank - 1]), ...(line && line.tokens.join(" ").length <= SHORT_AYAH_CHARS ? { ayah: line } : {}) };
        });
  const before = level.batches.slice(0, batch - 1).flat();
  const after = level.batches.slice(batch).flat();
  const earlier = items(before.slice(-EARLIER_CAP));
  const later = items(after.slice(0, LATER_POOL));
  return { id: `${level.n}-${batch}`, opens: [`${level.n}-${batch}`], fresh, earlier, pool: [...earlier, ...fresh, ...later], review: src.path.review_questions, questions: fresh.length, isPart };
}

/** Whether `id` names a test of the path: the anonymous counts take nothing else. */
export function knownTest(src: PathSource, id: unknown): boolean {
  if (typeof id !== "string") return false;
  const m = /^(\d)-(tes|[1-9]\d{0,2})$/.exec(id);
  if (!m) return false;
  const level = src.path.levels.find((l) => l.n === Number(m[1]));
  return !!level && (m[2] === "tes" || Number(m[2]) <= level.batches.length);
}
