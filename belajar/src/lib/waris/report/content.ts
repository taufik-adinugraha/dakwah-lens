/**
 * The report's view of the reviewed-content files, as plain structural types: lib/waris imports
 * nothing from content/ (architecture.md §5.1), so the server page passes rules.json and the dalil
 * records in as data. These shapes are satisfied by src/content/waris-schema.ts's WarisRules and
 * DalilRecord (zod output), and by the raw JSON files.
 *
 * Also: the report-level legal sources the Langkah berikutnya checklist cites that rules.json does
 * not list (plan §6 row 6). Quoted by title and locator only; none is pinned yet (plan M0).
 */
import { isRuleId, type RuleId } from "../registry";
import type { LegalRefView, RuleRefView } from "./types";

export interface LegalCiteIn {
  source: string;
  locator: string;
}

export interface RuleNoteIn {
  rule_id: string;
  title_id: string;
  summary_id: string;
  dalil?: readonly string[];
  legal?: readonly LegalCiteIn[];
  ikhtilaf?: { summary_id: string; dalil?: readonly string[]; legal?: readonly LegalCiteIn[] } | null;
  method?: { summary_id: string } | null;
}

export interface LegalSourceIn {
  id: string;
  citation: { kitab: string; url?: string | null };
  pin?: { status: string };
}

export interface ReportRules {
  meta: { written?: unknown; source_sha256?: unknown };
  legal_sources: readonly LegalSourceIn[];
  rules: readonly RuleNoteIn[];
}

/** One record of dalil.json or dalil-gaps.json (fields read defensively; the pipeline owns the bytes). */
export interface ReportDalilRecord {
  id: string;
  kind: string;
  [field: string]: unknown;
}

/**
 * Legal sources cited by the next-steps checklist that rules.json does not list. Each names its
 * research file; none is pinned (plan M0 lists UU 1/1974 Ps. 48/52 and the MUI 1984 land
 * recommendation as items to pin).
 */
export const REPORT_LEGAL_SOURCES: readonly LegalSourceIn[] = [
  {
    id: "uu-1-1974",
    citation: { kitab: "Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan", url: "https://pasal.id/peraturan/uu/uu-no-1-tahun-1974/pasal-48" },
    pin: { status: "belum" },
  },
  {
    id: "sema-1-2017",
    citation: {
      kitab: "SEMA No. 1 Tahun 2017, Rumusan Hukum Kamar Agama",
      url: "https://pta-bandung.go.id/images/Kepaniteraan/Pengelolaan_Kepaniteraan/2023_Kompilasi_SEMA_Kamar_Agama.pdf",
    },
    pin: { status: "belum" },
  },
  {
    id: "permen-atr-bpn-16-2021",
    citation: {
      kitab: "Peraturan Menteri ATR/Kepala BPN Nomor 16 Tahun 2021",
      url: "https://literasihukum.bphn.go.id/konsultasiView?id=24629",
    },
    pin: { status: "belum" },
  },
  {
    id: "mui-1984-tanah-warisan",
    citation: {
      kitab: "Rekomendasi Rakernas MUI 1984, Pendayagunaan Tanah Warisan",
      url: "https://mui.or.id/baca/fatwa/pendayagunaan-tanah-warisan",
    },
    pin: { status: "belum" },
  },
];

export interface ContentIndex {
  notes: Map<string, RuleNoteIn>;
  legal: Map<string, LegalSourceIn>;
  dalil: Map<string, ReportDalilRecord>;
  meta: ReportRules["meta"];
}

export function indexContent(rules: ReportRules, dalil: readonly ReportDalilRecord[]): ContentIndex {
  const notes = new Map<string, RuleNoteIn>();
  for (const n of rules.rules) notes.set(n.rule_id, n);
  const legal = new Map<string, LegalSourceIn>();
  for (const s of REPORT_LEGAL_SOURCES) legal.set(s.id, s);
  for (const s of rules.legal_sources) legal.set(s.id, s);
  const idx = new Map<string, ReportDalilRecord>();
  for (const r of dalil) idx.set(r.id, r);
  return { notes, legal, dalil: idx, meta: rules.meta };
}

export function legalRef(ix: ContentIndex, c: LegalCiteIn): LegalRefView {
  const s = ix.legal.get(c.source);
  if (!s) throw new Error(`waris/report: legal source "${c.source}" is in neither rules.json nor REPORT_LEGAL_SOURCES`);
  return {
    source: c.source,
    locator: c.locator,
    title: s.citation.kitab,
    url: s.citation.url ?? null,
    pinned: s.pin?.status === "terpasang",
  };
}

/**
 * Plan D10 "Never shown" and the records whose display needs a reviewer who does not exist
 * (operator decision: no human review). A RuleNote may cite them; the report drops them and lists
 * them in ReportModel.hiddenDalil.
 */
export const NEVER_SHOWN: Readonly<Record<string, string>> = {
  "H-BULUGH-1101": "plan D10: da'if, never shown",
  "H-BULUGH-1107": "plan D10: only with its grading note and a reviewer's leave; there is no reviewer",
  "H-BULUGH-1109": "plan D10: never shown",
  "H-BULUGH-1110": "plan D10: da'if, never shown",
  "H-BULUGH-1115": "plan D10: munkar addition, never shown",
  "F-FSUNNAH-840-sad-rabi": "plan D10: the Sa'd ibn ar-Rabi' story until a named grading is found",
};

/** A RuleNote as the report shows it. Throws when the note is missing (a content bug CI catches). */
export function ruleRef(ix: ContentIndex, id: RuleId, hidden?: Map<string, string>): RuleRefView {
  const n = ix.notes.get(id);
  if (!n) throw new Error(`waris/report: no RuleNote for engine rule id "${id}" (rules.json)`);
  const shown = (ids: readonly string[] | undefined): string[] =>
    (ids ?? []).filter((d) => {
      const why = NEVER_SHOWN[d];
      if (why) hidden?.set(d, why);
      return !why;
    });
  return {
    ruleId: id,
    title: n.title_id,
    summary: n.summary_id,
    dalilIds: shown(n.dalil),
    legal: (n.legal ?? []).map((c) => legalRef(ix, c)),
    ikhtilaf: n.ikhtilaf
      ? { summary: n.ikhtilaf.summary_id, dalilIds: shown(n.ikhtilaf.dalil), legal: (n.ikhtilaf.legal ?? []).map((c) => legalRef(ix, c)) }
      : null,
    method: n.method ? n.method.summary_id : null,
  };
}

export function asRuleId(x: string): RuleId {
  if (!isRuleId(x)) throw new Error(`waris/report: "${x}" is not an engine rule id`);
  return x;
}
