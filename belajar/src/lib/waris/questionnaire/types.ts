/**
 * Questionnaire model types ("Hitung waris keluarga saya", plan §5; architecture.md §6.3).
 *
 * The answers are the ONLY state. The path, the cursor's default, the family and the outcome are
 * derived from them, never stored. The killer answer (A3 k6) has no representation here at all:
 * A3Answer cannot hold it, the reducer refuses it, and the codec cannot encode it (plan §5.6, §9.4).
 * Pure TypeScript, no React, no I/O. AI-assisted, not an authoritative fatwa.
 */
import type { HeirId, RuleId, RujukReason } from "../registry";
import type { Result, WarisInput } from "../types";

/** The one "Tidak tahu" value, for every node kind that allows it (plan §5.7 table, D15). */
export const TIDAK_TAHU = "tidak_tahu" as const;
export type TidakTahu = typeof TIDAK_TAHU;

/** Two steppers on one screen that count the same thing split by sex (ux.md §4.1 item 1). */
export interface LP {
  readonly L: number;
  readonly P: number;
}

/**
 * A stored answer:
 *  - "pilih" / "peran": the option id (string);
 *  - "pilih_banyak": the selected option ids ([] = "Tidak ada");
 *  - "jumlah": a whole number;
 *  - "jumlah_lp": { L, P };
 *  - any node that allows it: the string "tidak_tahu".
 */
export type AnswerValue = string | readonly string[] | number | LP;

/** Answers keyed by QKey ("A1", "C4s.2", …). Unknown keys and stale answers are ignored. */
export type Answers = Readonly<Record<string, AnswerValue>>;

export const NODE_IDS = [
  "A1",
  "A1s",
  "A2",
  "A3",
  "A3a",
  "A3b",
  "A3b2",
  "A3b3",
  "A3b4",
  "A3c",
  "A3d",
  "A3e",
  "B1",
  "B2",
  "B3",
  "B1b",
  "C1",
  "C1m",
  /** Added by this model: grandchildren through a LIVING child who is not Muslim (that child does not block them). */
  "C1n",
  "C1p",
  "C3",
  "C4s",
  "C4r",
  "C4g",
  "C4gm",
  "C4b",
  "C4m",
  "D1",
  "D1m",
  "D3",
  "D3m",
  "E1",
  "E1m",
  "E2",
  "E2m",
  "E3",
  "E3m",
  "F1",
  "F1n",
  "F2",
  "F2n",
  "F3",
  "F3n",
  "F5",
  "F4",
  "G1",
  "G2",
  "G3",
  "G3w",
  "G4",
] as const;
export type NodeId = (typeof NODE_IDS)[number];

/** Nodes repeated once per predeceased child (C3 → C4 loop, plan §5.7 "C4 → three screens"). */
export const LOOP_NODES = ["C4s", "C4r", "C4g", "C4gm", "C4b", "C4m"] as const satisfies readonly NodeId[];
export type LoopNodeId = (typeof LOOP_NODES)[number];

/** "A1", or "C4s.2" for the second predeceased child. */
export type QKey = string;

export type NodeKind = "pilih" | "pilih_banyak" | "jumlah" | "jumlah_lp" | "peran";

/** Named progress sections, shown without a total (plan §5.1, §5.7 "Progress"). */
export const SECTIONS = ["pewaris", "pasangan", "anak", "orang_tua", "saudara", "kerabat", "wasiat"] as const;
export type SectionId = (typeof SECTIONS)[number];

/** Who the questionnaire is about (A1): a deceased Muslim, or a planning simulation. */
export type Mode = "wafat" | "diri" | "keluarga";

/** A3a relationship groups that had someone of another religion at the death. */
export const REL_GROUPS = ["pasangan", "anak", "cucu", "orang_tua", "kakek_nenek", "saudara", "kerabat"] as const;
export type RelGroup = (typeof REL_GROUPS)[number];

/** A3c / A3d / A3e role picker ("siapa?") for k3 hilang, k4 dalam kandungan, k5 wafat bersamaan. */
export const ROLE_GROUPS = ["pasangan", "anak", "cucu", "ayah", "ibu", "kakek", "nenek", "saudara", "kerabat"] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

export const EXIT_IDS = [
  "E-HIDUP",
  "E-NONMUSLIM",
  "E-BUNUH",
  "E-KHUNTSA",
  "E-MAFQUD",
  "E-HAML",
  "E-BERSAMAAN",
  "E-KERABAT-JAUH",
  "E-DZAWIL",
  "E-TANPA-AHLI-WARIS",
  "E-UTANG",
  /** Added by this model: a «Tidak tahu» that makes the outcome uncertain (plan D15 "konsultasikan"). */
  "E-TIDAK-TAHU",
  /** Added by this model: any other engine refusal in both columns (e.g. wala'). */
  "E-RUJUK",
] as const;
export type ExitId = (typeof EXIT_IDS)[number];

/** Where an exit was reached: a node, the end of the family questions, or the report. */
export type ExitAt = QKey | "keluarga" | "laporan";

export interface ExitHit {
  id: ExitId;
  at: ExitAt;
  /** Engine refusal reasons per column (absent for questionnaire-level exits). */
  reasons?: { fikih: RujukReason[]; pengadilan: RujukReason[] };
  /** E-TIDAK-TAHU: the «Tidak tahu» answers that change the outcome. */
  nodes?: QKey[];
  /** E-MAFQUD / E-HAML / E-BERSAMAAN: the role groups that could change a number. */
  roles?: RoleGroup[];
}

/** UI cursor: a node being edited, the review screen, or null (= follow the derived path). */
export type Cursor = QKey | "ringkasan" | null;

export interface QState {
  readonly v: 1;
  readonly answers: Answers;
  readonly at: Cursor;
}

export type Action =
  /** Answer the node at `key` (the current node, or any node already on the path). */
  | { type: "jawab"; key: QKey; value: AnswerValue }
  /** Go one step back along the derived path. */
  | { type: "kembali" }
  /** Jump to a node already on the path ("Ubah" on the review screen or the tree). */
  | { type: "ubah"; key: QKey }
  /** E-HIDUP: "Lanjutkan sebagai simulasi: jika saya wafat hari ini". */
  | { type: "lanjut_simulasi" }
  /** Show the review screen (only when the path is complete). */
  | { type: "ringkasan" }
  /** Start over. */
  | { type: "ulang" }
  /** Load answers (sessionStorage, "Simpan di perangkat ini", or a #j= link). Invalid keys are dropped. */
  | { type: "muat"; answers: Answers };

/**
 * The optional "Hitung dalam rupiah" panel (plan D5; ux.md §4.3 R1–R6). Lives outside QState;
 * the codec writes it only when "Sertakan nilai rupiah" is ticked (plan D9, §5.7 "Text summary").
 */
export interface Amounts {
  /** R1: harta bersama (one pool; with several wives it is referred to the court, D18). */
  hartaBersama?: bigint;
  /** D6 toggle "semua harta ini milik almarhum": the pool is not split. */
  semuaMilikAlmarhum?: boolean;
  /** R2: the deceased's own property. */
  hartaBawaan?: bigint;
  biayaSakit?: bigint;
  /** R3. */
  biayaJenazah?: bigint;
  /** R4. */
  utang?: bigint;
  /** R5: value of the wasiat to others when G3 is "nilai tertentu" or "lebih dari sepertiga". */
  wasiatLain?: bigint;
  /** R5: value of the wasiat to an heir when G3w is "nilai tertentu" or "lebih dari sepertiga". */
  wasiatWaris?: bigint;
}

/** Questionnaire-level notes (no engine rule id; reviewed copy lives in Q_TEXT "catatan.*"). */
export const Q_NOTES = [
  "simulasi",
  "iddah",
  "nikah_siri",
  "anak_tiri",
  "wasiat_tidak_diketahui",
  "wasiat_perlu_nilai",
  "hilang_tanpa_pengaruh",
  "kandungan_tanpa_pengaruh",
  "bersamaan_tanpa_pengaruh",
  "pasangan_terdahulu",
  "pasangan_terdahulu_tidak_tahu",
  /** B1 "pernah": «Tidak tahu» whether harta bersama of the earlier marriage is still undivided. */
  "harta_bersama_terdahulu_tidak_tahu",
] as const;
export type QNote = (typeof Q_NOTES)[number];

// ---------------------------------------------------------------------------------------------
// Report hand-off (structurally equal to report/options.ts NotAskedInput / UnknownInput /
// ReportFlags, so the report page passes these straight to buildReport()).
// ---------------------------------------------------------------------------------------------

export type NotAskedGroup =
  | "saudara"
  | "saudara_kandung"
  | "saudara_seayah"
  | "saudara_seibu"
  | "keponakan"
  | "paman"
  | "sepupu"
  | "kakek"
  | "nenek"
  | "cucu"
  | "kerabat_lain";

export interface NotAsked {
  group: NotAskedGroup;
  /** Role ids (or "pengganti" for a KHI-185 substitute) whose presence made the group irrelevant. */
  because: string[];
}

export type UnknownSubject =
  | HeirId
  | "pasangan"
  | "anak"
  | "cucu"
  | "orang_tua"
  | "kakek_nenek"
  | "saudara"
  | "kerabat_lain"
  | "agama"
  | "wasiat"
  | "persetujuan_wasiat";

export type UnknownOption =
  | "ada"
  | "tidak_ada"
  | "satu"
  | "dua_atau_lebih"
  | "muslim"
  | "bukan_muslim"
  | "setuju"
  | "belum_setuju"
  | "mewarisi"
  | "tidak_mewarisi";

/** The answer that opened the readings: «Tidak tahu», B1 "iddah", or G4 "Belum dibicarakan". */
export type UnknownAnswer = "tidak_tahu" | "iddah" | "belum_dibicarakan";

/** How the report names the person the questionnaire is about (messageVars "pewaris"). */
export type PewarisKind = "almarhum" | "almarhumah" | "anda" | "beliau";

export interface UnknownVariant {
  option: UnknownOption;
  input: WarisInput;
  base?: boolean;
}

export interface UnknownReading {
  node: QKey;
  subject: UnknownSubject;
  answer: UnknownAnswer;
  variants: UnknownVariant[];
}

export interface ReportFlags {
  iddahRaji?: boolean;
  nikahSiri?: boolean;
  munasakhat?: boolean;
  wasiatTidakTahu?: boolean;
}

/** One report column after the v1 policies (plan D4: dzawil arham refuse in the fikih column). */
export interface ColumnOutcome {
  ruleset: "klasik-syafii" | "standar-indonesia";
  /** The engine result; a policy refusal is a synthesized Rujuk (no numbers, plan M2.8). */
  result: Result;
  refused: boolean;
  /** Set when the refusal comes from a v1 policy rather than the engine itself. */
  policy?: "dzawil_v1";
}

export interface ReportOutcome {
  fikih: ColumnOutcome;
  pengadilan: ColumnOutcome;
  /** The engine input both columns were solved from. */
  input: WarisInput;
  /** Some share differs between the columns (the court column is then shown beside it). */
  berbeda: boolean;
}

export interface ReportRequest {
  input: WarisInput;
  options: {
    mode: "wafat" | "simulasi";
    pewaris: PewarisKind;
    answerCode: string;
    notAsked: NotAsked[];
    unknowns: UnknownReading[];
    flags: ReportFlags;
  };
}

export type Evaluation =
  | { kind: "belum_selesai"; next: QKey }
  | { kind: "keluar"; exit: ExitHit }
  | {
      kind: "laporan";
      mode: Mode;
      /** The outcome for the answers as given (the first reading of every «Tidak tahu»). */
      utama: ReportOutcome;
      /** Exactly one «Tidak tahu» changes the division: its readings, each exact (plan D15). */
      perluDipastikan: { key: QKey; subject: UnknownSubject; alternatives: { option: UnknownOption; outcome: ReportOutcome }[] } | null;
      /** «Tidak tahu» answers that do not change the division. */
      tidakBerpengaruh: QKey[];
      notes: QNote[];
      /** Ready for report/build.ts buildReport(input, rules, dalil, options). */
      request: ReportRequest;
    };

/** "Kenapa kami tanyakan ini?" — a text key plus the RuleNotes it links to (D10: no bare QS/HR). */
export interface WhyRef {
  text: string;
  rules: readonly RuleId[];
}
