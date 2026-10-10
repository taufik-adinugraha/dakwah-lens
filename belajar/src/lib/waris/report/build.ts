/**
 * buildReport(input, rules, dalil, opts) → ReportModel: the "Rekomendasi Pembagian Waris" report
 * (plan §6 sections 0–7; architecture.md §7; operator decision 2026-10-09: no human review, the
 * report is a recommendation).
 *
 * Pure and deterministic: no Date, no I/O, no network, no LLM. The two columns come from solve()
 * ("klasik-syafii" leads, plan D2 = A; "standar-indonesia" beside it only where a share differs);
 * every sentence is a message key (messages.ts) or a RuleNote keyed by an engine rule id; every
 * Arabic string is a slice of a dalil record (dalil.ts). Refusals carry reasons only, never
 * numbers. See analysis.ts for the report-level policies. AI-assisted, not an authoritative fatwa.
 */
import type { WarisInput } from "../types";
import { analyse, makeCtx, refusalViews, type Analysis, type Ctx } from "./analysis";
import { answerCode, dateText } from "./code";
import { indexContent, type ReportDalilRecord, type ReportRules } from "./content";
import { dalilCard } from "./dalil";
import { diagramView } from "./diagram";
import { msg } from "./messages";
import { catatanView, dalilSectionView, langkahView } from "./notes";
import { REPORT_SCHEMA, type ReportOptions } from "./options";
import { ringkasanView, unknownResults } from "./ringkasan";
import { tidakMendapatView } from "./tidak";
import type { DalilCard, KepalaView, PenutupView, RefusalView, ReportModel, RujukView } from "./types";

function kepalaView(ctx: Ctx, a: Analysis): KepalaView {
  const sim = ctx.opts.mode === "simulasi";
  const code = ctx.opts.answerCode ?? answerCode(ctx.input, sim ? "simulasi" : "wafat");
  const leadId = a.lead?.id ?? "fikih";
  const dt = ctx.opts.date ? dateText(ctx.opts.date) : null;
  return {
    title: msg(sim ? "laporan.kepala.judul_simulasi" : "laporan.kepala.judul"),
    subtitle: msg("laporan.kepala.subjudul"),
    label: msg("laporan.kepala.label"),
    chip: msg("laporan.kepala.chip"),
    simulasi: sim,
    simulasiNote: sim ? msg("laporan.kepala.simulasi") : null,
    date: dt && ctx.opts.date ? { iso: ctx.opts.date, text: dt } : null,
    answerCode: code,
    answerCodeLine: msg("laporan.kepala.kode", { kode: code }),
    leadColumnLine:
      leadId === "fikih"
        ? msg("laporan.kepala.kolom_utama", { kolom: msg("laporan.kolom.fikih") })
        : msg("laporan.kepala.kolom_utama_pengganti", { kolom: msg("laporan.kolom.court") }),
    leadColumn: leadId,
    methodLabel: a.lead?.id === "fikih" ? msg("laporan.kepala.metode_fikih") : null,
    route: msg("laporan.kepala.jalur_hukum"),
    musyawarah: msg("laporan.kepala.musyawarah"),
    musyawarahRule: ctx.rule("khi.perdamaian"),
  };
}

function penutupView(): PenutupView {
  return {
    lines: [msg("laporan.penutup.ai"), msg("laporan.penutup.dalil"), msg("laporan.penutup.privasi")],
    label: msg("laporan.kepala.label"),
  };
}

function cards(ctx: Ctx, first: readonly string[]): DalilCard[] {
  const out: DalilCard[] = [];
  const done = new Set<string>();
  for (const id of [...first, ...ctx.cardOrder]) {
    if (done.has(id) || ctx.hidden.has(id)) continue;
    done.add(id);
    const r = ctx.ix.dalil.get(id);
    if (!r) throw new Error(`waris/report: dalil record "${id}" is in neither dalil.json nor dalil-gaps.json`);
    const card = dalilCard(r);
    if (card) out.push(card);
  }
  return out;
}

function refusalModel(ctx: Ctx, a: Analysis, reasons: RefusalView[], printAllowed: boolean): ReportModel {
  const rujuk: RujukView = {
    title: msg("laporan.rujuk.judul"),
    lead: msg("laporan.rujuk.kalimat"),
    reasons,
    whereToAsk: msg("laporan.rujuk.ke_mana"),
    noPrintLine: printAllowed ? null : msg("laporan.rujuk.tanpa_cetak"),
  };
  return {
    schema: REPORT_SCHEMA,
    kind: "rujuk",
    printAllowed,
    shareAllowed: printAllowed,
    kepala: kepalaView(ctx, a),
    ringkasan: null,
    diagram: null,
    tidakMendapat: null,
    dalil: null,
    catatan: null,
    langkah: null,
    penutup: penutupView(),
    rujuk,
    dalilCards: cards(ctx, []),
    hiddenDalil: [...ctx.hidden].map(([id, reason]) => ({ id, reason })),
  };
}

export function buildReport(input: WarisInput, rules: ReportRules, dalil: readonly ReportDalilRecord[], opts: ReportOptions = {}): ReportModel {
  const ctx = makeCtx(input, indexContent(rules, dalil), opts);
  const a = analyse(input, opts.results);
  // E-BUNUH class (plan D4, §9.4): reasons only; no print, no summary, no link
  if (a.killer) return refusalModel(ctx, a, refusalViews(ctx, ["dugaan_pembunuhan"]), false);
  if (!a.lead) {
    const reasons = [...new Set([...(a.fik.refusal ?? []), ...(a.crt.refusal ?? [])])];
    return refusalModel(ctx, a, refusalViews(ctx, reasons), true);
  }
  const unknown = unknownResults(ctx);
  // plan D15: more than one «Tidak tahu» that changes the division → konsultasikan, not a grid
  if (unknown.changing.length > 1) {
    return refusalModel(ctx, a, [{ reason: "tidak_tahu_ganda", rule: null, text: msg("laporan.rujuk.tidak_tahu_ganda") }], true);
  }
  const ringkasan = ringkasanView(ctx, a, unknown);
  const diagram = diagramView(ctx, a);
  const tidakMendapat = tidakMendapatView(ctx, a);
  const { view: dalilSection, order } = dalilSectionView(ctx, a, ringkasan.rows, tidakMendapat);
  const catatan = catatanView(ctx, a, unknown);
  const langkah = langkahView(ctx, catatan.perlu.length);
  return {
    schema: REPORT_SCHEMA,
    kind: "laporan",
    printAllowed: true,
    shareAllowed: true,
    kepala: kepalaView(ctx, a),
    ringkasan,
    diagram,
    tidakMendapat,
    dalil: dalilSection,
    catatan,
    langkah,
    penutup: penutupView(),
    rujuk: null,
    dalilCards: cards(ctx, order),
    hiddenDalil: [...ctx.hidden].map(([id, reason]) => ({ id, reason })),
  };
}
