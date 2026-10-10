/**
 * Estate (engine.md §3): harta bersama ½ to the surviving spouse(s) as owner (KHI 96(1); several
 * wives by period, KHI 94, 190, Buku II 2026 pp. 836–838) → the deceased's own property →
 * last-illness and funeral costs → debts → wasiat ≤ ⅓ unless every heir consents (KHI 195, 201;
 * Fath al-Qarib § 118). Wasiat wajibah (§11.4) is combined in solve.ts.
 */
import { B0, ZERO, div, frac, gt, min, mul, sum, toStr, type Frac } from "./frac";
import { largestRemainder } from "./distribute";
import type { NoteId, RujukReason, Switches } from "./registry";
import type { EstateInput, TraceStep } from "./types";

export interface EstatePlan {
  /** Rupiah can be computed (amounts given and every pool computable). */
  rupiahOk: boolean;
  hasAmounts: boolean;
  /** spouse output key → their own harta-bersama amount. */
  hartaBersamaSpouse: Record<string, bigint>;
  grossOwn: bigint;
  biayaSakit: bigint;
  biayaJenazah: bigint;
  utang: bigint;
  afterDebts: bigint;
  trace: TraceStep[];
  notes: NoteId[];
}

export function estateStage(
  estate: EstateInput | undefined,
  spouses: readonly { personId: string; key: string }[],
  sw: Pick<Switches, "hartaBersama">,
): EstatePlan | { rujuk: RujukReason[] } {
  const trace: TraceStep[] = [];
  const notes: NoteId[] = [];
  const hasAmounts = estate !== undefined && (estate.hartaBawaan !== undefined || (estate.hartaBersama?.length ?? 0) > 0);
  const plan: EstatePlan = {
    rupiahOk: hasAmounts,
    hasAmounts,
    hartaBersamaSpouse: {},
    grossOwn: B0,
    biayaSakit: estate?.biayaSakit ?? B0,
    biayaJenazah: estate?.biayaJenazah ?? B0,
    utang: estate?.utang ?? B0,
    afterDebts: B0,
    trace,
    notes,
  };
  if (!estate) return plan;
  if (estate.hartaBersamaRumit) {
    plan.rupiahOk = false;
    notes.push("harta_bersama_rumit");
  }
  let gross = estate.hartaBawaan ?? B0;
  const pools = estate.hartaBersama ?? [];
  for (const pool of pools) {
    if (!sw.hartaBersama) {
      gross += pool.amount; // "semua harta ini milik almarhum" (plan D6 toggle)
      continue;
    }
    const k = pool.period;
    const members = spouses.slice(0, k);
    if (members.length < k) {
      // the period names a spouse who is not a living spouse at death: a separate matter
      plan.rupiahOk = false;
      if (!notes.includes("harta_bersama_rumit")) notes.push("harta_bersama_rumit");
      gross += pool.amount;
      continue;
    }
    // each spouse of the period 1/(k+1), the deceased 1/(k+1); spouses first on a tie (§14)
    const lines = [...members.map((m, i) => ({ key: `s:${m.key}`, frac: frac(1, k + 1), rank: i })), { key: "estate", frac: frac(1, k + 1), rank: 99 }];
    const alloc = largestRemainder(pool.amount, lines);
    for (const m of members) plan.hartaBersamaSpouse[m.key] = (plan.hartaBersamaSpouse[m.key] ?? B0) + (alloc.get(`s:${m.key}`) ?? B0);
    gross += alloc.get("estate") ?? B0;
    trace.push({ rule: k > 1 ? "estate.harta_bersama_poligami" : "estate.harta_bersama", heirs: members.map((m) => m.key), facts: { periode: String(k) } });
  }
  plan.grossOwn = gross;
  const costs = plan.biayaSakit + plan.biayaJenazah;
  if (costs > B0) trace.push({ rule: "estate.biaya", heirs: [] });
  if (plan.utang > B0) trace.push({ rule: "estate.utang", heirs: [] });
  plan.afterDebts = gross - costs - plan.utang;
  if (hasAmounts && plan.afterDebts <= B0 && (costs > B0 || plan.utang > B0)) return { rujuk: ["utang_melebihi_harta"] };
  if (hasAmounts && plan.afterDebts <= B0) plan.rupiahOk = false;
  return plan;
}

export interface WasiatLine {
  key: string;
  /** Fraction of the estate after debts. */
  frac: Frac;
  toHeir: boolean;
}

/**
 * Voluntary wasiat (§3.1): to non-heirs capped at `cap` (⅓ minus any wasiat wajibah, EQ5: combined
 * cap, wasiat wajibah first) unless every heir consents; several over the cap are cut pro rata
 * (EQ7: usual practice, not found in an opened source); to an heir only with every heir's
 * consent (KHI 195(3); Bulugh 1114), otherwise ignored and reported.
 */
export function voluntaryWasiat(
  estate: EstateInput | undefined,
  afterDebts: bigint,
  cap: Frac,
  available: Frac,
): { lines: WasiatLine[]; trace: TraceStep[]; notes: NoteId[] } {
  const trace: TraceStep[] = [];
  const notes: NoteId[] = [];
  const entries = estate?.wasiat ?? [];
  if (entries.length === 0) return { lines: [], trace, notes };
  const consent = estate?.heirsConsentToExcessWasiat === true;
  const raw = entries.map((w, i) => {
    let f: Frac = ZERO;
    if (w.fraction) f = w.fraction;
    else if (w.amount !== undefined && afterDebts > B0) f = frac(w.amount, afterDebts);
    return { key: entries.length === 1 ? "wasiat" : `wasiat#${i + 1}`, frac: f, toHeir: w.toHeir };
  });
  let paid = raw.filter((w) => !w.toHeir || consent);
  if (raw.some((w) => w.toHeir) && !consent) {
    notes.push("wasiat_ahli_waris_diabaikan");
    trace.push({ rule: "estate.wasiat_ahli_waris_tanpa_persetujuan", heirs: [] });
  }
  const total = sum(paid.map((w) => w.frac));
  const limit = consent ? available : min(cap, available);
  if (gt(total, limit)) {
    const factor = div(limit, total);
    paid = paid.map((w) => ({ ...w, frac: mul(w.frac, factor) }));
    // sisa_batas = what the cap leaves for voluntary wasiat (0 when a wasiat wajibah used all of ⅓)
    if (!consent) trace.push({ rule: "estate.wasiat_dibatasi_sepertiga", heirs: [], facts: { sisa_batas: toStr(limit) } });
  }
  const lines = paid.filter((w) => w.frac.n > B0);
  // only a wasiat actually carried out is reported as one (a capped-to-zero wasiat is not)
  if (lines.length > 0) trace.push({ rule: "estate.wasiat", heirs: [] });
  return { lines, trace, notes };
}

