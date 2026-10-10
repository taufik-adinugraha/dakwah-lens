/**
 * Expectations in test-vectors.json that this engine believes are WRONG, each with evidence.
 * A disputed entry is still reported as a failure; the vitest wrapper asserts that the failures are
 * EXACTLY this list, so a new failure fails CI, and an entry that starts passing (or fails for
 * another reason) is stale. There is no human review (plan §2, operator update 2026-10-09): the
 * operator decides each entry. A vector whose status is "sourced" is never edited to match the engine.
 */
import type { ExpectationResult } from "./vectors";

export interface DisputedEntry {
  vector: string;
  key: string;
  /** The field that disagrees (prefix of the problem string, e.g. "blocked", "base"). */
  field: string;
  evidence: string;
}

// 2026-10-09: hajb-anaklk-cucu and hajb-2anakpr-cucupr-paman [standar-indonesia] (status computed)
// were recomputed by hand and fixed in the vector file (the substitutes are heirs, not blocked).
export const DISPUTED: readonly DisputedEntry[] = [
  {
    vector: "khi-ww-istri-nonmuslim-16K2010",
    key: "standar-indonesia",
    field: "base",
    evidence:
      "Convention, not arithmetic: every share and finalBase 60 match. The file's conventions.base_finalBase define base = " +
      "asal masalah and finalBase = the table after 'aul/radd/tashih (kh-kasus2: base 24, finalBase 96). The as-if solve has " +
      "the mother 1/6 and the widow 1/4 as fardh, so the engine's asal masalah is lcm(6, 4) = 12; the residue 7/12 over 5 units " +
      "(brother 2, three sisters 1 each) needs tashih x5 = 60, which the trace now records (tashih 12 -> 60). The court calls " +
      "60 its 'pokok masalah' (16 K/AG/2010 amar 5, the vector's S1 quote), so the block is a faithful copy of its source and " +
      "stays as written (status sourced: never edited to match the engine). Operator's choice: keep this dispute, or record " +
      "the court's 60 as finalBase only.",
  },
];

export interface Classified {
  disputed: { result: ExpectationResult; entry: DisputedEntry }[];
  unexpected: ExpectationResult[];
  /** Disputed entries that no longer fail exactly as described. */
  stale: DisputedEntry[];
}

/**
 * Split failures into documented disputes and unexpected ones. `checked` = every expectation that
 * was run (pass or fail): an entry is stale only if its expectation was checked and did not fail
 * exactly as documented (a file without that vector makes no entry stale).
 */
export function classifyFailures(failures: readonly ExpectationResult[], checked?: readonly ExpectationResult[]): Classified {
  const disputed: Classified["disputed"] = [];
  const unexpected: ExpectationResult[] = [];
  const used = new Set<DisputedEntry>();
  for (const f of failures) {
    const entry = DISPUTED.find(
      (d) => d.vector === f.vector && d.key === f.key && f.problems.length > 0 && f.problems.every((p) => p.startsWith(`${d.field}:`)),
    );
    if (entry) {
      disputed.push({ result: f, entry });
      used.add(entry);
    } else unexpected.push(f);
  }
  const ran = (d: DisputedEntry) => !checked || checked.some((r) => r.vector === d.vector && r.key === d.key);
  return { disputed, unexpected, stale: DISPUTED.filter((d) => !used.has(d) && ran(d)) };
}
