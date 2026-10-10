/**
 * CI-only: the plan that scripts/ci/waris-e2e.mjs drives through the REAL built image
 * (docs/waris-plan.md §10 M2.6 end-to-end, M2.9 print, M2.10 reduced motion). Pure TypeScript:
 * no React, no next, no network, no clock, no LLM. Runnable without npm install:
 *
 *   cd belajar && npx --yes tsx@4.19.2 scripts/ci/waris-e2e-plan.ts --out /tmp/waris-plan.json [--vectors f.json]
 *
 * 1. For each end-to-end case (a simple family, an 'aul family, a radd family, and case 3 for the
 *    print check) it answers the questionnaire MODEL (lib/waris/questionnaire: view/reduce, the
 *    same calls HitungApp dispatches) from the test vector's family, and records every screen as
 *    a declarative step: the node key the screen must show (a DOM probe), what to tick, how many
 *    stepper taps. The browser script only follows these steps, so the UI path is checked against
 *    the model path screen by screen.
 * 2. Before anything reaches a browser it checks, through the same computeReport() the report page
 *    runs, that those answers give the vector's expected shares: every fikih data-share (the
 *    leading column, D2 = A), the court cells exactly where the columns differ, and case 3's rupiah.
 *    A planning mistake fails HERE with the vector's numbers, not as a browser timeout.
 * 3. It lists every other vector the questionnaire can express (plain heir counts, KHI
 *    predeceased children) with its share-link token (#j=, codec.ts) and the same checked
 *    expectations, for the share-link pass and the print-length survey (M2.9: "the longest report
 *    in the vector set is measured and recorded"). Vectors it cannot express are listed by name
 *    with the reason, never silently dropped.
 *
 * Expected values come from content/waris/test-vectors.json (sourced/rule/computed fractions),
 * never from the model under test. AI-assisted, not an authoritative fatwa.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeReport } from "../../src/components/waris/report/compute";
import { FORBIDDEN_REVIEW } from "../../src/lib/waris/checks/report";
import { HEIRS } from "../../src/lib/waris/registry";
import {
  TIDAK_TAHU,
  initialState,
  reduce,
  screenCount,
  shareToken,
  view,
  type Amounts,
  type AnswerValue,
  type Answers,
  type LP,
  type NodeId,
  type NodeView,
  type QState,
} from "../../src/lib/waris/questionnaire";
import { REPORT_MESSAGES, type CellView, type ColumnHead, type ReportDalilRecord, type ReportRules } from "../../src/lib/waris/report";

const here = dirname(fileURLToPath(import.meta.url));
const BELAJAR = resolve(here, "../..");
const readJson = (rel: string): unknown => JSON.parse(readFileSync(resolve(BELAJAR, rel), "utf8"));

const args = process.argv.slice(2);
const outPath = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : undefined;
})();
const verbose = args.includes("--verbose");
/** `--vectors <file>`: another vector file (planted-fault runs); default content/waris/test-vectors.json. */
const vectorsPath = (() => {
  const i = args.indexOf("--vectors");
  return i >= 0 ? resolve(process.cwd(), args[i + 1]) : resolve(BELAJAR, "content/waris/test-vectors.json");
})();

// ---------------------------------------------------------------------------------------------
// Content (the same files the image bakes in)
// ---------------------------------------------------------------------------------------------

interface VectorExpectation {
  shares?: Record<string, string>;
  rujuk?: string[];
  input_override?: unknown;
  rupiah?: Record<string, number>;
}
interface Vector {
  id: string;
  input: {
    deceasedSex: "L" | "P";
    heirs?: Record<string, number>;
    estate?: Record<string, unknown>;
    predeceasedChildren?: { sex: "L" | "P"; children: { L: number; P: number } }[];
    [k: string]: unknown;
  };
  expected: Record<string, VectorExpectation>;
}

const vectors = (JSON.parse(readFileSync(vectorsPath, "utf8")) as { vectors: Vector[] }).vectors;
const rules = readJson("content/waris/rules.json") as ReportRules;
const dalil = [
  ...(readJson("content/waris/dalil.json") as ReportDalilRecord[]),
  ...(readJson("content/waris/dalil-gaps.json") as ReportDalilRecord[]),
];
const messagesId = readJson("messages/waris/id.json") as { Report?: { ui?: Record<string, string> } };

/** A fixed report date: nothing here reads the clock. */
const DATE = "2026-10-09";
const FIKIH = "klasik-syafii";
const COURT = "standar-indonesia";
const HEIR_IDS: ReadonlySet<string> = new Set<string>(HEIRS);

// ---------------------------------------------------------------------------------------------
// The end-to-end cases (M2.6: a simple family, an 'aul family, a radd family; M2.9: case 3)
// ---------------------------------------------------------------------------------------------

interface CaseSpec {
  name: string;
  vector: string;
  why: string;
  /** Answers the vector's heir list cannot carry (case 3's bequest). */
  overrides?: Partial<Record<NodeId, AnswerValue>>;
  /** Typed into the report's "Isi nilai harta" panel by the browser script. */
  amounts?: Amounts;
}

const big = (s: string) => BigInt(s);

const E2E: readonly CaseSpec[] = [
  {
    name: "sederhana",
    vector: "kasus-01-keluarga-inti",
    why: "simple family: wife, 2 sons, 1 daughter (plan §5.5 common family 1)",
  },
  {
    name: "aul",
    vector: "aul-24-27-minbariyyah",
    why: "'aul 24 → 27: wife, 2 daughters, father, mother (plan §5.5 common family 3)",
  },
  {
    name: "radd",
    vector: "kasus-04-radd-anakpr-ibu",
    why: "radd: a daughter and the mother only (plan §4 case 4)",
  },
  {
    name: "kasus3",
    vector: "kasus-03-gonogini-utang-wasiat",
    why: "case 3, the print-length target (plan §6 'Print and PDF'): harta bersama, debts, a bequest to a mosque",
    overrides: { G1: ["lain"], G3: "nilai_tertentu", G4: "setuju" },
    amounts: {
      hartaBersama: big("1000000000"),
      hartaBawaan: big("300000000"),
      biayaJenazah: big("12000000"),
      utang: big("48000000"),
      wasiatLain: big("20000000"),
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Vector family → questionnaire answers (an oracle for plain families)
// ---------------------------------------------------------------------------------------------

/** Heirs the oracle can enter through the questionnaire's own questions. */
const ENTERABLE: ReadonlySet<string> = new Set([
  "istri",
  "suami",
  "anak_lk",
  "anak_pr",
  "ayah",
  "ibu",
  "kakek",
  "nenek_ibu",
  "nenek_ayah",
  "sdr_lk_kandung",
  "sdr_pr_kandung",
  "sdr_lk_seayah",
  "sdr_pr_seayah",
  "sdr_lk_seibu",
  "sdr_pr_seibu",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
]);

interface Fam {
  sex: "L" | "P";
  heirs: Record<string, number>;
  predeceased: { sex: "L" | "P"; L: number; P: number }[];
}

/** The family a vector describes, or why the questionnaire cannot express it. */
function familyOf(v: Vector, spec?: CaseSpec): Fam | string {
  const inp = v.input;
  for (const k of Object.keys(inp)) {
    if (k === "deceasedSex" || k === "heirs" || k === "assumptions" || k === "predeceasedChildren") continue;
    if (k === "estate") {
      const extra = Object.keys(inp.estate ?? {}).filter((e) => e !== "netEstate");
      if (extra.length > 0 && !spec?.amounts) return `estate.${extra.join("/")} needs the rupiah panel`;
      continue;
    }
    return `input.${k} is not a plain family`;
  }
  const heirs = inp.heirs ?? {};
  for (const h of Object.keys(heirs)) if (!ENTERABLE.has(h)) return `heir ${h} is entered only through a predeceased parent`;
  const predeceased = (inp.predeceasedChildren ?? []).map((c) => ({ sex: c.sex, L: c.children.L, P: c.children.P }));
  return { sex: inp.deceasedSex, heirs, predeceased };
}

function answerFor(node: NodeView, f: Fam, over: Partial<Record<NodeId, AnswerValue>> | undefined): AnswerValue | null {
  if (over && Object.prototype.hasOwnProperty.call(over, node.id)) return over[node.id] ?? null;
  const h = (k: string) => f.heirs[k] ?? 0;
  const offered = node.options.map((o) => o.id);
  const pick = (id: string | undefined): string | null => (id !== undefined && offered.includes(id) ? id : null);
  const child = f.predeceased[node.instance - 1];
  const nephew = h("keponakan_lk_kandung") > 0 ? "kandung" : h("keponakan_lk_seayah") > 0 ? "seayah" : "tidak";
  const uncle = h("paman_kandung") > 0 ? "kandung" : h("paman_seayah") > 0 ? "seayah" : "tidak";
  const cousin = h("sepupu_lk_kandung") > 0 ? "dari_kandung" : h("sepupu_lk_seayah") > 0 ? "dari_seayah" : "tidak";
  const spouses = f.sex === "L" ? h("istri") : h("suami");
  switch (node.id) {
    case "A1":
      return pick("wafat_muslim");
    case "A2":
      return pick(f.sex);
    case "A3":
      return [];
    case "B1":
      return pick(spouses === 0 ? "pernah" : spouses === 1 ? "ya_satu" : "ya_lebih");
    case "B2":
    case "B3":
      return spouses;
    case "B1b":
      return pick("tidak");
    case "C1":
    case "C1m":
      return { L: h("anak_lk"), P: h("anak_pr") };
    case "C1n":
    case "C1p":
      return { L: 0, P: 0 };
    case "C3":
      return pick(f.predeceased.length > 0 ? "ya" : "tidak");
    case "C4s":
      return pick(child?.sex);
    case "C4r":
      return pick("ya");
    case "C4g":
    case "C4gm":
      return child ? { L: child.L, P: child.P } : null;
    case "C4b":
      return [];
    case "C4m":
      return pick(node.instance < f.predeceased.length ? "ya" : "tidak");
    case "D1":
    case "D1m": {
      const a = h("ayah") > 0;
      const i = h("ibu") > 0;
      return pick(a && i ? "keduanya" : a ? "ayah" : i ? "ibu" : "tidak_ada");
    }
    case "D3":
    case "D3m":
      return ["kakek", "nenek_ibu", "nenek_ayah"].filter((k) => h(k) > 0 && offered.includes(k));
    case "E1":
    case "E1m":
      return { L: h("sdr_lk_kandung"), P: h("sdr_pr_kandung") };
    case "E2":
    case "E2m":
      return { L: h("sdr_lk_seayah"), P: h("sdr_pr_seayah") };
    case "E3":
    case "E3m":
      return { L: h("sdr_lk_seibu"), P: h("sdr_pr_seibu") };
    case "F5":
      return [];
    case "F1":
      return pick(nephew);
    case "F1n":
      return h(nephew === "kandung" ? "keponakan_lk_kandung" : "keponakan_lk_seayah");
    case "F2":
      return pick(uncle);
    case "F2n":
      return h(uncle === "kandung" ? "paman_kandung" : "paman_seayah");
    case "F3":
      return pick(cousin);
    case "F3n":
      return h(cousin === "dari_kandung" ? "sepupu_lk_kandung" : "sepupu_lk_seayah");
    case "F4":
      return pick("tidak");
    case "G1":
      return [];
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Screens → declarative browser steps (selectors follow components/waris/questionnaire/*.tsx)
// ---------------------------------------------------------------------------------------------

/** The question card (QuestionCard.tsx) and its one primary action, "Lanjut" (NavRow). */
const Q_SECTION = 'section[aria-labelledby="waris-q-heading"]';
const NEXT = `${Q_SECTION} button.btn-primary`;

type Action =
  /** Click the nth label that wraps a matching (visually hidden) input: OptionRow. */
  | { do: "label"; input: string; nth: number }
  /** Tap a Stepper's "+" (or "−") until its <output> reads `to` (Stepper.tsx ids). */
  | { do: "stepper"; id: string; from: number; to: number };

export interface PlanStep {
  key: string;
  node: NodeId;
  kind: NodeView["kind"];
  value: AnswerValue;
  /** Present only on this screen: the node's own input name or stepper id. */
  probe: string;
  actions: Action[];
  next: string;
}

const radio = (key: string) => `input[type="radio"][name="${key}"]`;
const checkbox = (name: string) => `input[type="checkbox"][name="${name}"]`;

const isLP = (v: AnswerValue): v is LP => typeof v === "object" && v !== null && !Array.isArray(v);

function stepFor(node: NodeView, value: AnswerValue): PlanStep | string {
  const base = { key: node.key, node: node.id, kind: node.kind, value, next: NEXT };
  const k = node.key;
  if (node.id === "A3") {
    if (!Array.isArray(value)) return `${k}: A3 needs a list`;
    const picks = (value as readonly string[]).length === 0 ? ["k0"] : [...(value as readonly string[])];
    return { ...base, probe: checkbox("A3-k0"), actions: picks.map((o): Action => ({ do: "label", input: checkbox(`A3-${o}`), nth: 0 })) };
  }
  if (node.kind === "pilih" || node.kind === "peran") {
    const ids = node.options.map((o) => o.id);
    const nth = value === TIDAK_TAHU ? ids.length : ids.indexOf(String(value));
    if (nth < 0) return `${k}: option ${String(value)} not offered (${ids.join(", ")})`;
    return { ...base, probe: radio(k), actions: [{ do: "label", input: radio(k), nth }] };
  }
  if (node.kind === "pilih_banyak") {
    if (!Array.isArray(value)) return `${k}: a multi-select needs a list`;
    const xs = value as readonly string[];
    const names = xs.length === 0 ? [`${k}-tidak-ada`] : xs.map((o) => `${k}-${o}`);
    return { ...base, probe: checkbox(`${k}-tidak-ada`), actions: names.map((n): Action => ({ do: "label", input: checkbox(n), nth: 0 })) };
  }
  if (node.kind === "jumlah" && node.min === 0 && node.max === 1) {
    // YesNoCount: "Ya" (1), "Tidak" (0), then «Tidak tahu».
    const nth = value === 1 ? 0 : value === 0 ? 1 : value === TIDAK_TAHU ? 2 : -1;
    if (nth < 0) return `${k}: a 0–1 count needs 0 or 1`;
    return { ...base, probe: radio(k), actions: [{ do: "label", input: radio(k), nth }] };
  }
  if (node.kind === "jumlah") {
    if (typeof value !== "number" || value < node.min || value > node.max) return `${k}: count ${String(value)} outside ${node.min}–${node.max}`;
    // CountAnswer starts at the node's minimum on a fresh screen.
    return { ...base, probe: `[id="${k}-n-label"]`, actions: [{ do: "stepper", id: `${k}-n`, from: node.min, to: value }] };
  }
  // jumlah_lp: PairAnswer, two steppers starting at 0 on a fresh screen.
  if (!isLP(value)) return `${k}: a pair count needs { L, P }`;
  const maxL = node.maxLP ? node.maxLP.L : node.max;
  const maxP = node.maxLP ? node.maxLP.P : node.max;
  if (value.L > maxL || value.P > maxP) return `${k}: { L: ${value.L}, P: ${value.P} } above the bound`;
  const actions: Action[] = [];
  if (value.L > 0) actions.push({ do: "stepper", id: `${k}-L`, from: 0, to: value.L });
  if (value.P > 0) actions.push({ do: "stepper", id: `${k}-P`, from: 0, to: value.P });
  return { ...base, probe: `[id="${k}-L-label"]`, actions };
}

/** Walk the model exactly as HitungApp does (view → answer → reduce) until the review screen. */
function drive(f: Fam, over: CaseSpec["overrides"]): { state: QState; steps: PlanStep[] } | string {
  let s = initialState();
  const steps: PlanStep[] = [];
  for (let n = 0; n < 120; n++) {
    const v = view(s);
    if (v.kind === "ringkasan") return { state: s, steps };
    if (v.kind === "keluar") return `the questionnaire exits at ${v.exit.id} (${String(v.exit.at)})`;
    const value = answerFor(v.node, f, over);
    if (value === null) return `no answer for ${v.node.key} (options: ${v.node.options.map((o) => o.id).join(", ") || "none"})`;
    const st = stepFor(v.node, value);
    if (typeof st === "string") return st;
    steps.push(st);
    s = reduce(s, { type: "jawab", key: v.node.key, value });
  }
  return "no end after 120 screens";
}

// ---------------------------------------------------------------------------------------------
// Expectations (from the vector) and the model check (through the page's own computeReport)
// ---------------------------------------------------------------------------------------------

export interface Expect {
  /** Leading column (fikih, D2 = A): heir id → data-share figure, for every heir the vector gives a share. */
  fikih: Record<string, string>;
  /** Court cells exactly where the columns differ (heir → figure); null when the vector has no court block. */
  court: Record<string, string> | null;
  /** Case 3 with the rupiah panel filled: heir → "Rp 90.000.000". */
  rupiah: Record<string, string> | null;
}

const heirShares = (sh: Record<string, string> | undefined): Record<string, string> | null => {
  if (!sh) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sh)) {
    if (!HEIR_IDS.has(k)) return null; // baitul_mal, sisa_dirujuk, wasiat lines: not a heir row
    out[k] = v;
  }
  return out;
};

const dots = (n: number | bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function expectOf(v: Vector, withRupiah: boolean): Expect | string {
  const f = v.expected[FIKIH];
  if (!f || f.input_override || f.rujuk || !f.shares) return "no plain fikih expectation";
  const fikih = heirShares(f.shares);
  if (!fikih) return "fikih expectation has a non-heir line (baitul mal, residue or bequest)";
  let court: Record<string, string> | null = null;
  const c = v.expected[COURT];
  if (c && !c.input_override && !c.rujuk && c.shares) {
    const cs = heirShares(c.shares);
    if (cs) {
      court = {};
      for (const h of new Set([...Object.keys(fikih), ...Object.keys(cs)])) {
        const a = fikih[h] ?? "0";
        const b = cs[h] ?? "0";
        if (a !== b) court[h] = b;
      }
    }
  }
  let rupiah: Record<string, string> | null = null;
  if (withRupiah) {
    rupiah = {};
    for (const h of Object.keys(fikih)) {
      const amt = f.rupiah?.[h];
      if (typeof amt !== "number") return `no rupiah expectation for ${h}`;
      rupiah[h] = `Rp ${dots(amt)}`;
    }
  }
  return { fikih, court, rupiah };
}

/** What Ringkasan.tsx renders as data-share (mainOf: total, or lineTotal for "setelah_utang"). */
function shownFigure(head: ColumnHead, cell: CellView | undefined): string {
  if (!cell) return "0";
  const value = head.basis === "setelah_utang" ? (cell.lineTotal ?? cell.total) : cell.total;
  return value?.figure ?? "0";
}

function modelProblems(answers: Answers, amounts: Amounts | undefined, ex: Expect): string[] {
  const c = computeReport(answers, amounts, rules, dalil, DATE);
  if (c.kind !== "model") return [`the report would show ${c.kind}${c.kind === "exit" ? ` ${c.exit.id}` : c.kind === "error" ? `: ${c.message}` : ""}`];
  const g = c.model.ringkasan;
  if (!g || c.model.kind === "rujuk") return ["the report refuses (no Ringkasan)"];
  const out: string[] = [];
  if (!g.columns.fikih.lead) out.push("the fikih column does not lead");
  if (g.bergantung) out.push("the report shows a «Tidak tahu» grid");
  const seen = new Set<string>();
  for (const row of g.rows) {
    seen.add(row.role);
    const got = shownFigure(g.columns.fikih, row.fikih);
    const want = ex.fikih[row.role] ?? "0";
    if (got !== want) out.push(`fikih ${row.role}: report ${got}, vector ${want}`);
  }
  for (const h of Object.keys(ex.fikih)) if (!seen.has(h)) out.push(`fikih ${h}: no row in the report (vector ${ex.fikih[h]})`);
  if (ex.court) {
    const courtShown = g.columns.court.shown && g.columns.court.status === "hasil";
    const cells: Record<string, string> = {};
    if (courtShown) for (const row of g.rows) if (row.differs && row.court) cells[row.role] = shownFigure(g.columns.court, row.court);
    const keys = new Set([...Object.keys(cells), ...Object.keys(ex.court)]);
    for (const h of keys) if (cells[h] !== ex.court[h]) out.push(`court ${h}: report ${cells[h] ?? "(no cell)"}, vector ${ex.court[h] ?? "(same as fikih)"}`);
  }
  if (ex.rupiah) {
    if (!g.rupiahShown) out.push("rupiah not shown with the amounts entered");
    for (const row of g.rows) {
      const want = ex.rupiah[row.role];
      const got = row.fikih?.rupiahTotal?.text;
      if (want && got !== want) out.push(`rupiah ${row.role}: report ${got ?? "(none)"}, vector ${want}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Build the plan
// ---------------------------------------------------------------------------------------------

const amountsJson = (a: Amounts | undefined): Record<string, string> | null => {
  if (!a) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "bigint") out[k] = v.toString();
  return out;
};

const failures: string[] = [];
const byId = new Map(vectors.map((v) => [v.id, v] as const));

const cases = E2E.map((spec) => {
  const v = byId.get(spec.vector);
  if (!v) {
    failures.push(`${spec.name}: no vector ${spec.vector}`);
    return null;
  }
  const fam = familyOf(v, spec);
  if (typeof fam === "string") {
    failures.push(`${spec.name} (${v.id}): ${fam}`);
    return null;
  }
  const d = drive(fam, spec.overrides);
  if (typeof d === "string") {
    failures.push(`${spec.name} (${v.id}): ${d}`);
    return null;
  }
  const ex = expectOf(v, false);
  if (typeof ex === "string") {
    failures.push(`${spec.name} (${v.id}): ${ex}`);
    return null;
  }
  for (const p of modelProblems(d.state.answers, undefined, ex)) failures.push(`${spec.name} (${v.id}), fractions: ${p}`);
  let exRupiah: Expect | null = null;
  if (spec.amounts) {
    const er = expectOf(v, true);
    if (typeof er === "string") failures.push(`${spec.name} (${v.id}): ${er}`);
    else {
      exRupiah = er;
      for (const p of modelProblems(d.state.answers, spec.amounts, er)) failures.push(`${spec.name} (${v.id}), with rupiah: ${p}`);
    }
  }
  return {
    name: spec.name,
    vector: v.id,
    why: spec.why,
    screens: screenCount(d.state.answers),
    steps: d.steps,
    expect: ex,
    amounts: amountsJson(spec.amounts),
    expectWithAmounts: exRupiah,
    token: shareToken(d.state),
    tokenWithAmounts: spec.amounts ? shareToken(d.state, spec.amounts, { sertakanRupiah: true }) : null,
  };
});

/** Every vector the questionnaire can express: the share-link pass and the print-length survey. */
const survey: { vector: string; token: string; expect: Expect; screens: number }[] = [];
const notExpressible: { vector: string; reason: string }[] = [];
const surveyMismatch: { vector: string; problems: string[] }[] = [];
for (const v of vectors) {
  const fam = familyOf(v);
  if (typeof fam === "string") {
    notExpressible.push({ vector: v.id, reason: fam });
    continue;
  }
  const ex = expectOf(v, false);
  if (typeof ex === "string") {
    notExpressible.push({ vector: v.id, reason: ex });
    continue;
  }
  const d = drive(fam, undefined);
  if (typeof d === "string") {
    notExpressible.push({ vector: v.id, reason: d });
    continue;
  }
  const probs = modelProblems(d.state.answers, undefined, ex);
  if (probs.length > 0) {
    // Not a CI failure here (the e2e cases above are): the questionnaire may legitimately differ
    // from a vector's modelling (e.g. a grandparent the tool never asks about). Listed by name.
    surveyMismatch.push({ vector: v.id, problems: probs });
    continue;
  }
  survey.push({ vector: v.id, token: shareToken(d.state), expect: ex, screens: screenCount(d.state.answers) });
}

const ui = messagesId.Report?.ui ?? {};
const plan = {
  schema: "waris-e2e-plan/1",
  note: "Generated by belajar/scripts/ci/waris-e2e-plan.ts from content/waris/test-vectors.json. AI-assisted, not an authoritative fatwa.",
  routes: { hitung: "/belajar/id/waris/hitung", laporan: "/belajar/id/waris/laporan" },
  text: {
    chip: REPORT_MESSAGES["laporan.kepala.chip"],
    title: REPORT_MESSAGES["laporan.kepala.judul"],
    label: REPORT_MESSAGES["laporan.kepala.label"],
    rpHitung: ui.rp_hitung ?? null,
    forbidden: [...FORBIDDEN_REVIEW],
  },
  cases: cases.filter((c): c is NonNullable<typeof c> => c !== null),
  survey,
  notExpressible,
  surveyMismatch,
};

console.log(`== waris e2e plan: ${plan.cases.length}/${E2E.length} end-to-end cases`);
for (const c of plan.cases) console.log(`   ${c.name.padEnd(9)} ${c.vector}: ${c.steps.length} screens (${c.screens} counted), fikih ${JSON.stringify(c.expect.fikih)}`);
console.log(`== survey: ${survey.length} of ${vectors.length} vectors expressible and matching; ${notExpressible.length} not expressible; ${surveyMismatch.length} differ from the vector`);
for (const m of surveyMismatch) console.log(`   differs: ${m.vector}: ${m.problems.join("; ")}`);
if (verbose) for (const n of notExpressible) console.log(`   not expressible: ${n.vector}: ${n.reason}`);
if (!plan.text.rpHitung) failures.push("messages/waris/id.json has no Report.ui.rp_hitung (the rupiah panel's button)");

if (failures.length > 0) {
  console.error(`\n✗ waris-e2e-plan: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
const json = JSON.stringify(plan, null, 2) + "\n";
if (outPath) {
  writeFileSync(outPath, json);
  console.log(`plan written to ${outPath}`);
} else {
  process.stdout.write(json);
}
