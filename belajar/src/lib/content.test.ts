import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SurahContent } from "@/content/schema";

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

  it("times every word once, in order, in the ayah's recitation", () => {
    for (const a of s.ayat) {
      expect(a.recitation, a.loc).toHaveLength(1);
      for (const r of a.recitation) {
        expect(r.segments.map(([w]) => w)).toEqual(a.words.map((_, i) => i + 1));
        for (const [, start, end] of r.segments) expect(end).toBeGreaterThan(start);
        for (let i = 1; i < r.segments.length; i++) {
          expect(r.segments[i][1]).toBeGreaterThanOrEqual(r.segments[i - 1][2]);
        }
      }
    }
  });

  // One imam everywhere, and no reciter setting (operator 2026-10-13, plan L21: "better to use
  // alafasy for all? no need to give option to user to change"). Until then this asked only that
  // Alafasy be AMONG an ayah's reciters (toContain): Husary Mu'allim was the other.
  it("plays this surah's recitation from ONE imam: every ayah has exactly one recitation, Mishary Alafasy's (our copy of EveryAyah's file)", () => {
    const nnn = String(surah).padStart(3, "0");
    for (const a of s.ayat) {
      expect(a.recitation.map((r) => r.reciter), a.loc).toEqual(["Alafasy_128kbps"]);
      const [r] = a.recitation;
      // our unaltered copy, same-origin (operator 2026-10-15: "we copy to our server so latency is minimum")
      expect(r.url).toBe(`/belajar/media/narration/alafasy/${nnn}${String(a.ayah).padStart(3, "0")}.mp3`);
      expect(r.credit).toBe("Recitation: Mishary Rashid Alafasy via EveryAyah.com · Word timings: Collin Fair, quran-align (CC BY 4.0)");
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

// ONE imam everywhere, and no reciter setting (operator 2026-10-13, plan L21: "better to use
// alafasy for all? no need to give option to user to change"). The lessons carry one recitation
// per ayah, and the schema every page is built through (content.ts load()) refuses anything else:
// the faults are planted in a copy of the real file, which itself must pass.
describe("one imam: a second reciter in content is refused (planted faults)", () => {
  type RawAyah = { recitation: { reciter: string; url: string; segments: number[][]; credit: string }[] };
  const file = fileURLToPath(new URL("../../content/al-fatihah.json", import.meta.url));
  const fresh = () => JSON.parse(readFileSync(file, "utf8")) as { ayat: RawAyah[] };
  /** The entry the lessons carried beside the imam's until 2026-10-13, for `ayah`. */
  const husary = (ayah: RawAyah) => ({
    ...ayah.recitation[0],
    reciter: "Husary_Muallim_128kbps",
    url: ayah.recitation[0].url.replace("Alafasy_128kbps", "Husary_Muallim_128kbps"),
    credit: "Recitation: Mahmoud Khalil Al-Husary (Mu'allim) via EveryAyah.com · Word timings: Collin Fair, quran-align (CC BY 4.0)",
  });
  /** The paths the schema objects to ("ayat.0.recitation"), empty when it accepts the file. */
  const refusedAt = (raw: unknown) => {
    const r = SurahContent.safeParse(raw);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("the file as built passes", () => {
    expect(refusedAt(fresh())).toEqual([]);
  });

  it.each([
    ["a second reciter after the imam", (a: RawAyah) => a.recitation.push(husary(a)), "ayat.0.recitation"],
    ["a second reciter before the imam", (a: RawAyah) => a.recitation.unshift(husary(a)), "ayat.0.recitation"],
    ["the imam's own entry twice", (a: RawAyah) => a.recitation.push({ ...a.recitation[0] }), "ayat.0.recitation"],
    ["another reciter in the imam's place", (a: RawAyah) => a.recitation.splice(0, 1, husary(a)), "ayat.0.recitation.0.reciter"],
    ["no recitation at all", (a: RawAyah) => a.recitation.splice(0), "ayat.0.recitation"],
  ])("%s", (_name, plant, where) => {
    const raw = fresh();
    plant(raw.ayat[0]);
    expect(refusedAt(raw)).toContain(where);
  });
});
