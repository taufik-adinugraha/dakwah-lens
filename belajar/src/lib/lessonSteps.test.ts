import { describe, expect, it } from "vitest";

import type { Ayah } from "@/content/schema";

import { getAyah, getSurah } from "./content";
import {
  buildLessonSteps,
  captionMs,
  latinSentences,
  MAX_CAPTION,
  splitCaption,
  stripArabic,
  type StepTexts,
} from "./lessonSteps";
import { conceptsIntroducedIn } from "./library";

const T: StepTexts = {
  intro: (n) => `Ayat ${n}`,
  wordIntro: (t) => `Kata: ${t}`,
  meaning: (g) => `Artinya ${g}.`,
  concept: (t, s) => `${t}: ${s}`,
  conceptBrief: (t) => `Konsep ${t}.`,
  structure: (s) => s,
  practice: "Latihan",
  recap: "Sekali lagi",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const surah = getSurah("al-fatihah")!;

/** Exactly `n` characters of plain words, ending in `end`. */
const phrase = (n: number, end = ".", first = "Ini") => {
  let s = first;
  while (s.length < n - 1) s += " kata";
  return `${s.slice(0, n - 1).trimEnd().padEnd(n - 1, "a")}${end}`;
};
/** A sentence of exactly `n` characters ending in a full stop. */
const sentence = (n: number) => phrase(n);

describe("buildLessonSteps", () => {
  const ayah = getAyah(surah, 2)!;
  const steps = buildLessonSteps(ayah, [], T);

  it("opens and closes with the imam reciting the whole ayah", () => {
    expect(steps[0].kind).toBe("recite_ayah");
    expect(steps.at(-1)?.kind).toBe("recite_ayah");
  });

  it("recites then explains every word, in order", () => {
    const words = steps.filter((s) => s.kind === "recite_word");
    expect(words.map((s) => (s.kind === "recite_word" ? s.word : 0))).toEqual([1, 2, 3, 4]);
    ayah.words.forEach((w, i) => {
      const parts = steps.filter((s) => s.kind === "explain" && s.focus === w.loc);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) expect(p.kind === "explain" && p.word).toBe(i + 1);
      expect(norm(parts.map((p) => p.caption).join(" "))).toContain(latinSentences(w.why));
    });
  });

  it("pauses for practice before the recap, and step ids are unique", () => {
    expect(steps.at(-2)?.kind).toBe("practice");
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("never puts Arabic script in a caption (the narrator must not voice Qur'an)", () => {
    for (const a of surah.ayat) {
      for (const s of buildLessonSteps(a, conceptsIntroducedIn(a.loc), T)) {
        expect(s.caption).not.toMatch(/[؀-ۿ]/);
      }
    }
  });

  it("leaves Arabic-script sentences out of captions, keeping the rest", () => {
    const why = "Akhirnya fathah karena menjadi objek. Polanya فَاعِل seperti kata lain.";
    const long: Ayah = { ...ayah, words: ayah.words.map((w, i) => (i === 0 ? { ...w, why } : w)) };
    const [concept] = conceptsIntroducedIn("1:1");
    const arabic = { ...concept, id: "uji", summary: "Wazan ditulis dengan huruf ف ع ل, dan seterusnya." };
    const mixed = { ...concept, id: "uji-2", summary: "Kalimat pertama biasa. Contohnya رَبِّ di ayat ini." };
    const s = buildLessonSteps(long, [arabic, mixed], T);
    for (const x of s) expect(x.caption).not.toMatch(/[؀-ۿ]/);
    expect(s.find((x) => x.id === "w1-meaning")?.caption).toBe(`${T.meaning(ayah.words[0].gloss)} Akhirnya fathah karena menjadi objek.`);
    expect(s.find((x) => x.id === "c-uji")?.caption).toBe(T.conceptBrief(concept.title));
    expect(s.find((x) => x.id === "c-uji-2")?.caption).toBe(T.concept(concept.title, "Kalimat pertama biasa."));
  });

  it("never shows an explanation longer than 180 characters when it can be split", () => {
    for (const a of surah.ayat) {
      for (const s of buildLessonSteps(a, conceptsIntroducedIn(a.loc), T)) {
        if (s.kind === "explain") expect(s.caption.length).toBeLessThanOrEqual(MAX_CAPTION);
      }
    }
  });

  it("splits a long explanation into consecutive steps about the same word", () => {
    const why = [sentence(120), sentence(100), sentence(90)].join(" ");
    const long: Ayah = { ...ayah, words: ayah.words.map((w, i) => (i === 0 ? { ...w, why } : w)) };
    const s = buildLessonSteps(long, [], T);
    const first = s.findIndex((x) => x.kind === "explain" && x.focus === long.words[0].loc);
    const parts = s.filter((x) => x.kind === "explain" && x.focus === long.words[0].loc);
    expect(parts.length).toBe(3);
    // Consecutive, right after the word is recited.
    expect(s[first - 1].kind).toBe("recite_word");
    expect(s.slice(first, first + parts.length)).toEqual(parts);
    for (const p of parts) expect(p.caption.length).toBeLessThanOrEqual(MAX_CAPTION);
    expect(norm(parts.map((p) => p.caption).join(" "))).toBe(norm(`${T.meaning(long.words[0].gloss)} ${why}`));
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
  });

  it("splits a long structure summary the same way", () => {
    const summary = [sentence(150), sentence(150)].join(" ");
    const st = { type: "jumlah ismiyyah", summary, groups: [], sources: [{ kitab: "Test" }], status: "draft" as const };
    const s = buildLessonSteps({ ...ayah, structure: st }, [], T);
    const parts = s.filter((x) => x.id === "structure" || x.id.startsWith("structure:"));
    expect(parts.map((p) => p.caption)).toEqual([sentence(150), sentence(150)]);
  });
});

describe("splitCaption", () => {
  it("leaves a caption of 180 characters or fewer whole", () => {
    const c = sentence(180);
    expect(splitCaption(c)).toEqual([c]);
  });

  it("splits at sentence boundaries into the fewest, most even parts", () => {
    const [a, b, c, d] = [sentence(50), sentence(60), sentence(60), sentence(70)];
    // Two parts are needed (243 characters); 111 + 131 is more even than 172 + 70.
    expect(splitCaption([a, b, c, d].join(" "))).toEqual([`${a} ${b}`, `${c} ${d}`]);
  });

  it("never leaves a short tail alone on a step", () => {
    const [x, y, z] = [phrase(100, ",", "isi"), phrase(60, ",", "isi"), phrase(30, ".", "isi")];
    // One 192-character sentence: greedy packing would give 161 + 30.
    expect(splitCaption(`${x} ${y} ${z}`)).toEqual([x, `${y} ${z}`]);
  });

  it("does not end a sentence at an abbreviation such as Q.S.", () => {
    const text = `${sentence(100)} Lihat Q.S. Al-Baqarah ayat 2 untuk contoh lain yang serupa. ${sentence(100)}`;
    const parts = splitCaption(text);
    expect(parts.some((p) => p.includes("Q.S. Al-Baqarah"))).toBe(true);
    expect(norm(parts.join(" "))).toBe(norm(text));
  });

  it("falls back to commas for a single sentence over 180 characters", () => {
    const one = `${"bagian pertama yang panjang, ".repeat(4)}${"bagian kedua yang juga panjang, ".repeat(3)}lalu selesai.`;
    expect(one.length).toBeGreaterThan(MAX_CAPTION);
    const parts = splitCaption(one);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CAPTION);
    expect(parts[0].endsWith(",")).toBe(true);
    expect(parts.join(" ")).toBe(norm(one));
  });

  it("never cuts at a comma inside brackets", () => {
    const one =
      "Wawu adalah huruf 'athaf, dan iyyāka (mabni di atas fathah, berkedudukan nashab) diulang sebagai objek " +
      "yang didahulukan bagi nasta‘īnu agar makna 'hanya' melekat pada kedua perbuatan, bukan hanya pada yang pertama saja.";
    const parts = splitCaption(one);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(MAX_CAPTION);
      expect(p.split("(").length).toBe(p.split(")").length);
    }
    expect(parts.join(" ")).toBe(one);
  });

  it("splits between words when a clause has no punctuation at all", () => {
    const run = `${"kata ".repeat(80)}akhir.`;
    const parts = splitCaption(run);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_CAPTION);
    expect(parts.join(" ")).toBe(norm(run));
  });
});

describe("stripArabic", () => {
  it("drops Arabic runs from a template part and tidies the spaces (the autoplay captions use it too)", () => {
    const ar = String.fromCharCode(0x0631, 0x064e, 0x0628, 0x0651, 0x0650); // a vocalised word
    expect(stripArabic(`Kata ${ar} , artinya Tuhan`)).toBe("Kata, artinya Tuhan");
    expect(stripArabic("Tanpa huruf Arab.")).toBe("Tanpa huruf Arab.");
  });
});

describe("captionMs", () => {
  it("has a per-pace minimum: 5 s normal, 6 s slow", () => {
    expect(captionMs("a", "biasa")).toBe(5000);
    expect(captionMs("a", "pelan")).toBe(6000);
    expect(captionMs("", "biasa")).toBe(5000);
  });

  it("reads at 10 / 6 characters per second after a settle time", () => {
    const c = "x".repeat(180);
    expect(captionMs(c, "biasa")).toBe(2500 + 18_000);
    expect(captionMs(c, "pelan")).toBe(3000 + 30_000);
  });

  it("has no upper cap: a long caption is never rushed", () => {
    const c = "x".repeat(1000);
    expect(captionMs(c, "biasa")).toBe(102_500);
    expect(captionMs(c, "pelan")).toBe(169_667);
    expect(captionMs(c, "biasa")).toBeGreaterThan(12_000);
  });

  it("is never faster in Pelan than in Biasa", () => {
    for (const n of [0, 20, 60, 180, 600]) {
      const c = "x".repeat(n);
      expect(captionMs(c, "pelan")).toBeGreaterThanOrEqual(captionMs(c, "biasa"));
    }
  });
});
