/**
 * Content contract for the Ilmu Waris track (docs/waris-plan.md §9.2; architecture.md §3.2).
 *
 * M1 scope: the RuleNote drafts in content/waris/rules.json (built by pipeline/build_waris.py from
 * pipeline/authored/waris.rules.json) and a light shape for the dalil files content/waris/dalil.json
 * and dalil-gaps.json, whose bytes the Python pipeline owns and re-checks (validate_waris.py).
 *
 * Imports only ReviewStatus and SourceRef from schema.ts, which the Qur'an track edits. Engine rule
 * ids are not enumerated here: the engine registry (src/lib/waris/registry.ts) is their single
 * source, and lib/waris-content.ts checks every note against it (assertWarisReferences()).
 *
 * Hard rules encoded here and in assertWarisReferences():
 *  - a RuleNote cites dalil by record id only; Arabic is shown only through those records, never
 *    typed into a note ("retrieved, never generated");
 *  - every note rests on >= 1 dalil record or legal source (KHI, SEMA, MA, MUI), or, for the one
 *    arithmetic rule, an explicit `method` block saying it is not a ruling;
 *  - every note is "draft" until the fara'id reviewer signs it (plan D3, D13).
 * AI-assisted, not an authoritative fatwa.
 */
import { z } from "zod";

import { ReviewStatus, SourceRef } from "./schema";

/** A dalil.json / dalil-gaps.json record id, e.g. "Q-4-11", "H-MUSLIM-1615a", "G-AKDARIYYAH". */
export const DalilId = z.string().regex(/^[A-Z][A-Za-z0-9-]*$/);

/** Shape of an engine rule id ("estate.utang", "rujuk.khuntsa", "aul"); membership is checked against the registry. */
export const RuleIdString = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/);

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

// ───────────────────────── Dalil files (shape only; bytes are the pipeline's job) ─────────────────────────

export const DalilKind = z.enum(["meta", "quran", "hadith", "fiqh", "tafsir", "section_index", "rule", "gap"]);
export type DalilKind = z.infer<typeof DalilKind>;

/** One record of dalil.json or dalil-gaps.json. Only id and kind are read here; the rest passes through. */
export const DalilRecord = z.looseObject({ id: DalilId, kind: DalilKind });
export type DalilRecord = z.infer<typeof DalilRecord>;

export const DalilFile = z.array(DalilRecord).min(1);

// ───────────────────────── Legal sources (KHI, SEMA, MA, MUI) ─────────────────────────

export const LegalKind = z.enum(["peraturan", "sema", "yurisprudensi", "putusan", "fatwa", "pedoman", "kajian"]);

/** A legal text or court document a note may cite. Quoted only from a pinned copy (plan D10, rule B9). */
export const LegalSource = z.strictObject({
  id: Slug,
  kind: LegalKind,
  /** kitab = the instrument's title; url = where the official (or best available) text lives. */
  citation: SourceRef,
  /** Copies actually read, when the official text could not be opened. */
  read_via: z.array(SourceRef).default([]),
  /** "belum" until plan M0 pins the file (URL + sha256 + page); "terpasang" once it is. */
  pin: z.strictObject({
    status: z.enum(["belum", "terpasang"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }),
  /** Where the research recorded it, e.g. "docs/waris-research/standard.md §2". */
  source_doc: z.string().min(5),
  note: z.string().optional(),
});
export type LegalSource = z.infer<typeof LegalSource>;

export const LegalCite = z.strictObject({
  /** A LegalSource id. */
  source: Slug,
  /** Article, rumusan number, page or amar, e.g. "Pasal 185 ayat (2)". */
  locator: z.string().min(2),
});
export type LegalCite = z.infer<typeof LegalCite>;

// ───────────────────────── RuleNote: one per engine rule id ─────────────────────────

/** A disagreement the plan records, shown collapsed under the note ("Pendapat lain"). */
export const Ikhtilaf = z.strictObject({
  summary_id: z.string().min(20),
  dalil: z.array(DalilId).default([]),
  legal: z.array(LegalCite).default([]),
  /** Where the plan or research records the disagreement. */
  source_doc: z.string().min(5),
});

/** Only for arithmetic that is not a ruling (lib/waris-content.ts METHOD_ONLY_RULES). */
export const MethodBasis = z.strictObject({
  summary_id: z.string().min(20),
  source_doc: z.string().min(5),
});

export const RuleNote = z.strictObject({
  rule_id: RuleIdString,
  /** Plain, senior-friendly Indonesian title. */
  title_id: z.string().min(5).max(90),
  /** One or two plain Indonesian sentences: no Arabic script, no quotation marks, no bare QS/HR. */
  summary_id: z.string().min(20).max(450),
  /** dalil.json / dalil-gaps.json evidence records whose TEXT grounds the rule; a gap record (G-*) only
   *  when the corpus cannot ground the rule at all, and then summary_id says the source is pending. */
  dalil: z.array(DalilId).default([]),
  /** The dalil.json kind:"rule" record(s) of plan §8 (lesson writers' bundle). */
  dalil_rule: z.array(DalilId).default([]),
  /** Gap records (G-*) for the part of the rule the corpus cannot ground. */
  related_gaps: z.array(DalilId).default([]),
  legal: z.array(LegalCite).default([]),
  ikhtilaf: Ikhtilaf.nullable().default(null),
  method: MethodBasis.nullable().default(null),
  /** For the reviewer; never shown to learners. */
  reviewer_notes: z.array(z.string().min(5)).default([]),
  status: ReviewStatus,
});
export type RuleNote = z.infer<typeof RuleNote>;

export const WarisRulesMeta = z.looseObject({
  status: ReviewStatus,
  disclaimer_id: z.string().min(10),
  disclaimer_en: z.string().min(10),
});

/** content/waris/rules.json */
export const WarisRulesFile = z.strictObject({
  meta: WarisRulesMeta,
  legal_sources: z.array(LegalSource),
  rules: z.array(RuleNote),
});
export type WarisRules = z.infer<typeof WarisRulesFile>;
