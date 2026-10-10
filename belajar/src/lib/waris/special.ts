/**
 * Named special cases (engine.md §8), each with its own rule id so the report can name it:
 * 'Umariyyatain (§8.1, incl. the grandfather variant per al-Hawi 8:121 — the mother then takes ⅓
 * of the whole, which is the ordinary rule, so nothing special fires), musytarakah (§8.2),
 * akdariyyah (§8.3, requires S = 1), and the grandfather with siblings per Zaid (§8.4, incl.
 * mu'addah). Patterns are exact predicates on the eligible, unexcluded set.
 */
import {
  B1,
  B2,
  HALF,
  ONE,
  SIXTH,
  THIRD,
  TWO_THIRDS,
  divInt,
  frac,
  gt,
  le,
  min,
  mul,
  mulInt,
  sub,
  sum,
  type Frac,
} from "./frac";
import { holdersOf, n, type Env, type FardhGroup } from "./furudh";
import type { HeirId, RuleId } from "./registry";
import type { BlockedGroup, Holder, TraceStep } from "./types";

const LIVE_ROLES = (e: Env): HeirId[] => (Object.keys(e.live) as HeirId[]).filter((h) => n(e, h) > 0);

/** §8.1: the only inheriting heirs are {spouse, father, mother}, no descendant, S < 2. */
export function isUmariyyatain(e: Env): boolean {
  if (e.F || e.S >= 2 || n(e, "ayah") === 0 || n(e, "ibu") === 0) return false;
  const spouse = n(e, "suami") > 0 || n(e, "istri") > 0;
  if (!spouse) return false;
  return LIVE_ROLES(e).every((h) => h === "suami" || h === "istri" || h === "ayah" || h === "ibu");
}

/** §8.2: husband, a ⅙ mother-side heir, ≥ 2 uterine siblings, ≥ 1 full brother; no F, father, grandfather. */
export function isMusytarakahPattern(e: Env): boolean {
  if (!e.sw.musytarakah || e.F || n(e, "ayah") > 0 || n(e, "kakek") > 0) return false;
  if (n(e, "suami") === 0 || n(e, "sdr_lk_kandung") === 0) return false;
  const motherSide = n(e, "ibu") > 0 || n(e, "nenek_ibu") > 0 || n(e, "nenek_ayah") > 0;
  return motherSide && n(e, "sdr_lk_seibu") + n(e, "sdr_pr_seibu") >= 2;
}

/** §8.3: exactly husband, mother, grandfather and ONE sister, and S == 1 (review 2026-10-09). */
export function isAkdariyyah(e: Env): boolean {
  if (!e.jaddRegime || e.F || e.S !== 1) return false;
  if (n(e, "suami") !== 1 || n(e, "ibu") !== 1 || n(e, "kakek") !== 1) return false;
  if (n(e, "sdr_pr_kandung") + n(e, "sdr_pr_seayah") !== 1) return false;
  return LIVE_ROLES(e).every((h) => ["suami", "ibu", "kakek", "sdr_pr_kandung", "sdr_pr_seayah"].includes(h));
}

export interface SpecialAlloc {
  holder: Holder;
  share: Frac;
  rule: RuleId;
}

/**
 * Akdariyyah per Zaid: husband ½, mother ⅓, grandfather ⅙, sister ½ → 'aul 6 → 9; the
 * grandfather's 1 and the sister's 3 are pooled (4/9) and split 2 : 1 → 27: 9, 6, 8, 4.
 * Sources: Khairuddin pp. 89–92 (its first list misprints the mother); Achmad Yani (tashih 27).
 */
export function akdariyyah(e: Env): { allocs: SpecialAlloc[]; trace: TraceStep[] } {
  const sister = n(e, "sdr_pr_kandung") === 1 ? holdersOf(e, "sdr_pr_kandung") : holdersOf(e, "sdr_pr_seayah");
  const pool = frac(4, 9);
  return {
    allocs: [
      { holder: holdersOf(e, "suami")[0], share: frac(3, 9), rule: "fardh.suami_1_2" },
      { holder: holdersOf(e, "ibu")[0], share: frac(2, 9), rule: "fardh.ibu_1_3" },
      { holder: holdersOf(e, "kakek")[0], share: mul(pool, frac(2, 3)), rule: "akdariyyah" },
      { holder: sister[0], share: mul(pool, frac(1, 3)), rule: "akdariyyah" },
    ],
    trace: [
      // the husband's ½ and the mother's ⅓ are their ordinary furudh (the report cites their dalil)
      { rule: "fardh.suami_1_2", heirs: ["suami"] },
      { rule: "fardh.ibu_1_3", heirs: ["ibu"] },
      { rule: "akdariyyah", heirs: ["suami", "ibu", "kakek", sister[0].role] },
      { rule: "aul", heirs: ["suami", "ibu", "kakek", sister[0].role], facts: { dari: "6", menjadi: "9" } },
    ],
  };
}

export interface JaddOut {
  /** The grandfather's ⅙ as a fardh (floor case: R ≤ ⅙; may cause 'aul). */
  kakekFardh?: FardhGroup;
  /** Allocations out of the residue R (no 'aul possible here). */
  allocs: SpecialAlloc[];
  blocked: BlockedGroup[];
  trace: TraceStep[];
}

const SIB_ROLES = ["sdr_lk_kandung", "sdr_pr_kandung", "sdr_lk_seayah", "sdr_pr_seayah"] as const;

/** Split a pool 2 : 1 among siblings (brothers bin-nafs, sisters bil-ghair; MAIS datuk-bersama). */
function split21(holders: Holder[], pool: Frac): SpecialAlloc[] {
  let units = BigInt(0);
  for (const h of holders) units += h.sex === "L" ? B2 : B1;
  const mixed = holders.some((h) => h.sex === "L") && holders.some((h) => h.sex === "P");
  return holders.map((holder) => ({
    holder,
    share: mul(pool, frac(holder.sex === "L" ? B2 : B1, units)),
    rule: holder.sex === "L" ? "asabah.bin_nafs" : mixed ? "asabah.bil_ghair" : "asabah.bin_nafs",
  }));
}

/**
 * §8.4 Grandfather with full/consanguine siblings (Zaid; al-Umm § 556; Fath al-Qarib § 117; MAIS).
 * `fx` = the other fardh heirs (spouse, mother/grandmother, daughters, son's daughters, and the
 * uterine siblings under the khi181 variant). Sisters take no fardh here (except Akdariyyah).
 */
export function jadd(e: Env, fx: readonly FardhGroup[]): JaddOut {
  const trace: TraceStep[] = [];
  const blocked: BlockedGroup[] = [];
  const kakek = holdersOf(e, "kakek")[0];
  const sibs = SIB_ROLES.flatMap((r) => holdersOf(e, r));
  const R = sub(ONE, sum(fx.map((g) => g.share)));
  const zero = (roles: readonly HeirId[], by: string[], rule: RuleId) => {
    for (const r of roles) {
      const hs = holdersOf(e, r);
      if (hs.length > 0) blocked.push({ heir: r, personIds: hs.map((h) => h.id), by, rule });
    }
  };

  if (le(R, SIXTH)) {
    // Khairuddin p. 101 (3); MAIS: the ⅙ floor, as a fardh ('aul if R < ⅙); siblings get nothing.
    trace.push({ rule: "jadd.seperenam", heirs: ["kakek"], facts: { sisa: `${R.n}/${R.d}` } });
    trace.push({ rule: "fardh.kakek_1_6", heirs: ["kakek"] });
    zero(SIB_ROLES, ["kakek"], "jadd.seperenam");
    return { kakekFardh: { holders: [kakek], share: SIXTH, rule: "fardh.kakek_1_6" }, allocs: [], blocked, trace };
  }

  let units = B2;
  for (const s of sibs) units += s.sex === "L" ? B2 : B1;
  const muq = divInt(mulInt(R, 2), units);
  const third = fx.length === 0 ? THIRD : divInt(R, 3);
  const options: { v: Frac; rule: RuleId }[] = [
    { v: muq, rule: "jadd.muqasamah" },
    { v: third, rule: fx.length === 0 ? "jadd.sepertiga" : "jadd.sepertiga_sisa" },
  ];
  if (fx.length > 0) options.push({ v: SIXTH, rule: "jadd.seperenam" });
  let best = options[0];
  for (const o of options) if (gt(o.v, best.v)) best = o; // ties keep the earlier (muqasamah first)
  const allocs: SpecialAlloc[] = [{ holder: kakek, share: best.v, rule: best.rule }];
  trace.push({ rule: best.rule, heirs: ["kakek"], facts: { muqasamah: `${muq.n}/${muq.d}`, sisa: `${R.n}/${R.d}` } });
  const P = sub(R, best.v);

  const kandung = [...holdersOf(e, "sdr_lk_kandung"), ...holdersOf(e, "sdr_pr_kandung")];
  const seayah = [...holdersOf(e, "sdr_lk_seayah"), ...holdersOf(e, "sdr_pr_seayah")];
  if (seayah.length > 0 && kandung.length > 0) {
    trace.push({ rule: "jadd.muaddah", heirs: ["sdr_lk_seayah", "sdr_pr_seayah"].filter((r) => n(e, r as HeirId) > 0) });
  }
  if (n(e, "sdr_lk_kandung") > 0) {
    allocs.push(...split21(kandung, P));
    zero(["sdr_lk_seayah", "sdr_pr_seayah"], ["sdr_lk_kandung"], "jadd.muaddah");
  } else if (n(e, "sdr_pr_kandung") > 0 && seayah.length > 0) {
    const sisters = holdersOf(e, "sdr_pr_kandung");
    const fs = min(P, sisters.length === 1 ? HALF : TWO_THIRDS);
    for (const h of sisters) allocs.push({ holder: h, share: divInt(fs, sisters.length), rule: "jadd.sdr_pr_kandung_sampai_fardh" });
    trace.push({ rule: "jadd.sdr_pr_kandung_sampai_fardh", heirs: ["sdr_pr_kandung"] });
    const rest = sub(P, fs);
    if (rest.n > BigInt(0)) allocs.push(...split21(seayah, rest));
    else zero(["sdr_lk_seayah", "sdr_pr_seayah"], ["sdr_pr_kandung"], "jadd.muaddah");
  } else {
    allocs.push(...split21(sibs, P));
  }
  // the siblings' residuary shares, one step per rule (as asabah.ts does), so that the report's
  // "Dasar hukum" carries their dalil too; allocs[0] is the grandfather's own (traced above)
  const byRule = new Map<RuleId, string[]>();
  for (const a of allocs.slice(1)) {
    if (a.rule === "jadd.sdr_pr_kandung_sampai_fardh") continue;
    byRule.set(a.rule, [...new Set([...(byRule.get(a.rule) ?? []), a.holder.role])]);
  }
  for (const [rule, heirs] of byRule) trace.push({ rule, heirs });
  return { allocs, blocked, trace };
}
