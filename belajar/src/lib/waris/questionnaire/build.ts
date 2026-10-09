/**
 * From answers to the engine's input, and the engine-derived tests the walk uses.
 *
 *  - knownCounts(): what couldAffectOutcome() needs — ELIGIBLE (Muslim) counts per role; a role
 *    whose node is not answered yet, or was answered «Tidak tahu», is ABSENT ("maybe present").
 *  - buildFamily(): the structured FamilyInput (engine.md §2) the answers describe. Facts that a
 *    count cannot carry are placed in the structure the engine reads: nephews under a brother who
 *    died first, cousins under an uncle who died first, beyond-depth relatives (C4b, F5) under the
 *    line the engine checks, so that the ENGINE decides kerabat_jauh / dzawil_arham (task: "align
 *    C4b with the engine's kerabat_jauh rule so they agree").
 *  - buildEstate(): the wasiat (G1–G4) and the optional rupiah panel.
 *  - probe(): "does adding one such relative change any number in any ruleset?" via solveOnce().
 *  - applyPolicy(): plan D4 — v1 refuses dzawil arham in the fikih column.
 *
 * No float arithmetic, no network (eslint waris guard). AI-assisted, not an authoritative fatwa.
 */
import { THIRD, frac, toStr, type Frac } from "../frac";
import { couldAffectOutcome, couldInherit, type KnownCounts } from "../hajb";
import { COMPARISON_VARIANTS, resolveRuleset, type HeirId, type Ruleset, type Sex } from "../registry";
import { solveOnce } from "../solve";
import type { EstateInput, FamilyInput, OutOfScopeFact, Person, Result, Rujuk, SiblingPerson, UnclePerson, WarisInput, WasiatInput } from "../types";
import { MAX_ANAK_WAFAT } from "./graph";
import { TIDAK_TAHU, type Amounts, type AnswerValue, type Answers, type LP, type QNote, type RelGroup, type RoleGroup } from "./types";

// ---------------------------------------------------------------------------------------------
// Rulesets
// ---------------------------------------------------------------------------------------------

export const FIKIH: Ruleset = resolveRuleset("klasik-syafii");
export const COURT: Ruleset = resolveRuleset("standar-indonesia");
export const REPORT_RULESETS: readonly Ruleset[] = [FIKIH, COURT];
/**
 * Every ruleset the questionnaire asks for (plan M2.1: "per ruleset (both columns and the
 * comparison variants)"). The report shows only the two columns; the variants feed "Catatan
 * metode" and the tests, so a relative a variant needs is asked too (e.g. uterine siblings beside
 * the grandfather for uterineExcludedBy=khi181).
 */
export const RELEVANCE_RULESETS: readonly Ruleset[] = [
  FIKIH,
  COURT,
  resolveRuleset("klasik-syafii-asal"),
  ...COMPARISON_VARIANTS.map((v) => resolveRuleset(v)),
];
const VARIANT_SWITCHES = RELEVANCE_RULESETS.slice(2).map((r) => r.switches);

/** couldAffectOutcome() over both columns, OR couldInherit() under any comparison variant. */
export function relevantRole(x: HeirId, known: KnownCounts): boolean {
  if (couldAffectOutcome(x, known)) return true;
  for (const sw of VARIANT_SWITCHES) if (couldInherit(x, known, sw)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Answer accessors
// ---------------------------------------------------------------------------------------------

export const isTT = (v: AnswerValue | undefined): boolean => v === TIDAK_TAHU;
export function str(a: Answers, k: string): string | undefined {
  const v = a[k];
  return typeof v === "string" && v !== TIDAK_TAHU ? v : undefined;
}
export function arr(a: Answers, k: string): readonly string[] | undefined {
  const v = a[k];
  return Array.isArray(v) ? (v as readonly string[]) : undefined;
}
export function num(a: Answers, k: string): number | undefined {
  const v = a[k];
  return typeof v === "number" ? v : undefined;
}
export function lp(a: Answers, k: string): LP | undefined {
  const v = a[k];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as LP) : undefined;
}
export const lpTotal = (x: LP | undefined): number => (x ? x.L + x.P : 0);

export function sexOf(a: Answers): Sex | undefined {
  const s = str(a, "A2");
  return s === "L" || s === "P" ? s : undefined;
}
export function flagsOf(a: Answers): ReadonlySet<string> {
  return new Set(arr(a, "A3") ?? []);
}
/** A3a groups; «Tidak tahu» = every group is followed up (plan §5.7: religion counts allow it). */
export function groupsOf(a: Answers): ReadonlySet<string> | "semua" {
  if (isTT(a.A3a)) return "semua";
  return new Set(arr(a, "A3a") ?? []);
}
/** The religion follow-up of a group is asked (A3 k1 ticked and the group selected in A3a). */
export function needReligion(a: Answers, g: RelGroup): boolean {
  if (!flagsOf(a).has("k1")) return false;
  const gs = groupsOf(a);
  return gs === "semua" || gs.has(g);
}

/** Living spouses at death per B1/B2; undefined when not known yet (or «Tidak tahu» / iddah). */
export function spouseN(a: Answers): number | undefined {
  const b1 = str(a, "B1");
  if (b1 === "ya_satu") return 1;
  if (b1 === "ya_lebih") return num(a, "B2");
  if (b1 === "pernah" || b1 === "belum") return 0;
  return undefined;
}
/** Spouses for the family builder: iddah counts as one (its «both outcomes» overlay decides). */
function spouseForFamily(a: Answers): number {
  const b1 = str(a, "B1");
  if (b1 === "iddah") return 1;
  return spouseN(a) ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Predeceased children (the C4 loop)
// ---------------------------------------------------------------------------------------------

export interface PredInstance {
  i: number;
  sex: Sex;
  /** C4r (taken as Muslim when not asked). */
  muslim: boolean;
  /** Living grandchildren (C4g); undefined while unanswered or «Tidak tahu». */
  kids: LP | undefined;
  /** Muslim grandchildren per sex (C4gm when asked, else = kids). */
  kidsMuslim: LP | undefined;
  /** C4b answers. */
  extras: readonly string[];
  /** Every count and religion this instance needs is answered (no «Tidak tahu»). */
  known: boolean;
}

/** The predeceased children entered so far, in loop order (stops where the loop stops). */
export function predInstances(a: Answers): PredInstance[] {
  const out: PredInstance[] = [];
  if (str(a, "C3") !== "ya") return out;
  for (let i = 1; i <= MAX_ANAK_WAFAT; i++) {
    const s = str(a, `C4s.${i}`);
    if (s !== "L" && s !== "P") break;
    const g = lp(a, `C4g.${i}`);
    const needR = needReligion(a, "anak");
    const needGm = needReligion(a, "cucu") && lpTotal(g) > 0;
    const gm = needGm ? lp(a, `C4gm.${i}`) : g;
    const known = (!needR || str(a, `C4r.${i}`) !== undefined) && g !== undefined && gm !== undefined;
    out.push({ i, sex: s, muslim: str(a, `C4r.${i}`) !== "tidak", kids: g, kidsMuslim: gm, extras: arr(a, `C4b.${i}`) ?? [], known });
    if (str(a, `C4m.${i}`) !== "ya") break;
  }
  return out;
}

/** The C4 loop is answered to its end with no «Tidak tahu» in a count or a religion. */
function predLoopKnown(a: Answers): boolean {
  if (str(a, "C3") === "tidak") return true;
  if (str(a, "C3") !== "ya") return false;
  const xs = predInstances(a);
  if (xs.length === 0 || xs.some((x) => !x.known)) return false;
  const last = xs[xs.length - 1];
  return last.i === MAX_ANAK_WAFAT || str(a, `C4m.${last.i}`) === "tidak";
}

// ---------------------------------------------------------------------------------------------
// Known counts for couldAffectOutcome (eligible = Muslim; killers never get here: A3 k6)
// ---------------------------------------------------------------------------------------------

function lpMuslim(a: Answers, countKey: string, muslimKey: string, g: RelGroup): LP | undefined {
  const c = lp(a, countKey);
  if (!c) return undefined;
  if (!needReligion(a, g) || lpTotal(c) === 0) return c;
  return lp(a, muslimKey);
}

/**
 * Known counts. `asIf` counts a non-Muslim spouse, child or parent AS a Muslim: the court column's
 * wasiat-wajibah illustration solves exactly that family (solve.ts §11.4 b), so a relative who
 * changes the as-if shares (e.g. siblings lowering a non-Muslim mother's as-if share to ⅙) must be
 * asked even though the real family makes them irrelevant.
 */
export function knownCounts(a: Answers, asIf = false): KnownCounts {
  const k: KnownCounts = {};
  if (asIf) {
    a = asIfAnswers(a);
  }
  const sex = sexOf(a);
  if (!sex) return k;
  // spouse
  const n = spouseN(a);
  if (n !== undefined) {
    const role: HeirId = sex === "L" ? "istri" : "suami";
    if (n === 0 || !needReligion(a, "pasangan")) k[role] = n;
    else if (num(a, "B3") !== undefined) k[role] = num(a, "B3");
  }
  // children
  const ch = lpMuslim(a, "C1", "C1m", "anak");
  if (ch) {
    k.anak_lk = ch.L;
    k.anak_pr = ch.P;
  } else if (a.C1 === undefined && (str(a, "B1") === "belum" && sex === "L")) {
    k.anak_lk = 0;
    k.anak_pr = 0;
  }
  // grandchildren through predeceased children (classical cucu via sons; KHI-185 slots), plus the
  // children of a living son who is not Muslim (C1n: he does not block them)
  const noC = str(a, "B1") === "belum" && sex === "L";
  const viaNonMuslim = lp(a, "C1n");
  if ((noC || predLoopKnown(a)) && !isTT(a.C1n)) {
    let cl = viaNonMuslim?.L ?? 0;
    let cp = viaNonMuslim?.P ?? 0;
    let ps = 0;
    let pd = 0;
    for (const x of predInstances(a)) {
      const km = x.kidsMuslim ?? { L: 0, P: 0 };
      if (x.sex === "L") {
        cl += km.L;
        cp += km.P;
      }
      if (x.muslim && lpTotal(km) > 0) {
        if (x.sex === "L") ps++;
        else pd++;
      }
    }
    k.cucu_lk = cl;
    k.cucu_pr = cp;
    k.predeceasedSons = ps;
    k.predeceasedDaughters = pd;
  }
  // parents
  const d1 = str(a, "D1");
  if (d1 !== undefined) {
    const alive = { ayah: d1 === "keduanya" || d1 === "ayah", ibu: d1 === "keduanya" || d1 === "ibu" };
    if (!needReligion(a, "orang_tua") || d1 === "tidak_ada") {
      k.ayah = alive.ayah ? 1 : 0;
      k.ibu = alive.ibu ? 1 : 0;
    } else {
      const m = str(a, "D1m");
      if (m !== undefined) {
        k.ayah = alive.ayah && (m === "keduanya" || m === "ayah") ? 1 : 0;
        k.ibu = alive.ibu && (m === "keduanya" || m === "ibu") ? 1 : 0;
      }
    }
  }
  // grandparents: once D3 is answered (or was never relevant, which needs the parents known)
  const d3 = arr(a, "D3");
  if (d3 !== undefined) {
    const m = needReligion(a, "kakek_nenek") && d3.length > 0 ? arr(a, "D3m") : d3;
    if (m !== undefined) for (const g of ["kakek", "nenek_ibu", "nenek_ayah"] as const) k[g] = d3.includes(g) && m.includes(g) ? 1 : 0;
  }
  // siblings
  for (const [key, line] of [
    ["E1", "kandung"],
    ["E2", "seayah"],
    ["E3", "seibu"],
  ] as const) {
    const s = lpMuslim(a, key, `${key}m`, "saudara");
    if (s) {
      k[`sdr_lk_${line}` as HeirId] = s.L;
      k[`sdr_pr_${line}` as HeirId] = s.P;
    }
  }
  // nephews / uncles / cousins (F1–F3 count Muslims only when "kerabat" is flagged)
  const agnate = (key: string, kandung: HeirId, seayah: HeirId, kOpt: string, sOpt: string) => {
    const f = str(a, key);
    if (f === "tidak") {
      k[kandung] = 0;
      k[seayah] = 0;
    } else if (f === kOpt) {
      const c = num(a, `${key}n`);
      if (c !== undefined) k[kandung] = c;
    } else if (f === sOpt) {
      const c = num(a, `${key}n`);
      k[kandung] = 0;
      if (c !== undefined) k[seayah] = c;
    }
  };
  agnate("F1", "keponakan_lk_kandung", "keponakan_lk_seayah", "kandung", "seayah");
  agnate("F2", "paman_kandung", "paman_seayah", "kandung", "seayah");
  agnate("F3", "sepupu_lk_kandung", "sepupu_lk_seayah", "dari_kandung", "dari_seayah");
  return k;
}

/** The answers with every living spouse / child / parent taken as Muslim (the as-if family). */
function asIfAnswers(a: Answers): Answers {
  const out: Record<string, AnswerValue> = { ...a };
  if (num(a, "B3") !== undefined) delete out.B3;
  if (lp(a, "C1m") !== undefined) delete out.C1m;
  if (str(a, "D1m") !== undefined) delete out.D1m;
  // with the follow-ups gone, needReligion() still asks for them: mark the groups as answered
  const gs = groupsOf(a);
  if (gs !== "semua") out.A3a = [...gs].filter((g) => g !== "pasangan" && g !== "anak" && g !== "orang_tua");
  else out.A3a = ["cucu", "kakek_nenek", "saudara", "kerabat"];
  return out;
}

/** Some living spouse, child or parent is not Muslim (a wasiat-wajibah candidate, court column). */
export function hasAsIfCandidate(a: Answers): boolean {
  if (!flagsOf(a).has("k1")) return false;
  const n = spouseN(a) ?? (str(a, "B1") === "iddah" ? 1 : 0);
  if (num(a, "B3") !== undefined && (num(a, "B3") ?? 0) < n) return true;
  const c = lp(a, "C1");
  const cm = lp(a, "C1m");
  if (c && cm && (cm.L < c.L || cm.P < c.P)) return true;
  const d1 = str(a, "D1");
  const d1m = str(a, "D1m");
  if (d1 && d1m && d1 !== "tidak_ada" && d1m !== d1 && d1m !== "keduanya") return true;
  // «Tidak tahu» on a religion follow-up: the as-if family may differ too
  return isTT(a.B3) || isTT(a.C1m) || isTT(a.D1m) || isTT(a.A3a);
}

// ---------------------------------------------------------------------------------------------
// Family builder
// ---------------------------------------------------------------------------------------------

const P = (id: string, sex: Sex, muslim = true, alive = true): Person => ({ id, sex, alive, religion: muslim ? "islam" : "non_islam" });

/** n persons of one sex, the first m of them Muslim. */
function persons(prefix: string, sex: Sex, n: number, m: number): Person[] {
  const out: Person[] = [];
  for (let j = 1; j <= n; j++) out.push(P(`${prefix}.${j}`, sex, j <= m));
  return out;
}

export interface BuildOptions {
  /** Decide the k3–k5 «siapa?» refusals (needs the whole family). Off while the walk probes. */
  final: boolean;
}

export function buildFamily(a: Answers, opts: BuildOptions): FamilyInput {
  const sex = sexOf(a) ?? "L";
  const spouseSex: Sex = sex === "L" ? "P" : "L";
  const fam: FamilyInput = { deceased: { sex, religion: "islam" }, spouses: [], children: [], siblings: [], paternalUncles: [] };

  // B. spouses
  const ns = spouseForFamily(a);
  const ms = needReligion(a, "pasangan") ? (num(a, "B3") ?? ns) : ns;
  fam.spouses.push(...persons("pasangan", spouseSex, ns, ms));

  // C. living children
  const c1 = lp(a, "C1");
  if (c1) {
    const m = needReligion(a, "anak") ? (lp(a, "C1m") ?? c1) : c1;
    fam.children.push(...persons("anak_lk", "L", c1.L, m.L), ...persons("anak_pr", "P", c1.P, m.P));
    // C1n / C1p: Muslim children of a living child who is not Muslim (attached to the first such child)
    for (const [key, sx] of [
      ["C1n", "L"],
      ["C1p", "P"],
    ] as const) {
      const g = lp(a, key);
      const host = fam.children.find((c) => c.alive && c.sex === sx && c.religion !== "islam");
      if (g && host && lpTotal(g) > 0) host.children = [...persons(`${host.id}.L`, "L", g.L, g.L), ...persons(`${host.id}.P`, "P", g.P, g.P)];
    }
  }
  // C. predeceased children with their descendants
  for (const x of predInstances(a)) {
    const kids = x.kids ?? { L: 0, P: 0 };
    const km = x.kidsMuslim ?? kids;
    const gk = [...persons(`wafat.${x.i}.L`, "L", kids.L, km.L), ...persons(`wafat.${x.i}.P`, "P", kids.P, km.P)];
    const c: Person = { id: `wafat.${x.i}`, sex: x.sex, alive: false, religion: x.muslim ? "islam" : "non_islam", children: gk };
    for (const e of x.extras) addC4bExtra(c, e);
    fam.children.push(c);
  }

  // D. parents and grandparents
  const d1 = str(a, "D1");
  if (d1 && d1 !== "tidak_ada") {
    const m = needReligion(a, "orang_tua") ? (str(a, "D1m") ?? "keduanya") : "keduanya";
    if (d1 === "keduanya" || d1 === "ayah") fam.father = P("ayah", "L", m === "keduanya" || m === "ayah");
    if (d1 === "keduanya" || d1 === "ibu") fam.mother = P("ibu", "P", m === "keduanya" || m === "ibu");
  }
  const d3 = arr(a, "D3") ?? [];
  const d3m = needReligion(a, "kakek_nenek") ? (arr(a, "D3m") ?? d3) : d3;
  if (d3.includes("kakek")) fam.paternalGrandfather = P("kakek", "L", d3m.includes("kakek"));
  if (d3.includes("nenek_ibu")) fam.maternalGrandmother = P("nenek_ibu", "P", d3m.includes("nenek_ibu"));
  if (d3.includes("nenek_ayah")) fam.paternalGrandmother = P("nenek_ayah", "P", d3m.includes("nenek_ayah"));

  // E. siblings
  for (const [key, line] of [
    ["E1", "kandung"],
    ["E2", "seayah"],
    ["E3", "seibu"],
  ] as const) {
    const c = lp(a, key);
    if (!c) continue;
    const m = needReligion(a, "saudara") ? (lp(a, `${key}m`) ?? c) : c;
    for (const p of [...persons(`sdr.${line}.L`, "L", c.L, m.L), ...persons(`sdr.${line}.P`, "P", c.P, m.P)]) fam.siblings.push({ ...p, line });
  }

  // F. nephews (under a brother of that line who died first), uncles, cousins (under an uncle who died first)
  const f1 = str(a, "F1");
  if (f1 === "kandung" || f1 === "seayah") fam.siblings.push(deadBrotherWithSons(`kpn.${f1}`, f1, num(a, "F1n") ?? 1));
  const f2 = str(a, "F2");
  if (f2 === "kandung" || f2 === "seayah") for (const p of persons(`paman.${f2}`, "L", num(a, "F2n") ?? 1, num(a, "F2n") ?? 1)) fam.paternalUncles.push({ ...p, line: f2 });
  const f3 = str(a, "F3");
  if (f3 === "dari_kandung" || f3 === "dari_seayah") {
    const line = f3 === "dari_kandung" ? "kandung" : "seayah";
    fam.paternalUncles.push(deadUncleWithSons(`spp.${line}`, line, num(a, "F3n") ?? 1));
  }
  const f5 = arr(a, "F5") ?? [];
  if (f5.includes("keturunan_saudara")) addBeyondSaudara(fam);
  if (f5.includes("keturunan_paman")) addBeyondPaman(fam);
  // the father's uncle and his line stand below the cousins: the engine's "paman" depth position
  if (f5.includes("kerabat_ayah")) addBeyondPaman(fam, "jauh.ayah");
  const oos: OutOfScopeFact[] = [];
  if (str(a, "F4") === "ya") addDzawil(fam);

  // A3b adopted children (KHI 171(h): only a court order counts), k8 stepchild
  const ad = lp(a, "A3b");
  if (flagsOf(a).has("k2") && ad && lpTotal(ad) > 0) {
    const b2 = str(a, "A3b2");
    const court = b2 === "ya" ? ad : b2 === "sebagian" ? (lp(a, "A3b3") ?? { L: 0, P: 0 }) : { L: 0, P: 0 };
    const received = str(a, "A3b4") === "ya";
    fam.adoptedChildren = [];
    for (const sx of ["L", "P"] as const) {
      for (let j = 1; j <= ad[sx]; j++) {
        const co = j <= court[sx];
        fam.adoptedChildren.push({ ...P(`angkat.${sx}.${j}`, sx), courtOrder: co, ...(co && received ? { receivedWasiat: true } : {}) });
      }
    }
  }
  if (flagsOf(a).has("k8")) fam.stepChildren = [P("tiri.1", "L")];

  // k3–k5: refuse only if that person could change a number (plan §5.2, §5.7 A3 k3–k5)
  if (opts.final) {
    for (const [key, fact] of SPECIAL) {
      if (!flagsOf(a).has(SPECIAL_FLAG[key])) continue;
      const groups = (arr(a, key) ?? []) as readonly RoleGroup[];
      if (specialRelevantGroups(a, fam, groups).length > 0 && !oos.includes(fact)) oos.push(fact);
    }
  }
  if (oos.length > 0) fam.outOfScope = oos;
  return fam;
}

export const SPECIAL: readonly (readonly ["A3c" | "A3d" | "A3e", OutOfScopeFact])[] = [
  ["A3c", "mafqud"],
  ["A3d", "haml"],
  ["A3e", "gharqa"],
];
export const SPECIAL_FLAG = { A3c: "k3", A3d: "k4", A3e: "k5" } as const;

function deadBrotherWithSons(id: string, line: "kandung" | "seayah", n: number): SiblingPerson {
  return { id, sex: "L", alive: false, religion: "islam", line, children: persons(id, "L", n, n) };
}
function deadUncleWithSons(id: string, line: "kandung" | "seayah", n: number): UnclePerson {
  return { id, sex: "L", alive: false, religion: "islam", line, children: persons(id, "L", n, n) };
}
/** F5 "keturunan saudara": a brother's grandson (engine: beyond-depth, kind "saudara"). */
function addBeyondSaudara(fam: FamilyInput, id = "jauh.sdr") {
  fam.siblings.push({ id, sex: "L", alive: false, religion: "islam", line: "kandung", children: [{ id: `${id}.c`, sex: "L", alive: false, religion: "islam", children: [P(`${id}.c.c`, "L")] }] });
}
/** F5 "keturunan paman": a cousin's son (engine: beyond-depth, kind "paman"). */
function addBeyondPaman(fam: FamilyInput, id = "jauh.paman") {
  fam.paternalUncles.push({ id, sex: "L", alive: false, religion: "islam", line: "kandung", children: [{ id: `${id}.c`, sex: "L", alive: false, religion: "islam", children: [P(`${id}.c.c`, "L")] }] });
}
/** F4 "kerabat lain": one dzawil-arham relative (v1 refuses dzawil arham, plan D4). */
function addDzawil(fam: FamilyInput, id = "dzawil.1") {
  fam.otherRelatives = [...(fam.otherRelatives ?? []), { relation: "bibi_ayah", person: P(id, "P") }];
}

/**
 * C4b answers, placed where the engine reads them (family.ts deriveFamily):
 *  - keturunan_jauh: a grandchild who died first and left a descendant (beyond depth; refused
 *    unless a living son or son's son excludes it, both columns);
 *  - anak_cucu_perempuan: (a son's line) a child of a granddaughter (dzawil arham);
 *  - cicit_dari_cucu_hidup: (a daughter's line) a child of a living grandchild (fikih column:
 *    beyond depth; court column: excluded by the KHI-185 substitute).
 */
function addC4bExtra(c: Person, e: string) {
  const kids = (c.children ??= []);
  const base = `${c.id}.x${kids.length + 1}`;
  if (e === "keturunan_jauh") kids.push({ id: base, sex: "L", alive: false, religion: "islam", children: [P(`${base}.c`, "L")] });
  else if (e === "anak_cucu_perempuan") kids.push({ id: base, sex: "P", alive: false, religion: "islam", children: [P(`${base}.c`, "L")] });
  else if (e === "cicit_dari_cucu_hidup") {
    const host = kids.find((g) => g.alive && g.religion === "islam") ?? kids.find((g) => g.alive);
    if (host) host.children = [...(host.children ?? []), P(`${host.id}.c`, "L")];
  }
}

// ---------------------------------------------------------------------------------------------
// Estate (G1–G4 and the rupiah panel)
// ---------------------------------------------------------------------------------------------

const QUARTER: Frac = frac(1, 4);
/** Placeholder for "lebih dari sepertiga" without a value and without consent: capped to ⅓ anyway. */
const OVER_THIRD: Frac = frac(1, 2);

export function buildEstate(a: Answers, fam: FamilyInput, amounts?: Amounts): { estate?: EstateInput; notes: QNote[] } {
  const notes: QNote[] = [];
  const e: EstateInput = {};
  const g1 = a.G1;
  const consent = str(a, "G4") === "setuju";
  const hasBase = amounts?.hartaBawaan !== undefined || amounts?.hartaBersama !== undefined;
  const wasiat: WasiatInput[] = [];
  if (isTT(g1)) notes.push("wasiat_tidak_diketahui");
  const sel = arr(a, "G1") ?? [];
  const entry = (sizeKey: string, value: bigint | undefined, toHeir: boolean, toId?: string) => {
    const size = a[sizeKey];
    const base: Pick<WasiatInput, "toHeir" | "toId"> = toId ? { toHeir, toId } : { toHeir };
    if (isTT(size)) {
      notes.push("wasiat_tidak_diketahui");
      return;
    }
    if (size === "sepertiga") wasiat.push({ ...base, fraction: THIRD });
    else if (size === "seperempat") wasiat.push({ ...base, fraction: QUARTER });
    else if (size === "lebih_sepertiga" || size === "nilai_tertentu") {
      if (value !== undefined && hasBase) wasiat.push({ ...base, amount: value });
      else if (size === "lebih_sepertiga" && !consent) wasiat.push({ ...base, fraction: OVER_THIRD });
      else notes.push("wasiat_perlu_nilai");
    }
  };
  if (sel.includes("lain")) entry("G3", amounts?.wasiatLain, false);
  if (sel.includes("waris")) {
    const role = str(a, "G2");
    entry("G3w", amounts?.wasiatWaris, true, role ? firstPersonOfRole(fam, role) : undefined);
  }
  if (wasiat.length > 0) {
    e.wasiat = wasiat;
    if (consent) e.heirsConsentToExcessWasiat = true;
  }
  // B1b / several wives: the rupiah panel refers harta bersama to the court (plan D18)
  const b1b = a.B1b;
  if (b1b === "ya") notes.push("pasangan_terdahulu");
  // B1 "pernah": the earlier spouse exists by definition; the unknown is whether that harta bersama is divided
  if (isTT(b1b)) notes.push(str(a, "B1") === "pernah" ? "harta_bersama_terdahulu_tidak_tahu" : "pasangan_terdahulu_tidak_tahu");
  const living = fam.spouses.length;
  const pool = amounts?.hartaBersama;
  const rumit = b1b === "ya" || isTT(b1b) || (living > 1 && pool !== undefined && !amounts?.semuaMilikAlmarhum);
  if (rumit) e.hartaBersamaRumit = true;
  if (amounts) {
    let own = amounts.hartaBawaan;
    if (pool !== undefined) {
      if (amounts.semuaMilikAlmarhum || living === 0) own = (own ?? BigInt(0)) + pool;
      else e.hartaBersama = [{ period: (living > 4 ? 4 : living) as 1 | 2 | 3 | 4, amount: pool }];
    }
    if (own !== undefined) e.hartaBawaan = own;
    if (amounts.biayaSakit !== undefined) e.biayaSakit = amounts.biayaSakit;
    if (amounts.biayaJenazah !== undefined) e.biayaJenazah = amounts.biayaJenazah;
    if (amounts.utang !== undefined) e.utang = amounts.utang;
  }
  return Object.keys(e).length > 0 ? { estate: e, notes } : { notes };
}

function firstPersonOfRole(fam: FamilyInput, role: string): string | undefined {
  const pick = (xs: Person[]) => xs.find((p) => p.alive && p.religion === "islam")?.id;
  switch (role) {
    case "istri":
    case "suami":
      return pick(fam.spouses);
    case "anak_lk":
      return pick(fam.children.filter((c) => c.sex === "L"));
    case "anak_pr":
      return pick(fam.children.filter((c) => c.sex === "P"));
    case "ayah":
      return fam.father?.id;
    case "ibu":
      return fam.mother?.id;
    case "kakek":
      return fam.paternalGrandfather?.id;
    case "nenek_ibu":
      return fam.maternalGrandmother?.id;
    case "nenek_ayah":
      return fam.paternalGrandmother?.id;
    default: {
      const sib = fam.siblings.find((s) => s.alive && `sdr_${s.sex === "L" ? "lk" : "pr"}_${s.line}` === role);
      return sib?.id;
    }
  }
}

/** The engine input the answers describe (final: the k3–k5 refusals are decided). */
export function toInput(a: Answers, amounts?: Amounts): { input: WarisInput; notes: QNote[] } {
  const family = buildFamily(a, { final: true });
  const { estate, notes } = buildEstate(a, family, amounts);
  return { input: estate ? { family, estate } : { family }, notes };
}

// ---------------------------------------------------------------------------------------------
// Signatures, policy, probes
// ---------------------------------------------------------------------------------------------

/**
 * Who receives what, at role level (person ids differ between a questionnaire family and the
 * oracle family): every share group (KHI slots normalised), every non-heir line, the residue,
 * 'aul / radd and the special case; or the refusal reasons.
 */
export function moneySig(r: Result): string {
  if (r.kind === "rujuk") return `R:${[...r.reasons].sort().join(",")}`;
  const groups: string[] = [];
  for (const g of r.shares) {
    const per = g.persons.map((p) => `${p.sex}:${toStr(p.share)}:${toStr(p.line)}`).sort().join(",");
    groups.push(`${g.heir.startsWith("pengganti_") ? "pengganti" : g.heir}=${toStr(g.group)}|${toStr(g.line)}|${g.count}|${per}`);
  }
  const lines = r.lines
    .filter((l) => l.kind !== "heir")
    .map((l) => `${l.kind === "wasiat_wajibah" ? `ww:${l.key.split("#")[0]}` : l.kind}=${toStr(l.frac)}`)
    .sort();
  return [groups.sort().join(";"), `L:${lines.join(";")}`, `A:${[...r.adjustments].sort().join(",")}`, `S:${r.specialCase ?? ""}`, `B:${toStr(r.residue.baitulMal)},${toStr(r.residue.sisaDirujuk)}`].join("\n");
}

/** Notes the questionnaire cannot be expected to reproduce (their trigger is never asked). */
const UNASKED_NOTES: ReadonlySet<string> = new Set(["wasiat_wajibah_keponakan"]);

/** moneySig plus the engine notes (the completeness gate compares this). */
export function fullSig(r: Result): string {
  if (r.kind === "rujuk") return moneySig(r);
  return `${moneySig(r)}\nN:${r.notes.filter((x) => !UNASKED_NOTES.has(x)).sort().join(",")}`;
}

/**
 * Plan D4 (v1): dzawil arham are refused in the fikih column; the engine's tanzil stays for v2.
 * Applies to every ruleset that computes tanzil (the fikih column and its variants).
 */
export function applyPolicy(r: Result, rs: Ruleset): { result: Result; policy?: "dzawil_v1" } {
  if (r.kind === "hasil" && rs.switches.dzawilArham === "tanzil" && (r.virtualHeirs !== undefined || r.shares.some((g) => g.rule === "dzawil_arham.tanzil"))) {
    const out: Rujuk = { kind: "rujuk", ruleset: r.ruleset, reasons: ["dzawil_arham"], notes: r.notes, trace: [{ rule: "rujuk.dzawil_arham", heirs: [] }] };
    return { result: out, policy: "dzawil_v1" };
  }
  return { result: r };
}

/** A small bounded memo for the walk's engine calls (pure: same input → same result). */
const SOLVE_CACHE = new Map<string, Result>();
const CACHE_MAX = 6000;

export function solveCached(input: WarisInput, rs: Ruleset): Result {
  const key = `${rs.id}\u0001${JSON.stringify(input, bigintJson)}`;
  const hit = SOLVE_CACHE.get(key);
  if (hit) return hit;
  const r = solveOnce(input, rs);
  if (SOLVE_CACHE.size >= CACHE_MAX) {
    const first = SOLVE_CACHE.keys().next();
    if (!first.done) SOLVE_CACHE.delete(first.value);
  }
  SOLVE_CACHE.set(key, r);
  return r;
}
function bigintJson(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `${v.toString()}n` : v;
}

/** The policy-applied money signature of one family under one ruleset (no estate). */
export function familySig(fam: FamilyInput, rs: Ruleset): string {
  return moneySig(applyPolicy(solveCached({ family: fam }, rs), rs).result);
}

export function cloneFamily(fam: FamilyInput): FamilyInput {
  return JSON.parse(JSON.stringify(fam)) as FamilyInput;
}

/** Does adding the relative(s) built by `add` change any number in any of the rulesets? */
export function probe(fam: FamilyInput, add: (f: FamilyInput) => void, rulesets: readonly Ruleset[] = RELEVANCE_RULESETS): boolean {
  const withX = cloneFamily(fam);
  add(withX);
  for (const rs of rulesets) if (familySig(fam, rs) !== familySig(withX, rs)) return true;
  return false;
}

// Probe additions (one living Muslim relative, placed as buildFamily places it) -------------
export const ADD = {
  keponakan: (line: "kandung" | "seayah") => (f: FamilyInput) => f.siblings.push(deadBrotherWithSons(`probe.kpn.${line}`, line, 1)),
  paman: (line: "kandung" | "seayah") => (f: FamilyInput) => f.paternalUncles.push({ ...P(`probe.paman.${line}`, "L"), line }),
  sepupu: (line: "kandung" | "seayah") => (f: FamilyInput) => f.paternalUncles.push(deadUncleWithSons(`probe.spp.${line}`, line, 1)),
  keturunanSaudara: (f: FamilyInput) => addBeyondSaudara(f, "probe.jauh.sdr"),
  keturunanPaman: (f: FamilyInput) => addBeyondPaman(f, "probe.jauh.paman"),
  /** A Muslim grandchild under the first living child of `parentSex` who is not Muslim. */
  cucuUnderNonMuslim: (parentSex: Sex, sx: Sex) => (f: FamilyInput) => {
    const host = f.children.find((c) => c.alive && c.sex === parentSex && c.religion !== "islam");
    if (host) host.children = [...(host.children ?? []), P(`probe.cucu.${host.id}.${sx}`, sx)];
  },
  c4bExtra: (instance: number, extra: string) => (f: FamilyInput) => {
    const c = f.children.find((x) => x.id === `wafat.${instance}`);
    if (c) addC4bExtra(c, extra);
  },
} as const;

/** Some ruleset leaves residue with no non-spouse heir (spouse only, or nobody): dzawil arham could inherit. */
export function residueOpen(fam: FamilyInput, rulesets: readonly Ruleset[] = RELEVANCE_RULESETS): boolean {
  for (const rs of rulesets) {
    const r = solveCached({ family: fam }, rs);
    if (r.kind === "rujuk" && r.reasons.includes("tanpa_ahli_waris")) return true;
    if (r.kind === "hasil" && r.residue.sisaDirujuk.n > BigInt(0)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// k3–k5: which «siapa?» groups could change a number (plan §5.7 A3 k3–k5)
// ---------------------------------------------------------------------------------------------

const GROUP_ROLES: Readonly<Record<Exclude<RoleGroup, "cucu" | "pasangan">, readonly HeirId[]>> = {
  anak: ["anak_lk", "anak_pr"],
  ayah: ["ayah"],
  ibu: ["ibu"],
  kakek: ["kakek"],
  nenek: ["nenek_ibu", "nenek_ayah"],
  saudara: ["sdr_lk_kandung", "sdr_pr_kandung", "sdr_lk_seayah", "sdr_pr_seayah", "sdr_lk_seibu", "sdr_pr_seibu"],
  kerabat: ["keponakan_lk_kandung", "keponakan_lk_seayah", "paman_kandung", "paman_seayah", "sepupu_lk_kandung", "sepupu_lk_seayah"],
};

/**
 * The picked groups that could change a number. Relatives: couldAffectOutcome() with that role
 * left "maybe present" (an extra person of a role already present changes per-head shares).
 * Grandchildren: an engine probe over every place a grandchild can stand (a KHI-185 substitute in
 * the court column is not a role couldAffectOutcome models).
 */
export function specialRelevantGroups(a: Answers, fam: FamilyInput, groups: readonly RoleGroup[]): RoleGroup[] {
  const knowns = [knownCounts(a), ...(hasAsIfCandidate(a) ? [knownCounts(a, true)] : [])];
  const out: RoleGroup[] = [];
  for (const g of groups) {
    let hit = false;
    if (g === "pasangan") hit = true; // a spouse is never excluded (Fath al-Qarib § 116)
    else if (g === "cucu") hit = cucuCouldMatter(fam);
    else
      for (const r of GROUP_ROLES[g])
        for (const known of knowns) {
          const k: KnownCounts = { ...known };
          delete k[r];
          if (relevantRole(r, k)) hit = true;
        }
    if (hit && !out.includes(g)) out.push(g);
  }
  return out;
}

function cucuCouldMatter(fam: FamilyInput): boolean {
  const adds: ((f: FamilyInput) => void)[] = [];
  for (const sx of ["L", "P"] as const) {
    for (const c of fam.children) {
      adds.push((f) => {
        const t = f.children.find((x) => x.id === c.id);
        if (t) t.children = [...(t.children ?? []), P(`probe.cucu.${c.id}.${sx}`, sx)];
      });
    }
    for (const parentSex of ["L", "P"] as const) {
      adds.push((f) => f.children.push({ id: `probe.wafat.${parentSex}.${sx}`, sex: parentSex, alive: false, religion: "islam", children: [P(`probe.wafat.${parentSex}.${sx}.c`, sx)] }));
    }
  }
  return adds.some((add) => probe(fam, add));
}
