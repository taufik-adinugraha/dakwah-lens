/**
 * The report page's own checks (checks.ts), in CI. The same functions run locally through tsx on
 * larger samples. AI-assisted, not an authoritative fatwa.
 */
import { describe, expect, it } from "vitest";

import dalilJson from "../../../../content/waris/dalil.json";
import gapsJson from "../../../../content/waris/dalil-gaps.json";
import rulesJson from "../../../../content/waris/rules.json";
import idMessages from "../../../../messages/waris/id.json";
import enMessages from "../../../../messages/waris/en.json";
import { PLAN_CASES } from "@/lib/waris/checks/cases";
import { randomFamily } from "@/lib/waris/checks/invariants";
import { Rng } from "@/lib/waris/checks/prng";
import type { ReportDalilRecord, ReportRules } from "@/lib/waris/report";

import { flowProblems, messageProblems, projectionProblems, type Family } from "./checks";

const rules = rulesJson as unknown as ReportRules;
const dalil = [...(dalilJson as unknown as ReportDalilRecord[]), ...(gapsJson as unknown as ReportDalilRecord[])];
const TIMEOUT_MS = 180000;

function families(randomCount: number, seed: number): Family[] {
  const out: Family[] = PLAN_CASES.map((c) => ({ where: c.id, input: c.input, opts: { date: "2026-10-09" } }));
  for (const c of PLAN_CASES) {
    out.push({
      where: `${c.id} +flags`,
      input: c.input,
      opts: { mode: "simulasi", flags: { iddahRaji: true, nikahSiri: true, munasakhat: true, wasiatTidakTahu: true }, notAsked: [{ group: "saudara", because: ["anak_lk"] }] },
    });
  }
  const rng = new Rng(seed);
  for (let i = 0; i < randomCount; i++) out.push({ where: `random#${i}`, input: randomFamily(rng, i) });
  return out;
}

describe("waris report page (plan §6, §9.4)", () => {
  it(
    "P1 the content sent to the browser changes no report and carries no pipeline text",
    () => {
      expect(projectionProblems(rules, dalil, families(150, 20261009))).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "P2 questionnaire answers → report: link round trip, rupiah only when ticked, refusals without numbers",
    () => {
      const r = flowProblems(rules, dalil, 150, 20261010);
      expect(r.problems).toEqual([]);
      expect(r.models).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it("P3 the Report and Track messages keep the copy rules in both locales", () => {
    expect(messageProblems(idMessages, enMessages)).toEqual([]);
  });
});
