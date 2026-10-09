/**
 * Thin vitest wrapper (plan §10 M2.7–M2.8, M2.12) over ../checks/report.ts, so that
 * scripts/waris-r-check.ts runs exactly the same checks locally via tsx:
 *   cd belajar && npx --yes tsx@4.19.2 scripts/waris-r-check.ts            (2,000 random families)
 * CI uses 300 random families (same generator and seed; the CI run is a prefix of the local one).
 * Plus a few plan-anchored assertions (the numbers plan §2 and §4 print), snapshot-free.
 */
import { describe, expect, it } from "vitest";
import dalilJson from "../../../../content/waris/dalil.json";
import gapsJson from "../../../../content/waris/dalil-gaps.json";
import rulesJson from "../../../../content/waris/rules.json";
import vectorsJson from "../../../../content/waris/test-vectors.json";
import { PLAN_CASES } from "../checks/cases";
import { messageTableProblems, runPlantedFaults, runReportChecks } from "../checks/report";
import { buildReport } from "./build";
import { NEVER_SHOWN, type ReportDalilRecord, type ReportRules } from "./content";
import { recordString, translationOf } from "./dalil";
import { renderMsg } from "./messages";
import { PRIMARY, SPANS, fnv1a } from "./primary";
import { buildTextSummary } from "./summary";
import { fractionWords, parseFractionWords } from "./words";
import { frac } from "../frac";

const rules = rulesJson as unknown as ReportRules;
const dalil = [...(dalilJson as unknown as ReportDalilRecord[]), ...(gapsJson as unknown as ReportDalilRecord[])];
const CI_RANDOM = 300;
const TIMEOUT_MS = 180000;

const caseInput = (id: string) => {
  const c = PLAN_CASES.find((x) => x.id === id);
  if (!c) throw new Error(`no plan case ${id}`);
  return c.input;
};

describe("waris report view-model (plan §6)", () => {
  it(
    `every vector, its flag / not-asked / «Tidak tahu» variants and ${CI_RANDOM} random families pass R1–R11`,
    () => {
      const s = runReportChecks({ vectors: vectorsJson, rules, dalil, randomCount: CI_RANDOM });
      expect(s.failures.map((f) => `${f.where} [${f.check}] ${f.message}`)).toEqual([]);
      expect(s.byKind.laporan).toBeGreaterThan(0);
      expect(s.byKind.differs).toBeGreaterThan(0);
      expect(s.byKind.bunuh).toBeGreaterThan(0);
      expect(s.unknownCases.changing).toBeGreaterThan(0);
      expect(s.unknownCases.doubleRefused).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );

  it("every planted fault is caught by the check it targets", () => {
    const missed = runPlantedFaults(rules, dalil, PLAN_CASES).filter((p) => !p.caught);
    expect(missed.map((p) => `${p.name}: expected ${p.expect}, got [${p.checks.join(", ")}]`)).toEqual([]);
  });

  it("the message table keeps the copy rules", () => {
    expect(messageTableProblems()).toEqual([]);
  });

  it("fraction words round-trip", () => {
    for (const [n, d, w] of [
      [1, 8, "seperdelapan"],
      [2, 3, "dua pertiga"],
      [1, 2, "setengah"],
      [7, 40, "tujuh perempat puluh"],
      [13, 24, "tiga belas perdua puluh empat"],
      [1, 1, "seluruhnya"],
    ] as const) {
      expect(fractionWords(frac(n, d))).toBe(w);
      const back = parseFractionWords(w);
      expect(`${back.n}/${back.d}`).toBe(`${n}/${d}`);
    }
  });
});

describe("plan-anchored numbers", () => {
  it("case 8 (daughter + full sister): the court column differs only by 86 K/AG/1994", () => {
    const m = buildReport(caseInput("kasus-8"), rules, dalil);
    const rows = m.catatan?.diff?.rows ?? [];
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.switches).toEqual(["daughtersExcludeSiblings"]);
    expect(m.kepala.title.key).toBe("laporan.kepala.judul");
    expect(renderMsg(m.kepala.title)).toBe("Rekomendasi Pembagian Waris");
  });

  it("case 10 (adopted son): the court column takes a ceiling of 1/3 first; wife 1/4 → 1/6 of the estate after debts", () => {
    const m = buildReport(caseInput("kasus-10"), rules, dalil);
    const ww = m.ringkasan?.preLines.find((p) => p.kind === "wasiat_wajibah");
    expect(ww?.court?.frac.figure).toBe("1/3");
    expect(ww?.court?.note?.key).toBe("laporan.baris.ww_plafon");
    const wife = m.catatan?.diff?.rows.find((r) => r.personIds.includes("istri"));
    expect([wife?.fikih.total?.figure, wife?.court.total?.figure]).toEqual(["1/4", "1/6"]);
  });

  it("case 11 (non-Muslim daughter): the as-if illustration leads with the after-debts share; each son 7/20", () => {
    const m = buildReport(caseInput("kasus-11"), rules, dalil);
    expect(m.ringkasan?.columns.court.basis).toBe("setelah_utang");
    const sons = m.ringkasan?.rows.find((r) => r.role === "anak_lk");
    expect(sons?.court?.linePerHead?.figure).toBe("7/20");
  });

  it("case 12 (wife + daughter): the D7 line gives the wife 1/5 when judges also return the residue to her", () => {
    const m = buildReport(caseInput("kasus-12"), rules, dalil);
    expect(m.catatan?.raddNote?.court.alt.figure).toBe("1/5");
  });

  it("the text summary carries rupiah only when ticked, and never a review promise", () => {
    const m = buildReport(caseInput("kasus-3"), rules, dalil, { date: "2026-10-09" });
    const plain = buildTextSummary(m) ?? "";
    const withRp = buildTextSummary(m, { includeRupiah: true }) ?? "";
    expect(plain).not.toMatch(/Rp\s/);
    expect(withRp).toMatch(/Rp 340\.000\.000/);
    for (const t of [plain, withRp]) {
      expect(t).toContain("Bukan fatwa dan bukan penetapan pengadilan");
      expect(t.toLowerCase()).not.toContain("tinjauan ustadz");
    }
  });

  it("a reported killing yields reasons only: no numbers, no print, no text summary", () => {
    const input = caseInput("kasus-1");
    const family = JSON.parse(JSON.stringify(input.family)) as typeof input.family;
    family.children[0].bars = ["membunuh_tanpa_putusan"];
    const m = buildReport({ family }, rules, dalil);
    expect(m.kind).toBe("rujuk");
    expect(m.printAllowed).toBe(false);
    expect(buildTextSummary(m)).toBeNull();
    expect(JSON.stringify(m)).not.toMatch(/"t":"(frac|rp|tabel)"/);
  });
});

describe("print: the primary dalil clause of each row (report/primary.ts, plan §6 Print and PDF)", () => {
  const records = new Map(dalil.map((r) => [r.id, r] as const));
  const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

  it("every span still cuts the exact words it was chosen for (checksums), from a shown record", () => {
    for (const [key, s] of Object.entries(SPANS)) {
      const r = records.get(s.recordId);
      expect(r, key).toBeDefined();
      if (!r) continue;
      expect(NEVER_SHOWN[s.recordId], key).toBeUndefined();
      const field = r[s.field];
      expect(typeof field, `${key} ${s.field}`).toBe("string");
      const ar = typeof field === "string" ? field.slice(s.ar.start, s.ar.end) : "";
      expect(fnv1a(ar), `${key}: Arabic slice`).toBe(s.ar.check);
      expect(/\s[0-9]+\u200f/.test(ar), `${key}: a Bulugh editor marker in the slice`).toBe(false);
      if ("tr" in s) {
        const tr = translationOf(r);
        const full = tr ? recordString(r, tr.path) : null;
        expect(full, `${key}: translation`).not.toBeNull();
        const words = (full ?? "").slice(s.tr.start, s.tr.end);
        expect(fnv1a(words), `${key}: translation slice`).toBe(s.tr.check);
        expect(ARABIC.test(words), `${key}: Arabic script in the translation slice`).toBe(false);
      }
    }
  });

  it("a clause is offered only for a rule whose RuleNote cites its record", () => {
    for (const [ruleId, specs] of Object.entries(PRIMARY)) {
      const note = rules.rules.find((n) => n.rule_id === ruleId);
      expect(note, ruleId).toBeDefined();
      for (const s of specs ?? []) expect(note?.dalil ?? [], `${ruleId} → ${s.span.recordId}`).toContain(s.span.recordId);
    }
  });

  it("case 3: the estate steps and each heir print one clause (QS 4:11 debts, 4:12 wife, Muslim 1615a son, 4:11 daughter, 4:11 mother)", () => {
    const m = buildReport(caseInput("kasus-3"), rules, dalil, { date: "2026-10-09" });
    const rows = [m.dalil?.sebelum ?? null, ...(m.dalil?.rows ?? [])];
    expect(rows.map((r) => r?.primary?.id ?? null)).toEqual(["Q-4-11", "Q-4-12", "H-MUSLIM-1615a", "Q-4-11", "Q-4-11"]);
    expect(rows.map((r) => r?.primary?.first)).toEqual([true, true, true, true, true]);
    // the son's hadith prints its matn only: the slice starts after the isnad
    const son = rows[2]?.primary;
    expect(son?.cut.start).toBe(true);
    expect(son?.meaning?.label.key).toBe("laporan.dalil.label_muslim");
    expect(m.dalil?.tidakMendapat?.primary ?? null).toBeNull();
  });
});
