/**
 * The questionnaire state machine (architecture.md §6.3; plan §5).
 *
 *   walk(answers)      the derived path: every relevant node in priority order, the first
 *                      unanswered one (the cursor), or the exit the answers lead to. Never stored.
 *   reduce(state, a)   the pure reducer for useReducer(); the answers are the only state.
 *   evaluate(answers)  the outcome: an exit page, or both report columns (and, for one «Tidak
 *                      tahu» that changes the division, each of its readings, plan D15).
 *
 * Relevance comes from the engine, never from a hand-written skip list (plan §5.1, §5.3):
 *  - a relative's node is asked iff couldAffectOutcome() (both columns) or couldInherit() under a
 *    comparison variant says it could change a number, with every role not yet asked (or
 *    answered «Tidak tahu») left "maybe present";
 *  - nephews / uncles / cousins are also skipped when an engine probe shows nothing is left for
 *    them (fixed shares ≥ 1, plan §5.3 last row);
 *  - beyond-depth relatives (C4b, F5) and dzawil arham (F4) are asked iff adding one changes the
 *    engine's result, and the answer is placed where the engine reads it, so C4b/F5 refuse exactly
 *    when solve() returns rujuk kerabat_jauh (the engine decides; the screen only reports it).
 *
 * The killer answer (A3 k6) never enters: a3Route() sends it to E-BUNUH before any dispatch, and
 * the reducer drops any answer that carries it (plan §5.6, §9.4).
 */
import { solve } from "../solve";
import { HEIRS, isHeirId, type HeirId, type RujukReason } from "../registry";
import type { Result } from "../types";
import { answerCodeOf } from "./codec";
import {
  ADD,
  COURT,
  FIKIH,
  RELEVANCE_RULESETS,
  hasAsIfCandidate,
  SPECIAL,
  SPECIAL_FLAG,
  applyPolicy,
  arr,
  buildFamily,
  flagsOf,
  fullSig,
  isTT,
  knownCounts,
  lp,
  lpTotal,
  moneySig,
  needReligion,
  probe,
  relevantRole,
  residueOpen,
  sexOf,
  solveCached,
  specialRelevantGroups,
  spouseN,
  str,
  toInput,
} from "./build";
import { A3_UI_OPTIONS, EXITS, KILLER_OPTION, MAX_ANAK_WAFAT, NODE, type A3UiOption, type NodeDef } from "./graph";
import {
  LOOP_NODES,
  NODE_IDS,
  ROLE_GROUPS,
  SECTIONS,
  TIDAK_TAHU,
  type Action,
  type Amounts,
  type AnswerValue,
  type Answers,
  type ColumnOutcome,
  type Evaluation,
  type ExitHit,
  type ExitId,
  type LP,
  type Mode,
  type NodeId,
  type NotAsked,
  type NotAskedGroup,
  type QKey,
  type QNote,
  type QState,
  type ReportOutcome,
  type ReportRequest,
  type RoleGroup,
  type SectionId,
  type PewarisKind,
  type UnknownAnswer,
  type UnknownOption,
  type UnknownReading,
  type UnknownSubject,
} from "./types";
import type { FamilyInput } from "../types";
import type { KnownCounts } from "../hajb";

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

export function keyOf(id: NodeId, i = 0): QKey {
  return i > 0 ? `${id}.${i}` : id;
}

export function parseKey(key: QKey): { id: NodeId; i: number } | null {
  const dot = key.indexOf(".");
  const id = (dot < 0 ? key : key.slice(0, dot)) as NodeId;
  if (!(NODE_IDS as readonly string[]).includes(id)) return null;
  const loop = (LOOP_NODES as readonly string[]).includes(id);
  if (!loop) return dot < 0 ? { id, i: 0 } : null;
  if (dot < 0) return null;
  const rest = key.slice(dot + 1);
  if (!/^[1-9][0-9]?$/.test(rest)) return null;
  const i = parseInt(rest, 10);
  return i <= MAX_ANAK_WAFAT ? { id, i } : null;
}

// ---------------------------------------------------------------------------------------------
// «Tidak tahu» readings (plan §5.7 table, D15)
// ---------------------------------------------------------------------------------------------

export interface Reading {
  option: UnknownOption;
  /** Concrete answers this reading stands for (several = the reading must give ONE outcome). */
  overlays: Answers[];
}

export interface ScenarioNode {
  key: QKey;
  id: NodeId;
  subject: UnknownSubject;
  /** «Tidak tahu», or the B1 "iddah" / G4 "belum" answers that are read both ways (plan §5.7). */
  answer: UnknownAnswer;
  readings: Reading[];
}

const SUBJECT: Partial<Record<NodeId, UnknownSubject>> = {
  B1: "pasangan",
  B3: "agama",
  C1: "anak",
  C1m: "agama",
  C1n: "cucu",
  C1p: "cucu",
  C3: "cucu",
  C4r: "agama",
  C4g: "cucu",
  C4gm: "agama",
  C4b: "cucu",
  C4m: "cucu",
  D1: "orang_tua",
  D1m: "agama",
  D3: "kakek_nenek",
  D3m: "agama",
  E1: "saudara",
  E1m: "agama",
  E2: "saudara",
  E2m: "agama",
  E3: "saudara",
  E3m: "agama",
  F1: "kerabat_lain",
  F1n: "kerabat_lain",
  F2: "kerabat_lain",
  F2n: "kerabat_lain",
  F3: "kerabat_lain",
  F3n: "kerabat_lain",
  F5: "kerabat_lain",
  F4: "kerabat_lain",
  A3b4: "wasiat",
  G4: "persetujuan_wasiat",
};

const LP_VALUES = [0, 1, 2] as const;

function lpExistence(key: QKey): Reading[] {
  const ada: Answers[] = [];
  for (const L of LP_VALUES) for (const P of LP_VALUES) if (L + P > 0) ada.push({ [key]: { L, P } });
  return [
    { option: "tidak_ada", overlays: [{ [key]: { L: 0, P: 0 } }] },
    { option: "ada", overlays: ada },
  ];
}
function few(n: number): number[] {
  const out: number[] = [];
  for (const x of [0, 1, n]) if (x >= 0 && x <= n && !out.includes(x)) out.push(x);
  return out;
}
function lpReligion(key: QKey, count: LP): Reading[] {
  const other: Answers[] = [];
  for (const L of few(count.L)) for (const P of few(count.P)) if (L !== count.L || P !== count.P) other.push({ [key]: { L, P } });
  return [
    { option: "muslim", overlays: [{ [key]: count }] },
    { option: "bukan_muslim", overlays: other },
  ];
}
function subsets(xs: readonly string[]): string[][] {
  let out: string[][] = [[]];
  for (const x of xs) out = [...out, ...out.map((s) => [...s, x])];
  return out;
}
/** A predeceased child who left one grandchild, as instance i (for C3 / C4m «Tidak tahu»). */
function onePredeceased(i: number, sx: "L" | "P", kid: "L" | "P"): Answers {
  return { [`C4s.${i}`]: sx, [`C4g.${i}`]: { L: kid === "L" ? 1 : 0, P: kid === "P" ? 1 : 0 }, [`C4b.${i}`]: [], [`C4m.${i}`]: "tidak" };
}

function readingsFor(id: NodeId, key: QKey, i: number, v: AnswerValue, a: Answers, opts: readonly string[]): Reading[] | null {
  // the question is whether the spouse in a revocable divorce's 'iddah inherits, not whether one exists
  if (id === "B1" && v === "iddah")
    return [
      { option: "mewarisi", overlays: [{ B1: "ya_satu" }] },
      { option: "tidak_mewarisi", overlays: [{ B1: "pernah" }] },
    ];
  if (id === "G4" && v === "belum")
    return [
      { option: "belum_setuju", overlays: [{ G4: "tidak_setuju" }] },
      { option: "setuju", overlays: [{ G4: "setuju" }] },
    ];
  if (v !== TIDAK_TAHU) return null;
  switch (id) {
    case "B1":
      return [
        { option: "tidak_ada", overlays: [{ B1: "pernah" }] },
        { option: "ada", overlays: [{ B1: "ya_satu" }] },
      ];
    case "B3": {
      const n = str(a, "B1") === "iddah" ? 1 : (spouseN(a) ?? 1);
      const other: Answers[] = [];
      for (let k = 0; k < n; k++) other.push({ B3: k });
      return [
        { option: "muslim", overlays: [{ B3: n }] },
        { option: "bukan_muslim", overlays: other },
      ];
    }
    case "C1":
    case "C1n":
    case "C1p":
    case "C4g":
    case "E1":
    case "E2":
    case "E3":
      return lpExistence(key);
    case "C1m":
    case "E1m":
    case "E2m":
    case "E3m":
    case "C4gm": {
      const countKey = id === "C4gm" ? `C4g.${i}` : id.slice(0, id.length - 1);
      return lpReligion(key, lp(a, countKey) ?? { L: 0, P: 0 });
    }
    case "C3":
    case "C4m": {
      const at = id === "C3" ? 1 : i + 1;
      if (at > MAX_ANAK_WAFAT) return null;
      const base: Answers = id === "C3" ? { C3: "ya" } : { [key]: "ya" };
      const ada: Answers[] = [];
      for (const sx of ["L", "P"] as const) for (const kid of ["L", "P"] as const) ada.push({ ...base, ...onePredeceased(at, sx, kid) });
      return [
        { option: "tidak_ada", overlays: [{ [key]: "tidak" }] },
        { option: "ada", overlays: ada },
      ];
    }
    case "C4r":
      return [
        { option: "muslim", overlays: [{ [key]: "ya" }] },
        { option: "bukan_muslim", overlays: [{ [key]: "tidak" }] },
      ];
    case "C4b":
    case "F5":
      return [
        { option: "tidak_ada", overlays: [{ [key]: [] }] },
        { option: "ada", overlays: opts.map((o) => ({ [key]: [o] })) },
      ];
    case "D1":
      return [
        { option: "tidak_ada", overlays: [{ D1: "tidak_ada" }] },
        { option: "ada", overlays: [{ D1: "keduanya" }, { D1: "ayah" }, { D1: "ibu" }] },
      ];
    case "D1m": {
      const d1 = str(a, "D1") ?? "keduanya";
      return [
        { option: "muslim", overlays: [{ D1m: d1 }] },
        { option: "bukan_muslim", overlays: opts.filter((o) => o !== d1).map((o) => ({ D1m: o })) },
      ];
    }
    case "D3":
      return [
        { option: "tidak_ada", overlays: [{ D3: [] }] },
        { option: "ada", overlays: subsets(opts).filter((s) => s.length > 0).map((s) => ({ D3: s })) },
      ];
    case "D3m": {
      const d3 = arr(a, "D3") ?? [];
      return [
        { option: "muslim", overlays: [{ D3m: [...d3] }] },
        { option: "bukan_muslim", overlays: subsets(d3).filter((s) => s.length < d3.length).map((s) => ({ D3m: s })) },
      ];
    }
    case "F1":
    case "F2":
    case "F3": {
      const [k, s] = id === "F3" ? ["dari_kandung", "dari_seayah"] : ["kandung", "seayah"];
      return [
        { option: "tidak_ada", overlays: [{ [id]: "tidak" }] },
        { option: "ada", overlays: [{ [id]: k, [`${id}n`]: 1 }, { [id]: s, [`${id}n`]: 1 }] },
      ];
    }
    case "F1n":
    case "F2n":
    case "F3n":
      return [
        { option: "satu", overlays: [{ [id]: 1 }] },
        { option: "dua_atau_lebih", overlays: [{ [id]: 2 }] },
      ];
    case "F4":
      return [
        { option: "tidak_ada", overlays: [{ F4: "tidak" }] },
        { option: "ada", overlays: [{ F4: "ya" }] },
      ];
    case "A3b4":
      return [
        { option: "tidak_ada", overlays: [{ A3b4: "tidak" }] },
        { option: "ada", overlays: [{ A3b4: "ya" }] },
      ];
    default:
      return null; // A3a, B1b, G1, G3, G3w: no readings (all groups / notes / wasiat left out)
  }
}

/** Every «Tidak tahu» (and B1 iddah, G4 belum) on the path, with its readings. */
export function scenarioNodes(eff: Answers, opts: Readonly<Record<string, readonly string[]>>): ScenarioNode[] {
  const out: ScenarioNode[] = [];
  for (const key of Object.keys(eff)) {
    const p = parseKey(key);
    if (!p) continue;
    const readings = readingsFor(p.id, key, p.i, eff[key], eff, opts[key] ?? []);
    if (readings && readings.length > 0 && readings.every((r) => r.overlays.length > 0)) {
      const v = eff[key];
      const answer: UnknownAnswer = p.id === "B1" && v === "iddah" ? "iddah" : p.id === "G4" && v === "belum" ? "belum_dibicarakan" : "tidak_tahu";
      out.push({ key, id: p.id, subject: SUBJECT[p.id] ?? "kerabat_lain", answer, readings });
    }
  }
  return out;
}

/** Above this many concrete combinations the answers are too uncertain: konsultasikan. */
export const MAX_COMBOS = 81;

export interface Combo {
  /** Per scenario node: index into its flattened overlays. */
  pick: number[];
  /** Per scenario node: index of the reading that overlay belongs to. */
  reading: number[];
  overlay: Answers;
}

export function combosOf(nodes: readonly ScenarioNode[]): Combo[] | null {
  let total = 1;
  for (const n of nodes) {
    total *= n.readings.reduce((s, r) => s + r.overlays.length, 0);
    if (total > MAX_COMBOS) return null;
  }
  let out: Combo[] = [{ pick: [], reading: [], overlay: {} }];
  for (const n of nodes) {
    const flat: { r: number; o: Answers }[] = [];
    n.readings.forEach((r, ri) => r.overlays.forEach((o) => flat.push({ r: ri, o })));
    const next: Combo[] = [];
    for (const c of out) flat.forEach((f, fi) => next.push({ pick: [...c.pick, fi], reading: [...c.reading, f.r], overlay: { ...c.overlay, ...f.o } }));
    out = next;
  }
  return out;
}

/** Scenario nodes whose answer changes the signature with everything else held fixed. */
export function mattering(nodes: readonly ScenarioNode[], combos: readonly Combo[], sigs: readonly string[]): number[] {
  const out: number[] = [];
  nodes.forEach((_, u) => {
    const groups = new Map<string, string>();
    for (let c = 0; c < combos.length; c++) {
      const rest = combos[c].pick.filter((_, j) => j !== u).join(",");
      const seen = groups.get(rest);
      if (seen === undefined) groups.set(rest, sigs[c]);
      else if (seen !== sigs[c]) {
        out.push(u);
        return;
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

export interface Step {
  key: QKey;
  id: NodeId;
  i: number;
  value: AnswerValue;
  options: readonly string[];
}

export interface CursorNode {
  key: QKey;
  id: NodeId;
  i: number;
  options: readonly string[];
}

export interface Walk {
  steps: Step[];
  /** Effective answers: relevant, valid, in path order. The only answers anything reads. */
  eff: Answers;
  cursor: CursorNode | null;
  exit: ExitHit | null;
  /** Options offered at each answered node (for «Tidak tahu» readings and the codec). */
  opts: Readonly<Record<string, readonly string[]>>;
  /** Relative groups not asked, with the relatives that made them irrelevant (plan §5.1). */
  notAsked: NotAsked[];
  complete: boolean;
}

interface W {
  eff: Record<string, AnswerValue>;
  opts: Record<string, readonly string[]>;
  known(): KnownCounts;
  /** Known counts of the court column's as-if family, or null when nobody is a candidate. */
  knownAsIf(): KnownCounts | null;
  anyCombo(tag: string, fn: (fam: FamilyInput, m: Answers) => boolean): boolean;
}

function makeW(eff: Record<string, AnswerValue>, opts: Record<string, readonly string[]>): W {
  let knownAt = -1;
  let known: KnownCounts = {};
  let asIfAt = -1;
  let asIf: KnownCounts | null = null;
  const memo = new Map<string, boolean>();
  const size = () => Object.keys(eff).length;
  return {
    eff,
    opts,
    known() {
      if (knownAt !== size()) {
        known = knownCounts(eff);
        knownAt = size();
      }
      return known;
    },
    knownAsIf() {
      if (asIfAt !== size()) {
        asIf = hasAsIfCandidate(eff) ? knownCounts(eff, true) : null;
        asIfAt = size();
      }
      return asIf;
    },
    anyCombo(tag, fn) {
      const mk = `${tag}@${size()}`;
      const hit = memo.get(mk);
      if (hit !== undefined) return hit;
      const combos = combosOf(scenarioNodes(eff, opts));
      let res = combos === null; // too many unknowns: ask (conservative)
      if (combos)
        for (const c of combos) {
          const m: Answers = { ...eff, ...c.overlay };
          if (fn(buildFamily(m, { final: false }), m)) {
            res = true;
            break;
          }
        }
      memo.set(mk, res);
      return res;
    },
  };
}

const AGNATES = {
  F1: { roles: ["keponakan_lk_kandung", "keponakan_lk_seayah"], add: [ADD.keponakan("kandung"), ADD.keponakan("seayah")] },
  F2: { roles: ["paman_kandung", "paman_seayah"], add: [ADD.paman("kandung"), ADD.paman("seayah")] },
  F3: { roles: ["sepupu_lk_kandung", "sepupu_lk_seayah"], add: [ADD.sepupu("kandung"), ADD.sepupu("seayah")] },
} as const satisfies Record<string, { roles: readonly HeirId[]; add: readonly ((f: FamilyInput) => void)[] }>;

const SIBLINGS = {
  E1: ["sdr_lk_kandung", "sdr_pr_kandung"],
  E2: ["sdr_lk_seayah", "sdr_pr_seayah"],
  E3: ["sdr_lk_seibu", "sdr_pr_seibu"],
} as const satisfies Record<string, readonly HeirId[]>;

const GRANDPARENTS = ["kakek", "nenek_ibu", "nenek_ayah"] as const satisfies readonly HeirId[];

/** A relative could change a number in the real family, or in the court column's as-if family. */
const relW = (r: HeirId, w: W): boolean => {
  if (relevantRole(r, w.known())) return true;
  const ai = w.knownAsIf();
  return ai !== null && relevantRole(r, ai);
};
const roleRel = (roles: readonly HeirId[], w: W) => roles.some((r) => relW(r, w));

function courtOrdered(a: Answers): number {
  const ad = lp(a, "A3b");
  const b2 = str(a, "A3b2");
  if (!ad) return 0;
  if (b2 === "ya") return lpTotal(ad);
  if (b2 === "sebagian") return lpTotal(lp(a, "A3b3"));
  return 0;
}

/** Does "semua ahli waris setuju" change any number in any ruleset (engine probe)? */
function consentMatters(m: Answers): boolean {
  const yes = toInput({ ...m, G4: "setuju" }).input;
  const no = toInput({ ...m, G4: "tidak_setuju" }).input;
  for (const rs of RELEVANCE_RULESETS) {
    const a = moneySig(applyPolicy(solveCached(yes, rs), rs).result);
    const b = moneySig(applyPolicy(solveCached(no, rs), rs).result);
    if (a !== b) return true;
  }
  return false;
}

/** The options a node offers now (a subset of its catalog, in catalog order). */
function optionsFor(id: NodeId, i: number, w: W): readonly string[] {
  const a = w.eff;
  const def = NODE[id];
  switch (id) {
    case "B1":
      return sexOf(a) === "P" ? def.options.filter((o) => o !== "ya_lebih") : def.options;
    case "A3b2":
      return lpTotal(lp(a, "A3b")) > 1 ? def.options : def.options.filter((o) => o !== "sebagian");
    case "D1m": {
      const d1 = str(a, "D1");
      return d1 === "keduanya" ? def.options : d1 === "ayah" ? ["ayah", "tidak_ada"] : d1 === "ibu" ? ["ibu", "tidak_ada"] : [];
    }
    case "D3":
      return GRANDPARENTS.filter((g) => relW(g, w));
    case "D3m":
      return arr(a, "D3") ?? [];
    case "C4b": {
      const line = str(a, `C4s.${i}`);
      const cands = line === "L" ? ["keturunan_jauh", "anak_cucu_perempuan"] : ["keturunan_jauh", "cicit_dari_cucu_hidup"];
      return cands.filter((o) => w.anyCombo(`C4b.${i}.${o}`, (fam) => probe(fam, ADD.c4bExtra(i, o))));
    }
    case "F5": {
      const out: string[] = [];
      if (w.anyCombo("F5.sdr", (fam) => probe(fam, ADD.keturunanSaudara))) out.push("keturunan_saudara");
      // a cousin's descendant and the father's uncle's line: the same engine position (kind "paman")
      if (w.anyCombo("F5.paman", (fam) => probe(fam, ADD.keturunanPaman))) out.push("keturunan_paman", "kerabat_ayah");
      return out;
    }
    case "G2":
      return heirRoleOptions(w);
    default:
      return def.options;
  }
}

/** G2: the relatives entered who receive a share in either column (no wasiat yet). */
function heirRoleOptions(w: W): string[] {
  const roles = new Set<string>();
  const combos = combosOf(scenarioNodes(w.eff, w.opts)) ?? [{ pick: [], reading: [], overlay: {} }];
  for (const c of combos) {
    const fam = buildFamily({ ...w.eff, ...c.overlay }, { final: true });
    for (const rs of [FIKIH, COURT]) {
      const r = applyPolicy(solveCached({ family: fam }, rs), rs).result;
      if (r.kind === "hasil") for (const g of r.shares) if (isHeirId(g.heir)) roles.add(g.heir);
    }
  }
  return HEIRS.filter((h) => roles.has(h));
}

function relevant(id: NodeId, i: number, w: W): boolean {
  const a = w.eff;
  const f = flagsOf(a);
  const g1 = arr(a, "G1") ?? [];
  switch (id) {
    case "A1":
    case "A2":
    case "A3":
    case "B1":
    case "D1":
    case "G1":
    case "C4s":
    case "C4g":
      return true;
    case "A1s":
      return str(a, "A1") === "saya_hidup";
    case "A3a":
      return f.has("k1");
    case "A3b":
      return f.has("k2");
    case "A3b2":
      return f.has("k2") && lpTotal(lp(a, "A3b")) > 0;
    case "A3b3":
      return f.has("k2") && str(a, "A3b2") === "sebagian";
    case "A3b4":
      return f.has("k2") && courtOrdered(a) > 0;
    case "A3c":
      return f.has("k3");
    case "A3d":
      return f.has("k4");
    case "A3e":
      return f.has("k5");
    case "B2":
      return sexOf(a) === "L" && str(a, "B1") === "ya_lebih";
    case "B3": {
      const n = str(a, "B1") === "iddah" ? 1 : spouseN(a);
      return needReligion(a, "pasangan") && (n ?? 0) > 0;
    }
    case "B1b": {
      // plan §5.7 B1b "if married now or before"; for "pernah" (widowed or divorced) it asks
      // whether harta bersama of that marriage is still undivided (questionKey: B1b.tanya_pernah)
      const b1 = str(a, "B1");
      return b1 === "ya_satu" || b1 === "ya_lebih" || b1 === "iddah" || b1 === "pernah";
    }
    case "C1":
    case "C3":
      // a never-married man has no children in law (plan §5.7 C1: a woman's do inherit, KHI 186)
      return !(sexOf(a) === "L" && str(a, "B1") === "belum");
    case "C1m":
      return needReligion(a, "anak") && lpTotal(lp(a, "C1")) > 0;
    case "C1n":
    case "C1p": {
      // grandchildren under a living child who is not Muslim: asked when the engine says they could matter
      const sx = id === "C1n" ? "L" : "P";
      const c = lp(a, "C1");
      const m = lp(a, "C1m");
      // with C1m «Tidak tahu» the readings decide (some of them have such a child)
      if (!c || !needReligion(a, "anak") || c[sx] === 0 || (m !== undefined && c[sx] - m[sx] <= 0)) return false;
      return w.anyCombo(`${id}.probe`, (fam) => probe(fam, ADD.cucuUnderNonMuslim(sx, "L")) || probe(fam, ADD.cucuUnderNonMuslim(sx, "P")));
    }
    case "C4r":
      return needReligion(a, "anak");
    case "C4gm":
      return needReligion(a, "cucu") && lpTotal(lp(a, `C4g.${i}`)) > 0;
    case "C4b":
      return optionsFor("C4b", i, w).length > 0;
    case "C4m":
      return i < MAX_ANAK_WAFAT;
    case "D1m": {
      const d1 = str(a, "D1");
      return needReligion(a, "orang_tua") && (d1 === "keduanya" || d1 === "ayah" || d1 === "ibu");
    }
    case "D3":
      return optionsFor("D3", 0, w).length > 0;
    case "D3m":
      return needReligion(a, "kakek_nenek") && (arr(a, "D3")?.length ?? 0) > 0;
    case "E1":
    case "E2":
    case "E3":
      return roleRel(SIBLINGS[id], w);
    case "E1m":
    case "E2m":
    case "E3m":
      return needReligion(a, "saudara") && lpTotal(lp(a, id.slice(0, 2))) > 0;
    case "F1":
    case "F2":
    case "F3": {
      const g = AGNATES[id];
      // with a beyond-depth relative reported at F5, a blocked nearer agnate still matters to the
      // engine's depth check; otherwise only an agnate who could inherit is asked
      const beyond = (arr(a, "F5") ?? []).length > 0 || isTT(a.F5);
      if (!beyond && !roleRel(g.roles, w)) return false;
      return w.anyCombo(`${id}.probe`, (fam) => g.add.some((add) => probe(fam, add)));
    }
    case "F1n":
    case "F2n":
    case "F3n": {
      const v = str(a, id.slice(0, 2));
      return v !== undefined && v !== "tidak";
    }
    case "F5":
      return optionsFor("F5", 0, w).length > 0;
    case "F4":
      return w.anyCombo("F4", (fam) => residueOpen(fam));
    case "G2":
    case "G3w":
      return g1.includes("waris");
    case "G3":
      return g1.includes("lain");
    case "G4": {
      // the plan's floor (§5.2: "> ⅓ or to an heir"; a value still to be entered may exceed ⅓) …
      const size = (k: string) => str(a, k);
      if ((g1.includes("waris") && !isTT(a.G3w)) || size("G3") === "lebih_sepertiga" || size("G3") === "nilai_tertentu") return true;
      // … plus any family where consent changes a number (e.g. the combined ⅓ cap with a wasiat wajibah)
      return w.anyCombo("G4", (_fam, m) => consentMatters(m));
    }
  }
}

/** Upper bound for a count node now (Muslim counts are bounded by their count). */
function boundsFor(id: NodeId, i: number, a: Answers): { min: number; max: number; maxLP?: LP } {
  const def = NODE[id];
  switch (id) {
    case "B3":
      return { min: 0, max: str(a, "B1") === "iddah" ? 1 : (spouseN(a) ?? 1) };
    case "C1m":
    case "E1m":
    case "E2m":
    case "E3m":
      return { min: 0, max: def.max, maxLP: lp(a, id.slice(0, id.length - 1)) ?? { L: 0, P: 0 } };
    case "C4gm":
      return { min: 0, max: def.max, maxLP: lp(a, `C4g.${i}`) ?? { L: 0, P: 0 } };
    case "A3b3":
      return { min: 0, max: def.max, maxLP: lp(a, "A3b") ?? { L: 0, P: 0 } };
    default:
      return { min: def.min, max: def.max };
  }
}

const isWhole = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && x >= lo && x <= hi && (x | 0) === x;

/** Is v an acceptable answer for this node now? (The reducer refuses anything else.) */
export function validAnswer(id: NodeId, i: number, v: AnswerValue, options: readonly string[], a: Answers): boolean {
  const def: NodeDef = NODE[id];
  if (v === TIDAK_TAHU) return def.unknown;
  const b = boundsFor(id, i, a);
  switch (def.kind) {
    case "pilih":
    case "peran":
      return typeof v === "string" && options.includes(v);
    case "pilih_banyak": {
      if (!Array.isArray(v)) return false;
      const xs = v as readonly string[];
      if (xs.some((x) => typeof x !== "string" || !options.includes(x))) return false;
      return new Set(xs).size === xs.length;
    }
    case "jumlah":
      return isWhole(v, b.min, b.max);
    case "jumlah_lp": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
      const x = v as LP;
      const mx = b.maxLP ?? { L: b.max, P: b.max };
      if (!isWhole(x.L, 0, mx.L) || !isWhole(x.P, 0, mx.P)) return false;
      if (id === "A3b" && x.L + x.P === 0) return false;
      return true;
    }
  }
}

const PRE_LOOP: readonly NodeId[] = ["A1", "A1s", "A2", "A3", "A3a", "A3b", "A3b2", "A3b3", "A3b4", "A3c", "A3d", "A3e", "B1", "B2", "B3", "B1b", "C1", "C1m", "C1n", "C1p", "C3"];
/**
 * F5 comes BEFORE F1–F3 (the plan's tree has it after): the engine's depth check excludes a
 * beyond-depth relative when a nearer agnate is PRESENT, even one who is blocked himself (e.g. an
 * uncle behind full sisters taking the residue with daughters). So when F5 reports such a
 * relative, F1–F3 are asked whenever the engine says the nearer agnate's presence changes the
 * result, and the engine — not the screen — decides E-KERABAT-JAUH.
 */
const POST_LOOP: readonly NodeId[] = ["D1", "D1m", "D3", "D3m", "E1", "E1m", "E2", "E2m", "E3", "E3m", "F5", "F1", "F1n", "F2", "F2n", "F3", "F3n", "F4"];
const WASIAT: readonly NodeId[] = ["G1", "G2", "G3", "G3w", "G4"];

const WALK_CACHE = new WeakMap<object, Walk>();

/** The derived path for these answers. Pure; memoised per answers object. */
export function walk(answers: Answers): Walk {
  const hit = WALK_CACHE.get(answers);
  if (hit) return hit;
  const res = doWalk(answers);
  WALK_CACHE.set(answers, res);
  return res;
}

function doWalk(answers: Answers): Walk {
  const eff: Record<string, AnswerValue> = {};
  const opts: Record<string, readonly string[]> = {};
  const steps: Step[] = [];
  const skippedHeirs: { id: NodeId; known: KnownCounts }[] = [];
  const w = makeW(eff, opts);
  let cursor: CursorNode | null = null;
  let exit: ExitHit | null = null;

  /** false = stop the walk */
  const visit = (id: NodeId, i: number): boolean => {
    const key = keyOf(id, i);
    if (!relevant(id, i, w)) {
      if (id === "E1" || id === "E2" || id === "E3" || id === "F1" || id === "F2" || id === "F3" || id === "D3") skippedHeirs.push({ id, known: { ...w.known() } });
      return true;
    }
    if (id === "D3" && optionsFor("D3", 0, w).length < GRANDPARENTS.length) skippedHeirs.push({ id, known: { ...w.known() } });
    const options = optionsFor(id, i, w);
    const v = answers[key];
    if (v === undefined || !validAnswer(id, i, v, options, eff)) {
      cursor = { key, id, i, options };
      return false;
    }
    eff[key] = v;
    opts[key] = options;
    steps.push({ key, id, i, value: v, options });
    const ex = nodeExit(id, v);
    if (ex) {
      exit = { id: ex, at: key };
      return false;
    }
    return true;
  };

  let go = true;
  for (const id of PRE_LOOP) if (go) go = visit(id, 0);
  for (let i = 1; go && i <= MAX_ANAK_WAFAT; i++) {
    const exists = i === 1 ? str(eff, "C3") === "ya" : str(eff, `C4m.${i - 1}`) === "ya";
    if (!exists) break;
    for (const id of LOOP_NODES) if (go) go = visit(id, i);
  }
  for (const id of POST_LOOP) if (go) go = visit(id, 0);
  if (go) {
    const gate = familyGate(w);
    if (gate) {
      exit = gate;
      go = false;
    }
  }
  for (const id of WASIAT) if (go) go = visit(id, 0);

  return {
    steps,
    eff,
    cursor,
    exit,
    opts,
    notAsked: notAskedFrom(skippedHeirs),
    complete: go,
  };
}

function nodeExit(id: NodeId, v: AnswerValue): ExitId | null {
  if (id === "A1" && v === "wafat_nonmuslim") return "E-NONMUSLIM";
  if (id === "A3" && Array.isArray(v) && (v as readonly string[]).includes("k7")) return "E-KHUNTSA";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

const EXIT_BY_REASON: readonly (readonly [RujukReason, ExitId])[] = [
  ["beda_agama_pewaris", "E-NONMUSLIM"],
  ["khuntsa", "E-KHUNTSA"],
  ["dugaan_pembunuhan", "E-BUNUH"],
  ["mafqud", "E-MAFQUD"],
  ["haml", "E-HAML"],
  ["gharqa", "E-BERSAMAAN"],
  ["kerabat_jauh", "E-KERABAT-JAUH"],
  ["utang_melebihi_harta", "E-UTANG"],
  ["dzawil_arham", "E-DZAWIL"],
  ["dzawil_arham_campuran", "E-DZAWIL"],
  ["tanpa_ahli_waris", "E-TANPA-AHLI-WARIS"],
];

/** The exit page for a refusal in both columns (engine reasons, plan §5.4 table). */
export function exitFor(fikih: readonly RujukReason[], pengadilan: readonly RujukReason[]): ExitId {
  for (const [r, e] of EXIT_BY_REASON) if (fikih.includes(r) || pengadilan.includes(r)) return e;
  return "E-RUJUK";
}

function column(r: Result, rs: typeof FIKIH, id: ColumnOutcome["ruleset"]): ColumnOutcome {
  const p = applyPolicy(r, rs);
  return { ruleset: id, result: p.result, refused: p.result.kind === "rujuk", ...(p.policy ? { policy: p.policy } : {}) };
}

interface ComboOutcome {
  outcome: ReportOutcome;
  notes: QNote[];
  sig: string;
  whole: boolean;
}

function outcomeFor(m: Answers, amounts: Amounts | undefined, full: boolean): ComboOutcome {
  const { input, notes } = toInput(m, amounts);
  const f = full ? solve(input, FIKIH) : solveCached(input, FIKIH);
  const c = full ? solve(input, COURT) : solveCached(input, COURT);
  const fikih = column(f, FIKIH, "klasik-syafii");
  const pengadilan = column(c, COURT, "standar-indonesia");
  return {
    outcome: { fikih, pengadilan, input, berbeda: moneySig(fikih.result) !== moneySig(pengadilan.result) },
    notes,
    sig: `${fullSig(fikih.result)}\n||\n${fullSig(pengadilan.result)}`,
    whole: fikih.refused && pengadilan.refused,
  };
}

function reasonsOf(o: ReportOutcome): { fikih: RujukReason[]; pengadilan: RujukReason[] } {
  return {
    fikih: o.fikih.result.kind === "rujuk" ? [...o.fikih.result.reasons] : [],
    pengadilan: o.pengadilan.result.kind === "rujuk" ? [...o.pengadilan.result.reasons] : [],
  };
}

/**
 * Before the wasiat questions (plan §5.2: no heirs → E-TANPA-AHLI-WARIS replaces G1): a refusal in
 * both columns that no wasiat answer can lift (out of scope, beyond depth, dzawil arham, no heir).
 */
function familyGate(w: W): ExitHit | null {
  const nodes = scenarioNodes(w.eff, w.opts);
  const combos = combosOf(nodes);
  if (combos === null) return { id: "E-TIDAK-TAHU", at: "keluarga", nodes: nodes.map((n) => n.key) };
  const outs = combos.map((c) => outcomeFor({ ...w.eff, ...c.overlay }, undefined, false));
  if (!outs.some((o) => o.whole)) return null;
  if (outs.every((o) => o.whole)) {
    const exits = outs.map((o) => {
      const r = reasonsOf(o.outcome);
      return exitFor(r.fikih, r.pengadilan);
    });
    if (exits.every((e) => e === exits[0])) {
      const r = reasonsOf(outs[0].outcome);
      return { id: exits[0], at: "keluarga", reasons: r, ...specialRoles(w.eff, exits[0]) };
    }
  }
  const sigs = outs.map((o) => (o.whole ? "whole" : "computed"));
  return { id: "E-TIDAK-TAHU", at: "keluarga", nodes: mattering(nodes, combos, sigs).map((u) => nodes[u].key) };
}

/** E-MAFQUD / E-HAML / E-BERSAMAAN: which picked groups could change a number. */
function specialRoles(eff: Answers, exit: ExitId): { roles?: RoleGroup[] } {
  const key = exit === "E-MAFQUD" ? "A3c" : exit === "E-HAML" ? "A3d" : exit === "E-BERSAMAAN" ? "A3e" : null;
  if (!key) return {};
  const groups = (arr(eff, key) ?? []).filter((g): g is RoleGroup => (ROLE_GROUPS as readonly string[]).includes(g));
  return { roles: specialRelevantGroups(eff, buildFamily(eff, { final: false }), groups) };
}

export function modeOf(a: Answers): Mode {
  const a1 = str(a, "A1");
  if (a1 === "saya_hidup") return "diri";
  if (a1 === "simulasi_keluarga") return "keluarga";
  return "wafat";
}

function questionnaireNotes(eff: Answers): QNote[] {
  const out: QNote[] = [];
  const f = flagsOf(eff);
  if (modeOf(eff) !== "wafat") out.push("simulasi");
  if (str(eff, "B1") === "iddah") out.push("iddah");
  if (f.has("k9")) out.push("nikah_siri");
  if (f.has("k8")) out.push("anak_tiri");
  const fam = buildFamily(eff, { final: false });
  const label: Record<string, QNote> = { A3c: "hilang_tanpa_pengaruh", A3d: "kandungan_tanpa_pengaruh", A3e: "bersamaan_tanpa_pengaruh" };
  for (const [key] of SPECIAL) {
    if (!f.has(SPECIAL_FLAG[key])) continue;
    const groups = (arr(eff, key) ?? []) as readonly RoleGroup[];
    if (groups.length > 0 && specialRelevantGroups(eff, fam, groups).length === 0) out.push(label[key]);
  }
  return out;
}

/**
 * The outcome of the answers (plan §5.4, §6, D15). With amounts (the rupiah panel), debts ≥ the
 * estate refuse (E-UTANG) and the wasiat values enter.
 */
export function evaluate(answers: Answers, amounts?: Amounts): Evaluation {
  const w = walk(answers);
  if (w.exit) return { kind: "keluar", exit: w.exit };
  if (w.cursor) return w.cursor.id === "A1s" ? { kind: "keluar", exit: { id: "E-HIDUP", at: "A1" } } : { kind: "belum_selesai", next: w.cursor.key };
  const nodes = scenarioNodes(w.eff, w.opts);
  const combos = combosOf(nodes);
  if (combos === null) return { kind: "keluar", exit: { id: "E-TIDAK-TAHU", at: "laporan", nodes: nodes.map((n) => n.key) } };
  const outs = combos.map((c) => outcomeFor({ ...w.eff, ...c.overlay }, amounts, true));
  const sigs = outs.map((o) => o.sig);
  const matter = mattering(nodes, combos, sigs);
  const base = outs[0];
  const mode = modeOf(w.eff);
  if (matter.length > 1 || (matter.length === 1 && outs.some((o) => o.whole))) {
    return { kind: "keluar", exit: { id: "E-TIDAK-TAHU", at: "laporan", nodes: matter.map((u) => nodes[u].key) } };
  }
  if (matter.length === 0 && base.whole) {
    const r = reasonsOf(base.outcome);
    return { kind: "keluar", exit: { id: exitFor(r.fikih, r.pengadilan), at: "laporan", reasons: r } };
  }
  let perlu: Extract<Evaluation, { kind: "laporan" }>["perluDipastikan"] = null;
  if (matter.length === 1) {
    const u = matter[0];
    const alternatives: { option: UnknownOption; outcome: ReportOutcome }[] = [];
    for (let ri = 0; ri < nodes[u].readings.length; ri++) {
      const idx = combos.map((c, ci) => (c.reading[u] === ri ? ci : -1)).filter((ci) => ci >= 0);
      const s = new Set(idx.map((ci) => sigs[ci]));
      if (s.size !== 1) return { kind: "keluar", exit: { id: "E-TIDAK-TAHU", at: "laporan", nodes: [nodes[u].key] } };
      alternatives.push({ option: nodes[u].readings[ri].option, outcome: outs[idx[0]].outcome });
    }
    perlu = { key: nodes[u].key, subject: nodes[u].subject, alternatives };
  }
  const notes = [...questionnaireNotes(w.eff)];
  for (const x of base.notes) if (!notes.includes(x)) notes.push(x);
  const tidakBerpengaruh = nodes.filter((_, j) => !matter.includes(j)).map((n) => n.key);
  const request: ReportRequest = {
    input: base.outcome.input,
    options: {
      mode: mode === "wafat" ? "wafat" : "simulasi",
      pewaris: pewarisKind(w.eff),
      answerCode: answerCodeOf(w.eff),
      notAsked: w.notAsked,
      unknowns: unknownReadings(nodes, combos, outs),
      flags: {
        ...(str(w.eff, "B1") === "iddah" ? { iddahRaji: true } : {}),
        ...(flagsOf(w.eff).has("k9") ? { nikahSiri: true } : {}),
        ...(notes.includes("wasiat_tidak_diketahui") ? { wasiatTidakTahu: true } : {}),
      },
    },
  };
  return { kind: "laporan", mode, utama: base.outcome, perluDipastikan: perlu, tidakBerpengaruh, notes, request };
}

/** report/options.ts UnknownInput[]: each reading's input with every other «Tidak tahu» at its first reading. */
function unknownReadings(nodes: readonly ScenarioNode[], combos: readonly Combo[], outs: readonly ComboOutcome[]): UnknownReading[] {
  return nodes.map((n, u) => ({
    node: n.key,
    subject: n.subject,
    answer: n.answer,
    variants: n.readings.map((r, ri) => {
      const ci = combos.findIndex((c) => c.reading[u] === ri && c.pick.every((p, j) => j === u || p === 0) && firstOfReading(n, ri) === c.pick[u]);
      return { option: r.option, input: outs[ci < 0 ? 0 : ci].outcome.input, ...(ri === 0 ? { base: true } : {}) };
    }),
  }));
}
function firstOfReading(n: ScenarioNode, ri: number): number {
  let at = 0;
  for (let r = 0; r < ri; r++) at += n.readings[r].overlays.length;
  return at;
}

// ---------------------------------------------------------------------------------------------
// "Saudara tidak ditanyakan karena …" (plan §5.1; report "Yang tidak mendapat bagian")
// ---------------------------------------------------------------------------------------------

const NOT_ASKED_GROUP: Partial<Record<NodeId, NotAskedGroup>> = {
  E1: "saudara_kandung",
  E2: "saudara_seayah",
  E3: "saudara_seibu",
  F1: "keponakan",
  F2: "paman",
  F3: "sepupu",
};
const NODE_ROLES: Partial<Record<NodeId, readonly HeirId[]>> = { ...SIBLINGS, F1: AGNATES.F1.roles, F2: AGNATES.F2.roles, F3: AGNATES.F3.roles };

/**
 * A minimal set of present relatives whose absence would make one of `roles` relevant, found by
 * asking couldAffectOutcome() (derived, not tabled). Empty when no removal helps (e.g. the
 * group could not change a number for another reason, such as nothing being left over).
 */
function blockersOf(roles: readonly HeirId[], known: KnownCounts): string[] {
  const present = Object.entries(known)
    .filter(([, c]) => typeof c === "number" && c > 0)
    .map(([r]) => r);
  const without = (rs: readonly string[]): KnownCounts => {
    const k: Record<string, number | undefined> = { ...known };
    for (const r of rs) k[r] = 0;
    return k as KnownCounts;
  };
  const relevantWithout = (rs: readonly string[]) => roles.some((x) => relevantRole(x, without(rs)));
  if (!relevantWithout(present)) return [];
  let need = [...present];
  for (const r of present) {
    const rest = need.filter((x) => x !== r);
    if (relevantWithout(rest)) need = rest;
  }
  return [...new Set(need.map((r) => (r === "predeceasedSons" || r === "predeceasedDaughters" ? "pengganti" : r)))];
}

function notAskedFrom(xs: readonly { id: NodeId; known: KnownCounts }[]): NotAsked[] {
  const out: NotAsked[] = [];
  for (const x of xs) {
    if (x.id === "D3") {
      for (const g of GRANDPARENTS) {
        if (relevantRole(g, x.known)) continue;
        const group: NotAskedGroup = g === "kakek" ? "kakek" : "nenek";
        if (!out.some((o) => o.group === group)) out.push({ group, because: blockersOf([g], x.known) });
      }
      continue;
    }
    const group = NOT_ASKED_GROUP[x.id];
    const roles = NODE_ROLES[x.id];
    if (group && roles) out.push({ group, because: blockersOf(roles, x.known) });
  }
  const sib = out.filter((o) => o.group.startsWith("saudara_"));
  if (sib.length === 3 && sib.every((o) => o.because.join() === sib[0].because.join())) {
    return [{ group: "saudara", because: sib[0].because }, ...out.filter((o) => !o.group.startsWith("saudara_"))];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------------------------

export function initialState(): QState {
  return { v: 1, answers: {}, at: null };
}

/**
 * A3 as the UI collects it (k0..k9, k6 included): k6 goes to E-BUNUH at once and NOTHING is
 * dispatched; otherwise the stored answer (k0 = the empty selection, k6 never present).
 */
export function a3Route(selection: readonly A3UiOption[]): { kind: "bunuh" } | { kind: "jawab"; value: readonly string[] } {
  if (selection.includes(KILLER_OPTION)) return { kind: "bunuh" };
  const stored = NODE.A3.options;
  return { kind: "jawab", value: stored.filter((o) => selection.includes(o as A3UiOption)) };
}
export { A3_UI_OPTIONS };

function carriesKiller(v: AnswerValue): boolean {
  return v === KILLER_OPTION || (Array.isArray(v) && (v as readonly string[]).includes(KILLER_OPTION));
}

function sanitize(answers: Answers): Answers {
  const out: Record<string, AnswerValue> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!parseKey(k) || carriesKiller(v)) continue;
    if (typeof v === "string" || typeof v === "number") out[k] = v;
    else if (Array.isArray(v)) out[k] = (v as unknown[]).filter((x): x is string => typeof x === "string");
    else if (typeof v === "object" && v !== null && typeof (v as LP).L === "number" && typeof (v as LP).P === "number") out[k] = { L: (v as LP).L, P: (v as LP).P };
  }
  return out;
}

export function reduce(s: QState, act: Action): QState {
  switch (act.type) {
    case "jawab": {
      if (carriesKiller(act.value)) return s; // never stored (plan §5.6)
      const p = parseKey(act.key);
      if (!p) return s;
      const w = walk(s.answers);
      const target = w.cursor && w.cursor.key === act.key ? w.cursor : w.steps.find((x) => x.key === act.key);
      if (!target) return s;
      // validate against the answers BEFORE this node (its own options and bounds)
      const before = answersBefore(w, act.key);
      if (!validAnswer(p.id, p.i, act.value, target.options, before)) return s;
      return { v: 1, answers: { ...s.answers, [act.key]: normalize(act.value) }, at: null };
    }
    case "kembali": {
      const w = walk(s.answers);
      const keys = w.steps.map((x) => x.key);
      if (keys.length === 0) return s;
      const here = typeof s.at === "string" && s.at !== "ringkasan" ? keys.indexOf(s.at) : -1;
      if (here > 0) return { ...s, at: keys[here - 1] };
      if (here === 0) return s;
      // on the cursor, an exit page, or the review screen: back to the last answered node
      return { ...s, at: keys[keys.length - 1] };
    }
    case "ubah": {
      const w = walk(s.answers);
      return w.steps.some((x) => x.key === act.key) ? { ...s, at: act.key } : s;
    }
    case "lanjut_simulasi":
      return str(s.answers, "A1") === "saya_hidup" ? { v: 1, answers: { ...s.answers, A1s: "ya" }, at: null } : s;
    case "ringkasan":
      return walk(s.answers).complete ? { ...s, at: "ringkasan" } : s;
    case "ulang":
      return initialState();
    case "muat":
      return { v: 1, answers: sanitize(act.answers), at: null };
  }
}

function answersBefore(w: Walk, key: QKey): Answers {
  const out: Record<string, AnswerValue> = {};
  for (const st of w.steps) {
    if (st.key === key) break;
    out[st.key] = st.value;
  }
  return out;
}

function normalize(v: AnswerValue): AnswerValue {
  if (Array.isArray(v)) return [...(v as readonly string[])];
  if (typeof v === "object" && v !== null) return { L: (v as LP).L, P: (v as LP).P };
  return v;
}

// ---------------------------------------------------------------------------------------------
// Views for the UI
// ---------------------------------------------------------------------------------------------

export interface NodeView {
  key: QKey;
  id: NodeId;
  /** Predeceased-child number (C4 loop), else 0. */
  instance: number;
  section: SectionId;
  kind: NodeDef["kind"];
  /** Options offered now, with their Q_TEXT key (variant-aware; G2: "peran.<role>"). */
  options: readonly { id: string; text: string }[];
  allowUnknown: boolean;
  min: number;
  max: number;
  /** For two-stepper Muslim counts: the bound per sex. */
  maxLP?: LP;
  /** Text keys in Q_TEXT (text.ts): question, "Kenapa kami tanyakan ini?", help. */
  text: { tanya: string; mengapa: string; bantuan: string | null };
  /** RuleNotes behind "Kenapa kami tanyakan ini?" (plan D10). */
  why: NodeDef["why"];
  value?: AnswerValue;
}

export type View =
  | { kind: "tanya"; node: NodeView; edit: boolean }
  | { kind: "keluar"; exit: ExitHit; print: boolean; lanjutSimulasi: boolean }
  | { kind: "ringkasan" };

/** The question's text key: Muslim-only wording (F-stage, C4b), singular wording (B3, D1m, G4). */
function questionKey(id: NodeId, a: Answers, max: number): string {
  if ((id === "F1" || id === "F2" || id === "F3" || id === "F5" || id === "F4") && needReligion(a, "kerabat")) return `${id}.muslim.tanya`;
  if (id === "C4b" && needReligion(a, "cucu")) return "C4b.muslim.tanya";
  if (id === "B3" && max <= 1) return "B3.tanya_satu";
  if (id === "B1b" && str(a, "B1") === "pernah") return "B1b.tanya_pernah";
  if (id === "D1m" && str(a, "D1") !== "keduanya") return "D1m.tanya_satu";
  if (id === "G4" && heirPersons(a) <= 1) return "G4.tanya_satu";
  return `${id}.tanya`;
}

/** An option's text key (B1 for a woman, D1m for one parent, C4b by the child's line, G2 roles). */
function optionKey(id: NodeId, i: number, opt: string, a: Answers): string {
  if (id === "G2") return `peran.${opt}`;
  if (id === "B1" && opt === "ya_satu" && sexOf(a) === "P") return "B1.opsi.ya_satu_P";
  if (id === "D1m" && str(a, "D1") !== "keduanya") return opt === "tidak_ada" ? "D1m.opsi.tidak_satu" : "D1m.opsi.ya_satu";
  if (id === "C4b" && opt === "keturunan_jauh") return `C4b.opsi.keturunan_jauh_${str(a, `C4s.${i}`) === "P" ? "P" : "L"}`;
  return `${id}.opsi.${opt}`;
}

/** Persons with a share in the larger column, for G4's singular wording. */
function heirPersons(a: Answers): number {
  if (!sexOf(a)) return 0;
  const fam = buildFamily(a, { final: true });
  let most = 0;
  for (const rs of [FIKIH, COURT]) {
    const r = solveCached({ family: fam }, rs);
    if (r.kind === "hasil") {
      const n = r.shares.reduce((acc, g) => acc + g.persons.length, 0);
      if (n > most) most = n;
    }
  }
  return most;
}

export function nodeView(w: Walk, key: QKey, value?: AnswerValue): NodeView | null {
  const p = parseKey(key);
  if (!p) return null;
  const st = w.steps.find((x) => x.key === key) ?? (w.cursor && w.cursor.key === key ? w.cursor : null);
  if (!st) return null;
  const def = NODE[p.id];
  const before = answersBefore(w, key);
  const b = boundsFor(p.id, p.i, before);
  return {
    key,
    id: p.id,
    instance: p.i,
    section: def.section,
    kind: def.kind,
    options: st.options.map((o) => ({ id: o, text: optionKey(p.id, p.i, o, before) })),
    allowUnknown: def.unknown,
    min: b.min,
    max: b.max,
    ...(b.maxLP ? { maxLP: b.maxLP } : {}),
    text: { tanya: questionKey(p.id, before, b.max), mengapa: `${p.id}.mengapa`, bantuan: HAS_HELP.has(p.id) ? `${p.id}.bantuan` : null },
    why: def.why,
    ...(value !== undefined ? { value } : {}),
  };
}

/** Nodes with a help line in Q_TEXT (kept in sync by the text-key check). */
export const HAS_HELP: ReadonlySet<NodeId> = new Set<NodeId>(["A3", "B1", "C1", "C3", "D3", "E3", "F1", "F2", "F3", "F4", "F5", "G3"]);

export function view(s: QState): View {
  const w = walk(s.answers);
  if (typeof s.at === "string" && s.at !== "ringkasan") {
    const st = w.steps.find((x) => x.key === s.at);
    if (st) {
      const nv = nodeView(w, st.key, st.value);
      if (nv) return { kind: "tanya", node: nv, edit: true };
    }
  }
  if (w.exit) return exitView(w.exit);
  if (w.cursor) {
    if (w.cursor.id === "A1s") return exitView({ id: "E-HIDUP", at: "A1" });
    const nv = nodeView(w, w.cursor.key, s.answers[w.cursor.key]);
    if (nv) return { kind: "tanya", node: nv, edit: false };
  }
  return { kind: "ringkasan" };
}

function exitView(e: ExitHit): View {
  const d = EXITS[e.id];
  return { kind: "keluar", exit: e, print: d.print, lanjutSimulasi: d.lanjutSimulasi };
}

/** Named sections without a total (plan §5.7 "Progress"). */
export function progress(s: QState): { section: SectionId; status: "selesai" | "sekarang" | "nanti" | "dilewati" }[] {
  const w = walk(s.answers);
  const done = new Set(w.steps.map((x) => NODE[x.id].section));
  const atKey = typeof s.at === "string" && s.at !== "ringkasan" ? s.at : (w.cursor?.key ?? null);
  const at = atKey ? parseKey(atKey) : null;
  const current: SectionId | null = at ? NODE[at.id].section : null;
  const order = SECTIONS as readonly SectionId[];
  const curIdx = current ? order.indexOf(current) : w.complete ? order.length : -1;
  return order.map((sec, idx) => {
    if (sec === current) return { section: sec, status: "sekarang" as const };
    if (done.has(sec) && (curIdx < 0 || idx < curIdx || w.complete)) return { section: sec, status: "selesai" as const };
    if (curIdx >= 0 && idx < curIdx) return { section: sec, status: "dilewati" as const };
    return { section: sec, status: "nanti" as const };
  });
}

/** Answered screens on the path (plan §5.5 counts these; the review screen and A1s are not). */
export function screenCount(answers: Answers): number {
  return walk(answers).steps.filter((x) => NODE[x.id].screen).length;
}

/** The answers in path order, for the review screen and "Cetak ringkasan jawaban Anda". */
export function answerSummary(s: QState): { key: QKey; id: NodeId; instance: number; section: SectionId; value: AnswerValue }[] {
  return walk(s.answers).steps.map((x) => ({ key: x.key, id: x.id, instance: x.i, section: NODE[x.id].section, value: x.value }));
}

/** Who has been entered so far, by role, for the live family tree (ux.md §4.7). */
export function familyPreview(s: QState): { role: string; count: number; bukanMuslim: number }[] {
  const w = walk(s.answers);
  if (!sexOf(w.eff)) return [];
  const fam = buildFamily(w.eff, { final: false });
  const tally = new Map<string, { count: number; bukanMuslim: number }>();
  const put = (role: string, nonMuslim: boolean) => {
    const t = tally.get(role) ?? { count: 0, bukanMuslim: 0 };
    t.count++;
    if (nonMuslim) t.bukanMuslim++;
    tally.set(role, t);
  };
  const spouse = fam.deceased.sex === "L" ? "istri" : "suami";
  for (const p of fam.spouses) put(spouse, p.religion !== "islam");
  for (const c of fam.children) {
    if (c.alive) put(c.sex === "L" ? "anak_lk" : "anak_pr", c.religion !== "islam");
    else {
      put(c.sex === "L" ? "anak_lk_wafat" : "anak_pr_wafat", c.religion !== "islam");
      for (const g of c.children ?? []) if (g.alive) put(c.sex === "L" ? (g.sex === "L" ? "cucu_lk" : "cucu_pr") : "cucu_dari_anak_pr", g.religion !== "islam");
    }
  }
  if (fam.father) put("ayah", fam.father.religion !== "islam");
  if (fam.mother) put("ibu", fam.mother.religion !== "islam");
  if (fam.paternalGrandfather) put("kakek", fam.paternalGrandfather.religion !== "islam");
  if (fam.maternalGrandmother) put("nenek_ibu", fam.maternalGrandmother.religion !== "islam");
  if (fam.paternalGrandmother) put("nenek_ayah", fam.paternalGrandmother.religion !== "islam");
  for (const x of fam.siblings) {
    if (x.alive) put(`sdr_${x.sex === "L" ? "lk" : "pr"}_${x.line}`, x.religion !== "islam");
    else if (x.id.startsWith("kpn.")) for (const k of x.children ?? []) put(`keponakan_lk_${x.line}`, k.religion !== "islam");
  }
  for (const u of fam.paternalUncles) {
    if (u.alive) put(`paman_${u.line}`, u.religion !== "islam");
    else if (u.id.startsWith("spp.")) for (const k of u.children ?? []) put(`sepupu_lk_${u.line}`, k.religion !== "islam");
  }
  for (const ad of fam.adoptedChildren ?? []) put("anak_angkat", ad.religion !== "islam");
  for (const st of fam.stepChildren ?? []) put("anak_tiri", st.religion !== "islam");
  return [...tally.entries()].map(([role, t]) => ({ role, ...t }));
}

/** Who the questions and the report are about: the user (a plan), a living relative, or the deceased. */
export function pewarisKind(a: Answers): PewarisKind {
  const mode = modeOf(a);
  if (mode === "diri") return "anda";
  if (mode === "keluarga") return "beliau";
  return sexOf(a) === "P" ? "almarhumah" : "almarhum";
}

/** Placeholder values for the Q_TEXT strings ({pewaris}, {saat}, {pasangan}, …). */
export function messageVars(answers: Answers): Record<string, string> {
  const a = walk(answers).eff;
  const mode = modeOf(a);
  const sex = sexOf(a);
  const kind = pewarisKind(a);
  const pewaris = kind === "anda" ? "Anda" : kind;
  const saat = mode === "wafat" ? `saat ${pewaris} wafat` : `jika ${pewaris} wafat hari ini`;
  const cap = (x: string) => (x.length > 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x);
  const pasangan = sex === "P" ? "suami" : "istri";
  return { pewaris, Pewaris: cap(pewaris), saat, Saat: cap(saat), pasangan, Pasangan: cap(pasangan) };
}

/** The k6 option id, exported for the UI's A3 screen and the privacy tests. */
export { KILLER_OPTION };
