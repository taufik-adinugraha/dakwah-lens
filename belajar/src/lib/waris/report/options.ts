/**
 * What the questionnaire passes to buildReport() besides the engine input (plan §5, §6).
 * The killer answer (A3 k6) has no field here: it routes to E-BUNUH and is never serialised
 * (plan §5.6, §9.4).
 */
import type { HeirId } from "../registry";
import type { Result, WarisInput } from "../types";

/** Relationship groups the questionnaire may leave unasked (plan §5.1 "Skips are visible"). */
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

export interface NotAskedInput {
  group: NotAskedGroup;
  /** Role ids present in the family that made the group irrelevant (couldAffectOutcome = false). */
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

/**
 * Which answer opened the readings: «Tidak tahu», B1 "dalam masa iddah talak raj'i" (does that
 * spouse inherit?) or G4 "Belum dibicarakan" (the heirs' consent). The report words each its own
 * way, never as a «Tidak tahu» the user did not give (plan §5.7).
 */
export type UnknownAnswer = "tidak_tahu" | "iddah" | "belum_dibicarakan";

/** A «Tidak tahu» answer that could add or remove an heir (plan D15): the inputs it could mean. */
export interface UnknownInput {
  /** Questionnaire node id (e.g. "E1"); echoed in the model, never shown. */
  node: string;
  subject: UnknownSubject;
  /** Default "tidak_tahu". */
  answer?: UnknownAnswer;
  /** Every reading of the answer; the one buildReport() was called with is marked `base`. */
  variants: { option: UnknownOption; input: WarisInput; base?: boolean }[];
}

/** Questionnaire facts that only add notes (plan §5.7). */
export interface ReportFlags {
  /** B1 "Bercerai, almarhum wafat dalam masa iddah talak raj'i" (soft stop). */
  iddahRaji?: boolean;
  /** A3 k9: a marriage that was not registered (itsbat note for the court column). */
  nikahSiri?: boolean;
  /** An heir died after the deceased: "Hitung untuk beliau ›" (plan §6 row 6 item 8). */
  munasakhat?: boolean;
  /** G1 / G3 «Tidak tahu»: shares shown without a wasiat, with the ⅓ note. */
  wasiatTidakTahu?: boolean;
}

/** Who the report is about (questionnaire messageVars): the deceased, the user (a plan), or a living relative. */
export type PewarisKind = "almarhum" | "almarhumah" | "anda" | "beliau";

export interface ReportOptions {
  /** "simulasi" for the planning paths (A1 option 2, E-HIDUP): title "Simulasi Pembagian Waris". */
  mode?: "wafat" | "simulasi";
  /** How the copy names the person (default: by mode and the deceased's sex; "beliau" in a simulation). */
  pewaris?: PewarisKind;
  /** ISO date "YYYY-MM-DD" captured in the click / print handler (never read during render). */
  date?: string;
  /** Overrides the computed answer code (e.g. the questionnaire codec's own). */
  answerCode?: string;
  /** Engine version label for Catatan metode (default ENGINE_VERSION_DEFAULT). */
  engineVersion?: string;
  /** Show rupiah when the engine computed it (the rupiah panel was filled). Default true. */
  showRupiah?: boolean;
  notAsked?: NotAskedInput[];
  unknowns?: UnknownInput[];
  flags?: ReportFlags;
  /** Results already solved for this input (else solved here). */
  results?: { fikih?: Result; court?: Result };
}

export const REPORT_SCHEMA = "waris-laporan/1" as const;
export const ENGINE_VERSION_DEFAULT = "M1";
