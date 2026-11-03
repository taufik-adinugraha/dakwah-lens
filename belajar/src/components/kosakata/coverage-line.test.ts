import { describe, expect, it } from "vitest";

import { coverageLine } from "./coverage-line";

const LEVELS = [
  { n: 0, batches: 2 },
  { n: 1, batches: 2 },
  { n: 2, batches: 3 },
  { n: 3, batches: 2 },
];
const passed = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, {}]));
const L1 = ["1-1", "1-2"];
const L2 = ["2-1", "2-2", "2-3"];
const L3 = ["3-1", "3-2"];

describe("coverageLine: what the map may say of the passed batches", () => {
  it("says nothing was passed only when nothing was", () => {
    expect(coverageLine({}, LEVELS)).toEqual({ kind: "none" });
  });

  it("does not call Level 0's parts no test passed, and gives them no figure", () => {
    expect(coverageLine(passed("0-1"), LEVELS)).toEqual({ kind: "first" });
    expect(coverageLine(passed("0-1", "0-2"), LEVELS)).toEqual({ kind: "first" });
  });

  it("names a whole level, whichever one, with or without Level 0", () => {
    expect(coverageLine(passed(...L1), LEVELS)).toEqual({ kind: "level", n: 1 });
    expect(coverageLine(passed("0-1", "0-2", ...L1), LEVELS)).toEqual({ kind: "level", n: 1 });
    expect(coverageLine(passed(...L3), LEVELS)).toEqual({ kind: "level", n: 3 });
  });

  it("names whole levels in a row", () => {
    expect(coverageLine(passed(...L1, ...L2), LEVELS)).toEqual({ kind: "levels", from: 1, to: 2 });
    expect(coverageLine(passed(...L2, ...L3), LEVELS)).toEqual({ kind: "levels", from: 2, to: 3 });
    expect(coverageLine(passed(...L1, ...L2, ...L3), LEVELS)).toEqual({ kind: "levels", from: 1, to: 3 });
  });

  it("speaks of batches partway through a level, or across a gap, where the figure is no level's", () => {
    expect(coverageLine(passed("1-1"), LEVELS)).toEqual({ kind: "batches" });
    expect(coverageLine(passed(...L1, "2-1"), LEVELS)).toEqual({ kind: "batches" });
    expect(coverageLine(passed("1-1", ...L2), LEVELS)).toEqual({ kind: "batches" });
    expect(coverageLine(passed(...L1, ...L3), LEVELS)).toEqual({ kind: "batches" });
  });
});
