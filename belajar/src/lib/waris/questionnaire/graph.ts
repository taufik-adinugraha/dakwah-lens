/**
 * The question graph as DATA (plan §5.1 "Questions are data"; §5.2 tree; §5.7 node changes;
 * ux.md §4.3). This file holds only the static catalog: node ids in priority order, the codec
 * code of each node (append-only), the answer kind, the full option catalog, "Tidak tahu"
 * permission (§5.7 table), the section, and the RuleNotes behind "Kenapa kami tanyakan ini?".
 *
 * WHICH node is asked, and which options it offers, is decided in machine.ts from the engine:
 * couldAffectOutcome()/couldInherit() for relatives, and solve() probes for beyond-depth
 * relatives, dzawil arham and the residue. No skip list is written here (plan §5.3: "The skip
 * table is documentation; the code derives every skip from couldAffectOutcome").
 */
import { HEIRS, type RuleId } from "../registry";
import { REL_GROUPS, ROLE_GROUPS, type ExitId, type NodeId, type NodeKind, type SectionId } from "./types";

export interface NodeDef {
  id: NodeId;
  /** Codec code (codec.ts). Append-only: never renumber, never reuse. */
  code: number;
  section: SectionId;
  kind: NodeKind;
  /** Repeated per predeceased child (QKey "C4s.<i>"). */
  loop: boolean;
  /** The full option catalog in codec order (append-only). Dynamic subsets: machine.optionsFor(). */
  options: readonly string[];
  /** Options that exclude all others in a multi-select ("Tidak ada" is the empty selection). */
  min: number;
  max: number;
  /** "Tidak tahu" allowed (plan §5.7 table). */
  unknown: boolean;
  /** Counted as an answered screen for path length (plan §5.5). A1s is the E-HIDUP page itself. */
  screen: boolean;
  /** RuleNotes shown under "Kenapa kami tanyakan ini?" (never a bare QS/HR string, plan D10). */
  why: readonly RuleId[];
}

const YT = ["ya", "tidak"] as const;
const LP_MAX = 20;

const n = (
  id: NodeId,
  code: number,
  section: SectionId,
  kind: NodeKind,
  options: readonly string[],
  unknown: boolean,
  why: readonly RuleId[],
  extra: Partial<Pick<NodeDef, "min" | "max" | "loop" | "screen">> = {},
): NodeDef => ({
  id,
  code,
  section,
  kind,
  options,
  unknown,
  why,
  loop: extra.loop ?? false,
  min: extra.min ?? 0,
  max: extra.max ?? LP_MAX,
  screen: extra.screen ?? true,
});

/** Node catalog in PRIORITY ORDER (the walk visits them in this order; the C4 block repeats). */
export const NODES: readonly NodeDef[] = [
  // A. Pewaris ------------------------------------------------------------------------------
  n("A1", 1, "pewaris", "pilih", ["wafat_muslim", "saya_hidup", "simulasi_keluarga", "wafat_nonmuslim"], false, ["rujuk.beda_agama_pewaris"]),
  n("A1s", 2, "pewaris", "pilih", ["ya"], false, ["estate.wasiat"], { screen: false }),
  n("A2", 3, "pewaris", "pilih", ["L", "P"], false, ["fardh.suami_1_2", "fardh.istri_1_4"]),
  n("A3", 4, "pewaris", "pilih_banyak", ["k1", "k2", "k3", "k4", "k5", "k7", "k8", "k9"], false, []),
  n("A3a", 5, "pewaris", "pilih_banyak", REL_GROUPS, true, ["mani.beda_agama"]),
  n("A3b", 6, "pewaris", "jumlah_lp", [], false, ["mani.anak_angkat", "khi.ww_anak_angkat"], { max: 10 }),
  n("A3b2", 7, "pewaris", "pilih", ["ya", "tidak", "sebagian"], false, ["mani.anak_angkat", "catatan.anak_angkat_tanpa_penetapan"]),
  n("A3b3", 8, "pewaris", "jumlah_lp", [], false, ["catatan.anak_angkat_tanpa_penetapan"], { max: 10 }),
  n("A3b4", 9, "pewaris", "pilih", YT, true, ["catatan.ww_anak_angkat_sudah_menerima_wasiat"]),
  n("A3c", 10, "pewaris", "pilih_banyak", ROLE_GROUPS, false, ["rujuk.mafqud"]),
  n("A3d", 11, "pewaris", "pilih_banyak", ["anak", "cucu", "saudara", "kerabat"], false, ["rujuk.haml"]),
  n("A3e", 12, "pewaris", "pilih_banyak", ROLE_GROUPS, false, ["rujuk.gharqa"]),
  // B. Pasangan -----------------------------------------------------------------------------
  n("B1", 13, "pasangan", "pilih", ["ya_satu", "ya_lebih", "iddah", "pernah", "belum"], true, ["fardh.istri_1_4", "fardh.suami_1_2"]),
  n("B2", 14, "pasangan", "jumlah", [], false, ["fardh.istri_1_4", "fardh.istri_1_8"], { min: 2, max: 4 }),
  n("B3", 15, "pasangan", "jumlah", [], true, ["mani.beda_agama"], { max: 4 }),
  n("B1b", 16, "pasangan", "pilih", YT, true, ["estate.harta_bersama", "catatan.harta_bersama_rumit"]),
  // C. Anak ---------------------------------------------------------------------------------
  n("C1", 17, "anak", "jumlah_lp", [], true, ["fardh.anak_pr_1_2", "asabah.bil_ghair"]),
  n("C1m", 18, "anak", "jumlah_lp", [], true, ["mani.beda_agama"]),
  // a living child who is not Muslim does not block their own children (eligibility before hajb)
  n("C1n", 49, "anak", "jumlah_lp", [], true, ["mani.beda_agama", "fardh.cucu_pr_1_2"]),
  n("C1p", 50, "anak", "jumlah_lp", [], true, ["mani.beda_agama", "rujuk.dzawil_arham"]),
  n("C3", 19, "anak", "pilih", YT, true, ["khi.pengganti"]),
  n("C4s", 20, "anak", "pilih", ["L", "P"], false, ["khi.pengganti"], { loop: true }),
  n("C4r", 21, "anak", "pilih", YT, true, ["mani.beda_agama", "khi.pengganti"], { loop: true }),
  n("C4g", 22, "anak", "jumlah_lp", [], true, ["khi.pengganti", "fardh.cucu_pr_1_2"], { loop: true }),
  n("C4gm", 23, "anak", "jumlah_lp", [], true, ["mani.beda_agama"], { loop: true }),
  n("C4b", 24, "anak", "pilih_banyak", ["keturunan_jauh", "anak_cucu_perempuan", "cicit_dari_cucu_hidup"], true, ["rujuk.kerabat_jauh"], { loop: true }),
  n("C4m", 25, "anak", "pilih", YT, true, ["khi.pengganti"], { loop: true }),
  // D. Orang tua ----------------------------------------------------------------------------
  n("D1", 26, "orang_tua", "pilih", ["keduanya", "ayah", "ibu", "tidak_ada"], true, ["fardh.ayah_1_6", "fardh.ibu_1_3"]),
  n("D1m", 27, "orang_tua", "pilih", ["keduanya", "ayah", "ibu", "tidak_ada"], true, ["mani.beda_agama"]),
  n("D3", 28, "orang_tua", "pilih_banyak", ["kakek", "nenek_ibu", "nenek_ayah"], true, ["fardh.kakek_1_6", "fardh.nenek_1_6", "hajb.hirman"]),
  n("D3m", 29, "orang_tua", "pilih_banyak", ["kakek", "nenek_ibu", "nenek_ayah"], true, ["mani.beda_agama"]),
  // E. Saudara ------------------------------------------------------------------------------
  n("E1", 30, "saudara", "jumlah_lp", [], true, ["fardh.sdr_pr_1_2", "hajb.hirman", "nuqshan.ibu"]),
  n("E1m", 31, "saudara", "jumlah_lp", [], true, ["mani.beda_agama"]),
  n("E2", 32, "saudara", "jumlah_lp", [], true, ["fardh.sdr_pr_seayah_1_6_takmilah", "hajb.hirman", "jadd.muaddah"]),
  n("E2m", 33, "saudara", "jumlah_lp", [], true, ["mani.beda_agama"]),
  n("E3", 34, "saudara", "jumlah_lp", [], true, ["fardh.seibu_1_6", "fardh.seibu_1_3", "nuqshan.ibu"]),
  n("E3m", 35, "saudara", "jumlah_lp", [], true, ["mani.beda_agama"]),
  // F. Kerabat ------------------------------------------------------------------------------
  // F5 before F1–F3: see machine.ts POST_LOOP (the engine reads nearer agnates for the depth check)
  n("F5", 42, "kerabat", "pilih_banyak", ["keturunan_saudara", "keturunan_paman", "kerabat_ayah"], true, ["rujuk.kerabat_jauh"]),
  n("F1", 36, "kerabat", "pilih", ["kandung", "seayah", "tidak"], true, ["asabah.bin_nafs"]),
  n("F1n", 37, "kerabat", "jumlah", [], true, ["asabah.bin_nafs"], { min: 1 }),
  n("F2", 38, "kerabat", "pilih", ["kandung", "seayah", "tidak"], true, ["asabah.bin_nafs"]),
  n("F2n", 39, "kerabat", "jumlah", [], true, ["asabah.bin_nafs"], { min: 1 }),
  n("F3", 40, "kerabat", "pilih", ["dari_kandung", "dari_seayah", "tidak"], true, ["asabah.bin_nafs"]),
  n("F3n", 41, "kerabat", "jumlah", [], true, ["asabah.bin_nafs"], { min: 1 }),
  n("F4", 43, "kerabat", "pilih", YT, true, ["rujuk.dzawil_arham", "rujuk.tanpa_ahli_waris"]),
  // G. Wasiat -------------------------------------------------------------------------------
  n("G1", 44, "wasiat", "pilih_banyak", ["lain", "waris"], true, ["estate.wasiat"]),
  // G2's catalog is the registry's HEIRS (codec order); the picker offers the heirs with a share
  n("G2", 45, "wasiat", "peran", HEIRS, false, ["estate.wasiat_ahli_waris_tanpa_persetujuan"]),
  n("G3", 46, "wasiat", "pilih", ["sepertiga", "seperempat", "lebih_sepertiga", "nilai_tertentu"], true, ["estate.wasiat_dibatasi_sepertiga"]),
  n("G3w", 47, "wasiat", "pilih", ["sepertiga", "seperempat", "lebih_sepertiga", "nilai_tertentu"], true, ["estate.wasiat_ahli_waris_tanpa_persetujuan"]),
  // "belum" (belum dibicarakan) is this node's «Tidak tahu»: both outcomes are shown (§5.7).
  n("G4", 48, "wasiat", "pilih", ["setuju", "tidak_setuju", "belum"], false, ["estate.wasiat_ahli_waris_tanpa_persetujuan", "estate.wasiat_dibatasi_sepertiga"]),
];

export const NODE: Readonly<Record<NodeId, NodeDef>> = Object.fromEntries(NODES.map((d) => [d.id, d])) as Record<NodeId, NodeDef>;

/** The C4 loop is bounded (termination, plan M2.2): at most this many predeceased children. */
export const MAX_ANAK_WAFAT = 6;

/**
 * A3 options as the UI shows them, in screen order. "k0" ("Tidak ada satu pun") is the empty
 * selection. "k6" (a family member caused the death) is offered on screen but is NOT an answer:
 * a3Route() sends it to E-BUNUH and nothing about it reaches QState (plan §5.6, §9.4).
 */
export const A3_UI_OPTIONS = ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"] as const;
export type A3UiOption = (typeof A3_UI_OPTIONS)[number];
export const KILLER_OPTION = "k6" as const;

// ---------------------------------------------------------------------------------------------
// Exits ("Konsultasikan", plan §5.4; ux.md §4.5)
// ---------------------------------------------------------------------------------------------

export interface ExitDef {
  id: ExitId;
  /** RuleNotes for "the rule, with its dalil where we have one" (plan §5.4 item 3). */
  rules: readonly RuleId[];
  /** "Cetak ringkasan jawaban Anda" offered. Never on E-BUNUH (plan §5.4 item 5, §9.4). */
  print: boolean;
  /** E-HIDUP offers "Lanjutkan sebagai simulasi" (action lanjut_simulasi). */
  lanjutSimulasi: boolean;
}

export const EXITS: Readonly<Record<ExitId, ExitDef>> = {
  "E-HIDUP": {
    id: "E-HIDUP",
    rules: ["catatan.hibah_dapat_diperhitungkan", "estate.wasiat", "estate.wasiat_dibatasi_sepertiga", "estate.wasiat_ahli_waris_tanpa_persetujuan"],
    print: true,
    lanjutSimulasi: true,
  },
  "E-NONMUSLIM": { id: "E-NONMUSLIM", rules: ["rujuk.beda_agama_pewaris", "mani.beda_agama"], print: true, lanjutSimulasi: false },
  "E-BUNUH": { id: "E-BUNUH", rules: ["mani.pembunuh", "rujuk.dugaan_pembunuhan"], print: false, lanjutSimulasi: false },
  "E-KHUNTSA": { id: "E-KHUNTSA", rules: ["rujuk.khuntsa"], print: true, lanjutSimulasi: false },
  "E-MAFQUD": { id: "E-MAFQUD", rules: ["rujuk.mafqud"], print: true, lanjutSimulasi: false },
  "E-HAML": { id: "E-HAML", rules: ["rujuk.haml"], print: true, lanjutSimulasi: false },
  "E-BERSAMAAN": { id: "E-BERSAMAAN", rules: ["rujuk.gharqa"], print: true, lanjutSimulasi: false },
  "E-KERABAT-JAUH": { id: "E-KERABAT-JAUH", rules: ["rujuk.kerabat_jauh"], print: true, lanjutSimulasi: false },
  "E-DZAWIL": { id: "E-DZAWIL", rules: ["rujuk.dzawil_arham", "dzawil_arham.tanzil"], print: true, lanjutSimulasi: false },
  "E-TANPA-AHLI-WARIS": { id: "E-TANPA-AHLI-WARIS", rules: ["rujuk.tanpa_ahli_waris", "baitul_mal"], print: true, lanjutSimulasi: false },
  "E-UTANG": { id: "E-UTANG", rules: ["rujuk.utang_melebihi_harta", "estate.utang"], print: true, lanjutSimulasi: false },
  "E-TIDAK-TAHU": { id: "E-TIDAK-TAHU", rules: [], print: true, lanjutSimulasi: false },
  "E-RUJUK": { id: "E-RUJUK", rules: [], print: true, lanjutSimulasi: false },
};
