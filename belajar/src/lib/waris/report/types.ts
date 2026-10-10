/**
 * The report view-model (plan §6 sections 0–7). Plain JSON: strings, numbers, booleans, arrays and
 * objects only (bigints travel as decimal strings), so the model can go through props, storage or
 * a test snapshot unchanged.
 *
 * Two structural rules the report checks enforce (checks/report.ts):
 *  1. every number a reader sees (a FracView, RupiahView or TableView, or a message value carrying
 *     one) sits under a key named "fikih" or "court", so a refused column provably shows none;
 *  2. every string containing Arabic script is an ArabicView / MeaningView whose segments
 *     reproduce it byte for byte from a dalil.json / dalil-gaps.json record field.
 * AI-assisted, not an authoritative fatwa.
 */
import type { RuleId, RujukReason, SwitchName } from "../registry";
import type { Msg, MsgList } from "./messages";

export type ColumnId = "fikih" | "court";

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** A share. The fraction is the legal share; percent is a convenience. */
export interface FracView {
  t: "frac";
  n: string;
  d: string;
  /** "1/8"; "1" for the whole. */
  figure: string;
  /** "seperdelapan" (words.ts; parses back to n/d). */
  words: string;
  /** "12,50" (half-up, 2 decimals, Indonesian decimal comma; the UI adds " %"). */
  percent: string;
}

export interface RupiahView {
  t: "rp";
  /** Integer rupiah as a decimal string. */
  amount: string;
  /** "Rp 90.000.000". */
  text: string;
}

/** The classical integer table of one column (plan §6; display decision: asal masalah leads). */
export interface TableView {
  t: "tabel";
  /** Asal masalah. */
  asal: string;
  aul?: { dari: string; menjadi: string };
  radd?: { dari: string; menjadi: string };
  /** Shown only in Catatan metode (the "6 → 2" ikhtisar M1 flagged reads oddly as a table base). */
  tashih?: { dari: string; menjadi: string };
  ikhtisar?: { dari: string; menjadi: string };
  /** The table the Ringkasan's units are counted in: the 'aul or radd total, else the asal masalah. */
  dasar: string;
  /** One-line caption: "Asal masalah 24, naik menjadi 27 karena 'aul". */
  caption: Msg;
}

// ---------------------------------------------------------------------------------------------
// References (structured; the UI renders chips and links)
// ---------------------------------------------------------------------------------------------

export interface LegalRefView {
  /** rules.json legal_sources id, or a report-level source (content.ts REPORT_LEGAL_SOURCES). */
  source: string;
  /** "Pasal 185 ayat (2)". */
  locator: string;
  /** The instrument's title. */
  title: string;
  url: string | null;
  /** false until plan M0 pins the official text (URL + sha256 + page). */
  pinned: boolean;
}

/** One RuleNote (rules.json) as the report shows it: its own words, keyed by the engine rule id. */
export interface RuleRefView {
  ruleId: RuleId;
  title: string;
  summary: string;
  /** Shown dalil record ids (plan D10 exclusions removed), in the RuleNote's order. */
  dalilIds: string[];
  legal: LegalRefView[];
  /** "Pendapat lain", collapsed. */
  ikhtilaf: { summary: string; dalilIds: string[]; legal: LegalRefView[] } | null;
  /** Arithmetic, not a ruling (rupiah.pembulatan). */
  method: string | null;
}

/** A byte slice of a dalil record field: record[field].slice(start, end). */
export interface Segment {
  recordId: string;
  field: string;
  start: number;
  end: number;
}

export interface ArabicView {
  /** The concatenated segments. Never typed: the checks rebuild it from the record. */
  text: string;
  segments: Segment[];
  /** "quran" → the module's .quran style (Tanzil Uthmani); "naskh" → .arabic-inline. */
  script: "quran" | "naskh";
}

/** A translation retrieved from the corpus, shown with its source label (plan D10). */
export interface MeaningView {
  text: string;
  /** The record path the text is copied from, e.g. "translations.id_quranenc_indonesian_affairs.text". */
  source: { recordId: string; path: string };
  label: Msg;
  /** QuranEnc translator's notes, shown whole (plan D10). */
  footnotes: { text: string; source: { recordId: string; path: string } } | null;
}

export interface CitationView {
  kind: "quran" | "hadith" | "fiqh" | "tafsir" | "gap";
  /** The record's own citation label (data from dalil.json, never a message string). */
  text: string;
  surah: number | null;
  ayah: number | null;
  /** Hadith number; null for Bulugh al-Maram (plan D10: its local numbering is not shown). */
  number: string | null;
  /** Fiqh section id ("117"). */
  section: string | null;
  /** Link to the source passage (AGENTS.md: link back to the source passage). */
  url: string | null;
}

export interface DalilCard {
  id: string;
  kind: CitationView["kind"];
  citation: CitationView;
  /** Arabic matn / excerpt (null for a gap record). */
  arabic: ArabicView | null;
  /** Fiqh section heading (Arabic, a slice of the record's title). */
  heading: ArabicView | null;
  meaning: MeaningView | null;
  /** Shown when there is no corpus Indonesian (hadith, kitab, tafsir): Arabic only, never a generated rendering. */
  meaningMissing: Msg | null;
  /** E.g. "Putusan Mu'adh bin Jabal (atsar)", the Bulugh source line, elision notes. */
  tags: Msg[];
}

// ---------------------------------------------------------------------------------------------
// 0. Kepala
// ---------------------------------------------------------------------------------------------

export interface KepalaView {
  title: Msg;
  subtitle: Msg;
  /** The mandatory label, also repeated in the Penutup. */
  label: Msg;
  chip: Msg;
  simulasi: boolean;
  simulasiNote: Msg | null;
  /** From the click/print event (purity: never read during render). */
  date: { iso: string; text: string } | null;
  answerCode: string;
  answerCodeLine: Msg;
  /** "Kolom utama: Menurut fikih mazhab Syafi'i" (plan D2 = A). */
  leadColumnLine: Msg;
  leadColumn: ColumnId;
  /** D1 label; describes the fikih column only. */
  methodLabel: Msg | null;
  /** D16 amended: the legal route and musyawarah (KHI 183). */
  route: Msg;
  musyawarah: Msg;
  musyawarahRule: RuleRefView;
}

// ---------------------------------------------------------------------------------------------
// 1. Ringkasan
// ---------------------------------------------------------------------------------------------

export interface RefusalView {
  /** An engine refusal reason, or a report-level one. */
  reason: RujukReason | "tidak_tahu_ganda";
  /** The RuleNote of rujuk.<reason> (null for a report-level reason). */
  rule: RuleRefView | null;
  /** Report-level reasons carry their own sentence. */
  text: Msg | null;
}

export interface ColumnHead {
  id: ColumnId;
  label: Msg;
  status: "hasil" | "rujuk";
  lead: boolean;
  /** Court column: shown when it differs from the fikih column, or when it refuses. */
  shown: boolean;
  /** Only for a refused column: reasons, never numbers. */
  refusal: RefusalView[] | null;
  table: TableView | null;
  /**
   * Which fraction the column leads with: "harta_waris" (CellView.total, the fara'id share of the
   * estate after costs, debts and bequests) or "setelah_utang" (CellView.lineTotal) for the MA
   * as-if wasiat-wajibah illustration, where every heir keeps an as-if share of the whole, and for
   * a column that takes a bequest first when the two shown columns take different ones (a wasiat
   * wajibah ceiling in the court column only): the shares are then compared on the same base.
   * With "setelah_utang" the column has no integer table (its asal masalah divides the harta waris).
   */
  basis: "harta_waris" | "setelah_utang";
  /** The rule ids of the switches that changed a share (court column; plan §6). */
  switchesUsed: SwitchName[];
}

export interface NoneView {
  kind: "terhalang" | "bukan" | "habis";
  count: number;
  label: Msg;
  /** "Terhalang oleh …" list (blocked only). */
  by: MsgList | null;
  rule: RuleRefView;
}

/** One column's cell of a Ringkasan row. */
export interface CellView {
  /** Sum over the row's persons who receive a share (fara'id view: share of the harta waris). */
  total: FracView | null;
  /** The same share for every person of the row, when count > 1. */
  perHead: FracView | null;
  /** Per-person shares when they differ (KHI 185 slots, 2 : 1 groups split across rows). */
  persons: { personId: string; share: FracView; rupiah: RupiahView | null }[] | null;
  /** Share of the estate after debts, when a wasiat or wasiat wajibah is taken first. */
  lineTotal: FracView | null;
  /** The same after-debts share for every person of the row (with lineTotal, count > 1). */
  linePerHead: FracView | null;
  rupiahTotal: RupiahView | null;
  rupiahPerHead: RupiahView | null;
  /** 'Aul / radd: "1/8 menjadi 1/9, dikurangi bersama karena 'aul". */
  change: { reason: "aul" | "radd"; from: FracView; to: FracView; text: Msg } | null;
  /** Units of the row in the column's TableView.dasar, when whole. */
  units: string | null;
  /** Persons of the row who receive nothing in this column, and why. */
  none: NoneView[];
  /** The rules that decided this share, in trace order (RuleNotes). */
  rules: RuleRefView[];
}

export interface HeirRow {
  /** Stable row key: "<column>:<role>". */
  key: string;
  /** Role id in the column the row comes from (HeirId, "pengganti_<k>", a dzawil-arham id). */
  role: string;
  label: Msg;
  count: number;
  countText: Msg;
  personIds: string[];
  /** The court cell exists only when the row differs and the court column computed. */
  differs: boolean;
  fikih?: CellView;
  court?: CellView;
  /** Anchor of this row's dalil disclosure in section 4. */
  dasarAnchor: string;
}

export interface PreLineCell {
  frac: FracView;
  rupiah: RupiahView | null;
  /** Wasiat wajibah: "paling banyak …" (plafon) or "contoh cara putusan MA" (illustration). */
  note: Msg | null;
}

export interface PreLineView {
  key: string;
  kind: "wasiat" | "wasiat_wajibah";
  label: Msg;
  personIds: string[];
  fikih?: PreLineCell;
  court?: PreLineCell;
}

export interface ResidueView {
  key: "sisa_dirujuk";
  text: Msg;
  fikih?: { frac: FracView; rupiah: RupiahView | null };
  court?: { frac: FracView; rupiah: RupiahView | null };
}

export interface CompactRow {
  label: Msg;
  count: number;
  total: FracView | null;
  perHead: FracView | null;
  ruleIds: RuleId[];
  /**
   * A «Tidak tahu» on a count read as "dua orang atau lebih": `count` is the least, the total is
   * the group's for any such count, and there is no per-head share ("dibagi rata di antara mereka").
   */
  open?: boolean;
}

/** One column of a «Tidak tahu» reading: what is taken first, then the heirs (plan D15). */
export interface OutcomeColumn {
  /** The bequests taken first (wasiat, wasiat wajibah), as shares of the estate after debts. */
  pre: CompactRow[];
  rows: CompactRow[];
  /** What the heirs' shares are of (ColumnHead.basis; "setelah_utang" when the readings take different bequests first). */
  basis: "harta_waris" | "setelah_utang";
}

export interface OutcomeView {
  option: Msg;
  base: boolean;
  fikih?: OutcomeColumn | { refusal: RefusalView[] };
  court?: OutcomeColumn | { refusal: RefusalView[] };
}

export interface RingkasanView {
  title: Msg;
  sentence: Msg[];
  agree: boolean;
  agreeLine: Msg;
  columns: { fikih: ColumnHead; court: ColumnHead };
  rows: HeirRow[];
  preLines: PreLineView[];
  residue: ResidueView | null;
  basisNote: Msg | null;
  fractionNote: Msg;
  rupiahShown: boolean;
  /** Rupiah refused (several wives' pools, an earlier spouse: plan D18). */
  rupiahNote: Msg | null;
  /**
   * Soft stops (plan §5.4 last row): numbers are shown, with a stamp beside the table, e.g.
   * "Kakek bersama saudara: perlu konfirmasi ahli faraid" (RuleNote) or the 'iddah line.
   */
  stamps: { text: Msg | null; rule: RuleRefView | null; columns: ColumnId[] }[];
  /**
   * One «Tidak tahu» answer changes the division: show these outcomes side by side (plan D15),
   * before the table; the table itself details the reading `baseOption` and says so.
   */
  bergantung: { line: Msg; node: string; outcomes: OutcomeView[]; baseOption: Msg } | null;
}

// ---------------------------------------------------------------------------------------------
// 2. Diagram
// ---------------------------------------------------------------------------------------------

export interface ShrinkStep {
  key: string;
  label: Msg;
  amount: RupiahView;
  remaining: RupiahView;
  ruleId: RuleId | null;
}

export interface BarSegment {
  key: string;
  label: Msg;
  frac: FracView;
  /** Pattern index (hatch, dots, …): never colour alone. */
  pattern: number;
  /** Under 1/12: the UI labels it outside, with a leader line. */
  small: boolean;
  units: string | null;
  personIds: string[];
  kind: "heir" | "wasiat" | "sisa";
}

export interface BarView {
  /** What the bar divides: the harta waris, or (MA as-if illustration) the estate after debts. */
  basis: "harta_waris" | "setelah_utang";
  segments: BarSegment[];
  table: TableView | null;
  caption: Msg[];
}

export interface TreeNodeColumn {
  status: "bagian" | "terhalang" | "bukan";
  share: FracView | null;
  by: MsgList | null;
  /** Hatched (blocked): pattern + text, not colour alone. */
  hatch: boolean;
}

export interface TreeNode {
  id: string;
  /** Tree parent (null for the root and its direct relatives drawn around it). */
  parent: string | null;
  /** -2 grandparents … +3 great-grandchildren. */
  generation: number;
  side: "ayah" | "ibu" | "pusat";
  kind: "pewaris" | "kerabat" | "wafat_lebih_dulu";
  label: Msg;
  personId: string | null;
  /** In the separate "bukan ahli waris" box (adopted, step children). */
  outside: boolean;
  /** Nodes with the same key may be collapsed into one "×n" node by the UI. */
  groupKey: string;
  fikih?: TreeNodeColumn;
  court?: TreeNodeColumn;
}

export interface TreeView {
  nodes: TreeNode[];
  aria: Msg;
  /** Muted lines: "Saudara tidak ditanyakan karena ada anak laki-laki." */
  notAsked: Msg[];
}

export interface DiagramView {
  title: Msg;
  tableToggle: Msg;
  /** (a) only with rupiah. */
  shrink: { title: Msg; fikih?: ShrinkStep[]; court?: ShrinkStep[] } | null;
  /** (b) the estate bar. */
  bars: { title: Msg; fikih?: BarView; court?: BarView };
  /** (c) the family tree. */
  tree: { title: Msg } & TreeView;
}

// ---------------------------------------------------------------------------------------------
// 3. Yang tidak mendapat bagian
// ---------------------------------------------------------------------------------------------

export interface ReasonView {
  kind: "terhalang" | "bukan" | "habis";
  text: Msg;
  rule: RuleRefView;
}

/** A way that stays open to a non-heir; a wasiat wajibah figure sits under its column key. */
export interface JalanView {
  text: Msg;
  rules: RuleRefView[];
  fikih?: FracView;
  court?: FracView;
}

export interface TidakEntry {
  label: Msg;
  count: number;
  personIds: string[];
  fikih?: ReasonView;
  /** Present when the court column computed and gives another reason. */
  court?: ReasonView;
  /** Ways that stay open (non-heirs): wasiat, hadiah, the court column's wasiat wajibah. */
  jalan: JalanView[];
}

export interface TidakGroup {
  kind: "terhalang" | "bukan" | "tidak_ditanya";
  title: Msg;
  entries: TidakEntry[];
  /** `rule` is hajb.hirman when someone present made the group irrelevant; null when nothing named did. */
  notAsked: { text: Msg; rule: RuleRefView | null }[];
  /** Every group ends with the QS 4:8 line (plan §6 row 3), its card from dalil.json. */
  closing: { text: Msg; dalilId: string };
}

export interface TidakMendapatView {
  title: Msg;
  groups: TidakGroup[];
}

// ---------------------------------------------------------------------------------------------
// 4. Dalil
// ---------------------------------------------------------------------------------------------

export interface DalilRowRef {
  id: string;
  /** false → the card was shown above ("Dalil ini sudah ditampilkan di atas"). */
  first: boolean;
}

/**
 * The printout's one dalil for a row (plan §6 "Print and PDF", M2.9; report/primary.ts): a short
 * clause of the row's first Qur'an / hadith source, the matn only for a hadith. Every other source
 * of the report is printed as a citation. The screen still shows every card whole.
 */
export interface PrimaryDalilView {
  /** The dalil card the clause is cut from (one of the row's dalil ids). */
  id: string;
  /** One contiguous slice of the card's Arabic field (verified like every ArabicView). */
  arabic: ArabicView;
  /**
   * The matching words of the corpus translation the card shows (QuranEnc; Muslim's internal one),
   * as `recordString(record, slice.path).slice(slice.start, slice.end)`; null when the corpus has none.
   */
  meaning: {
    text: string;
    label: Msg;
    slice: { recordId: string; path: string; start: number; end: number };
    /** The words start / end mid-sentence (the page marks it with an ellipsis). */
    cut: { start: boolean; end: boolean };
  } | null;
  /** The slice starts after / ends before the record text (the page marks it with an ellipsis). */
  cut: { start: boolean; end: boolean };
  /** false → the same clause was printed for an earlier row ("Dalil ini sudah ditampilkan di atas"). */
  first: boolean;
}

export interface DalilRow {
  anchor: string;
  title: Msg;
  /** "Rujukan (n)". */
  countLine: Msg;
  rules: RuleRefView[];
  dalil: DalilRowRef[];
  /** The figure for the disclosure title ("Dasar bagian istri (1/8)"), per column. */
  fikih?: FracView;
  court?: FracView;
  /** Rules that only the court column used for this row. */
  courtRules: RuleRefView[];
  courtLine: Msg | null;
  /** Print only: the row's primary dalil (null: the row prints its citations only). */
  primary: PrimaryDalilView | null;
}

export interface DalilSectionView {
  title: Msg;
  rows: DalilRow[];
  /** Estate steps (harta bersama, biaya, utang, wasiat). */
  sebelum: DalilRow | null;
  /** Exclusions and non-heirs. */
  tidakMendapat: DalilRow | null;
  seeAbove: Msg;
}

// ---------------------------------------------------------------------------------------------
// 5. Catatan metode
// ---------------------------------------------------------------------------------------------

export interface DiffRow {
  label: Msg;
  personIds: string[];
  /** "setelah_utang" when either column takes a bequest first: the shares compared are then of the estate after debts. */
  basis: "harta_waris" | "setelah_utang";
  fikih: { total: FracView | null; none: Msg | null };
  court: { total: FracView | null; none: Msg | null };
  /** The switches whose flip back to the fikih value changes these heirs (engine.md §12.1). */
  switches: SwitchName[];
  because: Msg;
  rules: RuleRefView[];
}

export interface PerluItem {
  kind: "tidak_tahu" | "catatan" | "flag";
  /** Report copy; null when the RuleNote speaks for itself. */
  text: Msg | null;
  /** «Tidak tahu»: "Jawaban ini (tidak) mengubah pembagian." */
  detail: Msg | null;
  rule: RuleRefView | null;
  legal: LegalRefView[];
  /** «Tidak tahu»: does the answer change the division? */
  changes: boolean | null;
  outcomes: OutcomeView[] | null;
  columns: ColumnId[];
}

export interface CatatanView {
  title: Msg;
  assumptionsTitle: Msg;
  /** Report copy, or (text null) a RuleNote that states the assumption itself. */
  assumptions: { text: Msg | null; rule: RuleRefView | null }[];
  diff: { title: Msg; why: Msg; rows: DiffRow[] } | null;
  /** D7: "Sebagian hakim memberikan sisa juga kepada suami/istri; …" (court column). */
  raddNote: { court: { text: Msg; heir: Msg; now: FracView; alt: FracView } } | null;
  perluTitle: Msg;
  perlu: PerluItem[];
  otherTitle: Msg;
  /** Engine notes that are not soft stops, as RuleNotes with the columns that raised them. */
  other: { rule: RuleRefView; columns: ColumnId[] }[];
  /** Tashih / ikhtisar, and who received the rounding rupiah, per column. */
  table: { fikih?: Msg[]; court?: Msg[] };
  roundingRule: RuleRefView | null;
  version: Msg;
}

// ---------------------------------------------------------------------------------------------
// 6. Langkah berikutnya, 7. Penutup, refusal
// ---------------------------------------------------------------------------------------------

export interface LangkahItem {
  id:
    | "utang_wasiat"
    | "musyawarah"
    | "anak_kecil"
    | "pemberian"
    | "bukti"
    | "sawah"
    | "tanah_mui"
    | "sengketa"
    | "tanya"
    | "munasakhat";
  text: Msg;
  rules: RuleRefView[];
  dalilIds: string[];
  legal: LegalRefView[];
  /** "Hitung untuk beliau ›" starts a fresh questionnaire. */
  action: { kind: "hitung_untuk_beliau"; label: Msg } | null;
  /** Nested under the previous numbered item (the fixed minor-heir line, the MUI land line). */
  sub: boolean;
}

export interface LangkahView {
  title: Msg;
  items: LangkahItem[];
}

export interface PenutupView {
  lines: Msg[];
  label: Msg;
}

export interface RujukView {
  title: Msg;
  lead: Msg;
  reasons: RefusalView[];
  whereToAsk: Msg;
  /** E-BUNUH class: no answer printout (plan §5.4, §9.4). */
  noPrintLine: Msg | null;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export interface ReportModel {
  schema: "waris-laporan/1";
  kind: "laporan" | "rujuk";
  /** false for the E-BUNUH class: no print, no text summary, no link (plan §9.4). */
  printAllowed: boolean;
  shareAllowed: boolean;
  kepala: KepalaView;
  ringkasan: RingkasanView | null;
  diagram: DiagramView | null;
  tidakMendapat: TidakMendapatView | null;
  dalil: DalilSectionView | null;
  catatan: CatatanView | null;
  langkah: LangkahView | null;
  penutup: PenutupView;
  rujuk: RujukView | null;
  /** Every dalil card the report references, by first use. */
  dalilCards: DalilCard[];
  /** Records a RuleNote cites that the report never shows (plan D10), for audit. */
  hiddenDalil: { id: string; reason: string }[];
}

