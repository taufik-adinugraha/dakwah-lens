import { describe, expect, it } from "vitest";

import { LIBRARY, TERMS } from "@/lib/library";
import { inkMeasured, inkShift } from "@/lib/markInk";
import { prepareParts, prepareSigns, Scope } from "@/lib/terms";
import { SURAHS } from "@/lib/content";

// Operator 2026-10-12: "the harakat overlaps with the circles, should be inside".
describe("markInk: every sign drawn on a dotted circle is measured", () => {
  it("each Harakat sign (the Harakat page, the Konsep index, the headwords)", () => {
    const harakat = LIBRARY.basics.find((b) => b.id === "harakat")!;
    for (const s of prepareSigns(harakat.signs, TERMS)) {
      expect(inkMeasured(s.mark), `${s.term?.id}: ${s.mark}`).toBe(true);
      // above the tatweel the ink moves down, below it up
      expect(Math.sign(inkShift(s.mark)), s.term?.id).toBe(/[ٍِ]/.test(s.mark) ? -1 : 1);
    }
  });

  it("each letter and vowel a word-parts diagram puts on a circle", () => {
    const words = new Map(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w] as const))));
    let seen = 0;
    for (const p of LIBRARY.parts) {
      const word = words.get(p.loc);
      if (!word) continue;
      for (const c of prepareParts(p, word, new Scope(), TERMS, {}).changes) {
        for (const shown of [c.from, c.to]) {
          if (!shown) continue;
          expect(inkMeasured(shown, c.kind === "letter"), `${p.loc} ${c.kind}: ${shown}`).toBe(true);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
