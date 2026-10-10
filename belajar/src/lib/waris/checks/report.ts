/**
 * Report view-model checks (plan §6, §10 M2.7–M2.8, M2.12). Snapshot-free and structural: they
 * hold for every test vector (all 99, every distinct input their expectations name), for seeded
 * random families, and for synthetic «Tidak tahu», not-asked and flag inputs. Plain TypeScript,
 * no vitest and no node imports (the waris lint block): scripts/waris-r-check.ts and the vitest
 * wrapper pass the content files in.
 *
 *  R1 every present relative appears in exactly one section (a Ringkasan row or a
 *     "Yang tidak mendapat bagian" entry); a refusal has neither
 *  R2 every fraction's words parse back to it; figure and percent match the fraction
 *  R3 every number sits under a "fikih" / "court" key; a refused column has none; a whole
 *     refusal has none at all; a message value carrying a fraction or rupiah does too
 *  R4 every Arabic string is a verified dalil slice (ArabicView segments rebuild it byte for byte;
 *     a MeaningView equals its record path); no Arabic anywhere else, the text summary included
 *  R5 no forbidden review phrase anywhere (model strings, rendered messages, text summaries, and
 *     every RuleNote's displayed fields, reached or not); softer review wording ("ditinjau", …)
 *     is reported as a warning with its source
 *  R6 the differing-heirs table equals a brute-force re-solve of both columns, each row's
 *     switches equal the brute-force flip of every court switch, and every cell equals the engine
 *  R7 refusals: reasons only; the E-BUNUH class has no print, no text summary, no link
 *  R8 every referenced dalil id has exactly one card; plan D10 hidden records never appear; a
 *     Bulugh matn shows no editor footnote marker
 *  R9 every message key exists and every default string keeps the copy rules (no Arabic, no bare
 *     QS/HR, no ALL-CAPS emphasis, no review promise, {name} placeholders only, no key that is
 *     also a branch); no rendered list placeholder is empty ("… karena ada .")
 *  R10 the model is plain JSON and deterministic; the text summary carries rupiah only when ticked
 *  R11 «Tidak tahu»: a changing answer gives side-by-side outcomes, two give a refusal; the text
 *     summary then prints every reading (never the base reading alone); an 'iddah or "belum
 *     dibicarakan" answer is never called «Tidak tahu»
 */
import { eq, frac, parse, toStr, type Frac } from "../frac";
import { percent } from "../format";
import { DZAWIL_IDS, HEIRS, PROFILES, resolveRuleset, type SwitchName } from "../registry";
import { solve } from "../solve";
import type { FamilyInput, Person, Result, SiblingPerson, WarisInput } from "../types";
import { buildReport } from "../report/build";
import { NEVER_SHOWN, indexContent, ruleRef, type ReportDalilRecord, type ReportRules } from "../report/content";
import { dalilCard, rebuildArabic, recordString } from "../report/dalil";
import { REPORT_MESSAGES, isMsg, renderMsg, type Msg } from "../report/messages";
import type { ReportOptions, UnknownInput } from "../report/options";
import { buildTextSummary } from "../report/summary";
import type { ReportModel } from "../report/types";
import { parseFractionWords } from "../report/words";
import { randomFamily } from "./invariants";
import { Rng } from "./prng";
import { effectiveInput, mapVectorInput, type VectorFile } from "./vectors";

/**
 * Review promises (plan §2 "Decisions taken": there is no human review). Read by
 * scripts/ci/waris-smoke.mjs and the e2e plan too, so every waris page's visible text is held to it.
 */
export const FORBIDDEN_REVIEW = ["tinjauan ustadz", "ditinjau ustadz", "awaiting ustadz", "reviewed by an ustadz", "peninjau", "reviewer"] as const;
/** Softer wording that may promise a reviewer (warned, with its source, for the content owner). */
const SOFT_REVIEW = /ditinjau|tinjauan|awaiting review|akan diperiksa/i;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const BARE_CITATION = /(^|[^A-Za-z])(QS|HR)([^A-Za-z]|$)/;
const CAPS_OK = new Set(["SEMA", "MUNAS", "BAZNAS"]);
const INTEXT_MARKER = /\s[0-9]+\u200f/;

export interface ReportCheckFailure {
  where: string;
  check: string;
  message: string;
}

export interface ReportCheckSummary {
  reports: number;
  byKind: { laporan: number; rujuk: number; bunuh: number; columnRefused: number; differs: number };
  failures: ReportCheckFailure[];
  warnings: string[];
  /** Plan D10 records that RuleNotes cite and the report hides (id → reason). */
  hidden: Record<string, string>;
  /** Longest text summary (characters), for the M2.9 print-length record. */
  longestSummary: { where: string; chars: number };
  unknownCases: { changing: number; unchanged: number; doubleRefused: number };
}

export interface ReportCheckInput {
  vectors: unknown;
  rules: ReportRules;
  /** dalil.json and dalil-gaps.json, concatenated. */
  dalil: readonly ReportDalilRecord[];
  /** Seeded random families (default 300). */
  randomCount?: number;
  seed?: number;
}

// ---------------------------------------------------------------------------------------------
// Walking the model
// ---------------------------------------------------------------------------------------------

interface Visit {
  path: string[];
  value: unknown;
}

function walk(x: unknown, path: string[], visit: (v: Visit) => void) {
  visit({ path, value: x });
  if (Array.isArray(x)) x.forEach((y, i) => walk(y, [...path, String(i)], visit));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, [...path, k], visit);
}

const COLUMN_KEYS = new Set(["fikih", "court"]);
const colOf = (path: readonly string[]): string | null => {
  for (let i = path.length - 1; i >= 0; i--) if (COLUMN_KEYS.has(path[i])) return path[i];
  return null;
};
const isNumeric = (v: unknown): boolean =>
  !!v && typeof v === "object" && ["frac", "rp", "tabel"].includes((v as { t?: unknown }).t as string);

function presentPersons(fam: FamilyInput): string[] {
  const out: string[] = [];
  const w = (p: Person) => {
    if (p.alive) out.push(p.id);
    for (const c of p.children ?? []) w(c);
  };
  for (const p of [
    ...fam.spouses,
    ...fam.children,
    ...[fam.father, fam.mother, fam.paternalGrandfather, fam.paternalGrandmother, fam.maternalGrandmother, fam.maternalGrandfather].filter((x): x is Person => !!x),
    ...fam.siblings,
    ...fam.paternalUncles,
    ...(fam.otherRelatives ?? []).map((o) => o.person),
    ...(fam.adoptedChildren ?? []),
    ...(fam.adoptiveParents ?? []),
    ...(fam.stepChildren ?? []),
  ])
    w(p);
  return out;
}

function lines(r: Result): Map<string, Frac> {
  const m = new Map<string, Frac>();
  if (r.kind === "hasil") for (const g of r.shares) for (const p of g.persons) m.set(p.personId, p.line);
  return m;
}
const lineAt = (m: Map<string, Frac>, id: string): Frac => m.get(id) ?? frac(0);

// ---------------------------------------------------------------------------------------------
// One report
// ---------------------------------------------------------------------------------------------

export interface OneReportContext {
  where: string;
  input: WarisInput;
  opts?: ReportOptions;
  rules: ReportRules;
  dalil: readonly ReportDalilRecord[];
  records: Map<string, ReportDalilRecord>;
  /** Planted-fault tests check a mutated model, which a rebuild would not reproduce. */
  skipRebuild?: boolean;
}

/** Build and check one report; returns the model (for the caller's own assertions) and adds to `out`. */
export function checkOneReport(c: OneReportContext, out: ReportCheckSummary): ReportModel | null {
  let m: ReportModel;
  try {
    m = buildReport(c.input, c.rules, c.dalil, c.opts ?? {});
  } catch (e) {
    out.failures.push({ where: c.where, check: "build", message: `buildReport threw: ${(e as Error).message}` });
    return null;
  }
  checkModel(c, m, out);
  return m;
}

/** Check a built model (exported so the planted-fault tests can hand it a broken one). */
export function checkModel(c: OneReportContext, m: ReportModel, out: ReportCheckSummary): void {
  const fail = (check: string, message: string) => out.failures.push({ where: c.where, check, message });
  out.reports += 1;
  const killer = m.kind === "rujuk" && !m.printAllowed;
  if (m.kind === "laporan") out.byKind.laporan += 1;
  else if (killer) out.byKind.bunuh += 1;
  else out.byKind.rujuk += 1;
  for (const h of m.hiddenDalil) out.hidden[h.id] = h.reason;

  // R10 plain JSON + deterministic
  let json = "";
  try {
    json = JSON.stringify(m);
    if (!c.skipRebuild) {
      const again = JSON.stringify(buildReport(c.input, c.rules, c.dalil, c.opts ?? {}));
      if (again !== json) fail("R10 deterministic", "two builds of the same input differ");
    }
    if (JSON.stringify(JSON.parse(json)) !== json) fail("R10 json", "the model does not survive a JSON round trip");
  } catch (e) {
    fail("R10 json", `the model is not JSON-serialisable: ${(e as Error).message}`);
  }

  const refusedCols = new Set<string>();
  if (m.ringkasan) {
    for (const col of ["fikih", "court"] as const) if (m.ringkasan.columns[col].status === "rujuk") refusedCols.add(col);
    if (refusedCols.size > 0) out.byKind.columnRefused += 1;
    if (m.ringkasan.rows.some((r) => r.differs)) out.byKind.differs += 1;
  }

  // Walk: R2, R3, R4, R5 (model strings), R8 references
  const verifiedArabic = new Set<string>();
  const referencedDalil = new Set<string>();
  const strings: { path: string; s: string }[] = [];
  walk(m, [], ({ path, value }) => {
    const p = path.join(".");
    if (isNumeric(value)) {
      const col = colOf(path);
      if (!col) fail("R3 column key", `a number outside a fikih/court key at ${p}`);
      if (m.kind === "rujuk") fail("R3 refusal", `a refused report shows a number at ${p}`);
      // a «Tidak tahu» outcome is another reading of the family: its columns refuse or compute on their own
      if (col && refusedCols.has(col) && !path.includes("outcomes")) fail("R3 refused column", `the refused ${col} column shows a number at ${p}`);
    }
    if (value && typeof value === "object" && (value as { t?: unknown }).t === "frac") {
      const f = value as { n: string; d: string; figure: string; words: string; percent: string };
      const want = frac(BigInt(f.n), BigInt(f.d));
      if (want.n.toString() !== f.n || want.d.toString() !== f.d) fail("R2 normalised", `${p}: ${f.n}/${f.d} is not in lowest terms`);
      try {
        const back = parseFractionWords(f.words);
        if (back.n.toString() !== f.n || back.d.toString() !== f.d) fail("R2 words", `${p}: "${f.words}" parses to ${back.n}/${back.d}, not ${f.n}/${f.d}`);
      } catch (e) {
        fail("R2 words", `${p}: "${f.words}" does not parse: ${(e as Error).message}`);
      }
      if (f.figure !== toStr(want)) fail("R2 figure", `${p}: figure ${f.figure} ≠ ${toStr(want)}`);
      if (f.percent !== percent(want)) fail("R2 percent", `${p}: percent ${f.percent} ≠ ${percent(want)}`);
    }
    if (value && typeof value === "object" && Array.isArray((value as { segments?: unknown }).segments) && typeof (value as { text?: unknown }).text === "string") {
      const v = value as { text: string; segments: { recordId: string; field: string; start: number; end: number }[]; script: "quran" | "naskh" };
      const rebuilt = rebuildArabic(v, c.records);
      if (rebuilt !== v.text) fail("R4 slice", `${p}: Arabic text is not the concatenation of its dalil slices`);
      else verifiedArabic.add(`${p}.text`);
      for (const g of v.segments) referencedDalil.add(g.recordId);
    }
    if (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
      const src = (value as { source?: { recordId?: unknown; path?: unknown } }).source;
      if (src && typeof src.recordId === "string" && typeof src.path === "string") {
        const r = c.records.get(src.recordId);
        const want = r ? recordString(r, src.path) : null;
        if (want !== (value as { text: string }).text) fail("R4 meaning", `${p}: translation text is not ${src.recordId} ${src.path}`);
        else verifiedArabic.add(`${p}.text`);
      }
    }
    if (path[path.length - 2] === "outcomes" && value && typeof value === "object") {
      for (const col of ["fikih", "court"] as const) {
        const oc = (value as Record<string, { rows?: unknown; refusal?: unknown } | undefined>)[col];
        if (oc && oc.rows !== undefined && oc.refusal !== undefined) fail("R3 outcome", `${p}.${col} has both rows and a refusal`);
      }
    }
    if (isMsg(value)) {
      if (!Object.prototype.hasOwnProperty.call(REPORT_MESSAGES, value.key)) fail("R9 key", `${p}: unknown message key ${value.key}`);
      for (const [k, v] of Object.entries(value.values ?? {})) {
        if (typeof v === "string" && /[0-9]+\/[0-9]+|Rp\s/.test(v) && !colOf(path)) fail("R3 message value", `${p}.values.${k} carries a number outside a column key`);
      }
    }
    if (typeof value === "string") strings.push({ path: p, s: value });
  });
  for (const { path, s } of strings) {
    if (ARABIC.test(s) && !verifiedArabic.has(path)) fail("R4 arabic", `${path}: Arabic script outside a verified dalil slice`);
    for (const f of FORBIDDEN_REVIEW) if (s.toLowerCase().includes(f)) fail("R5 review phrase", `${path}: "${f}"`);
  }
  // softer review wording in RuleNote text (the content owner's to fix): warn once per rule field
  walk(m, [], ({ value }) => {
    if (!value || typeof value !== "object" || typeof (value as { ruleId?: unknown }).ruleId !== "string") return;
    const r = value as { ruleId: string; title: string; summary: string; ikhtilaf: { summary: string } | null; method: string | null };
    for (const [field, text] of [
      ["title_id", r.title],
      ["summary_id", r.summary],
      ["ikhtilaf.summary_id", r.ikhtilaf?.summary ?? ""],
      ["method.summary_id", r.method ?? ""],
    ] as const) {
      if (SOFT_REVIEW.test(text)) out.warnings.push(`RuleNote ${r.ruleId} ${field} promises a reviewer: "${text}"`);
    }
  });
  // rendered messages
  walk(m, [], ({ path, value }) => {
    if (!isMsg(value)) return;
    for (const [k, v] of Object.entries((value as Msg).values ?? {})) {
      if (v && typeof v === "object" && "list" in v && v.list.length === 0) fail("R9 empty list", `${path.join(".")}.values.${k} is an empty list (renders "${renderMsg(value as Msg)}")`);
    }
    const s = renderMsg(value as Msg);
    for (const f of FORBIDDEN_REVIEW) if (s.toLowerCase().includes(f)) fail("R5 review phrase", `${path.join(".")} renders "${f}"`);
    if (ARABIC.test(s)) fail("R4 arabic", `${path.join(".")} renders Arabic script`);
    if (/\{[a-z_]+\}/.test(s)) fail("R9 placeholder", `${path.join(".")} renders an unfilled placeholder: ${s}`);
  });

  // R8 dalil references and cards
  const cardIds = m.dalilCards.map((d) => d.id);
  if (new Set(cardIds).size !== cardIds.length) fail("R8 cards", "a dalil card appears twice");
  walk(m, [], ({ path, value }) => {
    const last = path[path.length - 1];
    if ((last === "dalilIds" || last === "dalilId") && value !== null) {
      for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string") referencedDalil.add(id);
    }
    if (path[path.length - 2] === "dalil" && value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && "first" in (value as object)) {
      referencedDalil.add((value as { id: string }).id);
    }
  });
  for (const id of referencedDalil) if (!cardIds.includes(id)) fail("R8 cards", `dalil ${id} is referenced but has no card`);
  for (const id of cardIds) if (NEVER_SHOWN[id]) fail("R8 hidden", `plan D10 hidden record ${id} is shown`);
  for (const d of m.dalilCards) if (d.arabic && d.citation.text.startsWith("Bulugh") && INTEXT_MARKER.test(d.arabic.text)) fail("R8 bulugh marker", `${d.id} still shows the editor's footnote marker`);

  // R2 every estate bar divides exactly the whole (harta waris, or the estate after debts)
  for (const col of ["fikih", "court"] as const) {
    const bar = m.diagram?.bars[col];
    if (!bar) continue;
    let total = frac(0);
    for (const sg of bar.segments) total = addF(total, frac(BigInt(sg.frac.n), BigInt(sg.frac.d)));
    if (!eq(total, frac(1))) fail("R2 bar", `the ${col} bar sums to ${toStr(total)}, not 1`);
  }

  // R1 exactly one section
  const present = presentPersons(c.input.family);
  if (m.kind === "laporan") {
    const seen = new Map<string, number>();
    for (const r of m.ringkasan?.rows ?? []) for (const id of r.personIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const g of m.tidakMendapat?.groups ?? []) for (const e of g.entries) for (const id of e.personIds) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of present) {
      const k = seen.get(id) ?? 0;
      if (k !== 1) fail("R1 exactly-one", `${id} appears in ${k} sections`);
      seen.delete(id);
    }
    for (const id of seen.keys()) fail("R1 exactly-one", `${id} is listed but is not a present relative`);
  } else if (m.ringkasan || m.tidakMendapat || m.diagram) fail("R7 refusal", "a refusal carries a Ringkasan, diagram or list");

  // R7 refusal shape
  if (m.kind === "rujuk") {
    if (!m.rujuk || m.rujuk.reasons.length === 0) fail("R7 refusal", "a refusal without reasons");
    if (killer && buildTextSummary(m) !== null) fail("R7 bunuh", "the E-BUNUH class produced a text summary");
    if (killer && m.shareAllowed) fail("R7 bunuh", "the E-BUNUH class allows sharing");
  }
  if (m.ringkasan) {
    for (const col of ["fikih", "court"] as const) {
      const h = m.ringkasan.columns[col];
      if (h.status === "rujuk" && (!h.refusal || h.refusal.length === 0)) fail("R7 column refusal", `${col} refuses without reasons`);
    }
  }

  // R6 brute force (only when both columns computed after the report policies)
  if (m.kind === "laporan" && m.ringkasan && refusedCols.size === 0) bruteForce(c, m, fail);

  // R10 text summary: rupiah only when ticked; disclaimer and privacy lines; no Arabic
  if (m.shareAllowed) {
    const plain = buildTextSummary(m) ?? "";
    const withRp = buildTextSummary(m, { includeRupiah: true }) ?? "";
    if (/Rp\s/.test(plain)) fail("R10 rupiah opt-in", "the text summary shows rupiah without the tick");
    for (const t of [plain, withRp]) {
      if (ARABIC.test(t)) fail("R4 arabic", "the text summary carries Arabic script");
      for (const f of FORBIDDEN_REVIEW) if (t.toLowerCase().includes(f)) fail("R5 review phrase", `the text summary says "${f}"`);
      if (!t.includes("bukan fatwa")) fail("R10 disclaimer", "the text summary lacks the disclaimer");
      if (!t.includes("tidak disimpan di server kami")) fail("R10 privacy", "the text summary lacks the privacy line");
      if (m.kind === "rujuk" && (/[0-9]+\/[0-9]+/.test(t) || /Rp\s/.test(t))) fail("R7 refusal", "a refusal's text summary shows a number");
    }
    if (withRp.length > out.longestSummary.chars) out.longestSummary = { where: c.where, chars: withRp.length };
    // R11 plan D15: with readings side by side, the summary prints every reading's own shares
    const b = m.ringkasan?.bergantung;
    if (b) {
      for (const o of b.outcomes) if (!plain.includes(`${renderMsg(o.option)}:`)) fail("R11 summary", `the text summary lacks the reading "${renderMsg(o.option)}"`);
      const leadHead = `${renderMsg(m.ringkasan?.columns[m.kepala.leadColumn].label as Msg)}:`;
      if (plain.split("\n").filter((l) => l === leadHead).length !== b.outcomes.filter((o) => o[m.kepala.leadColumn] && !("refusal" in (o[m.kepala.leadColumn] as object))).length) {
        fail("R11 summary", "the text summary prints a share list that belongs to no reading");
      }
    }
  }
  // R11 only a «Tidak tahu» answer is called «Tidak tahu»
  for (const u of c.opts?.unknowns ?? []) {
    if ((u.answer ?? "tidak_tahu") === "tidak_tahu") continue;
    const texts = [m.ringkasan?.bergantung?.line, ...(m.catatan?.perlu ?? []).filter((p) => p.kind === "tidak_tahu").map((p) => p.text)];
    for (const t of texts) if (t && renderMsg(t).includes("Tidak tahu")) fail("R11 wording", `an ${u.answer} answer is called «Tidak tahu»: "${renderMsg(t)}"`);
  }
}

/**
 * R5 every RuleNote's displayed fields (title, summary, ikhtilaf, method), whether or not a family
 * reaches it: no review promise. Softer wording is a warning for the content owner.
 */
export function ruleNoteReviewProblems(rules: ReportRules): { failures: string[]; warnings: string[] } {
  const failures: string[] = [];
  const warnings: string[] = [];
  const notes = (rules as unknown as { rules?: unknown[] }).rules ?? [];
  for (const n of notes) {
    const r = n as { rule_id?: string; title_id?: string; summary_id?: string; ikhtilaf?: { summary_id?: string } | null; method?: { summary_id?: string } | null };
    for (const [field, text] of [
      ["title_id", r.title_id],
      ["summary_id", r.summary_id],
      ["ikhtilaf.summary_id", r.ikhtilaf?.summary_id],
      ["method.summary_id", r.method?.summary_id],
    ] as const) {
      if (typeof text !== "string") continue;
      const low = text.toLowerCase();
      for (const f of FORBIDDEN_REVIEW) if (low.includes(f)) failures.push(`RuleNote ${r.rule_id} ${field} promises a review ("${f}"): "${text}"`);
      if (SOFT_REVIEW.test(text)) warnings.push(`RuleNote ${r.rule_id} ${field} may promise a reviewer: "${text}"`);
    }
  }
  return { failures, warnings };
}

function bruteForce(c: OneReportContext, m: ReportModel, fail: (check: string, message: string) => void) {
  const g = m.ringkasan;
  if (!g) return;
  const fr = solve(c.input, "klasik-syafii");
  const cr = solve(c.input, "standar-indonesia");
  if (fr.kind !== "hasil" || cr.kind !== "hasil") return;
  const fl = lines(fr);
  const cl = lines(cr);
  const ids = new Set([...fl.keys(), ...cl.keys()]);
  const D = new Set([...ids].filter((id) => !eq(lineAt(fl, id), lineAt(cl, id))));
  const differingRows = new Set(g.rows.filter((r) => r.differs).flatMap((r) => r.personIds));
  for (const id of D) if (!differingRows.has(id)) fail("R6 differing heirs", `${id} differs by brute force but its row is not marked`);
  for (const id of differingRows) if (!D.has(id)) {
    // a differing row may hold same-share persons only if another person of the row differs
    const row = g.rows.find((r) => r.personIds.includes(id));
    if (!row || !row.personIds.some((x) => D.has(x))) fail("R6 differing heirs", `${id}'s row is marked as differing but nobody in it differs`);
  }
  for (const r of g.rows) {
    if (!r.differs && r.court) fail("R6 court cell", `${r.key} shows a court cell but does not differ`);
    if (r.differs && !r.court) fail("R6 court cell", `${r.key} differs but has no court cell`);
    // cells equal the engine (fara'id view)
    for (const [col, res] of [
      ["fikih", fr],
      ["court", cr],
    ] as const) {
      const cell = r[col];
      if (!cell) continue;
      let want = frac(0);
      let any = false;
      for (const gg of res.shares)
        for (const p of gg.persons)
          if (r.personIds.includes(p.personId)) {
            want = addF(want, p.share);
            any = true;
          }
      const got = cell.total ? parse(`${cell.total.n}/${cell.total.d}`) : null;
      if (any !== !!got || (got && !eq(got, want))) fail("R6 cell", `${r.key} ${col}: model ${got ? toStr(got) : "none"}, engine ${any ? toStr(want) : "none"}`);
    }
  }
  const diffIds = new Set((m.catatan?.diff?.rows ?? []).flatMap((x) => x.personIds));
  if (D.size === 0 && m.catatan?.diff) fail("R6 diff table", "a differing-heirs table for a family whose columns agree");
  for (const id of D) if (!diffIds.has(id)) fail("R6 diff table", `${id} differs but is not in the fikih-vs-KHI table`);
  // switch attribution: flip EVERY switch whose court value differs from the fikih value
  const klasik = PROFILES["klasik-syafii"];
  const court = PROFILES["standar-indonesia"];
  const effects = new Map<SwitchName, Set<string> | "semua">();
  for (const s of Object.keys(court) as SwitchName[]) {
    if (court[s] === klasik[s]) continue;
    const alt = solve(c.input, resolveRuleset(`standar-indonesia|${s}=${String(klasik[s])}`));
    if (alt.kind !== "hasil") {
      effects.set(s, "semua");
      continue;
    }
    const al = lines(alt);
    effects.set(s, new Set([...new Set([...al.keys(), ...cl.keys()])].filter((id) => !eq(lineAt(al, id), lineAt(cl, id)))));
  }
  for (const row of m.catatan?.diff?.rows ?? []) {
    const want = [...effects]
      .filter(([, set]) => set === "semua" || row.personIds.some((id) => set.has(id)))
      .map(([s]) => s)
      .sort();
    const got = [...row.switches].sort();
    if (want.join(",") !== got.join(",")) fail("R6 switches", `row ${row.personIds.join(",")}: model [${got.join(",")}], brute force [${want.join(",")}]`);
  }
}

function addF(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

// ---------------------------------------------------------------------------------------------
// Message table (R9)
// ---------------------------------------------------------------------------------------------

export function messageTableProblems(): string[] {
  const p: string[] = [];
  const keys = Object.keys(REPORT_MESSAGES);
  for (const k of keys) {
    const v = (REPORT_MESSAGES as Record<string, string>)[k];
    if (!k.startsWith("laporan.")) p.push(`${k}: outside the "laporan" namespace`);
    if (keys.some((o) => o.startsWith(`${k}.`))) p.push(`${k}: is both a message and a branch (next-intl nesting)`);
    if (ARABIC.test(v)) p.push(`${k}: Arabic script`);
    if (BARE_CITATION.test(v)) p.push(`${k}: a bare QS/HR citation`);
    const caps = (v.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !CAPS_OK.has(w));
    if (caps.length > 0) p.push(`${k}: ALL-CAPS ${caps.join(",")}`);
    for (const f of FORBIDDEN_REVIEW) if (v.toLowerCase().includes(f)) p.push(`${k}: review phrase "${f}"`);
    if (SOFT_REVIEW.test(v)) p.push(`${k}: promises a review`);
    if (/'\{/.test(v)) p.push(`${k}: an apostrophe before a placeholder (ICU would quote it)`);
    for (const ph of v.match(/\{[^}]*\}/g) ?? []) if (!/^\{[a-z_]+\}$/.test(ph)) p.push(`${k}: placeholder ${ph} is not {name}`);
    if (/\b(kamu|kau|engkau)\b/i.test(v)) p.push(`${k}: not the "Anda" register`);
  }
  for (const h of [...HEIRS, ...DZAWIL_IDS, "anak_angkat", "orang_tua_angkat", "anak_tiri", "kerabat_jauh"]) {
    if (!keys.includes(`laporan.ahli.${h}`)) p.push(`no label laporan.ahli.${h}`);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export function emptySummary(): ReportCheckSummary {
  return {
    reports: 0,
    byKind: { laporan: 0, rujuk: 0, bunuh: 0, columnRefused: 0, differs: 0 },
    failures: [],
    warnings: [],
    hidden: {},
    longestSummary: { where: "", chars: 0 },
    unknownCases: { changing: 0, unchanged: 0, doubleRefused: 0 },
  };
}

/** A brother added to a family: the reading "ada" of a «Tidak tahu» on E1. */
function withExtraBrother(input: WarisInput, tag: string): WarisInput {
  const fam: FamilyInput = JSON.parse(JSON.stringify(input.family)) as FamilyInput;
  const b: SiblingPerson = { id: `tt_${tag}`, sex: "L", alive: true, religion: "islam", line: "kandung" };
  fam.siblings = [...fam.siblings, b];
  return input.estate ? { family: fam, estate: input.estate } : { family: fam };
}

function withMother(input: WarisInput, tag: string): WarisInput | null {
  if (input.family.mother) return null;
  const fam: FamilyInput = JSON.parse(JSON.stringify(input.family)) as FamilyInput;
  fam.mother = { id: `tt_m_${tag}`, sex: "P", alive: true, religion: "islam" };
  return input.estate ? { family: fam, estate: input.estate } : { family: fam };
}

/**
 * Every dalil record as a card (not only the ones a family reaches): slices rebuild byte for byte,
 * translations equal their record path, no Bulugh matn keeps an editor footnote marker, the
 * known-marker records (H-BULUGH-1114, -1116) really had one stripped, and dalil.json itself is
 * untouched. Plus the plan D10 hiding: mani.pembunuh cites H-BULUGH-1107, which is never shown.
 */
export function cardProblems(rules: ReportRules, dalil: readonly ReportDalilRecord[]): string[] {
  const p: string[] = [];
  const records = new Map(dalil.map((r) => [r.id, r] as const));
  const before = JSON.stringify(dalil);
  for (const r of dalil) {
    const card = dalilCard(r);
    if (!card) continue;
    for (const v of [card.arabic, card.heading]) {
      if (!v) continue;
      if (rebuildArabic(v, records) !== v.text) p.push(`${r.id}: card Arabic is not its slices`);
      if (v.segments.some((g) => g.recordId !== r.id)) p.push(`${r.id}: card slices another record`);
    }
    if (card.meaning && recordString(r, card.meaning.source.path) !== card.meaning.text) p.push(`${r.id}: card meaning is not ${card.meaning.source.path}`);
    if ((r.kind === "quran" || r.kind === "hadith" || r.kind === "fiqh" || r.kind === "tafsir") && !card.arabic) p.push(`${r.id}: no Arabic on the card`);
    if (card.citation.text.startsWith("Bulugh")) {
      if (card.citation.number !== null) p.push(`${r.id}: shows the local Bulugh number (plan D10)`);
      if (card.arabic && INTEXT_MARKER.test(card.arabic.text)) p.push(`${r.id}: editor footnote marker still shown`);
    }
    if ((r.id === "H-BULUGH-1114" || r.id === "H-BULUGH-1116") && card.arabic) {
      const raw = r.ar_matn_and_ibn_hajar_attribution;
      if (typeof raw !== "string" || !INTEXT_MARKER.test(raw)) p.push(`${r.id}: expected the known in-text marker in dalil.json (has the record changed?)`);
      if (card.arabic.segments.length < 2) p.push(`${r.id}: the marker was not cut out`);
    }
    if (r.id === "H-BUKHARI-6734" && !card.tags.some((t) => t.key === "laporan.dalil.atsar_muadh")) p.push(`${r.id}: not labelled as Mu'adh's ruling (atsar)`);
    if (r.kind === "hadith" && !(r.collection as string).startsWith("Sahih Muslim") && card.meaning) p.push(`${r.id}: shows an Indonesian rendering the corpus does not have`);
  }
  if (JSON.stringify(dalil) !== before) p.push("building cards changed the dalil records");
  const hidden = new Map<string, string>();
  const pembunuh = ruleRef(indexContent(rules, dalil), "mani.pembunuh", hidden);
  if (pembunuh.dalilIds.includes("H-BULUGH-1107") || !hidden.has("H-BULUGH-1107")) p.push("mani.pembunuh still shows H-BULUGH-1107 (plan D10)");
  return p;
}

export function runReportChecks(inp: ReportCheckInput): ReportCheckSummary {
  const out = emptySummary();
  const records = new Map(inp.dalil.map((r) => [r.id, r] as const));
  for (const pr of messageTableProblems()) out.failures.push({ where: "messages.ts", check: "R9 copy", message: pr });
  for (const pr of cardProblems(inp.rules, inp.dalil)) out.failures.push({ where: "dalil cards", check: "R8 cards", message: pr });
  const notes = ruleNoteReviewProblems(inp.rules);
  for (const pr of notes.failures) out.failures.push({ where: "rules.json", check: "R5 rule notes", message: pr });
  out.warnings.push(...notes.warnings);
  const base = { rules: inp.rules, dalil: inp.dalil, records };

  // every vector, every distinct input its expectations name
  const file = inp.vectors as VectorFile;
  for (const v of file.vectors) {
    const seenInputs = new Set<string>();
    for (const [key, exp] of Object.entries(v.expected)) {
      const vi = effectiveInput(v, exp);
      const sig = JSON.stringify(vi);
      if (seenInputs.has(sig)) continue;
      seenInputs.add(sig);
      let input: WarisInput;
      try {
        input = mapVectorInput(v.id, vi);
      } catch {
        continue; // mapping failures are the vector check's business (scripts/waris-check.ts)
      }
      const where = `${v.id}${seenInputs.size > 1 ? ` [${key}]` : ""}`;
      const m = checkOneReport({ ...base, where, input }, out);
      if (!m || m.kind !== "laporan") continue;
      // notes-only flags, not-asked groups, simulasi mode and a fixed date on the same family
      checkOneReport(
        {
          ...base,
          where: `${where} +flags`,
          input,
          opts: {
            mode: "simulasi",
            pewaris: "anda",
            date: "2026-10-09",
            flags: { iddahRaji: true, nikahSiri: true, munasakhat: true, wasiatTidakTahu: true },
            // a group skipped because nothing is left over names nobody (questionnaire walk, 'aul families)
            notAsked: [
              { group: "saudara", because: ["anak_lk"] },
              { group: "keponakan", because: [] },
            ],
          },
        },
        out,
      );
      // R11 one «Tidak tahu» (an unknown full brother)
      const plus = withExtraBrother(input, v.id);
      const u1: UnknownInput = { node: "E1", subject: "sdr_lk_kandung", variants: [{ option: "tidak_ada", input, base: true }, { option: "ada", input: plus }] };
      const m1 = checkOneReport({ ...base, where: `${where} +tidak-tahu`, input, opts: { unknowns: [u1] } }, out);
      if (m1 && m1.kind === "laporan") {
        const item = m1.catatan?.perlu.find((x) => x.kind === "tidak_tahu");
        if (!item) out.failures.push({ where: `${where} +tidak-tahu`, check: "R11", message: "no «Tidak tahu» item" });
        else if (item.changes) {
          out.unknownCases.changing += 1;
          if (!m1.ringkasan?.bergantung || (item.outcomes ?? []).length !== 2) out.failures.push({ where: `${where} +tidak-tahu`, check: "R11", message: "a changing answer without side-by-side outcomes" });
        } else {
          out.unknownCases.unchanged += 1;
          if (m1.ringkasan?.bergantung) out.failures.push({ where: `${where} +tidak-tahu`, check: "R11", message: "an answer that changes nothing marked as bergantung" });
        }
        // the same readings opened by G4 "Belum dibicarakan": worded as such, never «Tidak tahu»
        if (item?.changes) checkOneReport({ ...base, where: `${where} +belum`, input, opts: { unknowns: [{ ...u1, answer: "belum_dibicarakan" }] } }, out);
        // two changing unknowns → konsultasikan
        const mom = withMother(input, v.id);
        if (item?.changes && mom) {
          const u2: UnknownInput = { node: "D1", subject: "ibu", variants: [{ option: "tidak_ada", input, base: true }, { option: "ada", input: mom }] };
          const m2 = checkOneReport({ ...base, where: `${where} +tidak-tahu x2`, input, opts: { unknowns: [u1, u2] } }, out);
          if (m2 && m2.kind === "rujuk" && m2.rujuk?.reasons.some((r) => r.reason === "tidak_tahu_ganda")) out.unknownCases.doubleRefused += 1;
          else if (m2 && m2.kind === "laporan" && (m2.catatan?.perlu.filter((x) => x.kind === "tidak_tahu" && x.changes).length ?? 0) > 1) {
            out.failures.push({ where: `${where} +tidak-tahu x2`, check: "R11", message: "two changing answers printed a grid instead of a refusal" });
          }
        }
      }
    }
  }

  // seeded random families (the invariants generator: every relative type sampled independently)
  const count = inp.randomCount ?? 300;
  const rng = new Rng(inp.seed ?? 20261009);
  for (let i = 0; i < count; i++) checkOneReport({ ...base, where: `random#${i}`, input: randomFamily(rng, i) }, out);

  out.warnings = [...new Set(out.warnings)].sort();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Planted faults: each broken model must be caught by the named check (checks FIND defects)
// ---------------------------------------------------------------------------------------------

export interface PlantedFault {
  name: string;
  expect: string;
  caught: boolean;
  checks: string[];
}

type Mutable = Record<string, unknown>;

export function runPlantedFaults(rules: ReportRules, dalil: readonly ReportDalilRecord[], cases: readonly { id: string; input: WarisInput }[]): PlantedFault[] {
  const records = new Map(dalil.map((r) => [r.id, r] as const));
  const caseInput = (id: string): WarisInput => {
    const c = cases.find((x) => x.id === id);
    if (!c) throw new Error(`planted faults: no case ${id}`);
    return c.input;
  };
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const FRAC = { t: "frac", n: "1", d: "8", figure: "1/8", words: "seperdelapan", percent: "12,50" };
  const simple = caseInput("kasus-1");
  const differing = caseInput("kasus-8");
  const withHeirWasiat: WarisInput = {
    family: simple.family,
    estate: { ...(simple.estate ?? {}), wasiat: [{ toHeir: true, toId: "s1", fraction: frac(1, 4) }] },
  };
  const killerFam: FamilyInput = clone(simple.family);
  killerFam.children[0].bars = ["membunuh_tanpa_putusan"];
  const plant: { name: string; expect: string; input: WarisInput; mutate: (m: ReportModel) => void }[] = [
    { name: "Arabic typed into a plain string", expect: "R4 arabic", input: simple, mutate: (m) => (m.kepala.answerCode = "W1-\u0639\u0631\u0628") },
    {
      name: "an Arabic card retyped (one letter changed)",
      expect: "R4 slice",
      input: simple,
      mutate: (m) => {
        const card = m.dalilCards.find((d) => d.arabic);
        if (card?.arabic) card.arabic.text = card.arabic.text.replace(/./, "\u0628");
      },
    },
    {
      name: "a translation that is not the record's",
      expect: "R4 meaning",
      input: simple,
      mutate: (m) => {
        const card = m.dalilCards.find((d) => d.meaning);
        if (card?.meaning) card.meaning.text += " (disunting)";
      },
    },
    { name: "a share outside a column key", expect: "R3 column key", input: simple, mutate: (m) => ((m.penutup as unknown as Mutable).x = clone(FRAC)) },
    {
      name: "fraction words that say another fraction",
      expect: "R2 words",
      input: simple,
      mutate: (m) => {
        const cell = m.ringkasan?.rows[0]?.fikih;
        if (cell?.total) cell.total.words = "sepertiga";
      },
    },
    { name: "a promise of an ustadz review", expect: "R5 review phrase", input: simple, mutate: (m) => (m.kepala.answerCode = "menunggu tinjauan ustadz") },
    {
      name: "a court cell on a row that does not differ",
      expect: "R6 court cell",
      input: simple,
      mutate: (m) => {
        const r = m.ringkasan?.rows[0];
        if (r?.fikih) r.court = clone(r.fikih);
      },
    },
    {
      name: "a court share that is not the engine's",
      expect: "R6 cell",
      input: differing,
      mutate: (m) => {
        const r = m.ringkasan?.rows.find((x) => x.court?.total);
        if (r?.court?.total) r.court.total = { ...r.court.total, n: "1", d: "3", figure: "1/3", words: "sepertiga", percent: "33,33" };
      },
    },
    {
      name: "a relative missing from every section",
      expect: "R1 exactly-one",
      input: differing,
      mutate: (m) => {
        if (m.ringkasan) m.ringkasan.rows = m.ringkasan.rows.slice(1);
      },
    },
    {
      name: "a refused column that still shows a number",
      expect: "R3 refused column",
      input: differing,
      mutate: (m) => {
        if (m.ringkasan) m.ringkasan.columns.court = { ...m.ringkasan.columns.court, status: "rujuk", refusal: [{ reason: "wasiat_wajibah_besar", rule: null, text: null }] };
      },
    },
    {
      name: "a plan D10 hidden hadith shown",
      expect: "R8 hidden",
      input: simple,
      mutate: (m) => {
        const r = records.get("H-BULUGH-1107");
        const card = r ? dalilCard(r) : null;
        if (card) m.dalilCards.push(card);
      },
    },
    {
      name: "a Bulugh matn with the editor's footnote marker",
      expect: "R8 bulugh marker",
      input: withHeirWasiat,
      mutate: (m) => {
        const card = m.dalilCards.find((d) => d.id === "H-BULUGH-1114");
        const raw = records.get("H-BULUGH-1114")?.ar_matn_and_ibn_hajar_attribution;
        if (card?.arabic && typeof raw === "string") card.arabic = { text: raw, segments: [{ recordId: "H-BULUGH-1114", field: "ar_matn_and_ibn_hajar_attribution", start: 0, end: raw.length }], script: "naskh" };
      },
    },
    { name: "the E-BUNUH class allowed to share", expect: "R7 bunuh", input: { family: killerFam }, mutate: (m) => (m.shareAllowed = true) },
    { name: "a dalil referenced without a card", expect: "R8 cards", input: simple, mutate: (m) => (m.dalilCards = m.dalilCards.slice(1)) },
    { name: "an unknown message key", expect: "R9 key", input: simple, mutate: (m) => ((m.penutup.lines[0] as unknown as Mutable).key = "laporan.tidak.ada") },
    {
      name: "a not-asked line that names nobody (\"… karena ada .\")",
      expect: "R9 empty list",
      input: simple,
      mutate: (m) => {
        m.diagram?.tree.notAsked.push({ key: "laporan.tidak.ditanya", values: { kelompok: { key: "laporan.kelompok.paman", cap: true }, oleh: { list: [] } } });
      },
    },
  ];
  const out: PlantedFault[] = [];
  for (const p of plant) {
    const sum = emptySummary();
    const ctx: OneReportContext = { where: p.name, input: p.input, rules, dalil, records, skipRebuild: true };
    const m = clone(buildReport(p.input, rules, dalil));
    const clean = emptySummary();
    checkModel(ctx, clone(m), clean);
    p.mutate(m);
    checkModel(ctx, m, sum);
    const before = new Set(clean.failures.map((f) => f.check));
    const checks = [...new Set(sum.failures.map((f) => f.check))].filter((c) => !before.has(c));
    out.push({ name: p.name, expect: p.expect, caught: checks.includes(p.expect) && clean.failures.length === 0, checks });
  }
  return out;
}
