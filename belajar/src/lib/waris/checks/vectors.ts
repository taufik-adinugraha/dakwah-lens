/**
 * Test-vector checks (engine.md §16; plan §10 M1.1). Plain TypeScript, no vitest import: the
 * vitest wrapper (../vectors.test.ts) and scripts/waris-check.ts both call runVectorChecks().
 *
 * The vector file describes a family with FLAT counts plus KHI lists (predeceasedChildren,
 * predeceasedSiblings); the engine takes a STRUCTURED family. mapVectorInput() is the faithful,
 * documented translation. A vector it cannot map is a FAILURE (never skipped silently). The only
 * skip is a switch value the engine documents but does not implement (substitution=luas), and it
 * is listed by name.
 */
import { NotImplementedVariantError, resolveRuleset, type Ruleset, isHeirId, isDzawilId, OUT_OF_SCOPE_FACTS } from "../registry";
import { solve } from "../solve";
import { eq, lcmAll, parse, toStr, type Frac } from "../frac";
import type { Bar, EstateInput, FamilyInput, Hasil, Person, Result, SiblingPerson, UnclePerson, WarisInput } from "../types";

// ---------------------------------------------------------------------------------------------
// Vector file shapes (test-vectors.json, schema waris-test-vectors/1)
// ---------------------------------------------------------------------------------------------

type Counts = Record<string, number>;
interface VKids {
  L?: number;
  P?: number;
}
export interface VInput {
  deceasedSex: "L" | "P";
  heirs: Counts;
  predeceasedChildren?: { sex: "L" | "P"; children: VKids }[];
  predeceasedSiblings?: { id: string; sex: "L" | "P"; line: "kandung" | "seayah" | "seibu"; children: VKids }[];
  nonMuslim?: Counts;
  barred?: { heir: string; count: number; reason: string; finalJudgment?: boolean }[];
  dzawilArham?: Counts;
  adoptedChildren?: { sex: "L" | "P"; courtOrder: boolean; receivedWasiat?: boolean }[];
  outOfScope?: string[];
  estate?: {
    netEstate?: number;
    netEstateBeforeWasiat?: number;
    hartaBawaan?: number;
    biayaSakit?: number;
    biayaJenazah?: number;
    utang?: number;
    hartaBersama?: { spouseId: string; period: number; amount: number }[];
    wasiat?: { toHeir: boolean; fraction?: string; amount?: number; toId?: string }[];
    heirsConsentToExcessWasiat?: boolean;
    assumptions?: string;
  };
  assumptions?: string;
}
export interface VExpected {
  status?: string;
  shares?: Record<string, string>;
  perHead?: Record<string, string>;
  blocked?: string[];
  ineligible?: string[];
  adjustments?: string[];
  base?: number;
  finalBase?: number;
  rupiah?: Record<string, number>;
  input_override?: Partial<VInput>;
  switches?: Record<string, string | boolean>;
  specialCase?: string;
  rujuk?: string[];
  notes_emitted?: string[];
  virtualHeirs?: Record<string, number>;
}
export interface Vector {
  id: string;
  title?: string;
  input: VInput;
  expected: Record<string, VExpected>;
}
export interface VectorFile {
  vectors: Vector[];
}

// ---------------------------------------------------------------------------------------------
// Per-vector aliases (documented): ids in the file that are not engine ids, read from the
// vector's own `assumptions` text. Engine id ↔ vector id for comparison.
// ---------------------------------------------------------------------------------------------

/**
 * kh-kasus1-cucu-asabah: dzawilArham "cucu_dari_anak_pr" — "the son of the LIVING daughter (so he
 * is no substitute)". Mapped as a son of the first living daughter; the engine names that
 * relative "cucu_lk_dari_anak_pr" (engine.md §5.1), compared back under the vector's id.
 */
const DZ_ALIASES: Record<string, Record<string, { attach: "living_anak_pr"; sex: "L" | "P"; engineId: string }>> = {
  "kh-kasus1-cucu-asabah": { cucu_dari_anak_pr: { attach: "living_anak_pr", sex: "L", engineId: "cucu_lk_dari_anak_pr" } },
};

export class MappingError extends Error {}

const SINGLE_ROLES: Record<string, keyof FamilyInput> = {
  ayah: "father",
  ibu: "mother",
  kakek: "paternalGrandfather",
  nenek_ayah: "paternalGrandmother",
  nenek_ibu: "maternalGrandmother",
};

const big = (x: number) => BigInt(x);

/**
 * Flat counts + KHI lists → structured FamilyInput. Rules (each documented in the report):
 *  - predeceasedChildren[k] / predeceasedSiblings are built first, in order (slot k = index k);
 *  - a flat id that the structured lists already produce (cucu_*, cucu_*_dari_anak_pr,
 *    keponakan_*, sibling-children ids) is reconciled: only the SURPLUS over the structured count
 *    becomes new people (under one synthetic predeceased parent per id). The vector describes one
 *    family; flat ids and the KHI lists are two views of the same people (conventions.input_override);
 *  - cucu_lk / cucu_pr without a stated parent are children of a predeceased son (every such
 *    vector's assumptions say so);
 *  - dzawil ids with a fixed wasith position (aunts, khal, maternal grandfather) are
 *    otherRelatives / maternalGrandfather;
 *  - nonMuslim / barred add people of that role with that status; estate.netEstate and
 *    netEstateBeforeWasiat are the amount divided (hartaBawaan with no deductions).
 */
export function mapVectorInput(vectorId: string, vi: VInput): WarisInput {
  const known = new Set([
    "deceasedSex",
    "heirs",
    "predeceasedChildren",
    "predeceasedSiblings",
    "nonMuslim",
    "barred",
    "dzawilArham",
    "adoptedChildren",
    "outOfScope",
    "estate",
    "assumptions",
  ]);
  for (const k of Object.keys(vi)) if (!known.has(k)) throw new MappingError(`unknown input field "${k}"`);
  const islam = "islam" as const;
  const P = (id: string, sex: "L" | "P", extra: Partial<Person> = {}): Person => ({ id, sex, alive: true, religion: islam, ...extra });
  const fam: FamilyInput = {
    deceased: { sex: vi.deceasedSex, religion: islam },
    spouses: [],
    children: [],
    siblings: [],
    paternalUncles: [],
    otherRelatives: [],
  };
  const kids = (prefix: string, k: VKids): Person[] => [
    ...Array.from({ length: k.L ?? 0 }, (_, j) => P(`${prefix}.L${j + 1}`, "L")),
    ...Array.from({ length: k.P ?? 0 }, (_, j) => P(`${prefix}.P${j + 1}`, "P")),
  ];
  // structured lists first (slot index k = predeceasedChildren[k])
  (vi.predeceasedChildren ?? []).forEach((c, k) =>
    fam.children.push({ id: `wafat_anak${k}`, sex: c.sex, alive: false, religion: islam, children: kids(`wafat_anak${k}`, c.children) }),
  );
  for (const s of vi.predeceasedSiblings ?? []) {
    fam.siblings.push({ id: `wafat_sdr_${s.id}`, sex: s.sex, line: s.line, alive: false, religion: islam, children: kids(`wafat_sdr_${s.id}`, s.children) });
  }
  // what the structured lists already produce, in classical ids
  const derived: Counts = {};
  const inc = (id: string, by = 1) => (derived[id] = (derived[id] ?? 0) + by);
  for (const c of vi.predeceasedChildren ?? []) {
    if (c.sex === "L") {
      inc("cucu_lk", c.children.L ?? 0);
      inc("cucu_pr", c.children.P ?? 0);
    } else {
      inc("cucu_lk_dari_anak_pr", c.children.L ?? 0);
      inc("cucu_pr_dari_anak_pr", c.children.P ?? 0);
    }
  }
  for (const s of vi.predeceasedSiblings ?? []) {
    if (s.line === "seibu") inc("anak_sdr_seibu", (s.children.L ?? 0) + (s.children.P ?? 0));
    else if (s.sex === "L") {
      inc(`keponakan_lk_${s.line}`, s.children.L ?? 0);
      inc(`anak_pr_sdr_lk_${s.line}`, s.children.P ?? 0);
    } else {
      inc(`anak_lk_sdr_pr_${s.line}`, s.children.L ?? 0);
      inc(`anak_pr_sdr_pr_${s.line}`, s.children.P ?? 0);
    }
  }
  const surplus = (id: string, n: number) => max0(n - (derived[id] ?? 0));

  // synthetic predeceased parents (built after the KHI lists so slot indices are unchanged)
  const synth = new Map<string, Person>();
  const synthParent = (key: string, make: () => Person, list: Person[]): Person => {
    let p = synth.get(key);
    if (!p) {
      p = make();
      synth.set(key, p);
      list.push(p);
    }
    return p;
  };
  const deadSon = () => synthParent("son", () => ({ id: "wafat_anak_lk", sex: "L", alive: false, religion: islam, children: [] }), fam.children);
  const deadDaughter = () =>
    synthParent("daughter", () => ({ id: "wafat_anak_pr", sex: "P", alive: false, religion: islam, children: [] }), fam.children);
  const deadSibling = (sex: "L" | "P", line: "kandung" | "seayah" | "seibu") =>
    synthParent(`sdr_${sex}_${line}`, () => ({ id: `wafat_sdr_${sex}_${line}`, sex, line, alive: false, religion: islam, children: [] }) as SiblingPerson, fam.siblings);
  const deadUncle = (line: "kandung" | "seayah") =>
    synthParent(`paman_${line}`, () => ({ id: `wafat_paman_${line}`, sex: "L", line, alive: false, religion: islam, children: [] }) as UnclePerson, fam.paternalUncles);

  const addPeople = (role: string, count: number, status: Partial<Person> = {}) => {
    for (let i = 0; i < count; i++) addOne(role, status);
  };
  const counters = new Map<string, number>();
  const nextId = (role: string) => {
    const c = (counters.get(role) ?? 0) + 1;
    counters.set(role, c);
    return `${role}#${c}`;
  };
  const addOne = (role: string, status: Partial<Person>) => {
    const id = nextId(role);
    switch (role) {
      case "suami":
        return fam.spouses.push(P(id, "L", status));
      case "istri":
        return fam.spouses.push(P(id, "P", status));
      case "anak_lk":
        return fam.children.push(P(id, "L", status));
      case "anak_pr":
        return fam.children.push(P(id, "P", status));
      case "cucu_lk":
        return deadSon().children!.push(P(id, "L", status));
      case "cucu_pr":
        return deadSon().children!.push(P(id, "P", status));
      case "sdr_lk_kandung":
      case "sdr_pr_kandung":
      case "sdr_lk_seayah":
      case "sdr_pr_seayah":
      case "sdr_lk_seibu":
      case "sdr_pr_seibu": {
        const [, sx, line] = role.split("_");
        return fam.siblings.push({ ...P(id, sx === "lk" ? "L" : "P", status), line: line as "kandung" | "seayah" | "seibu" });
      }
      case "keponakan_lk_kandung":
      case "keponakan_lk_seayah":
        return deadSibling("L", role.endsWith("kandung") ? "kandung" : "seayah").children!.push(P(id, "L", status));
      case "paman_kandung":
      case "paman_seayah":
        return fam.paternalUncles.push({ ...P(id, "L", status), line: role.endsWith("kandung") ? "kandung" : "seayah" });
      case "sepupu_lk_kandung":
      case "sepupu_lk_seayah":
        return deadUncle(role.endsWith("kandung") ? "kandung" : "seayah").children!.push(P(id, "L", status));
      default: {
        const single = SINGLE_ROLES[role];
        if (single) {
          if ((fam as unknown as Record<string, unknown>)[single]) throw new MappingError(`more than one "${role}"`);
          (fam as unknown as Record<string, Person>)[single] = P(id, role === "ibu" || role.startsWith("nenek") ? "P" : "L", status);
          return 1;
        }
        throw new MappingError(`unmappable heir id "${role}"`);
      }
    }
  };

  for (const [role, count] of Object.entries(vi.heirs)) {
    if (!isHeirId(role)) throw new MappingError(`heirs: "${role}" is not an engine heir id`);
    const reconciled = ["cucu_lk", "cucu_pr", "keponakan_lk_kandung", "keponakan_lk_seayah"].includes(role) ? surplus(role, count) : count;
    addPeople(role, reconciled);
  }
  for (const [role, count] of Object.entries(vi.nonMuslim ?? {})) addPeople(role, count, { religion: "non_islam" });
  for (const b of vi.barred ?? []) {
    const bar: Bar =
      b.reason === "membunuh" ? (b.finalJudgment === false ? "membunuh_tanpa_putusan" : "membunuh") : (b.reason as Bar);
    addPeople(b.heir, b.count, { bars: [bar] });
  }

  // dzawil arham
  const aliases = DZ_ALIASES[vectorId] ?? {};
  for (const [rel, count] of Object.entries(vi.dzawilArham ?? {})) {
    const alias = aliases[rel];
    if (alias) {
      const mother = fam.children.find((c) => c.alive && c.sex === "P");
      if (!mother) throw new MappingError(`alias ${rel}: no living daughter`);
      for (let i = 0; i < count; i++) (mother.children ??= []).push(P(nextId(rel), alias.sex));
      continue;
    }
    if (!isDzawilId(rel)) throw new MappingError(`dzawilArham: "${rel}" is not an engine dzawil-arham id`);
    const n = surplus(rel, count);
    const sexOf = (r: string): "L" | "P" => (r.includes("_pr") || r.startsWith("bibi") ? "P" : "L");
    for (let i = 0; i < n; i++) {
      const id = nextId(rel);
      switch (rel) {
        case "cucu_lk_dari_anak_pr":
        case "cucu_pr_dari_anak_pr":
          deadDaughter().children!.push(P(id, sexOf(rel.replace("_dari_anak_pr", ""))));
          break;
        case "anak_lk_dari_cucu_pr":
        case "anak_pr_dari_cucu_pr": {
          const son = deadSon();
          let gd = son.children!.find((c) => c.id === "wafat_cucu_pr");
          if (!gd) {
            gd = { id: "wafat_cucu_pr", sex: "P", alive: false, religion: islam, children: [] };
            son.children!.push(gd);
          }
          gd.children!.push(P(id, rel.startsWith("anak_lk") ? "L" : "P"));
          break;
        }
        case "anak_lk_sdr_pr_kandung":
        case "anak_pr_sdr_pr_kandung":
        case "anak_lk_sdr_pr_seayah":
        case "anak_pr_sdr_pr_seayah":
          deadSibling("P", rel.endsWith("kandung") ? "kandung" : "seayah").children!.push(P(id, rel.startsWith("anak_lk") ? "L" : "P"));
          break;
        case "anak_pr_sdr_lk_kandung":
        case "anak_pr_sdr_lk_seayah":
          deadSibling("L", rel.endsWith("kandung") ? "kandung" : "seayah").children!.push(P(id, "P"));
          break;
        case "anak_sdr_seibu":
          deadSibling("L", "seibu").children!.push(P(id, "L"));
          break;
        case "anak_pr_paman_kandung":
        case "anak_pr_paman_seayah":
          deadUncle(rel.endsWith("kandung") ? "kandung" : "seayah").children!.push(P(id, "P"));
          break;
        case "kakek_dari_ibu":
          if (fam.maternalGrandfather) throw new MappingError("more than one kakek_dari_ibu");
          fam.maternalGrandfather = P(id, "L");
          break;
        default:
          fam.otherRelatives!.push({ relation: rel, person: P(id, rel.startsWith("bibi") ? "P" : "L") });
      }
    }
  }
  for (const a of vi.adoptedChildren ?? []) {
    (fam.adoptedChildren ??= []).push({ ...P(nextId("anak_angkat"), a.sex), courtOrder: a.courtOrder, receivedWasiat: a.receivedWasiat ?? false });
  }
  if (vi.outOfScope) {
    for (const f of vi.outOfScope) if (!(OUT_OF_SCOPE_FACTS as readonly string[]).includes(f)) throw new MappingError(`outOfScope "${f}" unknown`);
    fam.outOfScope = vi.outOfScope as FamilyInput["outOfScope"];
  }

  let estate: EstateInput | undefined;
  if (vi.estate) {
    const e = vi.estate;
    const knownE = new Set(["netEstate", "netEstateBeforeWasiat", "hartaBawaan", "biayaSakit", "biayaJenazah", "utang", "hartaBersama", "wasiat", "heirsConsentToExcessWasiat", "assumptions"]);
    for (const k of Object.keys(e)) if (!knownE.has(k)) throw new MappingError(`unknown estate field "${k}"`);
    estate = {};
    const bawaan = e.netEstate ?? e.netEstateBeforeWasiat ?? e.hartaBawaan;
    if (bawaan !== undefined) estate.hartaBawaan = big(bawaan);
    if (e.biayaSakit !== undefined) estate.biayaSakit = big(e.biayaSakit);
    if (e.biayaJenazah !== undefined) estate.biayaJenazah = big(e.biayaJenazah);
    if (e.utang !== undefined) estate.utang = big(e.utang);
    if (e.hartaBersama) {
      estate.hartaBersama = e.hartaBersama.map((p) => {
        if (![1, 2, 3, 4].includes(p.period)) throw new MappingError(`hartaBersama period ${p.period}`);
        return { period: p.period as 1 | 2 | 3 | 4, amount: big(p.amount), spouseId: p.spouseId };
      });
    }
    if (e.wasiat) {
      estate.wasiat = e.wasiat.map((w) => ({
        toHeir: w.toHeir,
        ...(w.toId ? { toId: w.toId } : {}),
        ...(w.fraction ? { fraction: parse(w.fraction) } : {}),
        ...(w.amount !== undefined ? { amount: big(w.amount) } : {}),
      }));
    }
    if (e.heirsConsentToExcessWasiat !== undefined) estate.heirsConsentToExcessWasiat = e.heirsConsentToExcessWasiat;
  }
  return estate ? { family: fam, estate } : { family: fam };
}

function max0(x: number): number {
  return x > 0 ? x : 0;
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

export interface ExpectationResult {
  vector: string;
  key: string;
  status: "pass" | "fail" | "skipped";
  /** "field: message" per mismatch. */
  problems: string[];
  skipReason?: string;
  sourceStatus?: string;
}

function setEq(a: readonly string[], b: readonly string[]): boolean {
  const A = new Set(a);
  const B = new Set(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
}

/** Engine ↔ vector naming for one vector (aliases are per vector, see DZ_ALIASES). */
function aliasMap(vectorId: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const [vecId, a] of Object.entries(DZ_ALIASES[vectorId] ?? {})) m.set(a.engineId, vecId);
  return m;
}

function viewMaps(r: Hasil, view: "faraid" | "lines", alias: Map<string, string>) {
  const name = (x: string) => alias.get(x) ?? x;
  const shares = new Map<string, Frac>();
  const perPerson = new Map<string, { sex: string; share: Frac }[]>();
  for (const g of r.shares) {
    shares.set(name(g.heir), view === "faraid" ? g.group : g.line);
    perPerson.set(
      name(g.heir),
      g.persons.map((p) => ({ sex: p.sex, share: view === "faraid" ? p.share : p.line })),
    );
  }
  if (view === "faraid") {
    if (r.residue.baitulMal.n !== BigInt(0)) shares.set("baitul_mal", r.residue.baitulMal);
    if (r.residue.sisaDirujuk.n !== BigInt(0)) shares.set("sisa_dirujuk", r.residue.sisaDirujuk);
  } else {
    for (const l of r.lines) if (l.kind !== "heir") shares.set(l.key, l.frac);
  }
  return { shares, perPerson };
}

export function compareExpectation(vector: Vector, key: string, exp: VExpected, rs: Ruleset, r: Result): string[] {
  const problems: string[] = [];
  const alias = aliasMap(vector.id);
  const name = (x: string) => alias.get(x) ?? x;
  if (exp.switches) {
    for (const [k, v] of Object.entries(exp.switches)) {
      if ((rs.switches as unknown as Record<string, unknown>)[k] !== v) problems.push(`switches: ruleset has ${k}=${String((rs.switches as unknown as Record<string, unknown>)[k])}, vector says ${String(v)}`);
    }
  }
  if (exp.rujuk) {
    if (r.kind !== "rujuk") problems.push(`rujuk: expected refusal [${exp.rujuk.join(",")}], engine computed shares`);
    else if (!setEq(r.reasons, exp.rujuk)) problems.push(`rujuk: expected [${exp.rujuk.join(",")}], engine [${r.reasons.join(",")}]`);
    return problems;
  }
  if (r.kind !== "hasil") {
    problems.push(`kind: expected shares, engine refused [${r.reasons.join(",")}]`);
    return problems;
  }
  const view = Object.keys(exp.shares ?? {}).some((k) => k === "wasiat" || k.startsWith("wasiat#") || k.startsWith("wasiat_wajibah:")) ? "lines" : "faraid";
  const { shares, perPerson } = viewMaps(r, view, alias);
  // shares (exact)
  const expShares = new Map(Object.entries(exp.shares ?? {}).map(([k, v]) => [k, parse(v)] as const));
  for (const [k, v] of expShares) {
    const got = shares.get(k);
    if (!got) problems.push(`shares.${k}: expected ${toStr(v)}, engine has none`);
    else if (!eq(got, v)) problems.push(`shares.${k}: expected ${toStr(v)}, engine ${toStr(got)}`);
  }
  for (const [k, v] of shares) if (!expShares.has(k) && v.n !== BigInt(0)) problems.push(`shares.${k}: engine gives ${toStr(v)}, vector has none`);
  // blocked / ineligible / adjustments
  if (exp.blocked) {
    const got = r.blocked.map((b) => name(b.heir));
    if (!setEq(got, exp.blocked)) problems.push(`blocked: expected [${[...exp.blocked].sort().join(",")}], engine [${[...new Set(got)].sort().join(",")}]`);
  }
  if (exp.ineligible) {
    const got = r.ineligible.map((b) => b.heir);
    if (!setEq(got, exp.ineligible)) problems.push(`ineligible: expected [${exp.ineligible.join(",")}], engine [${got.join(",")}]`);
  }
  if (exp.adjustments && !setEq(r.adjustments, exp.adjustments)) {
    problems.push(`adjustments: expected [${exp.adjustments.join(",")}], engine [${r.adjustments.join(",")}]`);
  }
  // perHead (only when present)
  for (const [k, v] of Object.entries(exp.perHead ?? {})) {
    const want = parse(v);
    const [role, sex] = k.split(".");
    const ps = (perPerson.get(role) ?? []).filter((p) => !sex || p.sex === sex);
    if (ps.length === 0) problems.push(`perHead.${k}: engine has no such person`);
    else if (!ps.every((p) => eq(p.share, want))) problems.push(`perHead.${k}: expected ${v}, engine [${ps.map((p) => toStr(p.share)).join(",")}]`);
  }
  // integer table (only when present)
  if (exp.base !== undefined && r.base !== BigInt(exp.base)) problems.push(`base: expected ${exp.base}, engine ${r.base}`);
  if (exp.finalBase !== undefined) {
    const fb =
      view === "faraid"
        ? r.finalBase
        : lcmAll([...[...perPerson.values()].flat().map((p) => p.share.d), ...r.lines.filter((l) => l.kind !== "heir").map((l) => l.frac.d)]);
    if (fb !== BigInt(exp.finalBase)) problems.push(`finalBase: expected ${exp.finalBase}, engine ${fb}`);
  }
  // rupiah (only when present): exact key set and values
  if (exp.rupiah) {
    if (!r.rupiah) problems.push(`rupiah: expected amounts, engine computed none`);
    else {
      const got = r.rupiah;
      for (const [k, v] of Object.entries(exp.rupiah)) {
        if (got[k] === undefined) problems.push(`rupiah.${k}: expected ${v}, engine has none`);
        else if (got[k] !== BigInt(v)) problems.push(`rupiah.${k}: expected ${v}, engine ${got[k]}`);
      }
      for (const k of Object.keys(got)) if (!(k in exp.rupiah)) problems.push(`rupiah.${k}: engine has ${got[k]}, vector has none`);
    }
  }
  if (exp.specialCase !== undefined && r.specialCase !== exp.specialCase) problems.push(`specialCase: expected ${exp.specialCase}, engine ${r.specialCase ?? "none"}`);
  for (const nId of exp.notes_emitted ?? []) if (!(r.notes as string[]).includes(nId)) problems.push(`notes_emitted: missing ${nId} (engine [${r.notes.join(",")}])`);
  if (exp.virtualHeirs) {
    const got = r.virtualHeirs ?? {};
    const a = Object.entries(exp.virtualHeirs).map(([k, v]) => `${k}:${v}`);
    const b = Object.entries(got).map(([k, v]) => `${k}:${v}`);
    if (!setEq(a, b)) problems.push(`virtualHeirs: expected {${a.join(",")}}, engine {${b.join(",")}}`);
  }
  return problems;
}

/** Apply input_override: the fields it names replace the base input fields (conventions). */
export function effectiveInput(v: Vector, exp: VExpected): VInput {
  return exp.input_override ? ({ ...v.input, ...exp.input_override } as VInput) : v.input;
}

export function runVectorChecks(file: unknown): ExpectationResult[] {
  const f = file as VectorFile;
  if (!f || !Array.isArray(f.vectors)) throw new Error("vectors: not a waris-test-vectors file");
  const out: ExpectationResult[] = [];
  for (const v of f.vectors) {
    for (const [key, exp] of Object.entries(v.expected)) {
      const base = { vector: v.id, key, ...(exp.status ? { sourceStatus: exp.status } : {}) };
      let rs: Ruleset;
      try {
        rs = resolveRuleset(key);
      } catch (e) {
        if (e instanceof NotImplementedVariantError) {
          out.push({ ...base, status: "skipped", problems: [], skipReason: `${e.switchName}=${e.value} not implemented (registry NOT_IMPLEMENTED)` });
        } else out.push({ ...base, status: "fail", problems: [`ruleset: ${(e as Error).message}`] });
        continue;
      }
      let input: WarisInput;
      try {
        input = mapVectorInput(v.id, effectiveInput(v, exp));
      } catch (e) {
        out.push({ ...base, status: "fail", problems: [`mapping: ${(e as Error).message}`] });
        continue;
      }
      let r: Result;
      try {
        r = solve(input, rs);
      } catch (e) {
        out.push({ ...base, status: "fail", problems: [`engine threw: ${(e as Error).message}`] });
        continue;
      }
      const problems = compareExpectation(v, key, exp, rs, r);
      out.push({ ...base, status: problems.length === 0 ? "pass" : "fail", problems });
    }
  }
  return out;
}

export interface VectorSummary {
  vectors: number;
  expectations: number;
  byRuleset: Record<string, { pass: number; fail: number; skipped: number }>;
  failures: ExpectationResult[];
  skipped: ExpectationResult[];
}

export function summarize(results: readonly ExpectationResult[]): VectorSummary {
  const byRuleset: VectorSummary["byRuleset"] = {};
  for (const r of results) {
    const s = (byRuleset[r.key] ??= { pass: 0, fail: 0, skipped: 0 });
    s[r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "skipped"] += 1;
  }
  return {
    vectors: new Set(results.map((r) => r.vector)).size,
    expectations: results.length,
    byRuleset,
    failures: results.filter((r) => r.status === "fail"),
    skipped: results.filter((r) => r.status === "skipped"),
  };
}

