import { describe, expect, it } from "vitest";

import { getAyah, getSurah } from "./content";
import { buildLessonSteps, captionMs, type StepTexts } from "./lessonSteps";

const T: StepTexts = {
  intro: (n) => `Ayat ${n}`,
  wordIntro: (t) => `Kata: ${t}`,
  meaning: (g) => `Artinya ${g}.`,
  concept: (t, s) => `${t}: ${s}`,
  structure: (s) => s,
  practice: "Latihan",
  recap: "Sekali lagi",
};

describe("buildLessonSteps", () => {
  const ayah = getAyah(getSurah("al-fatihah")!, 2)!;
  const steps = buildLessonSteps(ayah, [], T);

  it("opens and closes with the imam reciting the whole ayah", () => {
    expect(steps[0].kind).toBe("recite_ayah");
    expect(steps.at(-1)?.kind).toBe("recite_ayah");
  });

  it("recites then explains every word, in order", () => {
    const words = steps.filter((s) => s.kind === "recite_word");
    expect(words.map((s) => (s.kind === "recite_word" ? s.word : 0))).toEqual([1, 2, 3, 4]);
    for (const w of ayah.words) {
      expect(steps.some((s) => s.kind === "explain" && s.focus === w.loc && s.caption.includes(w.why))).toBe(true);
    }
  });

  it("pauses for practice before the recap, and step ids are unique", () => {
    expect(steps.at(-2)?.kind).toBe("practice");
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });

  it("never puts Arabic script in a caption (the narrator must not voice Qur'an)", () => {
    for (const s of steps) expect(s.caption).not.toMatch(/[؀-ۿ]/);
  });
});

describe("captionMs", () => {
  it("is bounded to 3–12 s", () => {
    expect(captionMs("a")).toBe(3000);
    expect(captionMs("x".repeat(1000))).toBe(12000);
  });
});
