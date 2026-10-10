/** Thin vitest wrapper over ./checks/units.ts (frac, rounding, registry, rulesets, hajb, refusals). */
import { describe, expect, it } from "vitest";
import { runUnitChecks } from "./checks/units";

describe("waris engine unit checks", () => {
  it("all pass", () => {
    expect(runUnitChecks()).toEqual([]);
  });
});
