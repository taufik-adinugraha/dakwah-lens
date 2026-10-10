/**
 * Ilmu Waris content (docs/waris-plan.md §9.2, §10 M1.6): loads content/waris/{rules,dalil,
 * dalil-gaps}.json, validates their shape (src/content/waris-schema.ts) and cross-checks the RuleNotes
 * against the engine registry, the dalil records and the legal sources.
 *
 * Build-time and test-time only. In M1 nothing renders this yet (the calculator and report wait for
 * the fara'id reviewer, plan D13). It lives outside lib/waris/ because the engine imports nothing
 * from content/ and content never feeds the engine: the dependency points one way, content → engine.
 *
 * pipeline/validate_waris.py runs the same reference checks in Python (check 10); keep the two in
 * step. AI-assisted, not an authoritative fatwa.
 */
import dalilRaw from "../../content/waris/dalil.json";
import gapsRaw from "../../content/waris/dalil-gaps.json";
import rulesRaw from "../../content/waris/rules.json";

import { DalilFile, WarisRulesFile, type DalilRecord, type LegalCite, type WarisRules } from "@/content/waris-schema";
import { RULE_IDS } from "@/lib/waris/registry";

export interface WarisContent {
  rules: WarisRules;
  dalil: DalilRecord[];
  gaps: DalilRecord[];
}

export interface WarisRawContent {
  rules: unknown;
  dalil: unknown;
  gaps: unknown;
}

/**
 * Arithmetic that is not a ruling (plan D5, engine.md §14): such a note may cite neither dalil nor a
 * legal source, but must then carry a `method` block that says so. Mirrors validate_waris.py.
 */
export const METHOD_ONLY_RULES: readonly string[] = ["rupiah.pembulatan"];

const EVIDENCE_KINDS = new Set(["quran", "hadith", "fiqh", "tafsir"]);
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const QUOTES = /["“”«»]/;
const BARE_CITATION = /(^|[^A-Za-z])(QS|HR)([^A-Za-z]|$)/;
const CAPS_OK = new Set(["SEMA", "MUNAS", "BAZNAS"]);

function issues(list: { path: PropertyKey[]; message: string }[]): string {
  return JSON.stringify(list.slice(0, 10).map((i) => ({ path: i.path.map(String).join("."), message: i.message })), null, 2);
}

function parseDalil(raw: unknown, name: string): DalilRecord[] {
  const r = DalilFile.safeParse(raw);
  if (!r.success) throw new Error(`content/waris/${name} does not match the schema:\n${issues(r.error.issues)}`);
  return r.data;
}

/** Parse the three content files. Throws on a malformed file (first 10 issues), like lib/content.ts. */
export function loadWarisContent(raw: WarisRawContent = { rules: rulesRaw, dalil: dalilRaw, gaps: gapsRaw }): WarisContent {
  const rules = WarisRulesFile.safeParse(raw.rules);
  if (!rules.success) {
    throw new Error(`content/waris/rules.json does not match the schema:\n${issues(rules.error.issues)}`);
  }
  return { rules: rules.data, dalil: parseDalil(raw.dalil, "dalil.json"), gaps: parseDalil(raw.gaps, "dalil-gaps.json") };
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/** Learner-facing note prose: Arabic only through dalil records (D10), no paraphrase dressed as a
 *  quotation, citations as ids rather than bare QS/HR text, no ALL-CAPS emphasis. */
function proseProblems(text: string): string[] {
  const out: string[] = [];
  if (ARABIC.test(text)) out.push("Arabic script");
  if (QUOTES.test(text)) out.push("quotation marks (a paraphrase must not read as a quotation)");
  if (BARE_CITATION.test(text)) out.push("a bare QS/HR citation (cite through dalil ids)");
  const caps = (text.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !CAPS_OK.has(w));
  if (caps.length) out.push(`ALL-CAPS words ${JSON.stringify(caps)}`);
  return out;
}

/**
 * Every problem with the RuleNotes, as readable lines (empty = all good). Checked:
 *  - exactly one note per engine rule id (registry RULE_IDS), in registry order, and no note for an
 *    id the registry lacks;
 *  - every dalil id exists in dalil.json or dalil-gaps.json and is an evidence record
 *    (quran/hadith/fiqh/tafsir) or a gap record; dalil_rule ids are rule records; related_gaps ids
 *    are gap records; every legal cite names a legal source;
 *  - every note has >= 1 dalil or legal source (METHOD_ONLY_RULES may instead carry `method`);
 *  - a note citing only gap records says the source is pending ("belum");
 *  - every note and the file are draft (no reviewer has signed: plan D3, D13);
 *  - learner-facing prose rules (see proseProblems), Arabic nowhere in the notes.
 */
export function warisReferenceProblems(content: WarisContent, ruleIds: readonly string[] = RULE_IDS): string[] {
  const p: string[] = [];
  const { meta, legal_sources: sources, rules: notes } = content.rules;

  if (meta.status !== "draft") p.push(`rules.json: meta.status ${meta.status} (no reviewer has signed: plan D3, D13)`);
  if (!meta.disclaimer_en.includes("not an authoritative fatwa")) {
    p.push("rules.json: meta.disclaimer_en must say 'AI-assisted, not an authoritative fatwa'");
  }

  // One note per registry id, in registry order.
  const count = new Map<string, number>();
  for (const n of notes) count.set(n.rule_id, (count.get(n.rule_id) ?? 0) + 1);
  for (const [id, k] of count) if (k > 1) p.push(`rules: ${id} has more than one RuleNote (${k})`);
  const registry = new Set(ruleIds);
  for (const id of ruleIds) if (!count.has(id)) p.push(`rules: engine rule id ${id} has no RuleNote`);
  for (const id of count.keys()) if (!registry.has(id)) p.push(`rules: RuleNote '${id}' is not in the engine registry`);
  const order = notes.map((n) => n.rule_id);
  const expected = ruleIds.filter((id) => count.has(id));
  if (count.size === notes.length && order.join("|") !== expected.join("|")) {
    p.push("rules: rules.json is not in the registry order of RULE_IDS (re-run build_waris.py)");
  }

  // Legal sources.
  const legalIds = new Set<string>();
  for (const s of sources) {
    if (legalIds.has(s.id)) p.push(`legal source ${s.id}: id used twice`);
    legalIds.add(s.id);
    if (!s.citation.url) p.push(`legal source ${s.id}: citation needs a URL`);
    if (s.pin.status === "terpasang" && !s.pin.sha256) p.push(`legal source ${s.id}: a pinned source needs its sha256`);
    if (s.pin.status === "belum" && s.pin.sha256 !== null) p.push(`legal source ${s.id}: pin.status 'belum' but a sha256 is given`);
    if (ARABIC.test(JSON.stringify(s))) p.push(`legal source ${s.id}: Arabic script`);
  }

  // Dalil index (union of the two files; ids never collide).
  const kindOf = new Map<string, string>();
  for (const r of [...content.dalil, ...content.gaps]) {
    if (kindOf.has(r.id)) p.push(`dalil: record id ${r.id} used twice across dalil.json and dalil-gaps.json`);
    kindOf.set(r.id, r.kind);
  }
  const checkIds = (rid: string, field: string, ids: readonly string[], allowed: (k: string) => boolean, what: string) => {
    if (new Set(ids).size !== ids.length) p.push(`${rid}: ${field} lists an id twice`);
    for (const id of ids) {
      const k = kindOf.get(id);
      if (k === undefined) p.push(`${rid}: ${field} names unknown dalil record '${id}'`);
      else if (!allowed(k)) p.push(`${rid}: ${field} id '${id}' is a ${k} record; ${field} must cite ${what}`);
    }
  };
  const checkLegal = (rid: string, cites: readonly LegalCite[]) => {
    for (const c of cites) if (!legalIds.has(c.source)) p.push(`${rid}: legal cite names unknown legal source '${c.source}'`);
  };

  for (const n of notes) {
    const rid = n.rule_id;
    if (n.status !== "draft") {
      p.push(`${rid}: status '${n.status}'; every RuleNote must be draft until the fara'id reviewer signs (plan D13)`);
    }
    const sentences = sentenceCount(n.summary_id);
    if (sentences < 1 || sentences > 2) p.push(`${rid}: summary_id must be 1-2 sentences (has ${sentences})`);
    const prose: [string, string][] = [
      ["title_id", n.title_id],
      ["summary_id", n.summary_id],
    ];
    if (n.ikhtilaf) {
      if (sentenceCount(n.ikhtilaf.summary_id) > 3) p.push(`${rid}: ikhtilaf.summary_id must be 1-3 sentences`);
      prose.push(["ikhtilaf.summary_id", n.ikhtilaf.summary_id]);
      checkIds(rid, "ikhtilaf.dalil", n.ikhtilaf.dalil, (k) => EVIDENCE_KINDS.has(k), "evidence records");
      checkLegal(rid, n.ikhtilaf.legal);
    }
    if (n.method) {
      if (!METHOD_ONLY_RULES.includes(rid)) p.push(`${rid}: a method block is allowed only on ${JSON.stringify(METHOD_ONLY_RULES)}`);
      prose.push(["method.summary_id", n.method.summary_id]);
    }
    for (const [field, text] of prose) for (const x of proseProblems(text)) p.push(`${rid}: ${x} in ${field}`);
    if (n.reviewer_notes.some((t) => ARABIC.test(t))) {
      p.push(`${rid}: Arabic script in reviewer_notes (quote corpus bytes only through dalil records)`);
    }

    checkIds(rid, "dalil", n.dalil, (k) => EVIDENCE_KINDS.has(k) || k === "gap", "an evidence or gap record");
    checkIds(rid, "dalil_rule", n.dalil_rule, (k) => k === "rule", "rule records");
    checkIds(rid, "related_gaps", n.related_gaps, (k) => k === "gap", "gap records");
    checkLegal(rid, n.legal);

    if (n.dalil.length === 0 && n.legal.length === 0 && !(METHOD_ONLY_RULES.includes(rid) && n.method)) {
      p.push(`${rid}: has no dalil and no legal source`);
    }
    const gapOnly = n.dalil.length > 0 && n.legal.length === 0 && n.dalil.every((id) => kindOf.get(id) === "gap");
    if (gapOnly && !n.summary_id.toLowerCase().includes("belum")) {
      p.push(`${rid}: cites only gap records but its summary_id does not say the source is pending ('belum')`);
    }
  }
  return p;
}

/** Throw if any RuleNote reference is broken (plan §10 M1.6). Defaults to the committed content. */
export function assertWarisReferences(content: WarisContent = loadWarisContent(), ruleIds: readonly string[] = RULE_IDS): void {
  const problems = warisReferenceProblems(content, ruleIds);
  if (problems.length) {
    throw new Error(`Broken waris RuleNotes (${problems.length}):\n` + problems.slice(0, 20).join("\n"));
  }
}

/** Does any waris record still await review? A public build must refuse it (plan D13). */
export function warisHasDrafts(content: WarisContent = loadWarisContent()): boolean {
  return content.rules.meta.status === "draft" || content.rules.rules.some((n) => n.status === "draft");
}
