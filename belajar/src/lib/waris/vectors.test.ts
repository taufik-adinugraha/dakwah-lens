/**
 * Thin vitest wrapper (plan §10 M1.1): the checks live in ./checks/vectors.ts so that
 * scripts/waris-check.ts runs exactly the same logic locally via tsx.
 */
import { describe, expect, it } from "vitest";
import vectorsFile from "../../../content/waris/test-vectors.json";
import { runPlanCases } from "./checks/cases";
import { DISPUTED, classifyFailures } from "./checks/disputed";
import { runVectorChecks, summarize } from "./checks/vectors";

describe("waris test vectors (content/waris/test-vectors.json)", () => {
  const results = runVectorChecks(vectorsFile);
  const summary = summarize(results);
  const classified = classifyFailures(summary.failures, results);

  it("evaluates every expectation of every vector", () => {
    const file = vectorsFile as unknown as { vectors: { expected: Record<string, unknown> }[] };
    const expectations = file.vectors.reduce((acc, v) => acc + Object.keys(v.expected).length, 0);
    expect(summary.vectors).toBe(file.vectors.length);
    expect(summary.expectations).toBe(expectations);
  });

  it("maps and passes every vector except the documented disputed ones", () => {
    expect(classified.unexpected.map((f) => `${f.vector} [${f.key}]: ${f.problems.join("; ")}`)).toEqual([]);
  });

  it("keeps the disputed list exact (each entry still fails as documented)", () => {
    expect(classified.stale).toEqual([]);
    expect(classified.disputed.length).toBe(DISPUTED.length);
  });

  it("skips only the unimplemented variant substitution=luas, by name", () => {
    expect(summary.skipped.map((x) => `${x.vector} [${x.key}]`)).toEqual(["khi-pengganti-luas-tarjih [standar-indonesia|substitution=luas]"]);
  });
});

describe("plan §4 case studies (docs/waris-plan.md, both columns)", () => {
  it("the engine reproduces every printed amount", () => {
    const r = runPlanCases();
    expect(r.failures).toEqual([]);
    expect(r.checked).toBeGreaterThan(0);
  });
});
