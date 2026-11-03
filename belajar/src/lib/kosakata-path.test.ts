import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KosakataAyatFile, KosakataIndex, KosakataPath, KosakataWordsFile } from "@/content/kosakata-schema";

import { ayatFileName, wordsFileName } from "./kosakata-core";
import {
  afterTest,
  batchId,
  batchOrder,
  batchTest,
  chooseReview,
  coveredPercent,
  firstSense,
  isOpen,
  levelTest,
  meaningWords,
  nextBatch,
  NO_PROGRESS,
  parseProgress,
  passMark,
  type PathProgress,
  type Question,
  type TestItem,
} from "./kosakata-path-core";
import { batchCards, batchOf, knownTest, levelOf, mapLevels, type PathSource, testData } from "./kosakata-path-data";

const DIR = fileURLToPath(new URL("../../content/kosakata/", import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const index = KosakataIndex.parse(read("index.json"));
const path = KosakataPath.parse(read("path.json"));
const wordFiles = new Map<string, ReturnType<typeof KosakataWordsFile.parse>>();
const ayatFiles = new Map<string, ReturnType<typeof KosakataAyatFile.parse>>();

const src: PathSource = {
  index,
  path,
  word: (rank) => {
    const name = wordsFileName(rank);
    if (!wordFiles.has(name)) wordFiles.set(name, KosakataWordsFile.parse(read(name)));
    return wordFiles.get(name)!.words.find((w) => w.rank === rank) ?? null;
  },
  ayah: (loc) => {
    const [s, a] = loc.split(":").map(Number);
    const name = ayatFileName(s);
    if (!ayatFiles.has(name)) ayatFiles.set(name, KosakataAyatFile.parse(read(name)));
    const e = ayatFiles.get(name)!.ayat.find((x) => x.loc === loc);
    return e ? { ar: e.ar, text: e.translation.text, footnotes: e.translation.footnotes, surah: index.names[String(s)], ayah: a } : null;
  },
};

/** A seeded generator: the tests draw at random as the page does, and a failure can be repeated. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noTestKeys = new Set(path.no_test.map((r) => `w${r}`));

function checkQuestion(q: Question, where: string) {
  const at = `${where}: ${q.item.translit}`;
  expect(q.options, at).toHaveLength(4);
  expect(q.options.filter((o) => o.key === q.item.key), at).toHaveLength(1);
  expect(new Set(q.options.map((o) => o.key)).size, at).toBe(4);
  expect(new Set(q.options.map((o) => o.meaning.id)).size, `${at}: two options read the same`).toBe(4);
  expect(noTestKeys.has(q.item.key), `${at}: a word that gets no question was asked`).toBe(false);
  const taken = new Set(q.item.taken);
  for (const o of q.options) {
    expect(noTestKeys.has(o.key), `${at}: a word that gets no question stands as an option`).toBe(false);
    if (o.key === q.item.key) continue;
    const shared = [...meaningWords(o.meaning.id), ...meaningWords(o.meaning.en)].filter((w) => taken.has(w));
    expect(shared, `${at}: the wrong option "${o.meaning.id}" is also a meaning of the word`).toEqual([]);
  }
  if (q.kind === "ayah") expect(q.item.ayah, at).toBeTruthy();
  if (q.kind === "part") expect(q.item.word, at).toBeTruthy();
}

describe("the real path", () => {
  const levels = mapLevels(src);
  const order = batchOrder(levels);

  it("has six levels and 202 batches, each word of the top 2,000 once", () => {
    expect(levels.map((l) => l.batches)).toEqual([2, 10, 20, 20, 50, 100]);
    expect(order).toHaveLength(202);
    const ranks = path.levels.slice(1).flatMap((l) => l.batches.flat());
    expect([...ranks].sort((a, b) => (a as number) - (b as number))).toEqual(Array.from({ length: 2000 }, (_, i) => i + 1));
  });

  it("covers what the map says: each level's words add up to its share", () => {
    for (const l of levels.slice(1)) {
      const upTo = levels.slice(1, l.n + 1).flatMap((x) => x.tokens ?? []).reduce((a, b) => a + b, 0);
      expect(Math.round((upTo * 10000) / index.total_tokens), `level ${l.n}`).toBe(l.cum);
    }
  });

  it("gives a batch's cards with a recording, and every word of the path an ayah to be seen in", () => {
    for (const level of path.levels) {
      level.batches.forEach((_, i) => {
        for (const c of batchCards(src, level, i + 1)) {
          expect(c.voice.clip.url, c.key).toMatch(/^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/);
          expect(c.voice.surah, c.key).toBeTruthy();
          if (c.type === "word") {
            expect(c.example, c.key).toBeTruthy();
            for (const h of c.example!.hi) expect(c.example!.tokens[h], c.key).toBeTruthy();
          } else {
            expect(c.word.join(""), c.key).toBe(c.voice.form);
          }
        }
      });
    }
  }, 60_000);

  it("draws a sound test for every batch and every level, again and again", () => {
    let asked = 0;
    for (const seed of [1, 2, 3]) {
      const rand = seeded(seed);
      for (const level of path.levels) {
        level.batches.forEach((_, i) => {
          const d = testData(src, level, i + 1);
          const qs = batchTest({ fresh: d.fresh, earlier: d.earlier, pool: d.pool, missed: {}, review: d.review, isPart: d.isPart, rand });
          expect(qs.length, d.id).toBe(d.fresh.length + Math.min(d.review, d.earlier.length));
          expect(new Set(qs.map((q) => q.item.key)).size, d.id).toBe(qs.length);
          for (const q of qs) checkQuestion(q, d.id);
          asked += qs.length;
        });
        const d = testData(src, level, null);
        const qs = levelTest({ items: d.fresh, pool: d.pool, count: d.questions, isPart: d.isPart, rand });
        expect(qs.length, d.id).toBe(Math.min(d.questions, d.fresh.length));
        for (const q of qs) checkQuestion(q, d.id);
        asked += qs.length;
      }
    }
    expect(asked).toBeGreaterThan(8000);
  }, 120_000);

  it("keeps ';' out of a gloss, because it separates the senses in a row", () => {
    for (const r of index.rows.slice(0, 2000)) {
      expect(firstSense(r.id), r.translit).toBe(src.word(r.rank)!.senses[0].id);
      expect(firstSense(r.en), r.translit).toBe(src.word(r.rank)!.senses[0].en);
    }
  }, 60_000);

  it("asks a batch's ayah only where it fits a phone", () => {
    const level = levelOf(src, "1")!;
    for (const item of testData(src, level, 1).fresh) {
      if (item.ayah) expect(item.ayah.tokens.join(" ").length).toBeLessThanOrEqual(170);
    }
  });

  it("reads a level and a batch from a URL, and refuses the rest", () => {
    expect(levelOf(src, "0")?.n).toBe(0);
    expect(levelOf(src, "5")?.n).toBe(5);
    for (const bad of ["6", "9", "x", "", "01", undefined]) expect(levelOf(src, bad), String(bad)).toBeNull();
    const level = levelOf(src, "1")!;
    expect(batchOf(level, "10")).toBe(10);
    for (const bad of ["0", "11", "x", "1a", undefined]) expect(batchOf(level, bad), String(bad)).toBeNull();
  });

  it("counts only the tests that exist", () => {
    for (const ok of ["0-1", "0-2", "1-10", "5-100", "3-tes"]) expect(knownTest(src, ok), ok).toBe(true);
    for (const bad of ["0-3", "1-11", "6-1", "x", "1-0", "1-", "../..", "", 12, null]) expect(knownTest(src, bad), String(bad)).toBe(false);
  });
});

describe("what passes", () => {
  it("rounds the mark up, so 80% means at least 80%", () => {
    expect(passMark(15, 80)).toBe(12);
    expect(passMark(14, 80)).toBe(12);
    expect(passMark(10, 80)).toBe(8);
    expect(passMark(9, 80)).toBe(8);
    expect(passMark(30, 80)).toBe(24);
  });
});

describe("what opens", () => {
  const order = ["0-1", "0-2", "1-1", "1-2"];
  const result = { score: 12, total: 15, at: 1, viaLevel: false, missedKeys: [], rightKeys: [] };

  it("opens the first batch only, to begin with", () => {
    expect(order.filter((id) => isOpen(NO_PROGRESS, order, id))).toEqual(["0-1"]);
    expect(nextBatch(NO_PROGRESS, order)).toBe("0-1");
  });

  it("opens the next batch when one is passed, and not when it is failed", () => {
    const failed = afterTest(NO_PROGRESS, { ...result, passed: false, opens: ["0-1"] });
    expect(isOpen(failed, order, "0-2")).toBe(false);
    const passed = afterTest(NO_PROGRESS, { ...result, passed: true, opens: ["0-1"] });
    expect(order.filter((id) => isOpen(passed, order, id))).toEqual(["0-1", "0-2"]);
    expect(nextBatch(passed, order)).toBe("0-2");
  });

  it("opens a whole level from its test, and the next level's first batch with it", () => {
    const p = afterTest(NO_PROGRESS, { ...result, passed: true, opens: ["1-1", "1-2"], viaLevel: true });
    expect(isOpen(p, order, "1-2")).toBe(true);
    expect(p.passed["1-1"].viaLevel).toBe(true);
    // Level 0 stays there to go back to, not passed.
    expect(nextBatch(p, order)).toBe("0-1");
  });

  it("does not write a level test's score over a batch's own", () => {
    const own = afterTest(NO_PROGRESS, { ...result, passed: true, opens: ["1-1"], score: 15 });
    const after = afterTest(own, { ...result, passed: true, opens: ["1-1", "1-2"], viaLevel: true, score: 24, total: 30 });
    expect(after.passed["1-1"].score).toBe(15);
    expect(after.passed["1-2"].score).toBe(24);
  });

  it("asks again what a learner keeps missing, until they get it right", () => {
    let p: PathProgress = afterTest(NO_PROGRESS, { ...result, passed: false, opens: [], missedKeys: ["w5", "w9"] });
    p = afterTest(p, { ...result, passed: false, opens: [], missedKeys: ["w5"], rightKeys: ["w9"] });
    expect(p.missed).toEqual({ w5: 2 });
    const item = (key: string) => ({ key }) as TestItem;
    const chosen = chooseReview([item("w1"), item("w2"), item("w5"), item("w7")], p.missed, 2, seeded(1));
    expect(chosen[0].key).toBe("w5");
    expect(chosen).toHaveLength(2);
    p = afterTest(p, { ...result, passed: true, opens: [], rightKeys: ["w5"] });
    p = afterTest(p, { ...result, passed: true, opens: [], rightKeys: ["w5"] });
    expect(p.missed).toEqual({});
  });

  it("adds up what the passed batches cover", () => {
    const p = afterTest(NO_PROGRESS, { ...result, passed: true, opens: [batchId(1, 2)] });
    expect(coveredPercent(p, [{ n: 0 }, { n: 1, tokens: [100, 50] }], 1000)).toBe(5);
    expect(coveredPercent(NO_PROGRESS, [{ n: 1, tokens: [100] }], 1000)).toBe(0);
  });

  it("treats anything malformed in storage as no progress", () => {
    for (const raw of [null, "", "{", "null", "3", '{"passed":1,"missed":{}}', '{"passed":{}}']) {
      expect(parseProgress(raw), String(raw)).toEqual(NO_PROGRESS);
    }
    expect(parseProgress('{"passed":{"0-1":{"score":8,"total":10,"at":1}},"missed":{}}').passed["0-1"].score).toBe(8);
  });
});
