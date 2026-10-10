/**
 * KHI 185 ahli waris pengganti (engine.md §11.1): switch `substitution` ("cucu" = grandchildren
 * only, SEMA 3/2015; "luas" is documented but not implemented) and `substitutionCap` (185(2)).
 */
import { barredUnder173 } from "./eligibility";
import { B1, B2, gt, type Frac } from "./frac";
import type { Switches } from "./registry";
import type { Person, Slot } from "./types";

/**
 * A slot for the k-th predeceased child c (0-based among predeceased children, input order):
 * c not barred under KHI 173, c would have been Muslim, and at least one eligible living child.
 * Barred-but-alive children have no slot (they are alive, so they are not replaced at all).
 */
export function slotFor(
  c: Person,
  k: number,
  sw: Pick<Switches, "substitution">,
  isEligible: (p: Person) => boolean,
): { slot: Slot } | null {
  if (sw.substitution !== "cucu" || c.alive) return null;
  if (c.religion !== "islam" || barredUnder173(c)) return null;
  const members = (c.children ?? []).filter((g) => g.alive && isEligible(g)).map((g) => ({ personId: g.id, sex: g.sex }));
  if (members.length === 0) return null;
  return { slot: { key: `pengganti_${k}`, sex: c.sex, members, parentId: c.id } };
}

/**
 * Unit weight of a slot inside the children's residuary group (male 2, female 1).
 * `sederajat` (default, 109 K/AG/2016 as listed by PA Bojonegoro): a SON's slot may not take more
 * than a living child of the pewaris of the replaced child's degree; in practice this binds only
 * when the son's slot competes with living daughters and no living son, and the slot is
 * re-weighted from 2 units to 1 (engine.md §11.1). `none` / `per_kepala`: never re-weighted.
 */
export function slotWeight(
  slot: Slot,
  livingSons: number,
  livingDaughters: number,
  cap: Switches["substitutionCap"],
): { weight: bigint; capped: boolean } {
  if (slot.sex === "P") return { weight: B1, capped: false };
  if (cap === "sederajat" && livingSons === 0 && livingDaughters > 0) return { weight: B1, capped: true };
  return { weight: B2, capped: false };
}

/** Per-member weights inside a slot: the slot's share passes down 2 : 1 (Buku II 2013 p. 176 §8(d)). */
export function memberWeight(sex: "L" | "P"): bigint {
  return sex === "L" ? B2 : B1;
}

/**
 * `per_kepala` (Tarjih): each substitute PERSON may not take more than the living heir of the
 * replaced child's degree. Reference = the per-person share of a living child of the replaced
 * child's sex, else the largest per-person share among living children. No living child → no cap.
 * Returns true when the cap binds (the engine then refuses: pengganti_batas_tak_jelas).
 */
export function perKepalaBinds(
  memberShares: readonly Frac[],
  slotSex: "L" | "P",
  livingChildShares: { sex: "L" | "P"; share: Frac }[],
): boolean {
  if (livingChildShares.length === 0) return false;
  const same = livingChildShares.filter((c) => c.sex === slotSex);
  const pool = same.length > 0 ? same : livingChildShares;
  let ref = pool[0].share;
  for (const c of pool) if (gt(c.share, ref)) ref = c.share;
  return memberShares.some((m) => gt(m, ref));
}

