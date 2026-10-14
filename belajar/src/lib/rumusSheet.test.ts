import { describe, expect, it } from "vitest";

import type { RumusFile } from "@/content/rumus-schema";

import { WORD_INFO } from "./content";
import { CURRICULUM, introOpen } from "./curriculum";
import { DEFAULT_SURAHS } from "./features";
import { RUMUS, rumusProblems } from "./rumus";
import { ayahHref, rumusHref, SURAH_SLUGS } from "./routes";
import { rumusSheet, type Sheet, type SheetStep } from "./rumusSheet";

// THE CHEAT SHEET AS ITS PAGE READS IT (operator 2026-10-13/14: "we can make some 'cheat sheet' to
// explain the rules … of course we need to refer to valid kitab"; docs/belajar-plan.md L32).
// content/rumus.json is the pipeline's (pipeline/test_validate_rumus.py holds the quotes, the term
// rule and the example); here: that the app takes it as it is, in the curriculum's order, and shows
// a step's formula only where its lesson is available — and not otherwise, in no field of the sheet.

const sheet = (published: readonly string[], file: Pick<RumusFile, "steps"> = RUMUS, intro?: boolean) => {
  const set = new Set(published);
  return rumusSheet(file, CURRICULUM, { published: set, intro: intro ?? introOpen(set) });
};
const stepsOf = (s: Sheet) => s.units.flatMap((u) => u.steps);
const byId = (s: Sheet) => new Map(stepsOf(s).map((x) => [x.id, x]));
const lessonOf = (id: string) => CURRICULUM.steps.find((x) => x.id === id)!.lesson;
const slugOfLesson = (lid: string) => CURRICULUM.units.find((u) => u.id === CURRICULUM.lessons.find((l) => l.id === lid)!.unit)?.slug;

describe("the file is the curriculum's: every step, in teaching order, in its lesson", () => {
  it("loads with no problem, and its steps are a subset of the curriculum's in the curriculum's order", () => {
    expect(rumusProblems(RUMUS, CURRICULUM, WORD_INFO)).toEqual([]);
    const order = CURRICULUM.steps.map((s) => s.id);
    const have = RUMUS.steps.map((e) => e.step);
    expect(have).toEqual(order.filter((id) => have.includes(id)));
    for (const e of RUMUS.steps) expect(e.lesson, e.step).toBe(lessonOf(e.step));
    // 29 of 36: the other seven have no kitab sentence the pipeline could pin (docs/belajar-research/rumus-singkat.md).
    expect(have).toHaveLength(29);
    expect(order.filter((id) => !have.includes(id)).sort()).toEqual(
      ["harakat", "istifham", "istitsna", "isim-maushul", "la-nafi", "mudzakkar-muannats", "murab-mabni"].sort(),
    );
  });

  it("refuses a file that is not (a step that is not there, one out of order, an example in another lesson)", () => {
    const e = RUMUS.steps[1];
    expect(rumusProblems({ ...RUMUS, steps: [{ ...e, step: "tidak-ada" }] }, CURRICULUM, WORD_INFO).join()).toContain("no such step");
    expect(rumusProblems({ ...RUMUS, steps: [RUMUS.steps[2], RUMUS.steps[1]] }, CURRICULUM, WORD_INFO).join()).toContain("teaching order");
    expect(rumusProblems({ ...RUMUS, steps: [{ ...e, lesson: "1:2" }] }, CURRICULUM, WORD_INFO).join()).toContain("is not the step's lesson");
    expect(rumusProblems({ ...RUMUS, steps: [{ ...e, example: { loc: "1:2:1" } }] }, CURRICULUM, WORD_INFO).join()).toContain("is not in the step's lesson");
    expect(rumusProblems({ ...RUMUS, steps: [{ ...e, example: { loc: "9:9:9" } }] }, CURRICULUM, WORD_INFO).join()).toContain("not a word of any lesson");
    expect(rumusProblems({ ...RUMUS, steps: [{ ...e, rumus: "kita pelajari {{di:idhafah}}" }] }, CURRICULUM, WORD_INFO).join()).toContain("unresolved pointer");
    expect(rumusProblems({ ...RUMUS, steps: [e, e] }, CURRICULUM, WORD_INFO).join()).toContain("listed twice");
  });
});

describe("what the page may show: the lesson must be available (the curriculum page's own rule)", () => {
  it("as production runs (Al-Fatihah only): its steps and lesson zero's are shown, every other step is named and locked", () => {
    const s = sheet(DEFAULT_SURAHS);
    const by = byId(s);
    expect(s.steps).toBe(CURRICULUM.steps.length);
    expect(s.shown + s.none + s.locked).toBe(s.steps);
    for (const step of CURRICULUM.steps) {
      const x = by.get(step.id)!;
      const slug = slugOfLesson(step.lesson);
      const open = step.lesson === "0" || (slug !== undefined && DEFAULT_SURAHS.includes(slug));
      const has = RUMUS.steps.some((e) => e.step === step.id);
      expect(x.state, step.id).toBe(!open ? "locked" : has ? "shown" : "none");
    }
    // 15 + 1 formulas of lesson zero and Al-Fatihah; "harakat" and two of Al-Fatihah have none.
    expect([s.shown, s.none]).toEqual([16, 3]);
    expect(s.locked).toBe(CURRICULUM.steps.filter((x) => x.lesson !== "0" && slugOfLesson(x.lesson) !== "al-fatihah").length);
  });

  it("a locked step carries nothing of the file: no formula, no limit, no example, no source — anywhere in the sheet", () => {
    const s = sheet(DEFAULT_SURAHS);
    const text = JSON.stringify(s);
    for (const x of stepsOf(s).filter((y) => y.state === "locked")) {
      expect(Object.keys(x).sort(), x.id).toEqual(["id", "kind", "lesson", "n", "name", "state"]);
      const e = RUMUS.steps.find((r) => r.step === x.id);
      if (!e) continue;
      expect(text, x.id).not.toContain(e.rumus);
      for (const src of e.sumber) for (const q of src.quotes) {
        // A sentence that is (part of) one a shown step quotes is that step's, not a leak.
        const shownQuotes = stepsOf(s).filter((y) => y.state === "shown").flatMap((y) => (y.sumber ?? []).flatMap((z) => z.quotes));
        if (shownQuotes.some((sq) => sq.includes(q))) continue;
        expect(text, `${x.id} ${src.page}`).not.toContain(q);
      }
    }
    // A hidden surah's words do not even come in by an example's link.
    for (const slug of SURAH_SLUGS.filter((x) => !DEFAULT_SURAHS.includes(x))) expect(text).not.toContain(`/quran/${slug}`);
  });

  it("publishing a surah is one switch more, nothing else; hiding the host hides lesson zero's formula", () => {
    const all = sheet(SURAH_SLUGS);
    expect(all.locked).toBe(CURRICULUM.steps.filter((x) => slugOfLesson(x.lesson) === undefined && x.lesson !== "0").length);
    for (const step of all.units.flatMap((u) => u.steps).filter((x) => x.state === "shown")) {
      expect(RUMUS.steps.some((e) => e.step === step.id)).toBe(true);
    }
    const nothing = sheet([]);
    expect(nothing.shown).toBe(0);
    expect(nothing.locked).toBe(CURRICULUM.steps.length - 0);
    // Lesson zero follows the introduction's rule: written, and the surah that hosts it published.
    expect(byId(sheet(["an-nas"])).get("kalimah")!.state).toBe("locked");
    expect(byId(sheet(DEFAULT_SURAHS)).get("kalimah")!.state).toBe("shown");
    expect(byId(sheet(DEFAULT_SURAHS, RUMUS, false)).get("kalimah")!.state).toBe("locked");
  });

  it("a step of an available lesson with no formula says so (not locked, not shown)", () => {
    const x = byId(sheet(DEFAULT_SURAHS)).get("harakat")!;
    expect(x.state).toBe("none");
    expect(x.rumus).toBeUndefined();
    expect(byId(sheet(DEFAULT_SURAHS)).get("murab-mabni")!.state).toBe("none");
  });
});

describe("a shown step: formula, one example, limit and basis, each the file's", () => {
  const s = sheet(SURAH_SLUGS);
  const shown = stepsOf(s).filter((x): x is SheetStep & { rumus: string } => x.state === "shown");

  it("is in the curriculum's order, under its unit, by the name the lesson card shows", () => {
    expect(s.units.map((u) => u.id)).toEqual(CURRICULUM.units.map((u) => u.id).filter((id) => s.units.some((x) => x.id === id)));
    const order = CURRICULUM.steps.map((x) => x.id);
    const ids = stepsOf(s).map((x) => x.id);
    expect(ids).toEqual(order);
    for (const x of stepsOf(s)) expect(x.name, x.id).toBe(CURRICULUM.steps.find((y) => y.id === x.id)!.name);
  });

  it("carries the file's formula, limit and sources byte for byte", () => {
    for (const x of shown) {
      const e = RUMUS.steps.find((r) => r.step === x.id)!;
      expect([x.rumus, x.awas, x.sumber], x.id).toEqual([e.rumus, e.awas, e.sumber]);
      expect(x.sumber!.length, x.id).toBeGreaterThan(0);
    }
  });

  it("gives ONE example: the word's loc, its ayah's page through the route helper, with its word's card", () => {
    const withExample = shown.filter((x) => x.example);
    expect(withExample.length).toBeGreaterThan(15);
    for (const x of withExample) {
      const ex = x.example!;
      const [su, ay] = ex.loc.split(":").map(Number);
      expect(ex.surah, x.id).toBe(su);
      expect(ex.ayah, x.id).toBe(ay);
      expect(ex.href, x.id).toBe(ayahHref(CURRICULUM.units.find((u) => u.surah === su && u.slug)!.slug!, ay, ex.loc));
      expect(WORD_INFO[ex.loc], x.id).toBeDefined();
    }
    const by = byId(s);
    expect(by.get("majrur")!.example!.href).toBe("/quran/al-fatihah/1#w-1-1-1");
    expect(by.get("kana")!.example!.href).toBe("/quran/al-ikhlas/4#w-112-4-2");
    // Lesson zero and the steps whose lesson has no ayah on disk have none.
    for (const id of ["kalimah", "zharaf", "mutsanna"]) expect(by.get(id)!.example, id).toBeUndefined();
  });

  it("says no number or name of its own: the route is the helper's", () => {
    expect(rumusHref()).toBe("/quran/rumus");
  });
});
