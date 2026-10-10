/**
 * RuleNotes (plan §10 M1.6): the committed content/waris/rules.json passes assertWarisReferences(),
 * and each planted fault is caught with a readable message. pipeline/test_validate_waris.py plants
 * the same kinds of fault for the Python check.
 */
import { describe, expect, it } from "vitest";

import {
  METHOD_ONLY_RULES,
  assertWarisReferences,
  loadWarisContent,
  warisHasDrafts,
  warisReferenceProblems,
  type WarisContent,
} from "./waris-content";
import { RULE_IDS } from "./waris/registry";

const clean = loadWarisContent();

function note(c: WarisContent, id: string) {
  const n = c.rules.rules.find((x) => x.rule_id === id);
  if (!n) throw new Error(`test setup: no RuleNote ${id}`);
  return n;
}

function problemsAfter(mutate: (c: WarisContent) => void, ruleIds: readonly string[] = RULE_IDS): string[] {
  const c = structuredClone(clean);
  mutate(c);
  return warisReferenceProblems(c, ruleIds);
}

/** [fault, mutation, substring the problem list must contain] */
const FAULTS: [string, (c: WarisContent) => void, string][] = [
  ["a registry rule id has no note", (c) => (c.rules.rules = c.rules.rules.filter((n) => n.rule_id !== "aul")), "engine rule id aul has no RuleNote"],
  ["a note names an id the registry lacks", (c) => (note(c, "fardh.suami_1_2").rule_id = "fardh.paman_1_6"), "is not in the engine registry"],
  ["two notes for one id", (c) => c.rules.rules.push(structuredClone(note(c, "aul"))), "aul has more than one RuleNote"],
  ["an unknown dalil id", (c) => note(c, "fardh.ibu_1_3").dalil.push("Q-4-99"), "names unknown dalil record 'Q-4-99'"],
  ["a rule record cited as dalil", (c) => note(c, "aul").dalil.push("R-awl"), "dalil must cite an evidence or gap record"],
  ["a section pointer cited as dalil", (c) => note(c, "musytarakah").dalil.push("S-AL-UMM-559"), "dalil must cite an evidence or gap record"],
  ["an evidence record cited as dalil_rule", (c) => note(c, "aul").dalil_rule.push("F-FMUIN-35-awl"), "dalil_rule must cite rule records"],
  ["a non-gap record cited as related_gaps", (c) => note(c, "aul").related_gaps.push("Q-4-11"), "related_gaps must cite gap records"],
  [
    "a note with neither dalil nor legal source",
    (c) => {
      const n = note(c, "fardh.suami_1_2");
      n.dalil = [];
      n.legal = [];
    },
    "fardh.suami_1_2: has no dalil and no legal source",
  ],
  [
    "a method block used to dodge the dalil requirement",
    (c) => {
      const n = note(c, "tashih");
      n.dalil = [];
      n.method = { summary_id: "Ini cara menghitung, bukan hukum tersendiri.", source_doc: "docs/waris-research/engine.md §9.3" };
    },
    "a method block is allowed only on",
  ],
  ["the method rule loses its method block", (c) => (note(c, "rupiah.pembulatan").method = null), "rupiah.pembulatan: has no dalil and no legal source"],
  ["a note marked reviewed before sign-off", (c) => (note(c, "aul").status = "reviewed"), "must be draft"],
  ["the file marked reviewed", (c) => (c.rules.meta.status = "reviewed"), "meta.status reviewed"],
  ["Arabic in a summary", (c) => (note(c, "aul").summary_id += " (عول)"), "Arabic script in summary_id"],
  ["Arabic in a reviewer note", (c) => note(c, "aul").reviewer_notes.push("See العول in the source."), "Arabic script in reviewer_notes"],
  [
    "a paraphrase dressed as a quotation",
    (c) => (note(c, "asabah.bin_nafs").summary_id = 'Nabi bersabda "berikan sisa kepada laki-laki terdekat".'),
    "quotation marks",
  ],
  ["a bare QS citation in a summary", (c) => (note(c, "fardh.suami_1_2").summary_id += " Lihat QS 4:12."), "a bare QS/HR citation"],
  ["CAPS emphasis", (c) => (note(c, "mani.anak_tiri").summary_id = note(c, "mani.anak_tiri").summary_id.replace("tidak", "TIDAK")), "ALL-CAPS words"],
  ["a three-sentence summary", (c) => (note(c, "aul").summary_id += " Satu. Dua."), "summary_id must be 1-2 sentences"],
  [
    "a gap-only note that does not say the source is pending",
    (c) => (note(c, "akdariyyah").summary_id = "Kasus khusus ketika ahli warisnya tepat suami, ibu, kakek, dan satu saudara perempuan."),
    "does not say the source is pending",
  ],
  ["a legal cite to an unknown source", (c) => (note(c, "khi.pengganti").legal[0].source = "khi-2099"), "unknown legal source 'khi-2099'"],
  ["an ikhtilaf citing an unknown record", (c) => note(c, "musytarakah").ikhtilaf?.dalil.push("T-NOPE"), "ikhtilaf.dalil names unknown dalil record"],
  ["notes out of registry order", (c) => c.rules.rules.reverse(), "not in the registry order"],
  [
    "a pinned legal source without its sha256",
    (c) => (c.rules.legal_sources[0].pin = { status: "terpasang", sha256: null }),
    "a pinned source needs its sha256",
  ],
];

describe("waris RuleNotes (assertWarisReferences)", () => {
  it("the committed content passes", () => {
    expect(warisReferenceProblems(clean)).toEqual([]);
    expect(() => assertWarisReferences()).not.toThrow();
  });

  it("has exactly one note per engine rule id, in registry order", () => {
    expect(clean.rules.rules.map((n) => n.rule_id)).toEqual([...RULE_IDS]);
  });

  it("every note is a draft and the track counts as unreviewed", () => {
    expect(clean.rules.rules.filter((n) => n.status !== "draft").map((n) => n.rule_id)).toEqual([]);
    expect(warisHasDrafts(clean)).toBe(true);
  });

  it("only the listed method rules rest on a method block", () => {
    const methodNotes = clean.rules.rules.filter((n) => n.method !== null).map((n) => n.rule_id);
    expect(methodNotes).toEqual([...METHOD_ONLY_RULES]);
  });

  it("a registry id added without a note fails", () => {
    expect(problemsAfter(() => undefined, [...RULE_IDS, "catatan.baru"])).toEqual([
      "rules: engine rule id catatan.baru has no RuleNote",
    ]);
  });

  for (const [fault, mutate, expected] of FAULTS) {
    it(`catches: ${fault}`, () => {
      const problems = problemsAfter(mutate);
      expect(problems.some((x) => x.includes(expected))).toBe(true);
    });
  }

  it("assertWarisReferences throws with the problem list", () => {
    const c = structuredClone(clean);
    note(c, "aul").status = "reviewed";
    expect(() => assertWarisReferences(c)).toThrow("Broken waris RuleNotes");
  });

  it("a malformed rules file fails to load", () => {
    const bad = structuredClone(clean.rules) as unknown as { rules: Record<string, unknown>[] };
    bad.rules[0].dalill = ["Q-4-11"];
    expect(() => loadWarisContent({ rules: bad, dalil: clean.dalil, gaps: clean.gaps })).toThrow("rules.json does not match the schema");
  });
});
