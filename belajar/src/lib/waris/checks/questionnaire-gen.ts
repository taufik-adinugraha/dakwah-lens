/**
 * Oracle families for the questionnaire gates (plan §10 M2.1–M2.4; architecture.md §6.6).
 *
 *  - randomTrueFamily(): a FULL family in the engine's own FamilyInput shape, every relative type
 *    sampled INDEPENDENTLY (dense / sparse / pattern mixes, like checks/invariants.ts): spouses,
 *    children, predeceased children with descendants (KHI 185), grandparents, blocked siblings of
 *    every line, nephews, uncles, cousins, BEYOND-DEPTH relatives (great-grandchildren under a
 *    grandchild, a sibling's grandchildren, a cousin's children), dzawil arham, non-Muslims at
 *    every level, adopted and step children, bequests, and the A3 facts (killing, khuntsa,
 *    missing / unborn / same-incident relatives).
 *  - oracleAnswer(): answers ONE asked node truthfully from the full family. The questionnaire
 *    never sees the family; it sees only the answers to the nodes it chose to ask.
 *  - expected(): what the full family must give, computed from the engine directly (and, for a
 *    missing / unborn / same-incident relative, by solving with and without that person).
 *
 * Plain TypeScript, no vitest import, no float arithmetic, no network.
 */
import { THIRD, floorDiv, frac, type Frac } from "../frac";
import { deriveFamily } from "../family";
import { COURT_PROFILE, DEFAULT_PROFILE, PROFILES, isHeirId, resolveRuleset, type HeirId, type RujukReason, type Sex } from "../registry";
import { solveOnce } from "../solve";
import type { AdoptedPerson, EstateInput, FamilyInput, Person, SiblingPerson, UnclePerson, WarisInput, WasiatInput } from "../types";
import { applyPolicy, fullSig } from "../questionnaire/build";
import { exitFor } from "../questionnaire/machine";
import type { Amounts, AnswerValue, Answers, ExitId, LP, NodeId, RoleGroup } from "../questionnaire/types";
import { Rng } from "./prng";

export type A1Answer = "wafat_muslim" | "saya_hidup" | "simulasi_keluarga" | "wafat_nonmuslim";
export type WasiatSize = "sepertiga" | "seperempat" | "lebih_sepertiga" | "nilai_tertentu";

export interface TrueWasiat {
  size: WasiatSize;
  frac: Frac;
}

export interface Special {
  /** A3 k3 hilang, k4 dalam kandungan, k5 wafat bersamaan. */
  flag: "k3" | "k4" | "k5";
  group: RoleGroup;
  /** Adds the person, alive and Muslim, where they would stand (for the with/without solve). */
  place: (fam: FamilyInput, sex: Sex) => void;
}

export interface TrueFamily {
  index: number;
  /** The full family and bequests (fractions), as the engine reads them. */
  input: WarisInput;
  a1: A1Answer;
  everMarried: boolean;
  earlierSpouse: boolean;
  killer: boolean;
  khuntsa: boolean;
  siri: boolean;
  special: Special | null;
  wasiat: { lain?: TrueWasiat; waris?: TrueWasiat & { role: HeirId }; consent: boolean };
  /** The rupiah panel values the questionnaire needs for "lebih dari ⅓" / "nilai tertentu". */
  amounts?: Amounts;
}

const FIKIH = resolveRuleset(DEFAULT_PROFILE);
const COURT = resolveRuleset(COURT_PROFILE);
/** The estate base used for wasiat values (divisible by 2, 3, 4, 10). */
export const ESTATE_BASE = BigInt(1200000000);

const SIZES: readonly { size: WasiatSize; frac: Frac }[] = [
  { size: "sepertiga", frac: THIRD },
  { size: "seperempat", frac: frac(1, 4) },
  { size: "lebih_sepertiga", frac: frac(1, 2) },
  { size: "lebih_sepertiga", frac: frac(1) },
  { size: "nilai_tertentu", frac: frac(1, 10) },
];

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

export function randomTrueFamily(rng: Rng, index: number): TrueFamily {
  let next = 0;
  const id = (p: string) => `${p}${index}_${next++}`;
  const mode = rng.int(10) < 6 ? "dense" : rng.int(2) === 0 ? "sparse" : "pattern";
  const dense = mode === "dense";
  const nmPct = dense ? 6 : 3;
  const person = (p: string, sex: Sex, alive = true): Person => ({ id: id(p), sex, alive, religion: rng.chance(nmPct) ? "non_islam" : "islam" });
  const sexR = (): Sex => (rng.chance(50) ? "L" : "P");
  const count = (pZero: number, max: number) => {
    const z = dense ? pZero : pZero + (((100 - pZero) * 3) >> 2);
    return rng.int(100) < z ? 0 : 1 + rng.int(max);
  };
  const pct = (p: number) => (dense ? p : p >> 2);
  /** Descendants under p: children, each with a chance of their own (depth levels below). */
  const descend = (p: Person, prefix: string, depth: number, pctKids: number) => {
    if (depth <= 0 || !rng.chance(pctKids)) return;
    const n = 1 + rng.int(2);
    p.children = [...(p.children ?? [])];
    for (let k = 0; k < n; k++) {
      const c = person(prefix, sexR(), !rng.chance(25));
      descend(c, `${prefix}c`, depth - 1, c.alive ? 10 : 45);
      p.children.push(c);
    }
  };

  const sex = sexR();
  const fam: FamilyInput = { deceased: { sex, religion: "islam" }, spouses: [], children: [], siblings: [], paternalUncles: [] };
  const sib = (sx: Sex, line: SiblingPerson["line"], alive = true): SiblingPerson => ({ ...person("sib", sx, alive), line });
  const spouseSex: Sex = sex === "L" ? "P" : "L";

  if (mode === "pattern") {
    const t = rng.int(12);
    if (t === 0) {
      fam.deceased.sex = "P";
      fam.spouses.push(person("sp", "L"));
      fam.mother = person("m", "P");
      fam.paternalGrandfather = person("gf", "L");
      fam.siblings.push(sib("P", rng.chance(70) ? "kandung" : "seayah"));
    } else if (t === 1) {
      fam.deceased.sex = "P";
      fam.spouses.push(person("sp", "L"));
      if (rng.chance(70)) fam.mother = person("m", "P");
      else fam.maternalGrandmother = person("gmm", "P");
      for (let i = 2 + rng.int(2); i > 0; i--) fam.siblings.push(sib(sexR(), "seibu"));
      for (let i = 1 + rng.int(2); i > 0; i--) fam.siblings.push(sib("L", "kandung"));
    } else if (t === 2) {
      fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(70)) fam.father = person("f", "L");
      else fam.paternalGrandfather = person("gf", "L");
      fam.mother = person("m", "P");
    } else if (t === 3) {
      fam.paternalGrandfather = person("gf", "L");
      for (const line of ["kandung", "seayah"] as const) for (const sx of ["L", "P"] as const) for (let i = rng.int(3); i > 0; i--) fam.siblings.push(sib(sx, line));
      if (rng.chance(50)) fam.mother = person("m", "P");
      if (rng.chance(40)) fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(30)) fam.siblings.push(sib(sexR(), "seibu"));
    } else if (t === 4) {
      for (let i = rng.int(3); i > 0; i--) fam.children.push(person("ch", sexR()));
      for (let i = 1 + rng.int(2); i > 0; i--) {
        const c: Person = { id: id("dead"), sex: sexR(), alive: false, religion: "islam", children: [] };
        for (let k = 1 + rng.int(3); k > 0; k--) c.children?.push(person("gc", sexR()));
        fam.children.splice(rng.int(fam.children.length + 1), 0, c);
      }
      if (rng.chance(50)) fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(50)) fam.siblings.push(sib(sexR(), rng.pick(["kandung", "seayah", "seibu"] as const)));
    } else if (t === 5) {
      // dzawil arham only (+ maybe a spouse)
      if (rng.chance(40)) fam.spouses.push(person("sp", spouseSex));
      const rel = rng.pick(["bibi_ayah", "bibi_ibu", "paman_ibu", "paman_seibu_ayah"] as const);
      fam.otherRelatives = [{ relation: rel, person: { id: id("dz"), sex: rel.startsWith("bibi") ? "P" : "L", alive: true, religion: "islam" } }];
      if (rng.chance(50)) fam.children.push({ id: id("dead"), sex: "P", alive: false, religion: "islam", children: [person("gc", sexR())] });
    } else if (t === 6) {
      if (rng.chance(50)) fam.spouses.push(person("sp", spouseSex));
      for (let i = rng.int(3); i > 0; i--) fam.children.push(person("dau", "P"));
      if (rng.chance(50)) fam.mother = person("m", "P");
      else if (rng.chance(50)) fam.maternalGrandmother = person("gmm", "P");
      for (let i = rng.int(3); i > 0; i--) fam.siblings.push(sib(sexR(), "seibu"));
    } else if (t === 7) {
      if (rng.chance(80)) for (let i = sex === "L" ? 1 + rng.int(4) : 1; i > 0; i--) fam.spouses.push(person("sp", spouseSex));
    } else if (t === 8) {
      for (let i = 1 + rng.int(2); i > 0; i--) fam.children.push(person("dau", "P"));
      for (const line of ["kandung", "seayah"] as const) for (const sx of ["L", "P"] as const) for (let i = rng.int(2); i > 0; i--) fam.siblings.push(sib(sx, line));
    } else if (t === 9) {
      // blocked siblings that still lower the mother (S ≥ 2), with the father or grandfather
      fam.mother = person("m", "P");
      if (rng.chance(60)) fam.father = person("f", "L");
      else fam.paternalGrandfather = person("gf", "L");
      for (let i = 1 + rng.int(2); i > 0; i--) fam.siblings.push(sib(sexR(), rng.pick(["kandung", "seayah", "seibu"] as const)));
    } else if (t === 10) {
      // beyond-depth relatives with nobody nearer
      if (rng.chance(50)) fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(50)) fam.children.push(person("dau", "P"));
      const b = rng.int(3);
      if (b === 0) {
        const c: Person = { id: id("dead"), sex: sexR(), alive: false, religion: "islam", children: [{ id: id("deadgc"), sex: sexR(), alive: false, religion: "islam", children: [person("ggc", sexR())] }] };
        fam.children.push(c);
      } else if (b === 1) {
        fam.siblings.push({ id: id("deadsib"), sex: sexR(), alive: false, religion: "islam", line: rng.pick(["kandung", "seayah", "seibu"] as const), children: [{ id: id("deadnep"), sex: sexR(), alive: false, religion: "islam", children: [person("gnep", sexR())] }] });
      } else {
        fam.paternalUncles.push({ id: id("deadunc"), sex: "L", alive: false, religion: "islam", line: rng.pick(["kandung", "seayah"] as const), children: [{ id: id("deadcou"), sex: sexR(), alive: false, religion: "islam", children: [person("gcou", sexR())] }] });
      }
    } else {
      // grandfather + uterine siblings (khi181 variant), mother maybe
      fam.paternalGrandfather = person("gf", "L");
      for (let i = 1 + rng.int(2); i > 0; i--) fam.siblings.push(sib(sexR(), "seibu"));
      if (rng.chance(40)) fam.mother = person("m", "P");
      if (rng.chance(40)) fam.siblings.push(sib(sexR(), rng.pick(["kandung", "seayah"] as const)));
    }
  }

  // independent noise relatives
  const deceasedSex = fam.deceased.sex;
  const sSex: Sex = deceasedSex === "L" ? "P" : "L";
  fam.spouses = fam.spouses.filter((p) => p.sex === sSex);
  if (fam.spouses.length === 0) {
    const n = deceasedSex === "P" ? (rng.chance(dense ? 60 : 30) ? 1 : 0) : dense ? rng.pick([0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3, 4]) : rng.pick([0, 0, 0, 0, 1, 1, 2]);
    for (let i = 0; i < n; i++) fam.spouses.push(person("sp", sSex));
  }
  // Living children may have children of their own (blocked, or dzawil arham behind a daughter),
  // never asked. Deeper levels under a LIVING child are not generated: the questionnaire never asks
  // about them (a living child is nearer), while the engine's beyond-depth check refuses some of
  // them in the fikih column (family.ts beyondExcludedBy) — an engine item, reported separately.
  for (let i = count(50, 3); i > 0; i--) {
    const c = person("son", "L");
    descend(c, "gs", 1, 6);
    fam.children.push(c);
  }
  for (let i = count(50, 4); i > 0; i--) {
    const c = person("dau", "P");
    descend(c, "gd", 1, 6);
    fam.children.push(c);
  }
  for (let i = count(72, 2); i > 0; i--) {
    const c: Person = { id: id("dead"), sex: sexR(), alive: false, religion: rng.chance(5) ? "non_islam" : "islam", children: [] };
    for (let k = count(20, 3); k > 0; k--) {
      const g = person("gc", sexR(), !rng.chance(15));
      descend(g, "ggc", 2, g.alive ? 6 : 50);
      c.children?.push(g);
    }
    fam.children.splice(rng.int(fam.children.length + 1), 0, c);
  }
  if (!fam.father && rng.chance(pct(38))) fam.father = person("f", "L");
  if (!fam.mother && rng.chance(pct(45))) fam.mother = person("m", "P");
  if (!fam.paternalGrandfather && rng.chance(pct(22))) fam.paternalGrandfather = person("gf", "L");
  if (!fam.paternalGrandmother && rng.chance(pct(18))) fam.paternalGrandmother = person("gmf", "P");
  if (!fam.maternalGrandmother && rng.chance(pct(18))) fam.maternalGrandmother = person("gmm", "P");
  if (rng.chance(pct(4) + 1)) fam.maternalGrandfather = person("gfm", "L");
  for (const line of ["kandung", "seayah", "seibu"] as const) {
    for (const sx of ["L", "P"] as const) {
      for (let i = count(70, 3); i > 0; i--) {
        const s = sib(sx, line);
        descend(s, "nep", 2, 12);
        fam.siblings.push(s);
      }
      if (rng.chance(dense ? 8 : 4)) {
        const s = sib(sx, line, false);
        s.religion = "islam";
        descend(s, "nep", 2, 100);
        fam.siblings.push(s);
      }
    }
  }
  for (const line of ["kandung", "seayah"] as const) {
    for (let i = count(80, 2); i > 0; i--) {
      const u: UnclePerson = { ...person("unc", "L", !rng.chance(30)), line };
      descend(u, "cou", 2, u.alive ? 15 : 60);
      fam.paternalUncles.push(u);
    }
  }
  if (rng.chance(dense ? 5 : 10)) {
    const relation = rng.pick(["bibi_ayah", "bibi_ibu", "paman_ibu", "paman_seibu_ayah", "kakek_dari_ibu"] as const);
    fam.otherRelatives = [...(fam.otherRelatives ?? []), { relation, person: { id: id("dz"), sex: relation.startsWith("bibi") ? "P" : "L", alive: true, religion: "islam" } }];
  }
  if (rng.chance(5)) {
    const received = rng.chance(25);
    fam.adoptedChildren = Array.from({ length: 1 + rng.int(2) }, (): AdoptedPerson => {
      const co = rng.chance(70);
      return { id: id("adopt"), sex: sexR(), alive: true, religion: "islam", courtOrder: co, ...(co && received ? { receivedWasiat: true } : {}) };
    });
  }
  if (rng.chance(4)) fam.stepChildren = [{ id: id("step"), sex: sexR(), alive: true, religion: "islam" }];

  // A3 facts
  const killer = rng.chance(2);
  if (killer) {
    const living = livingPersons(fam);
    if (living.length > 0) rng.pick(living).bars = [rng.pick(["membunuh", "membunuh_tanpa_putusan", "mencoba_membunuh", "aniaya_berat", "fitnah_pidana5th"] as const)];
  }
  const khuntsa = rng.chance(1);
  const special = rng.chance(5) ? randomSpecial(rng, id) : null;
  const a1Roll = rng.int(100);
  const a1: A1Answer = a1Roll < 2 ? "wafat_nonmuslim" : a1Roll < 7 ? "saya_hidup" : a1Roll < 15 ? "simulasi_keluarga" : "wafat_muslim";
  if (a1 === "wafat_nonmuslim") fam.deceased.religion = "non_islam";
  const anyChild = fam.children.length > 0;
  const everMarried = fam.spouses.length > 0 || (deceasedSex === "L" ? anyChild || rng.chance(50) : rng.chance(60));
  const earlierSpouse = fam.spouses.length > 0 && rng.chance(10);

  // bequests (fractions; the rupiah panel gives the value of "lebih dari ⅓" / "nilai tertentu")
  const wasiat: TrueFamily["wasiat"] = { consent: false };
  if (rng.chance(16)) {
    if (rng.chance(75)) wasiat.lain = rng.pick(SIZES);
    if (rng.chance(35)) {
      const roles = heirRoles(fam);
      if (roles.length > 0) wasiat.waris = { ...rng.pick(SIZES), role: rng.pick(roles) };
    }
    wasiat.consent = rng.chance(35);
  }
  const estate: EstateInput = {};
  const entries: WasiatInput[] = [];
  if (wasiat.lain) entries.push({ toHeir: false, fraction: wasiat.lain.frac });
  if (wasiat.waris) entries.push({ toHeir: true, fraction: wasiat.waris.frac });
  if (entries.length > 0) {
    estate.wasiat = entries;
    if (wasiat.consent) estate.heirsConsentToExcessWasiat = true;
  }
  if (earlierSpouse) estate.hartaBersamaRumit = true;
  let amounts: Amounts | undefined;
  const needsValue = (w?: TrueWasiat) => w !== undefined && (w.size === "nilai_tertentu" || w.size === "lebih_sepertiga");
  if (needsValue(wasiat.lain) || needsValue(wasiat.waris)) {
    amounts = { hartaBawaan: ESTATE_BASE };
    if (wasiat.lain) amounts.wasiatLain = timesBase(wasiat.lain.frac);
    if (wasiat.waris) amounts.wasiatWaris = timesBase(wasiat.waris.frac);
  }
  const input: WarisInput = Object.keys(estate).length > 0 ? { family: fam, estate } : { family: fam };
  return { index, input, a1, everMarried, earlierSpouse, killer, khuntsa, siri: rng.chance(3), special, wasiat, ...(amounts ? { amounts } : {}) };
}

/** ESTATE_BASE × f, exact for the generator's fractions (every d divides 1.2e9). */
function timesBase(f: Frac): bigint {
  return floorDiv(ESTATE_BASE * f.n, f.d);
}

function livingPersons(fam: FamilyInput): Person[] {
  const out: Person[] = [];
  const walk = (p: Person | undefined) => {
    if (!p) return;
    if (p.alive) out.push(p);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [...fam.spouses, ...fam.children, fam.father, fam.mother, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother, ...fam.siblings, ...fam.paternalUncles]) walk(p);
  return out;
}

/** Roles with a share in either report column (the G2 picker's options). */
function heirRoles(fam: FamilyInput): HeirId[] {
  const out = new Set<HeirId>();
  for (const rs of [FIKIH, COURT]) {
    const r = applyPolicy(solveOnce({ family: fam }, rs), rs).result;
    if (r.kind === "hasil") for (const g of r.shares) if (isHeirId(g.heir)) out.add(g.heir);
  }
  return [...out];
}

function randomSpecial(rng: Rng, id: (p: string) => string): Special {
  const flag = rng.pick(["k3", "k4", "k5"] as const);
  const groups: readonly RoleGroup[] = flag === "k4" ? ["anak", "cucu", "saudara", "kerabat"] : ["pasangan", "anak", "cucu", "ayah", "ibu", "kakek", "nenek", "saudara", "kerabat"];
  const group = rng.pick(groups);
  const line = rng.pick(["kandung", "seayah", "seibu"] as const);
  const agnLine = rng.pick(["kandung", "seayah"] as const);
  const kind = rng.int(3);
  const pid = id("special");
  const place = (fam: FamilyInput, sex: Sex) => {
    const p: Person = { id: pid, sex, alive: true, religion: "islam" };
    switch (group) {
      case "pasangan":
        if (fam.spouses.length < (fam.deceased.sex === "L" ? 4 : 1)) fam.spouses.push({ ...p, sex: fam.deceased.sex === "L" ? "P" : "L" });
        break;
      case "anak":
        fam.children.push(p);
        break;
      case "cucu": {
        const dead = fam.children.filter((c) => !c.alive);
        if (dead.length > 0 && kind < 2) dead[0].children = [...(dead[0].children ?? []), p];
        else fam.children.push({ id: `${pid}.parent`, sex: kind === 2 ? "P" : "L", alive: false, religion: "islam", children: [p] });
        break;
      }
      case "ayah":
        if (!fam.father?.alive) fam.father = { ...p, sex: "L" };
        break;
      case "ibu":
        if (!fam.mother?.alive) fam.mother = { ...p, sex: "P" };
        break;
      case "kakek":
        if (!fam.paternalGrandfather?.alive) fam.paternalGrandfather = { ...p, sex: "L" };
        break;
      case "nenek":
        if (kind === 0 && !fam.maternalGrandmother?.alive) fam.maternalGrandmother = { ...p, sex: "P" };
        else if (!fam.paternalGrandmother?.alive) fam.paternalGrandmother = { ...p, sex: "P" };
        break;
      case "saudara":
        fam.siblings.push({ ...p, line });
        break;
      case "kerabat":
        if (kind === 0) fam.siblings.push({ id: `${pid}.parent`, sex: "L", alive: false, religion: "islam", line: agnLine, children: [{ ...p, sex: "L" }] });
        else if (kind === 1) fam.paternalUncles.push({ ...p, sex: "L", line: agnLine });
        else fam.paternalUncles.push({ id: `${pid}.parent`, sex: "L", alive: false, religion: "islam", line: agnLine, children: [{ ...p, sex: "L" }] });
        break;
    }
  };
  return { flag, group, place };
}

// ---------------------------------------------------------------------------------------------
// The oracle: answers one asked node from the full family
// ---------------------------------------------------------------------------------------------

const isMuslim = (p: Person) => p.religion === "islam" && !(p.bars ?? []).includes("murtad");
const lpOf = (ps: readonly Person[], pred: (p: Person) => boolean = () => true): LP => ({
  L: ps.filter((p) => p.sex === "L" && pred(p)).length,
  P: ps.filter((p) => p.sex === "P" && pred(p)).length,
});

function hasLivingDesc(p: Person): boolean {
  return (p.children ?? []).some((c) => c.alive || hasLivingDesc(c));
}

/** Predeceased children the questionnaire enters (they left a living descendant), in input order. */
export function predeceasedEntered(fam: FamilyInput): Person[] {
  return fam.children.filter((c) => !c.alive && hasLivingDesc(c));
}

function anyNonMuslim(ps: readonly (Person | undefined)[], deep: boolean): boolean {
  const walk = (p: Person | undefined): boolean => !!p && (!isMuslim(p) || (deep && (p.children ?? []).some(walk)));
  return ps.some(walk);
}

/** A3a: the relationship groups that have someone of another religion (plan §5.7). */
function religionGroups(fam: FamilyInput): string[] {
  const out: string[] = [];
  const living = (ps: readonly Person[]) => ps.filter((p) => p.alive);
  if (anyNonMuslim(living(fam.spouses), false)) out.push("pasangan");
  if (anyNonMuslim(fam.children.filter((c) => c.alive || hasLivingDesc(c)), false)) out.push("anak");
  if (predeceasedEntered(fam).some((c) => anyNonMuslim(c.children ?? [], true))) out.push("cucu");
  if (anyNonMuslim([fam.father, fam.mother].filter((p) => p?.alive), false)) out.push("orang_tua");
  if (anyNonMuslim([fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother].filter((p) => p?.alive), false)) out.push("kakek_nenek");
  if (anyNonMuslim(living(fam.siblings), false)) out.push("saudara");
  const kerabat = [
    ...fam.siblings.flatMap((s) => s.children ?? []),
    ...fam.paternalUncles,
    ...(fam.otherRelatives ?? []).map((o) => o.person),
    ...(fam.maternalGrandfather ? [fam.maternalGrandfather] : []),
  ];
  if (anyNonMuslim(kerabat, true)) out.push("kerabat");
  return out;
}

function hasAnyNonMuslim(fam: FamilyInput): boolean {
  const all: Person[] = [];
  const walk = (p: Person | undefined) => {
    if (!p) return;
    all.push(p);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [...fam.spouses, ...fam.children, fam.father, fam.mother, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother, fam.maternalGrandfather, ...fam.siblings, ...fam.paternalUncles, ...(fam.otherRelatives ?? []).map((o) => o.person)]) walk(p);
  // a predeceased child the questionnaire enters counts too (KHI 185 needs that child to be Muslim)
  return all.some((p) => p.alive && !isMuslim(p)) || predeceasedEntered(fam).some((c) => !isMuslim(c));
}

/** C4b: which extras a predeceased child's line has (in the engine's own terms, family.ts). */
function c4bExtras(c: Person): string[] {
  const out = new Set<string>();
  const eligibleAlive = (p: Person) => p.alive && isMuslim(p);
  const anyBelow = (p: Person, pred: (x: Person) => boolean): boolean => (p.children ?? []).some((x) => pred(x) || anyBelow(x, pred));
  for (const g of c.children ?? []) {
    const gEligible = g.alive && isMuslim(g);
    for (const x of g.children ?? []) {
      const xHas = eligibleAlive(x);
      const deeper = anyBelow(x, eligibleAlive);
      if (c.sex === "L") {
        if (g.sex === "P") {
          // a son's granddaughter's child: dzawil arham (g alive and an heir: no effect)
          if (xHas && !gEligible) out.add("anak_cucu_perempuan");
          if (deeper && !gEligible) out.add("keturunan_jauh");
        } else if (!gEligible && (xHas || deeper)) out.add("keturunan_jauh");
      } else if (xHas || deeper) {
        out.add(gEligible ? "cicit_dari_cucu_hidup" : "keturunan_jauh");
      }
    }
  }
  return [...out];
}

/** F5: beyond-depth relatives under the siblings' / uncles' lines that no living nephew / cousin parent excludes. */
function f5Kinds(fam: FamilyInput): string[] {
  const out: string[] = [];
  const eligibleBelow = (p: Person): boolean => (p.children ?? []).some((x) => (x.alive && isMuslim(x)) || eligibleBelow(x));
  if (fam.siblings.some((s) => (s.children ?? []).some((k) => !(s.line !== "seibu" && s.sex === "L" && k.sex === "L" && k.alive && isMuslim(k)) && eligibleBelow(k)))) out.push("keturunan_saudara");
  if (fam.paternalUncles.some((u) => (u.children ?? []).some((k) => !(k.sex === "L" && k.alive && isMuslim(k)) && eligibleBelow(k)))) out.push("keturunan_paman");
  return out;
}

/** F4: a living Muslim dzawil-arham relative other than those entered at C4 / C4b. */
function hasOtherDzawil(fam: FamilyInput): boolean {
  const d = deriveFamily(fam, PROFILES["klasik-syafii"]);
  const entered = new Set(["cucu_lk_dari_anak_pr", "cucu_pr_dari_anak_pr", "anak_lk_dari_cucu_pr", "anak_pr_dari_cucu_pr"]);
  return d.dzawil.some((x) => !entered.has(x.relation));
}

function siblingsOf(fam: FamilyInput, line: SiblingPerson["line"]): Person[] {
  return fam.siblings.filter((s) => s.alive && s.line === line);
}

/**
 * The truthful answer to an asked node. `options` are the options the questionnaire offered; a
 * multi-select answer is restricted to them (an un-offered option could not change a number).
 */
export function oracleAnswer(t: TrueFamily, id: NodeId, i: number, options: readonly string[], eff: Answers): AnswerValue {
  const fam = t.input.family;
  const muslimOnly = (g: string) => {
    const a3a = eff.A3a;
    return Array.isArray(a3a) ? (a3a as readonly string[]).includes(g) : a3a === "tidak_tahu";
  };
  const restrict = (xs: readonly string[]) => options.filter((o) => xs.includes(o));
  const pred = predeceasedEntered(fam);
  switch (id) {
    case "A1":
      return t.a1;
    case "A1s":
      return "ya";
    case "A2":
      return fam.deceased.sex;
    case "A3": {
      const xs: string[] = [];
      if (hasAnyNonMuslim(fam)) xs.push("k1");
      if ((fam.adoptedChildren ?? []).length > 0) xs.push("k2");
      if (t.special) xs.push(t.special.flag);
      if (t.khuntsa) xs.push("k7");
      if ((fam.stepChildren ?? []).length > 0) xs.push("k8");
      if (t.siri) xs.push("k9");
      return restrict(xs);
    }
    case "A3a":
      return restrict(religionGroups(fam));
    case "A3b":
      return lpOf(fam.adoptedChildren ?? []);
    case "A3b2": {
      const ad = fam.adoptedChildren ?? [];
      const co = ad.filter((x) => x.courtOrder).length;
      return co === ad.length ? "ya" : co === 0 ? "tidak" : "sebagian";
    }
    case "A3b3":
      return lpOf((fam.adoptedChildren ?? []).filter((x) => x.courtOrder));
    case "A3b4":
      return (fam.adoptedChildren ?? []).some((x) => x.courtOrder && x.receivedWasiat) ? "ya" : "tidak";
    case "A3c":
    case "A3d":
    case "A3e":
      return t.special ? restrict([t.special.group]) : [];
    case "B1": {
      const n = fam.spouses.filter((s) => s.alive).length;
      return n === 0 ? (t.everMarried ? "pernah" : "belum") : n === 1 ? "ya_satu" : "ya_lebih";
    }
    case "B2":
      return fam.spouses.filter((s) => s.alive).length;
    case "B3":
      return fam.spouses.filter((s) => s.alive && isMuslim(s)).length;
    case "B1b":
      return t.earlierSpouse ? "ya" : "tidak";
    case "C1":
      return lpOf(fam.children.filter((c) => c.alive));
    case "C1m":
      return lpOf(fam.children.filter((c) => c.alive && isMuslim(c)));
    case "C1n":
    case "C1p": {
      const sx = id === "C1n" ? "L" : "P";
      const hosts = fam.children.filter((c) => c.alive && c.sex === sx && !isMuslim(c));
      return lpOf(hosts.flatMap((h) => (h.children ?? []).filter((g) => g.alive && isMuslim(g))));
    }
    case "C3":
      return pred.length > 0 ? "ya" : "tidak";
    case "C4s":
      return pred[i - 1].sex;
    case "C4r":
      return isMuslim(pred[i - 1]) ? "ya" : "tidak";
    case "C4g":
      return lpOf((pred[i - 1].children ?? []).filter((g) => g.alive));
    case "C4gm":
      return lpOf((pred[i - 1].children ?? []).filter((g) => g.alive && isMuslim(g)));
    case "C4b":
      return restrict(c4bExtras(pred[i - 1]));
    case "C4m":
      return pred.length > i ? "ya" : "tidak";
    case "D1": {
      const f = fam.father?.alive === true;
      const m = fam.mother?.alive === true;
      return f && m ? "keduanya" : f ? "ayah" : m ? "ibu" : "tidak_ada";
    }
    case "D1m": {
      const f = fam.father?.alive === true && isMuslim(fam.father);
      const m = fam.mother?.alive === true && isMuslim(fam.mother);
      return f && m ? "keduanya" : f ? "ayah" : m ? "ibu" : "tidak_ada";
    }
    case "D3": {
      const xs: string[] = [];
      if (fam.paternalGrandfather?.alive) xs.push("kakek");
      if (fam.maternalGrandmother?.alive) xs.push("nenek_ibu");
      if (fam.paternalGrandmother?.alive) xs.push("nenek_ayah");
      return restrict(xs);
    }
    case "D3m": {
      const xs: string[] = [];
      if (fam.paternalGrandfather?.alive && isMuslim(fam.paternalGrandfather)) xs.push("kakek");
      if (fam.maternalGrandmother?.alive && isMuslim(fam.maternalGrandmother)) xs.push("nenek_ibu");
      if (fam.paternalGrandmother?.alive && isMuslim(fam.paternalGrandmother)) xs.push("nenek_ayah");
      return restrict(xs);
    }
    case "E1":
    case "E2":
    case "E3":
      return lpOf(siblingsOf(fam, id === "E1" ? "kandung" : id === "E2" ? "seayah" : "seibu"));
    case "E1m":
    case "E2m":
    case "E3m":
      return lpOf(siblingsOf(fam, id === "E1m" ? "kandung" : id === "E2m" ? "seayah" : "seibu"), isMuslim);
    case "F1":
    case "F1n": {
      const ok = (p: Person) => p.alive && p.sex === "L" && (!muslimOnly("kerabat") || isMuslim(p));
      const by = (line: "kandung" | "seayah") => fam.siblings.filter((s) => s.line === line && s.sex === "L").flatMap((s) => (s.children ?? []).filter(ok)).length;
      const k = by("kandung");
      const s = by("seayah");
      if (id === "F1") return k > 0 ? "kandung" : s > 0 ? "seayah" : "tidak";
      return k > 0 ? k : s;
    }
    case "F2":
    case "F2n": {
      const ok = (p: Person) => p.alive && (!muslimOnly("kerabat") || isMuslim(p));
      const k = fam.paternalUncles.filter((u) => u.line === "kandung" && ok(u)).length;
      const s = fam.paternalUncles.filter((u) => u.line === "seayah" && ok(u)).length;
      if (id === "F2") return k > 0 ? "kandung" : s > 0 ? "seayah" : "tidak";
      return k > 0 ? k : s;
    }
    case "F3":
    case "F3n": {
      const ok = (p: Person) => p.alive && p.sex === "L" && (!muslimOnly("kerabat") || isMuslim(p));
      const by = (line: "kandung" | "seayah") => fam.paternalUncles.filter((u) => u.line === line).flatMap((u) => (u.children ?? []).filter(ok)).length;
      const k = by("kandung");
      const s = by("seayah");
      if (id === "F3") return k > 0 ? "dari_kandung" : s > 0 ? "dari_seayah" : "tidak";
      return k > 0 ? k : s;
    }
    case "F5":
      return restrict(f5Kinds(fam));
    case "F4":
      return hasOtherDzawil(fam) ? "ya" : "tidak";
    case "G1": {
      const xs: string[] = [];
      if (t.wasiat.lain) xs.push("lain");
      if (t.wasiat.waris) xs.push("waris");
      return restrict(xs);
    }
    case "G2":
      return t.wasiat.waris?.role ?? options[0];
    case "G3":
      return t.wasiat.lain?.size ?? "sepertiga";
    case "G3w":
      return t.wasiat.waris?.size ?? "sepertiga";
    case "G4":
      return t.wasiat.consent ? "setuju" : "tidak_setuju";
  }
}

// ---------------------------------------------------------------------------------------------
// Expected outcome (from the full family, never from the answers)
// ---------------------------------------------------------------------------------------------

export type Expected = { kind: "exit"; exit: ExitId } | { kind: "report"; fikih: string; court: string };

/** Policy-applied full signatures of one input in both report columns. */
export function columnSigs(input: WarisInput): { fikih: string; court: string; whole: boolean; reasons: { fikih: RujukReason[]; court: RujukReason[] } } {
  const f = applyPolicy(solveOnce(input, FIKIH), FIKIH).result;
  const c = applyPolicy(solveOnce(input, COURT), COURT).result;
  return {
    fikih: fullSig(f),
    court: fullSig(c),
    whole: f.kind === "rujuk" && c.kind === "rujuk",
    reasons: { fikih: f.kind === "rujuk" ? [...f.reasons] : [], court: c.kind === "rujuk" ? [...c.reasons] : [] },
  };
}

export function expected(t: TrueFamily): Expected {
  if (t.a1 === "wafat_nonmuslim") return { kind: "exit", exit: "E-NONMUSLIM" };
  if (t.killer) return { kind: "exit", exit: "E-BUNUH" };
  if (t.khuntsa) return { kind: "exit", exit: "E-KHUNTSA" };
  if (t.special) {
    const base = columnSigs(t.input);
    for (const sex of ["L", "P"] as const) {
      const fam = JSON.parse(JSON.stringify(t.input.family)) as FamilyInput;
      t.special.place(fam, sex);
      const w = columnSigs({ ...t.input, family: fam });
      if (w.fikih !== base.fikih || w.court !== base.court) return { kind: "exit", exit: t.special.flag === "k3" ? "E-MAFQUD" : t.special.flag === "k4" ? "E-HAML" : "E-BERSAMAAN" };
    }
  }
  const s = columnSigs(t.input);
  if (s.whole) return { kind: "exit", exit: exitFor(s.reasons.fikih, s.reasons.court) };
  return { kind: "report", fikih: s.fikih, court: s.court };
}

