/**
 * Thin vitest wrapper (plan §10 M1.2) over ./checks/invariants.ts and ./checks/relevance.ts.
 *
 * CI COUNTS ARE SMALLER THAN THE ACCEPTANCE RUN, BY DESIGN: 2,000 seeded families for each of
 * the three profiles and 500 for each comparison variant (about 15 s), plus 1,000 for the
 * couldAffectOutcome ↔ solve parity. The 20,000-per-ruleset acceptance run is the local script:
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-check.ts            (seed 20261009)
 * Same generator, same seed, same checks; the CI run is a prefix of it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SEED, INVARIANT_RULESETS, runInvariants } from "./checks/invariants";
import { runRelevanceChecks } from "./checks/relevance";
import { PROFILE_IDS } from "./registry";

const CI_COUNT_PROFILE = 2000;
const CI_COUNT_VARIANT = 500;
const CI_COUNT_RELEVANCE = 1000;
const TIMEOUT_MS = 180000;

describe("waris invariants on seeded random families", () => {
  for (const ruleset of INVARIANT_RULESETS) {
    const count = (PROFILE_IDS as readonly string[]).includes(ruleset) ? CI_COUNT_PROFILE : CI_COUNT_VARIANT;
    it(
      `${ruleset}: ${count} families, seed ${DEFAULT_SEED}`,
      () => {
        const report = runInvariants({ count, seed: DEFAULT_SEED, ruleset });
        expect(report.failures.map((f) => `#${f.index} ${f.invariant}: ${f.message}`)).toEqual([]);
        expect(report.hasil).toBeGreaterThan(0);
      },
      TIMEOUT_MS,
    );
  }

  it(
    `couldAffectOutcome ↔ solve parity: ${CI_COUNT_RELEVANCE} families`,
    () => {
      const report = runRelevanceChecks({ count: CI_COUNT_RELEVANCE, seed: DEFAULT_SEED });
      expect(report.failures.map((f) => `#${f.index} ${f.role} [${f.column}]: ${f.message}`)).toEqual([]);
      expect(report.compared).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});
