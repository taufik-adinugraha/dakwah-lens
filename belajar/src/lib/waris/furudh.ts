/**
 * Furudh: fixed shares with hajb nuqshan (engine.md §5.2, §6.2), written as predicates over the
 * eligible, unexcluded set. 'Umariyyatain, musytarakah, akdariyyah and the grandfather with
 * siblings are handled in special.ts; this module gives every other fixed share.
 */
import { EIGHTH, HALF, QUARTER, SIXTH, THIRD, TWO_THIRDS, type Frac } from "./frac";
import type { HeirId, RuleId, Sex, Switches } from "./registry";
import type { Holder, Member, Slot, TraceStep } from "./types";

/** The solver's view of one family after hajb. */
export interface Env {
  sex: Sex;
  sw: Switches;
  live: Partial<Record<HeirId, Member[]>>;
  slots: Slot[];
  sonSlots: Slot[];
  daughterSlots: Slot[];
  /** Siblings of any line alive and eligible, even if excluded (engine.md §5.2). */
  S: number;
  /** Far' warith: any unexcluded descendant (incl. KHI slots). */
  F: boolean;
  /** Male far' warith. */
  Fm: boolean;
  maalGhair: { kandung: boolean; seayah: boolean };
  jaddRegime: boolean;
}

export interface FardhGroup {
  holders: Holder[];
  /** Group share (split equally per holder). */
  share: Frac;
  rule: RuleId;
  spouse?: boolean;
}

export const n = (e: Env, h: HeirId): number => e.live[h]?.length ?? 0;

export function holdersOf(e: Env, h: HeirId): Holder[] {
  return (e.live[h] ?? []).map((m) => ({ id: m.personId, role: h, sex: m.sex, members: [m], isSlot: false }));
}

export function slotHolder(s: Slot): Holder {
  return { id: s.key, role: s.key, sex: s.sex, members: s.members, isSlot: true };
}

export interface FurudhOut {
  fardh: FardhGroup[];
  trace: TraceStep[];
}

/**
 * Fixed shares for everyone except (a) the mother in 'Umariyyatain, (b) the grandfather and the
 * full/consanguine siblings in the jadd regime. `skip` lists roles a special case handles itself.
 */
export function furudh(e: Env, skip: ReadonlySet<HeirId> = new Set()): FurudhOut {
  const fardh: FardhGroup[] = [];
  const trace: TraceStep[] = [];
  const push = (holders: Holder[], share: Frac, rule: RuleId, spouse = false) => {
    if (holders.length === 0) return;
    fardh.push({ holders, share, rule, ...(spouse ? { spouse: true } : {}) });
    trace.push({ rule, heirs: [...new Set(holders.map((h) => h.role))] });
  };

  // Spouses (QS 4:12; Fath al-Qarib § 117).
  if (n(e, "suami") > 0 && !skip.has("suami")) {
    push(holdersOf(e, "suami"), e.F ? QUARTER : HALF, e.F ? "fardh.suami_1_4" : "fardh.suami_1_2", true);
    if (e.F) trace.push({ rule: "nuqshan.suami", heirs: ["suami"] });
  }
  if (n(e, "istri") > 0 && !skip.has("istri")) {
    push(holdersOf(e, "istri"), e.F ? EIGHTH : QUARTER, e.F ? "fardh.istri_1_8" : "fardh.istri_1_4", true);
    if (e.F) trace.push({ rule: "nuqshan.istri", heirs: ["istri"] });
  }

  // Daughters (QS 4:11) — only when no son and no son's KHI slot (else 'asabah bil ghair).
  const sonsPresent = n(e, "anak_lk") > 0 || e.sonSlots.length > 0;
  const daughters = [...holdersOf(e, "anak_pr"), ...e.daughterSlots.map(slotHolder)];
  if (!sonsPresent && daughters.length > 0) {
    push(daughters, daughters.length === 1 ? HALF : TWO_THIRDS, daughters.length === 1 ? "fardh.anak_pr_1_2" : "fardh.anak_pr_2_3");
  }

  // Son's daughters (Fath al-Qarib § 117; takmilah: Bukhari 6742).
  if (n(e, "cucu_pr") > 0 && n(e, "cucu_lk") === 0 && !sonsPresent) {
    const g = holdersOf(e, "cucu_pr");
    if (daughters.length === 0) push(g, g.length === 1 ? HALF : TWO_THIRDS, g.length === 1 ? "fardh.cucu_pr_1_2" : "fardh.cucu_pr_2_3");
    else if (daughters.length === 1) push(g, SIXTH, "fardh.cucu_pr_1_6_takmilah");
  }

  // Father / grandfather: ⅙ with any descendant (and the residue too when only female ones).
  if (n(e, "ayah") > 0 && e.F) {
    push(holdersOf(e, "ayah"), SIXTH, "fardh.ayah_1_6");
    trace.push({ rule: "nuqshan.ayah", heirs: ["ayah"] });
  }
  if (n(e, "kakek") > 0 && e.F && !skip.has("kakek") && !e.jaddRegime) {
    push(holdersOf(e, "kakek"), SIXTH, "fardh.kakek_1_6");
  }

  // Mother (QS 4:11): ⅙ with a descendant or two or more siblings (blocked ones count), else ⅓.
  if (n(e, "ibu") > 0 && !skip.has("ibu")) {
    if (e.F || e.S >= 2) {
      push(holdersOf(e, "ibu"), SIXTH, "fardh.ibu_1_6");
      trace.push({ rule: "nuqshan.ibu", heirs: ["ibu"], facts: { S: String(e.S) } });
    } else push(holdersOf(e, "ibu"), THIRD, "fardh.ibu_1_3");
  }

  // Grandmothers: ⅙ shared by those not excluded (Bulugh 1103; Fath al-Qarib § 117).
  const nenek = [...holdersOf(e, "nenek_ibu"), ...holdersOf(e, "nenek_ayah")];
  if (nenek.length > 0) push(nenek, SIXTH, "fardh.nenek_1_6");

  // Full and consanguine sisters (QS 4:176) — not in the jadd regime (special.ts).
  if (!e.jaddRegime) {
    if (n(e, "sdr_pr_kandung") > 0 && n(e, "sdr_lk_kandung") === 0 && !e.maalGhair.kandung) {
      const g = holdersOf(e, "sdr_pr_kandung");
      push(g, g.length === 1 ? HALF : TWO_THIRDS, g.length === 1 ? "fardh.sdr_pr_1_2" : "fardh.sdr_pr_2_3");
    }
    if (n(e, "sdr_pr_seayah") > 0 && n(e, "sdr_lk_seayah") === 0 && !e.maalGhair.seayah) {
      const g = holdersOf(e, "sdr_pr_seayah");
      if (n(e, "sdr_pr_kandung") === 0) push(g, g.length === 1 ? HALF : TWO_THIRDS, g.length === 1 ? "fardh.sdr_pr_1_2" : "fardh.sdr_pr_2_3");
      else if (n(e, "sdr_pr_kandung") === 1) push(g, SIXTH, "fardh.sdr_pr_seayah_1_6_takmilah");
    }
  }

  // Uterine siblings, pooled, male = female (QS 4:12; Fath al-Qarib § 117).
  if (!skip.has("sdr_lk_seibu")) {
    const seibu = [...holdersOf(e, "sdr_lk_seibu"), ...holdersOf(e, "sdr_pr_seibu")];
    if (seibu.length > 0) {
      push(seibu, seibu.length === 1 ? SIXTH : THIRD, seibu.length === 1 ? "fardh.seibu_1_6" : "fardh.seibu_1_3");
      if (n(e, "kakek") > 0 && e.sw.uterineExcludedBy === "khi181") trace.push({ rule: "khi.seibu_pasal_181", heirs: ["sdr_lk_seibu", "sdr_pr_seibu"] });
    }
  }
  return { fardh, trace };
}
