import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  EXERCISE_GUIDE_PARTS,
  EXERCISE_KEYS,
  GUIDE_PARTS,
  choiceGuidePart,
  guideMarker,
  guideSelector,
  guideTarget,
  parseGuideTarget,
  sortCaseGuidePart,
  tapWordGuidePart,
  type ExerciseKey,
  type GuidePart,
} from "./guide";

const FILES: Record<ExerciseKey, string> = {
  "tap-word": "TapWord.tsx",
  "why-harakat": "WhyHarakat.tsx",
  "sort-case": "SortCase.tsx",
  "label-role": "LabelRole.tsx",
  "wazn-factory": "WaznFactory.tsx",
};

const source = (key: ExerciseKey) => readFileSync(new URL(`./${FILES[key]}`, import.meta.url), "utf8");

describe("guide targets", () => {
  it("name an exercise and a part, and parse back", () => {
    for (const key of EXERCISE_KEYS) {
      for (const part of EXERCISE_GUIDE_PARTS[key]) {
        const target = guideTarget(key, part);
        expect(target).toBe(`exercise:${key}:${part}`);
        expect(parseGuideTarget(target)).toEqual({ key, part });
      }
    }
  });

  it("reject anything an exercise never points at", () => {
    expect(parseGuideTarget("exercise:sort-case:next")).toBeNull();
    expect(parseGuideTarget("exercise:why-harakat:play")).toBeNull();
    expect(parseGuideTarget("exercise:unknown:options")).toBeNull();
    expect(parseGuideTarget("exercise:tap-word:")).toBeNull();
    expect(parseGuideTarget("tap-word:play")).toBeNull();
    expect(parseGuideTarget("")).toBeNull();
  });

  it("every declared part is a known part", () => {
    for (const key of EXERCISE_KEYS) {
      for (const part of EXERCISE_GUIDE_PARTS[key]) expect(GUIDE_PARTS).toContain(part);
    }
  });

  it("select the marked element", () => {
    expect(guideSelector("exercise:tap-word:play")).toBe('[data-guide="exercise:tap-word:play"]');
    expect(guideSelector('a"b')).toBe('[data-guide="a\\"b"]');
  });

  it("are only marked in guided mode", () => {
    expect(guideMarker(undefined, "tap-word")("play")).toBeUndefined();
    expect(guideMarker({}, "tap-word")("play")).toBe("exercise:tap-word:play");
  });
});

describe("what the learner does next", () => {
  const idle = { finished: false, settled: false, canReveal: false };

  it("choose-one exercises: options → reveal after two misses → next → nothing", () => {
    expect(choiceGuidePart(idle)).toBe("options");
    expect(choiceGuidePart({ ...idle, canReveal: true })).toBe("reveal");
    expect(choiceGuidePart({ ...idle, settled: true })).toBe("next");
    expect(choiceGuidePart({ ...idle, finished: true })).toBeNull();
  });

  it("Dengar dan ketuk: play until the word is heard, then the words", () => {
    expect(tapWordGuidePart({ ...idle, heard: false })).toBe("play");
    expect(tapWordGuidePart({ ...idle, heard: true })).toBe("options");
    // Two misses before ever listening: listening comes first.
    expect(tapWordGuidePart({ ...idle, canReveal: true, heard: false })).toBe("play");
    expect(tapWordGuidePart({ ...idle, canReveal: true, heard: true })).toBe("reveal");
    // Answered (even by tapping before listening): Lanjut.
    expect(tapWordGuidePart({ ...idle, settled: true, heard: false })).toBe("next");
    expect(tapWordGuidePart({ ...idle, finished: true, heard: true })).toBeNull();
  });

  it("Kelompokkan: a word, then its group, per word", () => {
    expect(sortCaseGuidePart({ finished: false, selected: false, canReveal: false })).toBe("words");
    expect(sortCaseGuidePart({ finished: false, selected: true, canReveal: false })).toBe("bins");
    expect(sortCaseGuidePart({ finished: false, selected: true, canReveal: true })).toBe("reveal");
    expect(sortCaseGuidePart({ finished: true, selected: false, canReveal: false })).toBeNull();
  });
});

describe("the exercises mark exactly the parts they declare", () => {
  for (const key of EXERCISE_KEYS) {
    it(key, () => {
      const src = source(key);
      expect(src).toContain(`guideMarker(guided, "${key}")`);
      expect(src).toContain(`guideTarget("${key}", part)`);
      const marked = [...src.matchAll(/\bmark\("([a-z]+)"\)/g)].map((m) => m[1] as GuidePart);
      expect([...new Set(marked)].sort()).toEqual([...EXERCISE_GUIDE_PARTS[key]].sort());
    });
  }
});
