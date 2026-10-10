/**
 * 'Asabah (engine.md §7): bin-nafs ranked by jihah → darajah → quwwah (Fiqh as-Sunnah §§ 849–850),
 * bil-ghair 2 : 1 (QS 4:11, 4:176; Fath al-Qarib § 118), ma'al-ghair sisters (Bukhari 6742).
 * Hajb has already removed every lower-ranked agnate, so the first present rank takes the residue.
 */
import { B1, B2 } from "./frac";
import { holdersOf, n, slotHolder, type Env } from "./furudh";
import type { HeirId, RuleId } from "./registry";
import { slotWeight } from "./substitution";
import type { Holder, TraceStep } from "./types";

export interface AsabahHolder {
  holder: Holder;
  weight: bigint;
  rule: RuleId;
}

export interface AsabahOut {
  group: AsabahHolder[];
  trace: TraceStep[];
}

const unit = (holders: Holder[], weight: bigint, rule: RuleId): AsabahHolder[] => holders.map((holder) => ({ holder, weight, rule }));

/** The residuary group (or null). The grandfather in the jadd regime is handled in special.ts. */
export function asabah(e: Env): AsabahOut | null {
  const trace: TraceStep[] = [];
  const done = (group: AsabahHolder[]): AsabahOut => {
    const byRule = new Map<RuleId, string[]>();
    for (const g of group) byRule.set(g.rule, [...new Set([...(byRule.get(g.rule) ?? []), g.holder.role])]);
    for (const [rule, heirs] of byRule) trace.push({ rule, heirs });
    return { group, trace };
  };

  // 1 bunuwwah: sons (and KHI slots) with daughters 2 : 1.
  if (n(e, "anak_lk") > 0 || e.sonSlots.length > 0) {
    const group: AsabahHolder[] = [
      ...unit(holdersOf(e, "anak_lk"), B2, "asabah.bin_nafs"),
      ...unit(holdersOf(e, "anak_pr"), B1, "asabah.bil_ghair"),
    ];
    for (const s of e.slots) {
      if (s.sex === "L") {
        const w = slotWeight(s, n(e, "anak_lk"), n(e, "anak_pr"), e.sw.substitutionCap);
        group.push({ holder: slotHolder(s), weight: w.weight, rule: "asabah.bin_nafs" });
        if (w.capped) trace.push({ rule: "khi.pengganti_batas", heirs: [s.key], facts: { bobot: "1", karena: "anak_pr" } });
      } else group.push({ holder: slotHolder(s), weight: B1, rule: "asabah.bil_ghair" });
    }
    return done(group);
  }
  // son's sons with son's daughters 2 : 1 (Fath al-Mu'in § 34, even after two daughters' ⅔).
  if (n(e, "cucu_lk") > 0) {
    return done([...unit(holdersOf(e, "cucu_lk"), B2, "asabah.bin_nafs"), ...unit(holdersOf(e, "cucu_pr"), B1, "asabah.bil_ghair")]);
  }
  // 2 ubuwwah: father, then grandfather (outside the jadd regime).
  for (const h of ["ayah", "kakek"] as const) {
    if (n(e, h) === 0) continue;
    if (e.Fm) return null; // ⅙ only; the residue went to the sons above (unreachable)
    if (h === "kakek" && e.jaddRegime) return null;
    if (e.F) {
      if (h === "ayah" && e.sw.fatherWithDaughters === "fardh_then_radd") return null; // KHI 177 literal
      return done(unit(holdersOf(e, h), B1, "asabah.ayah_fardh_dan_sisa"));
    }
    return done(unit(holdersOf(e, h), B1, "asabah.bin_nafs"));
  }
  if (e.jaddRegime) return null; // siblings share with the grandfather (special.ts)
  // 3 ukhuwwah: full siblings, consanguine siblings (ma'al-ghair sisters rank as brothers).
  if (n(e, "sdr_lk_kandung") > 0)
    return done([...unit(holdersOf(e, "sdr_lk_kandung"), B2, "asabah.bin_nafs"), ...unit(holdersOf(e, "sdr_pr_kandung"), B1, "asabah.bil_ghair")]);
  if (e.maalGhair.kandung) return done(unit(holdersOf(e, "sdr_pr_kandung"), B1, "asabah.maal_ghair"));
  if (n(e, "sdr_lk_seayah") > 0)
    return done([...unit(holdersOf(e, "sdr_lk_seayah"), B2, "asabah.bin_nafs"), ...unit(holdersOf(e, "sdr_pr_seayah"), B1, "asabah.bil_ghair")]);
  if (e.maalGhair.seayah) return done(unit(holdersOf(e, "sdr_pr_seayah"), B1, "asabah.maal_ghair"));
  // nephews, then 4 'umumah: uncles, cousins (inherit without their sisters, Fath al-Qarib § 118).
  const rest: HeirId[] = ["keponakan_lk_kandung", "keponakan_lk_seayah", "paman_kandung", "paman_seayah", "sepupu_lk_kandung", "sepupu_lk_seayah"];
  for (const h of rest) if (n(e, h) > 0) return done(unit(holdersOf(e, h), B1, "asabah.bin_nafs"));
  return null;
}
