import { describe, expect, it } from "vitest";

import { getAyah, getSurah, hasDrafts, SURAHS } from "./content";

const fatihah = getSurah("al-fatihah")!;

type Expected = { slug: string; surah: number; name: string; words: number[] };

/** Every surah with a lesson: number, ayat and words per ayah (Hafs, Kufan count). */
const EXPECTED: Expected[] = [
  { slug: "al-fatihah", surah: 1, name: "Al-Fatihah", words: [4, 4, 2, 3, 4, 3, 9] },
  { slug: "al-ikhlas", surah: 112, name: "Al-Ikhlas", words: [4, 2, 4, 5] },
  { slug: "al-falaq", surah: 113, name: "Al-Falaq", words: [4, 4, 5, 5, 5] },
  { slug: "an-nas", surah: 114, name: "An-Nas", words: [4, 2, 2, 4, 5, 3] },
];

describe("Al-Fatihah content (build-time invariants)", () => {
  it("has 7 ayat and 29 words (Hafs, Kufan count, basmalah = 1:1)", () => {
    expect(fatihah.ayat).toHaveLength(7);
    expect(fatihah.ayat.map((a) => a.words.length)).toEqual([4, 4, 2, 3, 4, 3, 9]);
  });

  it("never labels a translation as Kemenag 2019 unless it is", () => {
    for (const a of fatihah.ayat) expect(a.translation.source_label).not.toMatch(/2019/);
  });

  it("is still a draft (pipeline state; no human review, plan L11) and getAyah resolves", () => {
    expect(hasDrafts(fatihah)).toBe(true);
    expect(getAyah(fatihah, 5)?.loc).toBe("1:5");
  });
});

describe("the surahs with a lesson", () => {
  it("are Al-Fatihah and Al-Mu'awwidzat, in mushaf order", () => {
    expect(SURAHS.map((s) => s.slug)).toEqual(EXPECTED.map((e) => e.slug));
    expect(SURAHS.map((s) => s.surah)).toEqual(EXPECTED.map((e) => e.surah));
    expect(SURAHS.map((s) => s.name_id)).toEqual(EXPECTED.map((e) => e.name));
  });
});

describe.each(EXPECTED)("$name content (build-time invariants)", ({ slug, surah, words }) => {
  const s = getSurah(slug)!;

  it(`has ${words.length} ayat and ${words.reduce((n, w) => n + w, 0)} words`, () => {
    expect(s.surah).toBe(surah);
    expect(s.ayat.map((a) => a.ayah)).toEqual(words.map((_, i) => i + 1));
    expect(s.ayat.map((a) => a.words.length)).toEqual(words);
    expect(s.name_ar.length).toBeGreaterThan(0);
  });

  it("numbers words consistently with their ayah", () => {
    for (const a of s.ayat) {
      expect(a.surah).toBe(surah);
      expect(a.loc).toBe(`${surah}:${a.ayah}`);
      a.words.forEach((w, i) => expect(w.loc).toBe(`${a.surah}:${a.ayah}:${i + 1}`));
      // The ayah text is the words joined by spaces (verbatim Tanzil tokens; the
      // surah-heading basmalah Tanzil prepends to ayah 1 is not part of the ayah).
      expect(a.words.map((w) => w.ar).join(" ")).toBe(a.ar);
    }
  });

  it("times every word once, in order, for every reciter", () => {
    for (const a of s.ayat) {
      for (const r of a.recitation) {
        expect(r.segments.map(([w]) => w)).toEqual(a.words.map((_, i) => i + 1));
        for (const [, start, end] of r.segments) expect(end).toBeGreaterThan(start);
        for (let i = 1; i < r.segments.length; i++) {
          expect(r.segments[i][1]).toBeGreaterThanOrEqual(r.segments[i - 1][2]);
        }
      }
    }
  });

  it("streams this surah's recitation and offers the default reciter (Alafasy)", () => {
    const nnn = String(surah).padStart(3, "0");
    for (const a of s.ayat) {
      expect(a.recitation.map((r) => r.reciter)).toContain("Alafasy_128kbps");
      for (const r of a.recitation) {
        expect(r.url).toBe(
          `https://everyayah.com/data/${r.reciter}/${nnn}${String(a.ayah).padStart(3, "0")}.mp3`,
        );
      }
    }
  });

  it("sources every word, structure and fact, and gives every word a role", () => {
    for (const a of s.ayat) {
      expect(a.structure?.sources.length ?? 0).toBeGreaterThan(0);
      for (const w of a.words) {
        expect(w.sources.length).toBeGreaterThan(0);
        expect(w.role).toBeTruthy();
      }
    }
    for (const f of s.facts) expect(f.sources.length).toBeGreaterThan(0);
  });

  it("labels the translation exactly as QuranEnc names it (never Kemenag 2019)", () => {
    for (const a of s.ayat) {
      expect(a.translation.source_label).toBe(fatihah.ayat[0].translation.source_label);
      expect(a.translation.source_label).not.toMatch(/2019/);
    }
  });

  it("is still a draft (pipeline state; no human review, plan L11) and getAyah resolves", () => {
    expect(hasDrafts(s)).toBe(true);
    for (const a of s.ayat) {
      expect(a.status).toBe("draft");
      for (const w of a.words) expect(w.status).toBe("draft");
    }
    for (const f of s.facts) expect(f.status).toBe("draft");
    for (const h of s.hadith) expect(h.status).toBe("draft");
    expect(getAyah(s, words.length)?.loc).toBe(`${surah}:${words.length}`);
    expect(getAyah(s, words.length + 1)).toBeUndefined();
  });
});
