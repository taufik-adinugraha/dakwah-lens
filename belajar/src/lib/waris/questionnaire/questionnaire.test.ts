/**
 * Thin vitest wrapper (plan §10 M2.1–M2.4) over ../checks/questionnaire.ts.
 *
 * CI COUNTS ARE SMALLER THAN THE ACCEPTANCE RUN, BY DESIGN: 800 oracle families for completeness
 * (each compared in both report columns and under all 10 rulesets), 400 «Tidak tahu» runs, 200
 * random termination runs and 200 codec families (about 25 s). The acceptance run is the local
 * script: 12,000 families (≥ 10,000 reports compared under each of the 10 rulesets, the rest are
 * refusals that must match) and 10,000 «Tidak tahu» runs:
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-q-check.ts            (seed 20261010)
 * Same generator, same seed, same checks; the CI run is a prefix of it.
 */
import { describe, expect, it } from "vitest";
import rulesFile from "../../../../content/waris/rules.json";
import {
  Q_DEFAULT_SEED,
  keysRoundTrip,
  runCodecChecks,
  runCompleteness,
  runPathLengths,
  runRefusalRouting,
  runTermination,
  runTextChecks,
  runUnknowns,
} from "../checks/questionnaire";

const CI_COMPLETENESS = 800;
const CI_UNKNOWN = 400;
const CI_TERMINATION = 200;
const CI_CODEC = 200;
const TIMEOUT_MS = 180000;

describe("waris questionnaire model", () => {
  it("copy rules: every key exists; no bare QS/HR, Arabic, review promise or ALL CAPS; why = rule ids with RuleNotes", () => {
    const ids = new Set((rulesFile as unknown as { rules: { rule_id: string }[] }).rules.map((r) => r.rule_id));
    expect(runTextChecks(ids).failures).toEqual([]);
    expect(keysRoundTrip()).toEqual([]);
  });

  it("M2.4 refusal routing: A3 options, engine reasons and per-column refusals reach their page", () => {
    const r = runRefusalRouting();
    expect(r.failures).toEqual([]);
    expect(r.checked).toBeGreaterThan(30);
  });

  it("M2.3 path length: the five common families finish in ≤ 12 screens (13 with a wasiat)", () => {
    const r = runPathLengths();
    expect(r.failures).toEqual([]);
    expect(r.rows.filter((x) => x.max !== null).length).toBeGreaterThanOrEqual(5);
  });

  it(
    `M2.2 termination: ${CI_TERMINATION} random runs with random Kembali / Ubah`,
    () => {
      const r = runTermination({ runs: CI_TERMINATION, seed: Q_DEFAULT_SEED });
      expect(r.failures).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    `codec: ${CI_CODEC} families round-trip; rupiah only when ticked; malformed tokens never throw`,
    () => {
      const r = runCodecChecks({ count: CI_CODEC, seed: Q_DEFAULT_SEED });
      expect(r.failures).toEqual([]);
      expect(r.checked).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it(
    `M2.1 completeness: ${CI_COMPLETENESS} oracle families, both columns and every comparison ruleset`,
    () => {
      const r = runCompleteness({ count: CI_COMPLETENESS, seed: Q_DEFAULT_SEED });
      expect(r.failures.map((f) => `#${f.index} ${f.kind}: ${f.message}`)).toEqual([]);
      expect(Object.keys(r.comparedByRuleset).length).toBe(10);
    },
    TIMEOUT_MS,
  );

  it(
    `M2.1 «Tidak tahu»: ${CI_UNKNOWN} runs, the true reading gives the true outcome, never one "likely" number`,
    () => {
      const r = runUnknowns({ count: CI_UNKNOWN, seed: Q_DEFAULT_SEED + 1 });
      expect(r.failures.map((f) => `#${f.index} ${f.key}: ${f.message}`)).toEqual([]);
      expect(r.exact).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});
