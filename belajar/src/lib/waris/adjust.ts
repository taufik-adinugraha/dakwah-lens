/**
 * Adjustments (engine.md §9.2, §9.4, §10): 'aul with the classical bases only (fails loudly
 * otherwise), radd to non-spouses (default) or to all (comparison), the Baitul Mal (only in
 * klasik-syafii-asal), the unassigned residue when a spouse is the only heir ("sisa:
 * konsultasikan", plan D7), and dzawil arham by tanzil (fikih column; the UI refuses in v1).
 */
import { B0, ONE, div, divInt, mul, sub, sum, type Frac } from "./frac";
import type { FardhGroup } from "./furudh";
import { HEIR_SEX, type HeirId, type RujukReason, type Sex, type Switches } from "./registry";
import type { CoreInput, CoreOut, Member, TraceStep } from "./types";
import type { DzPerson } from "./family";

/** 'Aul only raises 6 → 7, 8, 9, 10; 12 → 13, 15, 17; 24 → 27 (NU Online / Zuhaili; MAIS; Fiqh as-Sunnah § 853). */
export const AUL_BASES: ReadonlyMap<string, readonly string[]> = new Map([
  ["6", ["7", "8", "9", "10"]],
  ["12", ["13", "15", "17"]],
  ["24", ["27"]],
]);

export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(`waris engine invariant: ${message}`);
    this.name = "EngineInvariantError";
  }
}

/** Assert an 'aul is classical; anything else is an engine bug and must fail loudly. */
export function assertAul(base: bigint, siham: bigint): void {
  const ok = AUL_BASES.get(base.toString())?.includes(siham.toString()) ?? false;
  if (!ok) throw new EngineInvariantError(`'aul from base ${base} to ${siham} is not a classical 'aul`);
}

/** Scale every fardh group by 1/Σ ('aul, and radd to all). */
export function scaleAll(groups: FardhGroup[], total: Frac): FardhGroup[] {
  return groups.map((g) => ({ ...g, share: div(g.share, total) }));
}

/**
 * Radd to the NON-spouse fardh heirs in proportion to their furudh; the spouse keeps exactly the
 * fardh (Fath al-Mu'in § 34; Khairuddin pp. 54–65; Buku II 2013 p. 176 §8(h), superseded).
 */
export function raddNonSpouse(groups: FardhGroup[]): FardhGroup[] {
  const spouse = sum(groups.filter((g) => g.spouse).map((g) => g.share));
  const others = sum(groups.filter((g) => !g.spouse).map((g) => g.share));
  const factor = div(sub(ONE, spouse), others);
  return groups.map((g) => (g.spouse ? g : { ...g, share: mul(g.share, factor) }));
}

// ---------------------------------------------------------------------------------------------
// Dzawil arham by tanzil (engine.md §10; Tuwaijri IV:443)
// ---------------------------------------------------------------------------------------------

export interface TanzilOut {
  kind: "ok";
  /** Share of the WHOLE estate per dzawil person (spouse already taken out). */
  personShares: Map<string, Frac>;
  /** Persons whose wasith takes nothing in the virtual problem. */
  blocked: { personId: string; relation: string; byWasith: string[] }[];
  virtualHeirs: Partial<Record<HeirId, number>>;
  core: CoreOut;
  trace: TraceStep[];
}

/**
 * 1. map each relative to their wasith; 2. solve the virtual problem among the wasith-heirs (all
 * hajb applies among them), the spouse having taken their full fardh first and the dzawil arham
 * sharing the rest as if it were the whole estate (EQ11: the "rest as whole" mechanics are not in
 * an opened Syafi'i text); 3. pass each wasith's share down. Several relatives of mixed sex under
 * one wasith → rujuk dzawil_arham_campuran.
 */
export function tanzil(
  dz: readonly DzPerson[],
  rest: Frac,
  deceasedSex: Sex,
  sw: Switches,
  solveCore: (ci: CoreInput) => CoreOut,
): TanzilOut | { kind: "rujuk"; reasons: RujukReason[] } {
  const byKey = new Map<string, DzPerson[]>();
  for (const p of dz) byKey.set(p.wasithKey, [...(byKey.get(p.wasithKey) ?? []), p]);
  const roles: Partial<Record<HeirId, Member[]>> = {};
  const virtualHeirs: Partial<Record<HeirId, number>> = {};
  for (const [key, ps] of byKey) {
    const sexes = new Set(ps.map((p) => p.sex));
    if (ps.length > 1 && sexes.size > 1) return { kind: "rujuk", reasons: ["dzawil_arham_campuran"] };
    const role = ps[0].wasithRole;
    // the wasith's sex is the role's sex (a uterine wasith is pooled, so either sex works)
    (roles[role] ??= []).push({ personId: `wasith:${key}`, sex: HEIR_SEX[role] });
    virtualHeirs[role] = (virtualHeirs[role] ?? 0) + 1;
  }
  const virtualSw: Switches = { ...sw, residue: "radd_non_spouse", dzawilArham: "none", substitution: "none", wasiatWajibahAdopsi: "off", wasiatWajibahNonMuslim: "off" };
  const core = solveCore({ deceasedSex, sw: virtualSw, roles, slots: [] });
  if (core.rujuk.length > 0) return { kind: "rujuk", reasons: core.rujuk };
  const wasithShare = new Map<string, Frac>();
  for (const a of core.allocs) wasithShare.set(a.holder.id, a.share);
  const personShares = new Map<string, Frac>();
  const blocked: TanzilOut["blocked"] = [];
  for (const [key, ps] of byKey) {
    const s = wasithShare.get(`wasith:${key}`);
    if (!s || s.n === B0) {
      const b = core.blocked.find((x) => x.personIds.includes(`wasith:${key}`));
      for (const p of ps) blocked.push({ personId: p.personId, relation: p.relation, byWasith: b?.by ?? [] });
      continue;
    }
    for (const p of ps) personShares.set(p.personId, mul(divInt(s, ps.length), rest));
  }
  return {
    kind: "ok",
    personShares,
    blocked,
    virtualHeirs,
    core,
    trace: [{ rule: "dzawil_arham.tanzil", heirs: [...new Set(dz.map((p) => p.relation))], facts: { wasith: Object.keys(virtualHeirs).join(",") } }],
  };
}

