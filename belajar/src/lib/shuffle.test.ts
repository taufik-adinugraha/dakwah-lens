import { describe, expect, it } from "vitest";

import { seededShuffle } from "./shuffle";

describe("seededShuffle", () => {
  it("is deterministic for a seed and keeps every item", () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6], "1:2:1");
    expect(seededShuffle([1, 2, 3, 4, 5, 6], "1:2:1")).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("varies with the seed", () => {
    const seeds = ["1:1:1", "1:2:1", "1:3:1", "1:4:1", "1:5:1"];
    const orders = new Set(seeds.map((s) => seededShuffle([1, 2, 3, 4, 5, 6], s).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});
