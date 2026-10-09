/**
 * Checks for the report page's own logic (plan §10 M2.5, M2.6, M2.8, M2.12), pure TypeScript so
 * that content.test.ts (vitest, CI) and a local tsx run share them. They do not render React; the
 * view-model itself is checked by lib/waris/checks/report.ts.
 *
 *  P1 the projection sent to the browser changes nothing: every report built from it equals the
 *     report built from the full content files (byte-identical JSON), and it carries none of the
 *     pipeline text that must never reach a page (review promises, status lines, gist_id);
 *  P2 questionnaire-driven families: computeReport() on the answers equals computeReport() on the
 *     answers decoded from the share link; the link and the text summary carry rupiah only when
 *     "Sertakan nilai rupiah" is ticked; a refused report has no numbers in its ringkasan;
 *  P3 the messages files: Report.laporan equals REPORT_MESSAGES in both locales, Report.ui and
 *     Track have the same keys in both locales, and no string has a review promise, a bare QS/HR
 *     citation, Arabic script or ALL-CAPS emphasis.
 */
import { drive } from "@/lib/waris/checks/questionnaire";
import { randomTrueFamily } from "@/lib/waris/checks/questionnaire-gen";
import { Rng } from "@/lib/waris/checks/prng";
import { FORBIDDEN_REVIEW } from "@/lib/waris/checks/report";
import { decode, shareToken, type Amounts, type Answers } from "@/lib/waris/questionnaire";
import { buildReport, buildTextSummary, REPORT_MESSAGES, type ReportDalilRecord, type ReportModel, type ReportOptions, type ReportRules } from "@/lib/waris/report";
import type { WarisInput } from "@/lib/waris/types";

import { computeReport, type Computed } from "./compute";
import { projectReportContent } from "./content";

const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const BARE_CITATION = /(^|[^A-Za-z])(QS|HR)([^A-Za-z]|$)/;
const CAPS_OK = new Set(["SEMA", "MUNAS", "BAZNAS"]);
/** Pipeline text that must never reach a page (content.ts). */
const NEVER_ON_PAGE = [...FORBIDDEN_REVIEW, "gist_id", "disclaimer_id", "reviewer_notes", "needs ustadz"];

const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));

export interface Family {
  where: string;
  input: WarisInput;
  opts?: ReportOptions;
}

/** P1. */
export function projectionProblems(rules: ReportRules, dalil: readonly ReportDalilRecord[], families: readonly Family[]): string[] {
  const out: string[] = [];
  const p = projectReportContent(rules, dalil);
  const text = json(p);
  for (const bad of NEVER_ON_PAGE) if (text.toLowerCase().includes(bad.toLowerCase())) out.push(`P1 projection carries "${bad}"`);
  for (const f of families) {
    let full: string;
    let proj: string;
    try {
      full = json(buildReport(f.input, rules, dalil, f.opts));
    } catch (e) {
      full = `throws: ${String(e)}`;
    }
    try {
      proj = json(buildReport(f.input, p.rules, p.dalil, f.opts));
    } catch (e) {
      proj = `throws: ${String(e)}`;
    }
    if (full !== proj) out.push(`P1 ${f.where}: the report from the projection differs from the report from the full content`);
  }
  return out;
}

function hasNumberInRingkasan(m: ReportModel): boolean {
  return m.ringkasan !== null || m.diagram !== null;
}

/** P2: `count` questionnaire-driven families (the questionnaire checks' oracle generator). */
export function flowProblems(rules: ReportRules, dalil: readonly ReportDalilRecord[], count: number, seed: number): { problems: string[]; models: number; refusals: number; exits: number } {
  const out: string[] = [];
  const p = projectReportContent(rules, dalil);
  const rng = new Rng(seed);
  let models = 0;
  let refusals = 0;
  let exits = 0;
  for (let i = 0; i < count; i++) {
    const t = randomTrueFamily(rng, i);
    const d = drive(t);
    if (d.bunuh || d.error) continue;
    const answers: Answers = d.state.answers;
    const amounts: Amounts | undefined = t.amounts;
    const where = `family#${i}`;
    const a: Computed = computeReport(answers, amounts, p.rules, p.dalil, "2026-10-09");
    const b: Computed = computeReport(answers, amounts, rules, dalil, "2026-10-09");
    if (json(a) !== json(b)) out.push(`P2 ${where}: projected and full content give different pages`);
    if (a.kind === "error") {
      out.push(`P2 ${where}: computeReport failed: ${a.message}`);
      continue;
    }
    if (a.kind === "exit") exits += 1;
    // the share link round trip, without and with rupiah
    for (const sertakanRupiah of [false, true]) {
      const token = shareToken({ v: 1, answers, at: null }, amounts, { sertakanRupiah });
      const back = decode(token);
      if (!back) {
        out.push(`P2 ${where}: the share token does not decode`);
        continue;
      }
      if (!sertakanRupiah && back.amounts) out.push(`P2 ${where}: the link carries rupiah without the tick`);
      const c = computeReport(back.answers, back.amounts, p.rules, p.dalil, "2026-10-09");
      const expect = sertakanRupiah ? a : computeReport(answers, undefined, p.rules, p.dalil, "2026-10-09");
      if (json(c) !== json(expect)) out.push(`P2 ${where}: the page from the link differs (rupiah ${sertakanRupiah ? "on" : "off"})`);
    }
    if (a.kind !== "model") continue;
    models += 1;
    const m = a.model;
    if (m.kind === "rujuk") {
      refusals += 1;
      if (hasNumberInRingkasan(m)) out.push(`P2 ${where}: a refused report has a ringkasan or diagram`);
    }
    // text summary: rupiah only when ticked
    const plain = buildTextSummary(m, { includeRupiah: false });
    if (plain !== null && /\bRp\s?[0-9]/.test(plain)) out.push(`P2 ${where}: the text summary carries rupiah without the tick`);
    const all = `${json(m)}\n${plain ?? ""}`.toLowerCase();
    for (const bad of FORBIDDEN_REVIEW) if (all.includes(bad)) out.push(`P2 ${where}: "${bad}" on the page`);
    // every computed row has a share in its lead column (data-share is never empty for an heir with a share)
    const g = m.ringkasan;
    if (g) {
      const lead = g.columns.fikih.lead ? "fikih" : "court";
      for (const row of g.rows) {
        const cell = row[lead];
        if (!cell) out.push(`P2 ${where}: row ${row.key} has no ${lead} cell`);
      }
    }
  }
  return { problems: out, models, refusals, exits };
}

function walkStrings(o: unknown, path: string, fn: (path: string, s: string) => void) {
  if (typeof o === "string") fn(path, o);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walkStrings(v, path ? `${path}.${k}` : k, fn);
}

function keysOf(o: unknown, path = "", out: string[] = []): string[] {
  if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) keysOf(v, path ? `${path}.${k}` : k, out);
  else out.push(path);
  return out;
}

/** P3. `id` / `en` are the parsed messages/waris/{id,en}.json. */
export function messageProblems(id: unknown, en: unknown): string[] {
  const out: string[] = [];
  const files = { id, en } as Record<string, unknown>;
  for (const [loc, file] of Object.entries(files)) {
    const f = (file ?? {}) as Record<string, unknown>;
    const report = (f.Report ?? {}) as Record<string, unknown>;
    if (!f.Report) out.push(`P3 ${loc}: no Report namespace`);
    if (!f.Track) out.push(`P3 ${loc}: no Track namespace`);
    // Report.laporan is the report's message table, verbatim (Indonesian in both files, plan D11)
    for (const [k, v] of Object.entries(REPORT_MESSAGES)) {
      let cur: unknown = report;
      for (const part of k.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
      if (cur !== v) out.push(`P3 ${loc}: Report.${k} is not the REPORT_MESSAGES text`);
    }
    walkStrings({ Report: report, Track: f.Track }, "", (path, s) => {
      const low = s.toLowerCase();
      for (const bad of FORBIDDEN_REVIEW) if (low.includes(bad)) out.push(`P3 ${loc} ${path}: review promise "${bad}"`);
      if (BARE_CITATION.test(s)) out.push(`P3 ${loc} ${path}: bare QS/HR citation`);
      if (ARABIC.test(s)) out.push(`P3 ${loc} ${path}: Arabic script`);
      const caps = (s.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !CAPS_OK.has(w));
      if (caps.length) out.push(`P3 ${loc} ${path}: ALL-CAPS ${caps.join(", ")}`);
    });
  }
  const pick = (f: unknown, ns: string) => keysOf(((f ?? {}) as Record<string, unknown>)[ns]).sort();
  for (const ns of ["Report", "Track"]) {
    const a = pick(id, ns);
    const b = pick(en, ns);
    const missing = a.filter((k) => !b.includes(k)).concat(b.filter((k) => !a.includes(k)));
    if (missing.length) out.push(`P3 ${ns}: keys differ between id and en: ${missing.slice(0, 5).join(", ")}`);
  }
  return out;
}
