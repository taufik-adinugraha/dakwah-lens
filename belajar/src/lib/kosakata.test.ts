import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KosakataAyatFile, KosakataIndex, KosakataWordsFile } from "@/content/kosakata-schema";

import { parseAyahLoc } from "./ayah";
import {
  ayatFileName,
  foldSearch,
  MILESTONES,
  pageCount,
  pageOfRank,
  pageRows,
  parsePage,
  parseRank,
  percent,
  searchRows,
  wordsFileName,
} from "./kosakata-core";

// The app reads these files per request and trusts them, so every file is held to its shape here.
const DIR = fileURLToPath(new URL("../../content/kosakata/", import.meta.url));
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const files = readdirSync(DIR);
const index = KosakataIndex.parse(read("index.json"));
const total = index.rows.length;

describe("the data files", () => {
  it("match their schemas, and the file names the app computes exist", () => {
    for (const name of files.filter((f) => f.startsWith("words-"))) KosakataWordsFile.parse(read(name));
    for (const name of files.filter((f) => f.startsWith("ayat-"))) KosakataAyatFile.parse(read(name));
    for (const rank of [1, 100, 101, total]) expect(files).toContain(wordsFileName(rank));
  });

  it("has every word's rank in the file the app looks in, and every cited ayah in its surah's file", () => {
    for (let page = 1; page <= pageCount(total); page++) {
      const { words } = KosakataWordsFile.parse(read(wordsFileName((page - 1) * 100 + 1)));
      for (const w of words) {
        expect(wordsFileName(w.rank)).toBe(wordsFileName((page - 1) * 100 + 1));
        for (const s of w.senses) {
          for (const loc of s.ayat) {
            const r = parseAyahLoc(loc);
            expect(r, loc).not.toBeNull();
            const file = KosakataAyatFile.parse(read(ayatFileName(r!.surah)));
            expect(file.ayat.some((e) => e.loc === loc), loc).toBe(true);
          }
        }
      }
    }
  }, 60_000);

  it("names every surah, and the operator's reading of nasiya is there", () => {
    expect(Object.keys(index.names)).toHaveLength(114);
    const nasiya = index.rows.find((r) => r.translit === "nasīa");
    expect(nasiya?.s).toContain("abandon, disregard");
  });
});

describe("paging", () => {
  it("puts ranks on the right page", () => {
    expect(pageOfRank(1)).toBe(1);
    expect(pageOfRank(100)).toBe(1);
    expect(pageOfRank(101)).toBe(2);
    expect(pageRows(index.rows, 2)[0].rank).toBe(101);
    expect(pageRows(index.rows, pageCount(total)).at(-1)?.rank).toBe(total);
  });

  it("treats a bad page or rank as the first page or as no word", () => {
    for (const bad of [undefined, "", "0", "-1", "abc", "1e3", "99999", ["2"]]) expect(parsePage(bad, total)).toBe(1);
    expect(parsePage("2", total)).toBe(2);
    for (const bad of [undefined, "0", "-1", "abc", "1.5", String(total + 1), ["2"]]) expect(parseRank(bad, total)).toBeNull();
    expect(parseRank(String(total), total)).toBe(total);
  });
});

describe("coverage", () => {
  it("climbs to all of the Qur'an, and the milestones are within the list", () => {
    expect(index.rows.at(-1)?.cum).toBe(10000);
    for (const m of MILESTONES) expect(m).toBeLessThanOrEqual(total);
    expect(percent(5750)).toBe(57.5);
    // Measured from QAC 0.4 when the list was built (2026-11-03).
    expect(percent(index.rows[299].cum)).toBe(73.7);
  });
});

describe("search", () => {
  it("folds as the pipeline folded the rows", () => {
    expect(foldSearch("Raḥīm")).toBe("rahim");
    expect(foldSearch("‘ālamīn")).toBe("alamin");
    expect(foldSearch("رَحِيم")).toBe("رحيم");
    expect(foldSearch("ٱللَّه")).toBe(foldSearch("الله"));
  });

  it("finds a word by transliteration, by Arabic and by meaning in either language", () => {
    const first = (q: string) => searchRows(index.rows, q).rows[0]?.translit;
    expect(first("rahim")).toBeTruthy();
    expect(searchRows(index.rows, "tangan").rows.some((r) => r.translit === "yad")).toBe(true);
    expect(searchRows(index.rows, "hand").rows.some((r) => r.translit === "yad")).toBe(true);
    expect(searchRows(index.rows, "يد").rows.some((r) => r.translit === "yad")).toBe(true);
  });

  it("returns most frequent first, capped, and nothing for an empty query", () => {
    const { rows, total: matched } = searchRows(index.rows, "a");
    expect(matched).toBeGreaterThan(rows.length);
    expect(rows).toHaveLength(50);
    expect(rows[0].rank).toBeLessThan(rows[1].rank);
    expect(searchRows(index.rows, "   ").total).toBe(0);
  });
});
