/**
 * Seeded random-family invariants (plan §10 M1.2; architecture.md §5.6). Plain TypeScript, no
 * vitest import. Every relative type is sampled INDEPENDENTLY (correlated samplers hid the E2/E3
 * skip bug, plan §5.1), including blocked siblings of every line, predeceased children with
 * children (KHI 185), non-Muslim and barred relatives, dzawil arham, adopted and step children,
 * beyond-depth relatives, harta-bersama pools, costs, debts and bequests.
 *
 * Invariants (per ruleset):
 *  I1 shares sum to exactly 1, the Baitul Mal / "sisa: konsultasikan" lines being explicit;
 *     the after-debts lines also sum to 1; no zero or negative share
 *  I2 every present relative is in exactly one of shares / blocked / ineligible
 *  I3 an eligible son ⇒ every eligible sibling (any line) is blocked
 *  I4 2 : 1 inside every male–female residuary group (and inside every KHI slot)
 *  I5 KHI 185(2) cap holds (slot ≤ the living child of the replaced child's degree)
 *  I6 the result does not depend on input order (arrays shuffled at every level)
 *  I7 solve is idempotent and never throws; rupiah sum to the estate, each within Rp 1
 *  I8 every rule that decided a share, an exclusion, an ineligibility, a bequest line or an
 *     adjustment is a trace step (the report's "Dasar hukum" is built from the trace,
 *     architecture.md §7.2 item 6); a tashih step goes up by a whole factor to finalBase
 */
import { eligibility } from "../eligibility";
import { B0, ONE, add, eq, floorMod, frac, gt, isZero, lt, mul, mulInt, sub, sum, toStr, type Frac } from "../frac";
import { COMPARISON_VARIANTS, PROFILE_IDS, isRuleId, resolveRuleset, type Ruleset } from "../registry";
import { resultSignature, solve } from "../solve";
import type { EstateInput, FamilyInput, Hasil, Person, Result, SiblingPerson, UnclePerson, WarisInput } from "../types";
import { Rng } from "./prng";

export const DEFAULT_SEED = 20261009;
export const INVARIANT_RULESETS: readonly string[] = [...PROFILE_IDS, ...COMPARISON_VARIANTS];

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

/**
 * One random family. Three mixes, chosen per family: DENSE (every relative type sampled
 * independently, ~50%), SPARSE (each type rare, so small families: radd, spouse-only, dzawil
 * arham, no heir at all), and PATTERN (a named-case template — akdariyyah, musytarakah,
 * 'Umariyyatain, grandfather with siblings, KHI slots, dzawil arham — plus random noise relatives).
 */
export function randomFamily(rng: Rng, index: number): WarisInput {
  let next = 0;
  const id = (p: string) => `${p}${index}_${next++}`;
  const mode = rng.int(10) < 5 ? "dense" : rng.int(2) === 0 ? "sparse" : "pattern";
  const dense = mode === "dense";
  const statusPct = mode === "pattern" ? 2 : 6;
  const person = (p: string, sex: "L" | "P", alive = true): Person => {
    const x: Person = { id: id(p), sex, alive, religion: rng.chance(statusPct) ? "non_islam" : "islam" };
    if (alive && rng.chance(dense ? 3 : 1)) {
      x.bars = [rng.pick(["membunuh", "mencoba_membunuh", "aniaya_berat", "fitnah_pidana5th", "membunuh_tanpa_putusan", "murtad"] as const)];
    }
    return x;
  };
  const sexOf = () => (rng.chance(50) ? "L" : "P") as "L" | "P";
  /** 0 with probability pZero (dense) or a higher one (sparse/pattern noise), else 1..max. */
  const count = (pZero: number, max: number) => {
    const z = dense ? pZero : pZero + floorDivSmall((100 - pZero) * 3, 4);
    return rng.int(100) < z ? 0 : 1 + rng.int(max);
  };
  const kidsOf = (prefix: string, n: number, deep: number): Person[] =>
    Array.from({ length: n }, () => {
      const alive = !rng.chance(12);
      const k = person(prefix, sexOf(), alive);
      if (deep > 0 && (!alive ? rng.chance(40) : rng.chance(4))) k.children = kidsOf(prefix + "c", 1 + rng.int(2), deep - 1);
      return k;
    });

  const sex = sexOf();
  const fam: FamilyInput = {
    deceased: { sex, religion: rng.chance(1) ? "non_islam" : "islam" },
    spouses: [],
    children: [],
    siblings: [],
    paternalUncles: [],
  };
  const spouseSex = sex === "L" ? ("P" as const) : ("L" as const);
  const sib = (sx: "L" | "P", line: "kandung" | "seayah" | "seibu"): SiblingPerson => ({ ...person("sib", sx), line });
  const pct = (dense_: number) => (dense ? dense_ : floorDivSmall(dense_, 4));

  if (mode === "pattern") {
    const t = rng.int(9);
    if (t === 0) {
      // Akdariyyah (deceased woman): husband, mother, grandfather, ONE sister
      fam.deceased.sex = "P";
      fam.spouses.push(person("sp", "L"));
      fam.mother = person("m", "P");
      fam.paternalGrandfather = person("gf", "L");
      fam.siblings.push(sib("P", rng.chance(70) ? "kandung" : "seayah"));
    } else if (t === 1) {
      // Musytarakah: husband, mother/grandmother, ≥ 2 uterine, ≥ 1 full brother
      fam.deceased.sex = "P";
      fam.spouses.push(person("sp", "L"));
      if (rng.chance(70)) fam.mother = person("m", "P");
      else fam.maternalGrandmother = person("gmm", "P");
      for (let i = 2 + rng.int(2); i > 0; i--) fam.siblings.push(sib(sexOf(), "seibu"));
      for (let i = 1 + rng.int(2); i > 0; i--) fam.siblings.push(sib("L", "kandung"));
      if (rng.chance(40)) fam.siblings.push(sib("P", "kandung"));
    } else if (t === 2) {
      // 'Umariyyatain (father or grandfather)
      fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(70)) fam.father = person("f", "L");
      else fam.paternalGrandfather = person("gf", "L");
      fam.mother = person("m", "P");
    } else if (t === 3) {
      // grandfather with siblings (Zaid), incl. mu'addah and the ⅙ floor
      fam.paternalGrandfather = person("gf", "L");
      for (const line of ["kandung", "seayah"] as const) for (const sx of ["L", "P"] as const) for (let i = rng.int(3); i > 0; i--) fam.siblings.push(sib(sx, line));
      if (rng.chance(50)) fam.mother = person("m", "P");
      if (rng.chance(40)) fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(30)) for (let i = 1 + rng.int(2); i > 0; i--) fam.children.push(person("dau", "P"));
      if (rng.chance(25)) fam.siblings.push(sib(sexOf(), "seibu"));
    } else if (t === 4) {
      // KHI 185 slots against living children
      for (let i = rng.int(3); i > 0; i--) fam.children.push(person(rng.chance(50) ? "son" : "dau", sexOf()));
      for (let i = 1 + rng.int(2); i > 0; i--) {
        const c: Person = { id: id("dead"), sex: sexOf(), alive: false, religion: "islam" };
        c.children = kidsOf("gc", 1 + rng.int(3), 0);
        fam.children.splice(rng.int(fam.children.length + 1), 0, c);
      }
      if (rng.chance(50)) fam.spouses.push(person("sp", spouseSex));
      if (rng.chance(50)) fam.siblings.push(sib(sexOf(), rng.pick(["kandung", "seayah", "seibu"] as const)));
    } else if (t === 5) {
      // dzawil arham only (+ maybe a spouse)
      if (rng.chance(40)) fam.spouses.push(person("sp", spouseSex));
      const rel = rng.pick(["bibi_ayah", "bibi_ibu", "paman_ibu", "paman_seibu_ayah"] as const);
      fam.otherRelatives = [{ relation: rel, person: { id: id("dz"), sex: rel.startsWith("bibi") ? "P" : "L", alive: true, religion: "islam" } }];
      if (rng.chance(50)) fam.children.push({ id: id("dead"), sex: "P", alive: false, religion: "islam", children: kidsOf("gc", 1, 0) });
      if (rng.chance(50)) fam.siblings.push({ id: id("deadsib"), sex: sexOf(), alive: false, religion: "islam", line: rng.pick(["kandung", "seayah", "seibu"] as const), children: kidsOf("nep", 1, 0) });
    } else if (t === 6) {
      // radd families: daughters / mother / uterine / grandmother, maybe a spouse
      if (rng.chance(50)) fam.spouses.push(person("sp", spouseSex));
      for (let i = rng.int(3); i > 0; i--) fam.children.push(person("dau", "P"));
      if (rng.chance(50)) fam.mother = person("m", "P");
      else if (rng.chance(50)) fam.maternalGrandmother = person("gmm", "P");
      for (let i = rng.int(3); i > 0; i--) fam.siblings.push(sib(sexOf(), "seibu"));
    } else if (t === 7) {
      // spouse only, or nobody at all
      if (rng.chance(80)) for (let i = sex === "L" ? 1 + rng.int(4) : 1; i > 0; i--) fam.spouses.push(person("sp", spouseSex));
    } else {
      // daughters with sisters (ma'al ghair) and the consanguine line
      for (let i = 1 + rng.int(2); i > 0; i--) fam.children.push(person("dau", "P"));
      for (const line of ["kandung", "seayah"] as const) for (const sx of ["L", "P"] as const) for (let i = rng.int(2); i > 0; i--) fam.siblings.push(sib(sx, line));
      if (rng.chance(40)) fam.paternalUncles.push({ ...person("unc", "L"), line: "kandung" });
    }
  }

  // random relatives: every type independently (dense), rarely (sparse), as noise (pattern)
  const nSpouses =
    fam.spouses.length > 0 ? 0 : sex === "P" ? (rng.chance(dense ? 65 : 30) ? 1 : 0) : dense ? rng.pick([0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 3, 4]) : rng.pick([0, 0, 0, 0, 1, 1, 2]);
  if (fam.deceased.sex !== sex) fam.spouses = fam.spouses.filter((p) => p.sex !== fam.deceased.sex);
  for (let i = 0; i < nSpouses; i++) fam.spouses.push(person("sp", fam.deceased.sex === "L" ? "P" : "L"));
  for (let i = count(45, 3); i > 0; i--) {
    const c = person("son", "L");
    if (rng.chance(15)) c.children = kidsOf("gs", 1 + rng.int(2), 1);
    fam.children.push(c);
  }
  for (let i = count(45, 4); i > 0; i--) {
    const c = person("dau", "P");
    if (rng.chance(15)) c.children = kidsOf("gd", 1 + rng.int(2), 1);
    fam.children.push(c);
  }
  for (let i = count(70, 2); i > 0; i--) {
    const c: Person = { id: id("dead"), sex: sexOf(), alive: false, religion: rng.chance(4) ? "non_islam" : "islam" };
    c.children = kidsOf("gc", count(15, 3), 1);
    fam.children.splice(rng.int(fam.children.length + 1), 0, c);
  }
  if (!fam.father && rng.chance(pct(40))) fam.father = person("f", "L");
  if (!fam.mother && rng.chance(pct(45))) fam.mother = person("m", "P");
  if (!fam.paternalGrandfather && rng.chance(pct(25))) fam.paternalGrandfather = person("gf", "L");
  if (rng.chance(pct(20))) fam.paternalGrandmother = person("gmf", "P");
  if (!fam.maternalGrandmother && rng.chance(pct(20))) fam.maternalGrandmother = person("gmm", "P");
  if (rng.chance(pct(5) + 1)) fam.maternalGrandfather = person("gfm", "L");
  for (const line of ["kandung", "seayah", "seibu"] as const) {
    for (const sx of ["L", "P"] as const) {
      for (let i = count(70, 3); i > 0; i--) {
        const s = sib(sx, line);
        if (rng.chance(12)) s.children = kidsOf("nep", 1 + rng.int(2), 1);
        fam.siblings.push(s);
      }
      if (rng.chance(dense ? 8 : 4)) {
        fam.siblings.push({ id: id("deadsib"), sex: sx, alive: false, religion: "islam", line, children: kidsOf("nep", 1 + rng.int(2), 1) });
      }
    }
  }
  for (const line of ["kandung", "seayah"] as const) {
    for (let i = count(80, 2); i > 0; i--) {
      const alive = !rng.chance(30);
      const u: UnclePerson = { ...person("unc", "L", alive), line };
      if (rng.chance(alive ? 15 : 60)) u.children = kidsOf("cou", 1 + rng.int(2), 1);
      fam.paternalUncles.push(u);
    }
  }
  if (rng.chance(dense ? 6 : 12)) {
    fam.otherRelatives = [
      ...(fam.otherRelatives ?? []),
      ...Array.from({ length: 1 + rng.int(2) }, () => {
        const relation = rng.pick(["bibi_ayah", "bibi_ibu", "paman_ibu", "paman_seibu_ayah", "kakek_dari_ibu", "anak_pr_dari_cucu_pr"] as const);
        const female = relation.startsWith("bibi") || relation.startsWith("anak_pr");
        return { relation, person: { id: id("dz"), sex: female ? ("P" as const) : ("L" as const), alive: true, religion: "islam" as const } };
      }),
    ];
  }
  if (rng.chance(5)) fam.adoptedChildren = [{ ...person("adopt", sexOf()), courtOrder: rng.chance(70), receivedWasiat: rng.chance(20) }];
  if (rng.chance(3)) fam.adoptiveParents = [{ ...person("adoptpar", sexOf()), courtOrder: rng.chance(80), receivedWasiat: rng.chance(10) }];
  if (rng.chance(4)) fam.stepChildren = [person("step", sexOf())];
  if (rng.chance(1)) fam.outOfScope = [rng.pick(["khuntsa", "mafqud", "haml", "gharqa"] as const)];

  let estate: EstateInput | undefined;
  if (rng.chance(60)) {
    estate = { hartaBawaan: BigInt(1 + rng.int(999)) * BigInt(1000000) + BigInt(rng.int(1000)) };
    if (fam.spouses.length > 0 && rng.chance(35)) {
      estate.hartaBersama = [{ period: (1 + rng.int(fam.spouses.length + (rng.chance(5) ? 1 : 0))) as 1 | 2 | 3 | 4, amount: BigInt(1 + rng.int(1000000)) * BigInt(997) }];
    }
    if (rng.chance(3)) estate.hartaBersamaRumit = true;
    if (rng.chance(30)) estate.biayaJenazah = BigInt(rng.int(20000000));
    if (rng.chance(20)) estate.utang = BigInt(rng.int(rng.chance(5) ? 2000000000 : 200000000));
    if (rng.chance(15)) {
      estate.wasiat = Array.from({ length: 1 + rng.int(2) }, () =>
        rng.chance(50)
          ? { toHeir: rng.chance(20), fraction: rng.pick([frac(1, 10), frac(1, 4), frac(1, 3), frac(1, 2)]) }
          : { toHeir: rng.chance(20), amount: BigInt(rng.int(300000000)) },
      );
      estate.heirsConsentToExcessWasiat = rng.chance(20);
    }
  } else if (rng.chance(10)) {
    // a bequest stated as a fraction with no amounts
    estate = { wasiat: [{ toHeir: false, fraction: rng.pick([frac(1, 10), frac(1, 3), frac(1, 2)]) }], heirsConsentToExcessWasiat: rng.chance(20) };
  }
  return estate ? { family: fam, estate } : { family: fam };
}

/** floor(a / b) for small non-negative integers, without the `/` operator on numbers. */
function floorDivSmall(a: number, b: number): number {
  let q = 0;
  for (let r = a; r >= b; r -= b) q++;
  return q;
}

// ---------------------------------------------------------------------------------------------
// Input reordering (I6)
// ---------------------------------------------------------------------------------------------

function shufflePeople(rng: Rng, xs: Person[]): Person[] {
  const out = rng.shuffle(xs.map((p) => ({ ...p })));
  for (const p of out) if (p.children) p.children = shufflePeople(rng, p.children);
  return out;
}

export function reorder(rng: Rng, input: WarisInput): WarisInput {
  const f = structuredClone(input.family);
  const pooled = (input.estate?.hartaBersama?.length ?? 0) > 0;
  const fam: FamilyInput = {
    ...f,
    // spouse order defines harta-bersama periods: only shuffled when there is no pool
    spouses: pooled ? f.spouses : shufflePeople(rng, f.spouses),
    children: shufflePeople(rng, f.children),
    siblings: shufflePeople(rng, f.siblings) as SiblingPerson[],
    paternalUncles: shufflePeople(rng, f.paternalUncles) as UnclePerson[],
    ...(f.otherRelatives ? { otherRelatives: rng.shuffle(f.otherRelatives) } : {}),
    ...(f.stepChildren ? { stepChildren: shufflePeople(rng, f.stepChildren) } : {}),
  };
  return { family: fam, ...(input.estate ? { estate: structuredClone(input.estate) } : {}) };
}

/**
 * Order-free canonical form. Two things legitimately follow input order and are normalised here:
 * KHI slot keys (pengganti_<k> = k-th predeceased child) and output keys "role#i"; and the
 * rupiah tie-break (engine.md §14: "ties by registry order of the heir id, then input order"),
 * so rupiah are left to I7 (each person within Rp 1 of the exact value, total exact).
 */
export function canonical(r: Result): string {
  if (r.kind === "rujuk") return `rujuk:${[...r.reasons].sort().join(",")}`;
  const slotName = (k: string) => (k.startsWith("pengganti_") ? "pengganti" : k);
  const groups = r.shares
    .map((g) => `${slotName(g.heir)}=${toStr(g.group)}|${toStr(g.line)}|${g.persons.map((p) => `${p.personId}:${toStr(p.share)}:${toStr(p.line)}`).sort().join(",")}`)
    .sort();
  const blocked = r.blocked.map((b) => `${slotName(b.heir)}:${[...b.personIds].sort().join(",")}`).sort();
  const inel = r.ineligible.map((b) => `${slotName(b.heir)}:${b.reason}:${[...b.personIds].sort().join(",")}`).sort();
  const lines = r.lines
    .filter((l) => l.kind !== "heir")
    .map((l) => `${l.kind === "wasiat_wajibah" ? `ww:${l.personIds.join(",")}` : l.key}=${toStr(l.frac)}`)
    .sort();
  groups.push(`Rp:${r.rupiah ? "yes" : "no"}`);
  return [
    groups.join(";"),
    `B:${blocked.join(";")}`,
    `I:${inel.join(";")}`,
    `A:${[...r.adjustments].sort().join(",")}`,
    `R:${toStr(r.residue.baitulMal)},${toStr(r.residue.sisaDirujuk)}`,
    `L:${lines.join(";")}`,
    `N:${[...r.notes].sort().join(",")}`,
    `S:${r.specialCase ?? ""}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------------

export interface InvariantFailure {
  index: number;
  invariant: string;
  message: string;
  input?: WarisInput;
}

function presentPersons(fam: FamilyInput): string[] {
  const out: string[] = [];
  const walk = (p: Person) => {
    if (p.alive) out.push(p.id);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [
    ...fam.spouses.filter((s) => s.alive),
    ...fam.children,
    ...[fam.father, fam.mother, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother, fam.maternalGrandfather].filter(
      (x): x is Person => !!x,
    ),
    ...fam.siblings,
    ...fam.paternalUncles,
    ...(fam.otherRelatives ?? []).map((o) => o.person),
    ...(fam.adoptedChildren ?? []),
    ...(fam.adoptiveParents ?? []),
    ...(fam.stepChildren ?? []),
  ])
    walk(p);
  return out;
}

export function checkHasil(input: WarisInput, r: Hasil, rs: Ruleset): { invariant: string; message: string }[] {
  const bad: { invariant: string; message: string }[] = [];
  const fail = (invariant: string, message: string) => bad.push({ invariant, message });
  const fam = input.family;

  // I1
  const total = add(add(sum(r.shares.map((g) => g.group)), r.residue.baitulMal), r.residue.sisaDirujuk);
  if (!eq(total, ONE)) fail("I1 sum", `shares + baitul_mal + sisa = ${toStr(total)}`);
  const lines = sum(r.lines.map((l) => l.frac));
  if (!eq(lines, ONE)) fail("I1 sum", `lines sum to ${toStr(lines)}`);
  if (!isZero(r.residue.baitulMal) && rs.switches.residue !== "baitul_mal") fail("I1 sum", "Baitul Mal line outside klasik-syafii-asal");
  if (!isZero(r.residue.sisaDirujuk)) {
    const roles = new Set(r.shares.map((g) => g.heir));
    if (![...roles].every((x) => x === "istri" || x === "suami")) fail("I1 sum", `sisa_dirujuk with non-spouse heirs ${[...roles].join(",")}`);
    if (!r.notes.includes("sisa_pasangan_saja")) fail("I1 sum", "sisa_dirujuk without the sisa_pasangan_saja note");
  }
  for (const g of r.shares) for (const p of g.persons) if (!gt(p.share, frac(0))) fail("I1 sum", `non-positive share for ${p.personId}`);

  // I2
  const seen = new Map<string, number>();
  const mark = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const g of r.shares) for (const p of g.persons) mark(p.personId);
  for (const b of r.blocked) for (const id of b.personIds) mark(id);
  for (const b of r.ineligible) for (const id of b.personIds) mark(id);
  for (const id of presentPersons(fam)) {
    const n = seen.get(id) ?? 0;
    if (n !== 1) fail("I2 exactly-one", `${id} appears ${n} times in shares/blocked/ineligible`);
    seen.delete(id);
  }
  for (const id of seen.keys()) fail("I2 exactly-one", `${id} is listed but is not a present relative`);

  // I3
  const eligible = (p: Person) => eligibility(p, rs.switches).ok;
  const son = fam.children.some((c) => c.alive && c.sex === "L" && eligible(c));
  if (son) {
    const blockedIds = new Set(r.blocked.flatMap((b) => b.personIds));
    for (const s of fam.siblings) if (s.alive && eligible(s) && !blockedIds.has(s.id)) fail("I3 son blocks siblings", `${s.id} (${s.line}) not blocked`);
  }

  // I4
  const per = (heir: string): Frac | undefined => r.shares.find((g) => g.heir === heir)?.perHead;
  const pairs: [string, string][] = [
    ["anak_lk", "anak_pr"],
    ["cucu_lk", "cucu_pr"],
    ["sdr_lk_kandung", "sdr_pr_kandung"],
    ["sdr_lk_seayah", "sdr_pr_seayah"],
  ];
  for (const [m, f] of pairs) {
    if (r.specialCase === "musytarakah" && m === "sdr_lk_kandung") continue; // per head, male = female
    const pm = per(m);
    const pf = per(f);
    if (pm && pf && !eq(pm, mulInt(pf, 2))) fail("I4 2:1", `${m} ${toStr(pm)} vs ${f} ${toStr(pf)}`);
  }
  for (const g of r.shares) {
    if (!g.heir.startsWith("pengganti_")) continue;
    const L = g.persons.filter((p) => p.sex === "L").map((p) => p.share);
    const P = g.persons.filter((p) => p.sex === "P").map((p) => p.share);
    if (L.length > 0 && P.length > 0 && !eq(L[0], mulInt(P[0], 2))) fail("I4 2:1", `${g.heir}: L ${toStr(L[0])} vs P ${toStr(P[0])}`);
  }

  // I5
  if (rs.switches.substitution === "cucu" && rs.switches.substitutionCap !== "none") {
    const living = r.shares.filter((g) => g.heir === "anak_lk" || g.heir === "anak_pr").flatMap((g) => g.persons);
    if (living.length > 0) {
      let maxLiving = living[0].share;
      for (const p of living) if (gt(p.share, maxLiving)) maxLiving = p.share;
      for (const g of r.shares) {
        if (!g.heir.startsWith("pengganti_")) continue;
        if (rs.switches.substitutionCap === "sederajat" && gt(g.group, maxLiving)) fail("I5 KHI 185(2)", `${g.heir} ${toStr(g.group)} > living child ${toStr(maxLiving)}`);
        if (rs.switches.substitutionCap === "per_kepala")
          for (const p of g.persons) if (gt(p.share, maxLiving)) fail("I5 KHI 185(2)", `${p.personId} ${toStr(p.share)} > living child ${toStr(maxLiving)}`);
      }
    }
  }

  // I8 trace
  const traced = new Set<string>(r.trace.map((t) => t.rule));
  for (const g of r.shares) if (!traced.has(g.rule)) fail("I8 trace", `share rule ${g.rule} (${g.heir}) is not a trace step`);
  for (const b of r.blocked) if (!traced.has(b.rule)) fail("I8 trace", `blocked rule ${b.rule} (${b.heir}) is not a trace step`);
  for (const b of r.ineligible) if (!traced.has(b.rule)) fail("I8 trace", `ineligible rule ${b.rule} (${b.heir}) is not a trace step`);
  if (traced.has("estate.wasiat") !== r.lines.some((l) => l.kind === "wasiat")) {
    fail("I8 trace", `estate.wasiat step ${traced.has("estate.wasiat") ? "without a wasiat line" : "missing for a wasiat line"}`);
  }
  if (r.lines.some((l) => l.kind === "wasiat_wajibah") && !traced.has("estate.wasiat_wajibah")) fail("I8 trace", "wasiat wajibah line without its step");
  for (const a of r.adjustments) {
    const ok = a === "radd" ? traced.has("radd.semua") || traced.has("radd.tanpa_pasangan") : traced.has(a);
    if (!ok) fail("I8 trace", `adjustment ${a} has no trace step`);
  }
  // tashih multiplies the table by a whole factor, ikhtisar divides it by one, and the last table is
  // finalBase (outside the as-if illustration, whose table also holds the wasiat-wajibah share)
  let table: bigint | undefined;
  for (const rule of ["tashih", "ikhtisar"] as const) {
    const steps = r.trace.filter((t) => t.rule === rule);
    if (steps.length > 1) fail("I8 trace", `${steps.length} ${rule} steps`);
    for (const t of steps) {
      const dari = BigInt(t.facts?.dari ?? "0");
      const menjadi = BigInt(t.facts?.menjadi ?? "0");
      const whole = dari > B0 && menjadi > B0 && (rule === "tashih" ? menjadi > dari && floorMod(menjadi, dari) === B0 : menjadi < dari && floorMod(dari, menjadi) === B0);
      if (!whole) fail("I8 trace", `${rule} ${dari} → ${menjadi} is not a whole ${rule === "tashih" ? "multiplication" : "division"}`);
      if (table !== undefined && dari !== table) fail("I8 trace", `ikhtisar starts at ${dari}, tashih ended at ${table}`);
      table = menjadi;
    }
  }
  if (table !== undefined && !r.notes.includes("wasiat_wajibah_ilustrasi") && table !== r.finalBase) fail("I8 trace", `table ends at ${table}, finalBase ${r.finalBase}`);

  // I7 rupiah
  if (r.rupiah && r.estate) {
    const T = r.estate.afterDebts;
    let got = B0;
    for (const l of r.lines) {
      if (l.kind === "heir") continue;
      got += r.rupiah[l.key] ?? B0;
      const exact = mul(l.frac, frac(T));
      const diff = sub(frac(r.rupiah[l.key] ?? B0), exact);
      if (!lt(diff, ONE) || !gt(diff, frac(-1))) fail("I7 rupiah", `${l.key} off by more than Rp 1`);
    }
    for (const g of r.shares)
      for (const p of g.persons) {
        got += p.rupiah ?? B0;
        const diff = sub(frac(p.rupiah ?? B0), mul(p.line, frac(T)));
        if (!lt(diff, ONE) || !gt(diff, frac(-1))) fail("I7 rupiah", `${p.personId} off by more than Rp 1`);
      }
    if (got !== T) fail("I7 rupiah", `rupiah sum ${got} ≠ estate after debts ${T}`);
    const own = Object.values(r.estate.hartaBersamaSpouse).reduce((a, b) => a + b, B0);
    const pools = (input.estate?.hartaBersama ?? []).reduce((a, p) => a + p.amount, B0);
    if (own + r.estate.grossOwn !== pools + (input.estate?.hartaBawaan ?? B0)) fail("I7 rupiah", "harta bersama split does not add up");
  }
  return bad;
}

export interface InvariantReport {
  ruleset: string;
  seed: number;
  families: number;
  hasil: number;
  rujuk: number;
  failures: InvariantFailure[];
  /** How often each refusal reason, special case, adjustment and note was reached. */
  coverage: Record<string, number>;
}

export function runInvariants(opts: { count: number; seed: number; ruleset: string; maxFailures?: number }): InvariantReport {
  const rs = resolveRuleset(opts.ruleset);
  const gen = new Rng(opts.seed);
  const shuf = new Rng(opts.seed ^ 0x5bd1e995);
  const failures: InvariantFailure[] = [];
  const maxF = opts.maxFailures ?? 50;
  let hasil = 0;
  let rujuk = 0;
  const coverage: Record<string, number> = {};
  const hit = (k: string) => (coverage[k] = (coverage[k] ?? 0) + 1);
  for (let i = 0; i < opts.count && failures.length < maxF; i++) {
    const input = randomFamily(gen, i);
    let r: Result;
    try {
      r = solve(input, rs);
    } catch (e) {
      failures.push({ index: i, invariant: "I7 never throws", message: (e as Error).message, input });
      continue;
    }
    for (const t of r.trace) if (!isRuleId(t.rule)) failures.push({ index: i, invariant: "I9 registered rule ids", message: `unregistered trace rule ${t.rule}`, input });
    if (r.kind === "rujuk") {
      rujuk++;
      for (const x of r.reasons) hit(`rujuk.${x}`);
    } else {
      hasil++;
      if (r.specialCase) hit(`special.${r.specialCase}`);
      for (const a of r.adjustments) hit(`adj.${a}`);
      for (const nn of r.notes) hit(`catatan.${nn}`);
      if (r.shares.some((g) => g.heir.startsWith("pengganti_"))) hit("khi.pengganti");
      if (r.lines.some((l) => l.kind === "wasiat_wajibah")) hit("wasiat_wajibah");
      if (r.lines.some((l) => l.kind === "wasiat")) hit("wasiat");
      if (r.virtualHeirs) hit("dzawil_arham.tanzil");
      if (r.rupiah) hit("rupiah");
      if (r.switchesUsed.length > 0) hit("switchesUsed>0");
      if (r.blocked.some((b) => b.heir === "kerabat_jauh")) hit("kerabat_jauh.terhalang");
      for (const b of checkHasil(input, r, rs)) failures.push({ index: i, ...b, input });
    }
    try {
      const again = solve(input, rs);
      if (resultSignature(again) !== resultSignature(r)) failures.push({ index: i, invariant: "I7 idempotent", message: "second solve differs", input });
      const moved = solve(reorder(shuf, input), rs);
      if (canonical(moved) !== canonical(r)) {
        failures.push({ index: i, invariant: "I6 input order", message: `\n${canonical(r)}\n--- vs reordered ---\n${canonical(moved)}`, input });
      }
    } catch (e) {
      failures.push({ index: i, invariant: "I7 never throws", message: `(reordered) ${(e as Error).message}`, input });
    }
  }
  return { ruleset: rs.id, seed: opts.seed, families: opts.count, hasil, rujuk, failures, coverage };
}
