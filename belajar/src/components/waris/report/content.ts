/**
 * What the report page sends to the browser (plan §6, §9.3; architecture.md §7.1): the fields of
 * rules.json and dalil.json / dalil-gaps.json that buildReport() actually reads, and nothing else.
 *
 * Why project instead of passing the files whole:
 *  - size: the three files are about 460 KB; the projection is well under half of that;
 *  - honesty: the files carry pipeline state that must never reach a page, such as
 *    rules.json meta.disclaimer_id ("… menunggu tinjauan ustadz …"), the record `status` lines
 *    ("not reviewed by an ustadz"), `gist_id` summaries (generated text, plan D10), the raw Muslim
 *    translation labels and the English corpus translations. The operator decided there is no
 *    human review (plan §2), so no page may promise one.
 *
 * Every kept field is copied as is: the Arabic the report shows is a slice of exactly these
 * strings (report/dalil.ts), so the bytes are unchanged. content.test.ts proves that the report
 * built from the projection equals the report built from the full files.
 *
 * Pure TypeScript (no React, no next, no I/O). AI-assisted, not an authoritative fatwa.
 */
import type { LegalCiteIn, LegalSourceIn, ReportDalilRecord, ReportRules, RuleNoteIn } from "@/lib/waris/report/content";

/** Record kinds report/dalil.ts can show; any other kind keeps only its id and kind. */
const CARD_KINDS: ReadonlySet<string> = new Set(["quran", "hadith", "fiqh", "tafsir", "gap"]);

/** Top-level record fields report/dalil.ts reads (dalilCard, citationOf, meaningOf). */
const RECORD_FIELDS = [
  "ar",
  "ar_matn_and_ibn_hajar_attribution",
  "title",
  "citation",
  "collection",
  "book",
  "section_id",
  "display_label",
  "item",
  "url",
  "omit",
  "source_truncated",
] as const;

/** Translation fields report/dalil.ts reads: QuranEnc text + footnotes, and Muslim's `id` text. */
const TRANSLATION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  id_quranenc_indonesian_affairs: ["text", "footnotes"],
  id: ["text"],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pick(src: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** One dalil record as the browser needs it. */
export function projectDalilRecord(r: ReportDalilRecord): ReportDalilRecord {
  const out: ReportDalilRecord = { id: r.id, kind: r.kind };
  if (!CARD_KINDS.has(r.kind)) return out;
  const src = r as Record<string, unknown>;
  Object.assign(out, pick(src, RECORD_FIELDS));
  const ref = src.ref;
  if (isObject(ref)) out.ref = pick(ref, ["surah", "ayah"]);
  const tr = src.translations;
  if (isObject(tr)) {
    const kept: Record<string, unknown> = {};
    for (const [name, fields] of Object.entries(TRANSLATION_FIELDS)) {
      const t = tr[name];
      if (isObject(t)) {
        const p = pick(t, fields);
        if (Object.keys(p).length > 0) kept[name] = p;
      }
    }
    if (Object.keys(kept).length > 0) out.translations = kept;
  }
  return out;
}

function projectCites(list: readonly LegalCiteIn[] | undefined): LegalCiteIn[] | undefined {
  return list ? list.map((c) => ({ source: c.source, locator: c.locator })) : undefined;
}

function projectNote(n: RuleNoteIn): RuleNoteIn {
  const out: RuleNoteIn = { rule_id: n.rule_id, title_id: n.title_id, summary_id: n.summary_id };
  if (n.dalil) out.dalil = [...n.dalil];
  const legal = projectCites(n.legal);
  if (legal) out.legal = legal;
  if (n.ikhtilaf) {
    const ik: NonNullable<RuleNoteIn["ikhtilaf"]> = { summary_id: n.ikhtilaf.summary_id };
    if (n.ikhtilaf.dalil) ik.dalil = [...n.ikhtilaf.dalil];
    const il = projectCites(n.ikhtilaf.legal);
    if (il) ik.legal = il;
    out.ikhtilaf = ik;
  } else if (n.ikhtilaf === null) out.ikhtilaf = null;
  if (n.method) out.method = { summary_id: n.method.summary_id };
  else if (n.method === null) out.method = null;
  return out;
}

function projectSource(s: LegalSourceIn): LegalSourceIn {
  const citation: LegalSourceIn["citation"] = { kitab: s.citation.kitab };
  if (s.citation.url !== undefined) citation.url = s.citation.url;
  const out: LegalSourceIn = { id: s.id, citation };
  if (s.pin) out.pin = { status: s.pin.status };
  return out;
}

/** rules.json as the browser needs it: the RuleNotes' own words, their references, and the version stamp. */
export function projectRules(rules: ReportRules): ReportRules {
  return {
    meta: { written: rules.meta.written, source_sha256: rules.meta.source_sha256 },
    legal_sources: rules.legal_sources.map(projectSource),
    rules: rules.rules.map(projectNote),
  };
}

/** Both projections, for the report page's props. `dalil` = dalil.json then dalil-gaps.json. */
export function projectReportContent(
  rules: ReportRules,
  dalil: readonly ReportDalilRecord[],
): { rules: ReportRules; dalil: ReportDalilRecord[] } {
  return { rules: projectRules(rules), dalil: dalil.map(projectDalilRecord) };
}
