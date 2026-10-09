/**
 * From the questionnaire's answers to what the report page shows (plan §5, §6; architecture.md
 * §7.1). Pure TypeScript, no React: the client component calls it inside useMemo, and the local
 * check runs it on questionnaire-driven families.
 *
 *  - evaluate() decides: still incomplete, an exit page, or a report request;
 *  - an exit that carries engine reasons (both columns refused, e.g. debts ≥ the estate entered in
 *    the rupiah panel) becomes the report's own refusal model: reasons and RuleNotes, no numbers;
 *  - any other exit (E-TIDAK-TAHU, E-KHUNTSA, …) is passed through for its exit text;
 *  - a report request goes to buildReport() with the questionnaire's not-asked groups, «Tidak tahu»
 *    readings, flags and answer code.
 *
 * Nothing here reads a clock, storage or the network; the date comes in as an argument.
 * AI-assisted, not an authoritative fatwa.
 */
import {
  EXITS,
  answerCodeOf,
  evaluate,
  isQTextKey,
  modeOf,
  pewarisKind,
  toInput,
  walk,
  type Amounts,
  type Answers,
  type ExitHit,
  type QNote,
  type QTextKey,
} from "@/lib/waris/questionnaire";
import { buildReport, dalilCard, type DalilCard, type ReportDalilRecord, type ReportModel, type ReportRules, type RuleRefView } from "@/lib/waris/report";
import { NEVER_SHOWN, indexContent, ruleRef } from "@/lib/waris/report/content";
import { isRuleId } from "@/lib/waris/registry";

export type Computed =
  | { kind: "belum"; next: string }
  | { kind: "exit"; exit: ExitHit }
  | { kind: "model"; model: ReportModel; notes: QTextKey[] }
  | { kind: "error"; message: string };

/**
 * Questionnaire notes the report model already shows another way (kepala simulasi line, the iddah
 * and nikah-siri flags, the unknown-wasiat assumption); the rest are listed in Catatan metode.
 */
const SHOWN_BY_MODEL: ReadonlySet<QNote> = new Set<QNote>(["simulasi", "iddah", "nikah_siri", "wasiat_tidak_diketahui"]);

function noteKeys(notes: readonly QNote[]): QTextKey[] {
  const out: QTextKey[] = [];
  for (const n of notes) {
    if (SHOWN_BY_MODEL.has(n)) continue;
    const k = `catatan.${n}`;
    if (isQTextKey(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function computeReport(
  answers: Answers,
  amounts: Amounts | undefined,
  rules: ReportRules,
  dalil: readonly ReportDalilRecord[],
  date?: string,
): Computed {
  try {
    const ev = evaluate(answers, amounts);
    if (ev.kind === "belum_selesai") return { kind: "belum", next: ev.next };
    if (ev.kind === "keluar") {
      if (!ev.exit.reasons) return { kind: "exit", exit: ev.exit };
      const eff = walk(answers).eff;
      const { input } = toInput(eff, amounts);
      const model = buildReport(input, rules, dalil, {
        mode: modeOf(eff) === "wafat" ? "wafat" : "simulasi",
        pewaris: pewarisKind(eff),
        answerCode: answerCodeOf(eff),
        ...(date ? { date } : {}),
      });
      return { kind: "model", model, notes: [] };
    }
    const req = ev.request;
    const model = buildReport(req.input, rules, dalil, {
      ...req.options,
      showRupiah: true,
      ...(date ? { date } : {}),
    });
    return { kind: "model", model, notes: noteKeys(ev.notes) };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Which optional fields the rupiah panel offers for these answers (plan D5; ux.md §4.3 R1–R6). */
export interface RupiahFields {
  /** A living spouse: harta bersama (and the "semua milik almarhum" toggle). */
  hartaBersama: boolean;
  /** G3 "lebih dari sepertiga" / "nilai tertentu" for a bequest to others. */
  wasiatLain: boolean;
  /** G3w "lebih dari sepertiga" / "nilai tertentu" for a bequest to an heir. */
  wasiatWaris: boolean;
}

const NEEDS_VALUE: ReadonlySet<string> = new Set(["lebih_sepertiga", "nilai_tertentu"]);

export function rupiahFields(answers: Answers): RupiahFields {
  const eff = walk(answers).eff;
  const g1 = Array.isArray(eff.G1) ? (eff.G1 as readonly string[]) : [];
  let spouses = 0;
  try {
    spouses = toInput(eff).input.family.spouses.length;
  } catch {
    spouses = 0;
  }
  return {
    hartaBersama: spouses > 0,
    wasiatLain: g1.includes("lain") && typeof eff.G3 === "string" && NEEDS_VALUE.has(eff.G3),
    wasiatWaris: g1.includes("waris") && typeof eff.G3w === "string" && NEEDS_VALUE.has(eff.G3w),
  };
}

/**
 * The rules an exit page names (questionnaire/graph.ts EXITS, plan §5.4 item 3) as RuleNotes, with
 * the dalil cards they cite (plan D10 exclusions dropped). Never throws: a content gap shows fewer.
 */
export function exitRefs(exit: ExitHit, rules: ReportRules, dalil: readonly ReportDalilRecord[]): { rules: RuleRefView[]; cards: DalilCard[] } {
  const def = EXITS[exit.id];
  if (!def) return { rules: [], cards: [] };
  const ix = indexContent(rules, dalil);
  const out: RuleRefView[] = [];
  const cards: DalilCard[] = [];
  const seen = new Set<string>();
  for (const id of def.rules) {
    if (!isRuleId(id)) continue;
    try {
      const r = ruleRef(ix, id);
      out.push(r);
      for (const d of [...r.dalilIds, ...(r.ikhtilaf?.dalilIds ?? [])]) {
        if (seen.has(d) || NEVER_SHOWN[d]) continue;
        seen.add(d);
        const rec = ix.dalil.get(d);
        const card = rec ? dalilCard(rec) : null;
        if (card) cards.push(card);
      }
    } catch {
      // a missing RuleNote is a content bug the report checks catch; show the rest
    }
  }
  return { rules: out, cards };
}
