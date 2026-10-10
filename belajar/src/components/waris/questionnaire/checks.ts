/**
 * Checks for the questionnaire UI's pure layer (plan §10 M2.5, M2.7, M2.12; senior-ux.md), run by
 * questionnaire-ui.test.ts in CI and by a local tsx runner. No React, no DOM, no network.
 *
 *  1. Messages: the "Q" namespace of messages/waris/{id,en}.json holds every Q_TEXT key with the
 *     model's exact Indonesian text (both locales: the questionnaire is Indonesian-only, plan
 *     D11), the two files have the same keys in "Q" and "Exit", every key the UI sources name
 *     exists, and no string promises a review, cites a bare QS/HR, carries Arabic or ALL CAPS.
 *  2. Rule pack: every RuleNote the questions and exit pages name is present; every Arabic string
 *     is the report's dalilCard() slice of its record, rebuilt byte for byte; no NEVER_SHOWN
 *     record, no rules.json meta.disclaimer_id, no review promise.
 *  3. Walks: seeded oracle families driven through the reducer as the UI does: every answered
 *     screen has a question and an answer text whose keys exist, the family tree accounts for
 *     every person once, "Langkah" counts upward, skip lines and exit pages have their keys, and
 *     the stored / linked forms never carry the killer answer (k6).
 *
 * AI-assisted, not an authoritative fatwa.
 */
import { drive } from "@/lib/waris/checks/questionnaire";
import { randomTrueFamily } from "@/lib/waris/checks/questionnaire-gen";
import { Rng } from "@/lib/waris/checks/prng";
import {
  A3_UI_OPTIONS,
  EXITS,
  EXIT_IDS,
  KILLER_OPTION,
  NODE,
  Q_TEXT,
  a3Route,
  familyPreview,
  initialState,
  nodeView,
  reduce,
  shareToken,
  storable,
  view,
  walk,
  type Answers,
  type QState,
} from "@/lib/waris/questionnaire";
import { NEVER_SHOWN, type ReportDalilRecord, type ReportRules } from "@/lib/waris/report/content";
import { dalilCard, rebuildArabic } from "@/lib/waris/report/dalil";

import { COLLAPSE_ABOVE, answerParts, stepNumber, treeRows } from "./format";
import { buildRulePack, questionnaireRuleIds, type RulePack } from "./rulePack";
import { parseStored, serialize } from "./storage";

export interface CheckReport {
  checked: number;
  failures: string[];
}

type Json = { [k: string]: unknown };

/** The CI-wide banned review phrases (plan §2 "no human review") plus the reviewer wording. */
const REVIEW = [/tinjauan ustadz/i, /ditinjau ustadz/i, /awaiting ustadz/i, /reviewed by an ustadz/i, /peninjau/i, /akan ditinjau/i];
const BARE_CITATION = /(^|[^A-Za-z])(QS|HR)([^A-Za-z]|$)/;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** Acronyms allowed in upper case (they are names, not emphasis). */
const ACRONYMS = new Set(["KHI", "MUI", "AI", "SEMA", "KUA", "BAZNAS", "AS"]);
const PLACEHOLDERS = new Set(["pewaris", "Pewaris", "saat", "Saat", "pasangan", "Pasangan", "kelompok", "penghalang", "n", "label", "pertanyaan", "judul", "pasal", "kutipan", "kitab", "bagian", "tanggal", "kode"]);

/** Flatten a nested message object to dotted keys. */
export function flatten(o: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof o !== "object" || o === null) return out;
  for (const [k, v] of Object.entries(o as Json)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function textProblems(where: string, v: string, english: boolean): string[] {
  const out: string[] = [];
  for (const re of REVIEW) if (re.test(v)) out.push(`${where}: promises or reports a review ("${v}")`);
  if (BARE_CITATION.test(v)) out.push(`${where}: bare QS/HR citation`);
  if (ARABIC.test(v)) out.push(`${where}: Arabic script in a message (must come from dalil.json)`);
  for (const w of v.split(/[^A-Za-z]+/)) if (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w) && !ACRONYMS.has(w) && !(english && w === "I")) out.push(`${where}: ALL-CAPS word "${w}"`);
  let depth = 0;
  for (const ch of v) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0 || depth > 1) out.push(`${where}: unbalanced braces`);
  }
  if (depth !== 0) out.push(`${where}: unbalanced braces`);
  for (const m of v.match(/\{([A-Za-z_]+)\}/g) ?? []) if (!PLACEHOLDERS.has(m.slice(1, -1))) out.push(`${where}: unknown placeholder ${m}`);
  return out;
}

/** 1. The message files. `sources` = the UI's .ts/.tsx sources (key literals are read from them). */
export function runMessageChecks(id: Json, en: Json, sources: readonly string[]): CheckReport {
  const failures: string[] = [];
  let checked = 0;
  const qId = flatten(id.Q);
  const qEn = flatten(en.Q);
  const xId = flatten(id.Exit);
  const xEn = flatten(en.Exit);
  // Q_TEXT 1:1 in both locales
  for (const [k, v] of Object.entries(Q_TEXT)) {
    checked++;
    if (qId[k] !== v) failures.push(`id Q.${k}: differs from questionnaire/text.ts`);
    if (qEn[k] !== v) failures.push(`en Q.${k}: differs from questionnaire/text.ts (the questionnaire is Indonesian-only, plan D11)`);
  }
  // parity
  for (const [a, b, ns] of [
    [qId, qEn, "Q"],
    [xId, xEn, "Exit"],
  ] as const) {
    for (const k of Object.keys(a)) {
      checked++;
      if (!(k in b)) failures.push(`${ns}.${k}: in id.json but not in en.json`);
    }
    for (const k of Object.keys(b)) if (!(k in a)) failures.push(`${ns}.${k}: in en.json but not in id.json`);
  }
  // only the page shell differs between the locales
  for (const k of Object.keys(qId)) if (!k.startsWith("halaman.") && qId[k] !== qEn[k]) failures.push(`Q.${k}: differs between id and en outside "halaman"`);
  for (const k of Object.keys(xId)) if (xId[k] !== xEn[k]) failures.push(`Exit.${k}: differs between id and en (exit pages are Indonesian-only)`);
  // copy rules
  for (const [k, v] of Object.entries(qId)) {
    checked++;
    failures.push(...textProblems(`id Q.${k}`, v, false));
  }
  for (const [k, v] of Object.entries(xId)) {
    checked++;
    failures.push(...textProblems(`id Exit.${k}`, v, false));
  }
  for (const k of Object.keys(qEn).filter((x) => x.startsWith("halaman."))) {
    checked++;
    failures.push(...textProblems(`en Q.${k}`, qEn[k], true));
  }
  // the mandatory labels (plan §2 decisions; M2.7 "bukan fatwa" on every waris page)
  for (const [loc, q] of [
    ["id", qId],
    ["en", qEn],
  ] as const) {
    checked++;
    if (!/bukan fatwa/.test(q["halaman.chip"] ?? "")) failures.push(`${loc} Q.halaman.chip must say "bukan fatwa"`);
    if (!(q["halaman.label"] ?? "").startsWith("Dibantu AI, bukan fatwa otoritatif, bukan penetapan pengadilan")) failures.push(`${loc} Q.halaman.label must carry the header label`);
  }
  // every literal key the sources name
  const used = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(`Q:${m[1]}`);
    for (const m of src.matchAll(/\bte\(\s*"([^"]+)"/g)) used.add(`Exit:${m[1]}`);
    for (const m of src.matchAll(/"(ui\.[a-z_]+)"/g)) used.add(`Q:${m[1]}`);
  }
  // keys built from a template: ProgressLine `ui.status_${status}`
  for (const st of ["selesai", "sekarang", "nanti", "dilewati"]) used.add(`Q:ui.status_${st}`);
  const split = (u: string): [string, string] => {
    const at = u.indexOf(":");
    return [u.slice(0, at), u.slice(at + 1)];
  };
  for (const u of used) {
    checked++;
    const [ns, key] = split(u);
    const pool = ns === "Q" ? qId : xId;
    // keys used through getTranslations("Q.halaman") are written without the "halaman." prefix
    if (!(key in pool) && !(ns === "Q" && `halaman.${key}` in pool)) failures.push(`${ns}.${key}: used in the UI sources but missing from messages/waris/id.json`);
  }
  // keys defined by this UI but used nowhere (dead copy)
  const usedKeys = new Set([...used].map((u) => split(u)[1]));
  for (const k of Object.keys(qId).filter((x) => x.startsWith("ui."))) if (!usedKeys.has(k)) failures.push(`Q.${k}: defined but not used by the UI`);
  for (const k of Object.keys(xId)) if (!usedKeys.has(k)) failures.push(`Exit.${k}: defined but not used by the UI`);
  return { checked, failures };
}

/** 2. The rule pack the server hands to the client. */
export function runRulePackChecks(
  rules: ReportRules & { meta: { disclaimer_id?: unknown } },
  records: readonly ReportDalilRecord[],
  pack: RulePack = buildRulePack(rules, records),
): CheckReport {
  const failures: string[] = [];
  let checked = 0;
  const byId = new Map(records.map((r) => [r.id, r]));
  const { why, withDalil } = questionnaireRuleIds();
  for (const r of [...why, ...withDalil]) {
    checked++;
    if (!pack.rules[r]) failures.push(`rule ${r}: missing from the pack`);
  }
  for (const ex of EXIT_IDS) {
    checked++;
    if (JSON.stringify(pack.exitRules[ex]) !== JSON.stringify(EXITS[ex].rules)) failures.push(`${ex}: exit rules differ from EXITS`);
  }
  for (const [id, d] of Object.entries(pack.dalil)) {
    checked++;
    if (NEVER_SHOWN[id]) failures.push(`${id}: a NEVER_SHOWN record is in the pack`);
    const rec = byId.get(id);
    if (!rec) {
      failures.push(`${id}: no such record`);
      continue;
    }
    const card = dalilCard(rec);
    if (d.arabic) {
      const rebuilt = card?.arabic ? rebuildArabic(card.arabic, byId) : null;
      if (rebuilt === null || rebuilt !== d.arabic.text) failures.push(`${id}: Arabic is not a byte slice of the record`);
    }
    if (d.heading) {
      const rebuilt = card?.heading ? rebuildArabic(card.heading, byId) : null;
      if (rebuilt !== d.heading) failures.push(`${id}: heading is not a byte slice of the record`);
    }
  }
  const json = JSON.stringify(pack);
  const disclaimer = typeof rules.meta.disclaimer_id === "string" ? rules.meta.disclaimer_id : "";
  checked++;
  if (disclaimer && json.includes(disclaimer)) failures.push("the pack carries rules.json meta.disclaimer_id");
  for (const r of Object.values(pack.rules)) {
    if (!r) continue;
    checked++;
    for (const re of REVIEW) if (re.test(`${r.title} ${r.summary}`)) failures.push(`rule ${r.id}: its note promises or reports a review`);
    if (ARABIC.test(`${r.title} ${r.summary}`)) failures.push(`rule ${r.id}: Arabic in an Indonesian note`);
  }
  return { checked, failures };
}

/** 3. Seeded walks through the reducer, as the UI drives it. */
export function runWalkChecks(opts: { count: number; seed: number; qKeys: ReadonlySet<string> }): CheckReport & { bunuh: number; exits: number; reviews: number } {
  const failures: string[] = [];
  let checked = 0;
  let bunuh = 0;
  let exits = 0;
  let reviews = 0;
  const has = (k: string) => opts.qKeys.has(k);
  const rng = new Rng(opts.seed);
  for (let i = 0; i < opts.count && failures.length < 40; i++) {
    const fam = randomTrueFamily(rng, i);
    const d = drive(fam);
    const tag = `family#${i}`;
    if (d.error) {
      failures.push(`${tag}: ${d.error}`);
      continue;
    }
    // k6 never in state, storage or a link
    const stored = serialize(storable(d.state));
    checked++;
    if (stored.includes(KILLER_OPTION)) failures.push(`${tag}: the stored answers carry k6`);
    if (JSON.stringify(parseStored(stored)) !== JSON.stringify(d.state.answers)) failures.push(`${tag}: storage does not round-trip`);
    if (d.bunuh) {
      bunuh++;
      continue;
    }
    const w = walk(d.state.answers);
    // every answered screen reads back (review screen and printout)
    let lastStep = 0;
    for (const s of w.steps) {
      checked++;
      const nv = nodeView(w, s.key, s.value);
      if (!nv) {
        failures.push(`${tag}: no view for ${s.key}`);
        continue;
      }
      if (!has(nv.text.tanya)) failures.push(`${tag}: ${s.key} question key ${nv.text.tanya} missing`);
      const parts = answerParts(nv, s.value);
      if (parts.length === 0) failures.push(`${tag}: ${s.key} answer ${JSON.stringify(s.value)} has no text`);
      for (const p of parts) if (!has(p.key)) failures.push(`${tag}: ${s.key} answer key ${p.key} missing`);
      if (NODE[s.id].screen) {
        const n = stepNumber(w, s.key);
        if (n !== lastStep + 1) failures.push(`${tag}: Langkah ${n} after ${lastStep} at ${s.key}`);
        lastStep = n;
      }
    }
    // the tree accounts for every person once, with words for every state
    const s: QState = d.state;
    const preview = familyPreview(s);
    const rows = treeRows(preview, null, true, (k) => w.steps.some((x) => x.key === k));
    const nodes = rows.flatMap((r) => r.nodes);
    checked++;
    const drawn = nodes.filter((n) => n.role !== "pewaris").reduce((a, n) => a + n.count, 0);
    const people = preview.reduce((a, p) => a + p.count, 0);
    if (drawn !== people) failures.push(`${tag}: tree draws ${drawn} people, preview has ${people}`);
    for (const n of nodes) {
      if (n.role !== "pewaris" && !has(`peran.${n.role}`)) failures.push(`${tag}: no label for tree role ${n.role}`);
      if (n.count > 1 && n.count <= COLLAPSE_ABOVE) failures.push(`${tag}: ${n.role} collapsed below the threshold`);
      if (n.edit && !w.steps.some((x) => x.key === n.edit)) failures.push(`${tag}: ${n.role} edits ${n.edit}, not on the path`);
    }
    for (const na of w.notAsked) {
      checked++;
      if (!has(`kelompok.${na.group}`)) failures.push(`${tag}: no label for skipped group ${na.group}`);
      for (const r of na.because) if (!has(`peran.${r}`)) failures.push(`${tag}: no label for blocker ${r}`);
    }
    const v = view(s);
    if (v.kind === "keluar") {
      exits++;
      checked++;
      for (const part of ["judul", "situasi", "alasan", "langkah"]) if (!has(`exit.${v.exit.id}.${part}`)) failures.push(`${tag}: exit ${v.exit.id} lacks ${part}`);
      for (const k of v.exit.nodes ?? []) if (!nodeView(w, k)) failures.push(`${tag}: E-TIDAK-TAHU names ${k}, not on the path`);
      if (v.exit.id === "E-BUNUH" && v.print) failures.push(`${tag}: E-BUNUH offers a printout`);
    } else if (v.kind === "ringkasan") reviews++;
    // the share token (fallback hand-off) never carries k6 either
    checked++;
    if (shareToken(s).includes(KILLER_OPTION)) failures.push(`${tag}: the share token spells k6`);
  }
  // the killer option itself: routed away, never dispatched, never stored
  checked++;
  const routed = a3Route([...A3_UI_OPTIONS.filter((o) => o === "k1" || o === KILLER_OPTION)]);
  if (routed.kind !== "bunuh") failures.push("a3Route does not route k6 to E-BUNUH");
  let st = reduce(initialState(), { type: "jawab", key: "A1", value: "wafat_muslim" });
  st = reduce(st, { type: "jawab", key: "A2", value: "L" });
  const before: Answers = st.answers;
  const after = reduce(st, { type: "jawab", key: "A3", value: ["k1", KILLER_OPTION] });
  if (after.answers !== before || serialize(after.answers).includes(KILLER_OPTION)) failures.push("the reducer stored k6");
  return { checked, failures, bunuh, exits, reviews };
}
