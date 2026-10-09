import { describe, expect, it } from "vitest";

import { getAyah, getSurah, hasDrafts, SURAHS } from "./content";

const fatihah = getSurah("al-fatihah")!;

describe("Al-Fatihah content (build-time invariants)", () => {
  it("has 7 ayat and 29 words (Hafs, Kufan count, basmalah = 1:1)", () => {
    expect(fatihah.ayat).toHaveLength(7);
    expect(fatihah.ayat.map((a) => a.words.length)).toEqual([4, 4, 2, 3, 4, 3, 9]);
  });

  it("numbers words consistently with their ayah", () => {
    for (const a of fatihah.ayat) {
      a.words.forEach((w, i) => expect(w.loc).toBe(`${a.surah}:${a.ayah}:${i + 1}`));
      // The ayah text is the words joined by spaces (verbatim Tanzil tokens).
      expect(a.words.map((w) => w.ar).join(" ")).toBe(a.ar);
    }
  });

  it("times every word once, in order, for every reciter", () => {
    for (const a of fatihah.ayat) {
      for (const r of a.recitation) {
        expect(r.segments.map(([w]) => w)).toEqual(a.words.map((_, i) => i + 1));
        for (const [, s, e] of r.segments) expect(e).toBeGreaterThan(s);
        for (let i = 1; i < r.segments.length; i++) {
          expect(r.segments[i][1]).toBeGreaterThanOrEqual(r.segments[i - 1][2]);
        }
      }
    }
  });

  it("streams recitation and offers the default reciter (Alafasy)", () => {
    for (const a of fatihah.ayat) {
      expect(a.recitation.map((r) => r.reciter)).toContain("Alafasy_128kbps");
      for (const r of a.recitation) expect(r.url).toMatch(/^https:\/\/everyayah\.com\/data\//);
    }
  });

  it("sources every word and every fact", () => {
    for (const w of fatihah.ayat.flatMap((a) => a.words)) expect(w.sources.length).toBeGreaterThan(0);
    for (const f of fatihah.facts) expect(f.sources.length).toBeGreaterThan(0);
  });

  it("never labels a translation as Kemenag 2019 unless it is", () => {
    for (const a of fatihah.ayat) expect(a.translation.source_label).not.toMatch(/2019/);
  });

  it("is still a draft (no ustadz sign-off yet) and getAyah resolves", () => {
    expect(hasDrafts(fatihah)).toBe(true);
    expect(getAyah(fatihah, 5)?.loc).toBe("1:5");
    expect(SURAHS.map((s) => s.slug)).toEqual(["al-fatihah"]);
  });
});
