/**
 * Waris engine registry: heir ids, dzawil-arham ids, rule ids (with metadata), refusal reasons,
 * notes, switches and rulesets. Ids only; no calculation logic lives here.
 *
 * This file is the SINGLE SOURCE of rule ids (plan §9.2: "Heir and rule ids come from the engine
 * registry"). The RuleNote author keys one reviewed note per id in RULES. Ids are stable strings;
 * new ones are only ever added (engine.md §15).
 *
 * Spec: docs/waris-research/engine.md as amended by docs/waris-plan.md §7 (switch table §7.2 is
 * authoritative for ruleset values). AI-assisted, not an authoritative fatwa.
 */

// ---------------------------------------------------------------------------------------------
// Heirs (engine.md §5.1). Order = registry order, used for deterministic tie-breaks (§14).
// ---------------------------------------------------------------------------------------------

export const HEIRS = [
  "anak_lk",
  "cucu_lk",
  "ayah",
  "kakek",
  "sdr_lk_kandung",
  "sdr_lk_seayah",
  "sdr_lk_seibu",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
  "suami",
  "mutiq",
  "anak_pr",
  "cucu_pr",
  "ibu",
  "nenek_ibu",
  "nenek_ayah",
  "sdr_pr_kandung",
  "sdr_pr_seayah",
  "sdr_pr_seibu",
  "istri",
  "mutiqah",
] as const;
export type HeirId = (typeof HEIRS)[number];

/** Short Indonesian labels (debug / report fallback; reviewed UI copy lives in messages/waris). */
export const HEIR_LABEL: Record<HeirId, string> = {
  anak_lk: "anak laki-laki",
  cucu_lk: "cucu laki-laki (dari anak laki-laki)",
  ayah: "ayah",
  kakek: "kakek (ayah dari ayah)",
  sdr_lk_kandung: "saudara laki-laki kandung",
  sdr_lk_seayah: "saudara laki-laki seayah",
  sdr_lk_seibu: "saudara laki-laki seibu",
  keponakan_lk_kandung: "anak laki-laki saudara laki-laki kandung",
  keponakan_lk_seayah: "anak laki-laki saudara laki-laki seayah",
  paman_kandung: "paman kandung (saudara kandung ayah)",
  paman_seayah: "paman seayah (saudara seayah ayah)",
  sepupu_lk_kandung: "anak laki-laki paman kandung",
  sepupu_lk_seayah: "anak laki-laki paman seayah",
  suami: "suami",
  mutiq: "mu'tiq (di luar cakupan)",
  anak_pr: "anak perempuan",
  cucu_pr: "cucu perempuan (dari anak laki-laki)",
  ibu: "ibu",
  nenek_ibu: "nenek (ibu dari ibu)",
  nenek_ayah: "nenek (ibu dari ayah)",
  sdr_pr_kandung: "saudara perempuan kandung",
  sdr_pr_seayah: "saudara perempuan seayah",
  sdr_pr_seibu: "saudara perempuan seibu",
  istri: "istri",
  mutiqah: "mu'tiqah (di luar cakupan)",
};

export type Sex = "L" | "P";

export const HEIR_SEX: Record<HeirId, Sex> = {
  anak_lk: "L",
  cucu_lk: "L",
  ayah: "L",
  kakek: "L",
  sdr_lk_kandung: "L",
  sdr_lk_seayah: "L",
  sdr_lk_seibu: "L",
  keponakan_lk_kandung: "L",
  keponakan_lk_seayah: "L",
  paman_kandung: "L",
  paman_seayah: "L",
  sepupu_lk_kandung: "L",
  sepupu_lk_seayah: "L",
  suami: "L",
  mutiq: "L",
  anak_pr: "P",
  cucu_pr: "P",
  ibu: "P",
  nenek_ibu: "P",
  nenek_ayah: "P",
  sdr_pr_kandung: "P",
  sdr_pr_seayah: "P",
  sdr_pr_seibu: "P",
  istri: "P",
  mutiqah: "P",
};

export const SIBLING_HEIRS = [
  "sdr_lk_kandung",
  "sdr_pr_kandung",
  "sdr_lk_seayah",
  "sdr_pr_seayah",
  "sdr_lk_seibu",
  "sdr_pr_seibu",
] as const satisfies readonly HeirId[];

export const DESCENDANT_HEIRS = ["anak_lk", "anak_pr", "cucu_lk", "cucu_pr"] as const satisfies readonly HeirId[];

/** Never excluded by hajb hirman (Fath al-Qarib § 116). */
export const NEVER_EXCLUDED = ["anak_lk", "anak_pr", "ayah", "ibu", "suami", "istri"] as const satisfies readonly HeirId[];

// ---------------------------------------------------------------------------------------------
// Dzawil arham supported by the tanzil subset (engine.md §5.1, §10). `wasith` = the heir position
// the relative stands in. Ids follow test-vectors.json (sex-specific where the vectors use it).
// ---------------------------------------------------------------------------------------------

export const DZAWIL = {
  cucu_lk_dari_anak_pr: { wasith: "anak_pr", sex: "L" },
  cucu_pr_dari_anak_pr: { wasith: "anak_pr", sex: "P" },
  anak_lk_dari_cucu_pr: { wasith: "cucu_pr", sex: "L" },
  anak_pr_dari_cucu_pr: { wasith: "cucu_pr", sex: "P" },
  anak_lk_sdr_pr_kandung: { wasith: "sdr_pr_kandung", sex: "L" },
  anak_pr_sdr_pr_kandung: { wasith: "sdr_pr_kandung", sex: "P" },
  anak_lk_sdr_pr_seayah: { wasith: "sdr_pr_seayah", sex: "L" },
  anak_pr_sdr_pr_seayah: { wasith: "sdr_pr_seayah", sex: "P" },
  anak_pr_sdr_lk_kandung: { wasith: "sdr_lk_kandung", sex: "P" },
  anak_pr_sdr_lk_seayah: { wasith: "sdr_lk_seayah", sex: "P" },
  anak_sdr_seibu: { wasith: "sdr_lk_seibu", sex: null },
  kakek_dari_ibu: { wasith: "ibu", sex: "L" },
  paman_ibu: { wasith: "ibu", sex: "L" },
  bibi_ibu: { wasith: "ibu", sex: "P" },
  paman_seibu_ayah: { wasith: "ayah", sex: "L" },
  bibi_ayah: { wasith: "ayah", sex: "P" },
  anak_pr_paman_kandung: { wasith: "paman_kandung", sex: "P" },
  anak_pr_paman_seayah: { wasith: "paman_seayah", sex: "P" },
} as const satisfies Record<string, { wasith: HeirId; sex: Sex | null }>;
export type DzawilId = keyof typeof DZAWIL;
export const DZAWIL_IDS = Object.keys(DZAWIL) as DzawilId[];

export function isHeirId(x: string): x is HeirId {
  return (HEIRS as readonly string[]).includes(x);
}
export function isDzawilId(x: string): x is DzawilId {
  return Object.prototype.hasOwnProperty.call(DZAWIL, x);
}

/** Pseudo-role for a relative beyond the depth limit (engine.md §2) who is excluded anyway. */
export const KERABAT_JAUH_ROLE = "kerabat_jauh";

/**
 * Integer rank for deterministic ordering of output lines and rupiah tie-breaks: voluntary
 * wasiat, wasiat wajibah, then heirs in registry order (KHI-185 slots right after the daughters),
 * then dzawil arham, then the Baitul Mal and the unassigned residue.
 */
export function roleRank(role: string): number {
  if (role === "wasiat" || role.startsWith("wasiat#")) return -200;
  if (role.startsWith("wasiat_wajibah:")) return -100;
  if (role.startsWith("pengganti_")) return HEIRS.indexOf("anak_pr") * 10 + 1;
  const base = role.split("#")[0];
  if (isHeirId(base)) return HEIRS.indexOf(base) * 10;
  if (isDzawilId(base)) return 1000 + DZAWIL_IDS.indexOf(base);
  if (base === KERABAT_JAUH_ROLE) return 1900;
  if (base === "baitul_mal") return 2000;
  if (base === "sisa_dirujuk") return 2001;
  return 1500;
}

// ---------------------------------------------------------------------------------------------
// Refusal reasons and notes (engine.md §13; plan §5.4). `rujuk.<reason>` / `catatan.<reason>`.
// ---------------------------------------------------------------------------------------------

export const RUJUK_REASONS = [
  "khuntsa",
  "mafqud",
  "haml",
  "gharqa",
  "wala",
  "kerabat_jauh",
  "dzawil_arham",
  "dzawil_arham_campuran",
  "dugaan_pembunuhan",
  "beda_agama_pewaris",
  "utang_melebihi_harta",
  "wasiat_wajibah_besar",
  "pengganti_batas_tak_jelas",
  /** Added by the plan (E-TANPA-AHLI-WARIS): no spouse, no relative at all. */
  "tanpa_ahli_waris",
] as const;
export type RujukReason = (typeof RUJUK_REASONS)[number];

/** Facts the questionnaire may pass in as out of scope (it decides relevance via couldAffectOutcome). */
export const OUT_OF_SCOPE_FACTS = ["khuntsa", "mafqud", "haml", "gharqa", "wala", "kerabat_jauh"] as const;
export type OutOfScopeFact = (typeof OUT_OF_SCOPE_FACTS)[number];

export const NOTES = [
  /** Spouse is the only heir: the residue is not assigned ("sisa: konsultasikan"), engine.md §9.4. */
  "sisa_pasangan_saja",
  /** A harta-bersama pool the engine cannot split (earlier wife, period mismatch): no rupiah. */
  "harta_bersama_rumit",
  "pewaris_dibawah_umur_wasiat",
  "munasakhat",
  "anak_tiri_wasiat_wajibah",
  "anak_angkat_tanpa_penetapan",
  "wasiat_wajibah_keponakan",
  // Added by this engine (documented in engine/registry; RuleNotes to be written):
  /** Grandfather with siblings (Zaid): stamped "Perlu konfirmasi ahli faraid" (plan D4, §5.4). */
  "jadd_perlu_konfirmasi",
  /** Non-Muslim relative with wasiat wajibah off: "dapat menerima wasiat atau hibah" (§11.4 b). */
  "kerabat_non_muslim",
  /** As-if wasiat wajibah shown as an illustration, "besarnya ditetapkan hakim" (plan D8). */
  "wasiat_wajibah_ilustrasi",
  /** Adoption ceiling: "paling banyak …; besarnya ditetapkan hakim" (plan D8). */
  "wasiat_wajibah_plafon",
  /** KHI 209: an adopted child who already received a wasiat gets no wasiat wajibah. */
  "ww_anak_angkat_sudah_menerima_wasiat",
  /** Adoptive parent whose parent position is already filled: not computed, court sets it. */
  "ww_orang_tua_angkat_tidak_dihitung",
  /** KHI 211: hibah to children "dapat diperhitungkan" — reported only (§3.5). */
  "hibah_dapat_diperhitungkan",
  /** A wasiat to an heir without every heir's consent is ignored (KHI 195(3)). */
  "wasiat_ahli_waris_diabaikan",
] as const;
export type NoteId = (typeof NOTES)[number];

// ---------------------------------------------------------------------------------------------
// Rule ids (engine.md §15) with metadata for the RuleNote author.
//   group    — §15 group
//   section  — engine.md section that defines the rule
//   dalil    — the dalil.json rule record(s) per plan §8 (ids only; the note cites records)
//   legal    — Indonesian legal instruments per plan §8 (quoted only from pinned PDFs, rule B9)
// ---------------------------------------------------------------------------------------------

export type RuleGroup =
  | "estate"
  | "mawani"
  | "furudh"
  | "hajb"
  | "asabah"
  | "special"
  | "adjust"
  | "khi"
  | "money"
  | "rujuk"
  | "catatan";

export interface RuleMeta {
  group: RuleGroup;
  section: string;
  dalil?: readonly string[];
  legal?: readonly string[];
  /** true when the id was added by the engine beyond engine.md §15 (needs a RuleNote too). */
  added?: true;
}

const R = (group: RuleGroup, section: string, dalil?: readonly string[], legal?: readonly string[], added?: true): RuleMeta =>
  ({ group, section, ...(dalil ? { dalil } : {}), ...(legal ? { legal } : {}), ...(added ? { added } : {}) });

export const RULES = {
  // Estate (§3)
  "estate.harta_bersama": R("estate", "§3.2", undefined, ["KHI 96(1)", "32 K/AG/2002"]),
  "estate.harta_bersama_poligami": R("estate", "§3.2", undefined, ["KHI 94", "KHI 190", "Buku II 2026 pp. 836-838"]),
  "estate.biaya": R("estate", "§3.1", ["R-tajhiz"], ["KHI 175(1)"]),
  "estate.utang": R("estate", "§3.1", ["R-debt-wasiyya-first"], ["KHI 175"]),
  "estate.wasiat": R("estate", "§3.1", ["R-wasiyya-third"], ["KHI 195"]),
  "estate.wasiat_dibatasi_sepertiga": R("estate", "§3.1", ["R-wasiyya-third"], ["KHI 195(2)", "KHI 201"]),
  "estate.wasiat_ahli_waris_tanpa_persetujuan": R("estate", "§3.1", ["R-no-wasiyya-heir"], ["KHI 195(3)"]),
  "estate.wasiat_wajibah": R("estate", "§11.4", ["R-ext-mui-khi"], ["KHI 209", "1/Yur/Ag/2018"]),
  // Mawani' (§4)
  "mani.beda_agama": R("mawani", "§4", ["R-barrier-religion"], ["Fatwa MUI 5/MUNAS VII/MUI/9/2005", "KHI 171(c)"]),
  "mani.pembunuh": R("mawani", "§4", ["R-barrier-killer"], ["KHI 173"]),
  "mani.anak_luar_nikah": R("mawani", "§4", undefined, ["Fatwa MUI 11/2012", "KHI 186"]),
  "mani.anak_angkat": R("mawani", "§4", undefined, ["Fatwa MUI Adopsi 1984", "KHI 171(h)", "KHI 209"]),
  "mani.anak_tiri": R("mawani", "§4", ["R-heirs-list"], ["SEMA 7/2012 Kamar Agama 19"]),
  // Furudh (§5.2)
  "fardh.suami_1_2": R("furudh", "§5.2", ["R-spouses"]),
  "fardh.suami_1_4": R("furudh", "§5.2", ["R-spouses"]),
  "fardh.istri_1_4": R("furudh", "§5.2", ["R-spouses"]),
  "fardh.istri_1_8": R("furudh", "§5.2", ["R-spouses"]),
  "fardh.anak_pr_1_2": R("furudh", "§5.2", ["R-daughters"]),
  "fardh.anak_pr_2_3": R("furudh", "§5.2", ["R-daughters"]),
  "fardh.cucu_pr_1_2": R("furudh", "§5.2", ["R-sons-daughter-sixth"]),
  "fardh.cucu_pr_2_3": R("furudh", "§5.2", ["R-sons-daughter-sixth"]),
  "fardh.cucu_pr_1_6_takmilah": R("furudh", "§5.2", ["R-sons-daughter-sixth"]),
  "fardh.ayah_1_6": R("furudh", "§5.2", ["R-parents"]),
  "fardh.kakek_1_6": R("furudh", "§5.2", ["R-grandfather"]),
  "fardh.ibu_1_3": R("furudh", "§5.2", ["R-mother-third-sixth"]),
  "fardh.ibu_1_6": R("furudh", "§5.2", ["R-mother-third-sixth"]),
  "fardh.nenek_1_6": R("furudh", "§5.2", ["R-grandmother"]),
  "fardh.sdr_pr_1_2": R("furudh", "§5.2", ["R-siblings-kalala"]),
  "fardh.sdr_pr_2_3": R("furudh", "§5.2", ["R-siblings-kalala"]),
  "fardh.sdr_pr_seayah_1_6_takmilah": R("furudh", "§5.2", ["R-siblings-kalala"]),
  "fardh.seibu_1_6": R("furudh", "§5.2", ["R-maternal-siblings"]),
  "fardh.seibu_1_3": R("furudh", "§5.2", ["R-maternal-siblings"]),
  // Hajb (§6)
  "hajb.hirman": R("hajb", "§6.1", ["R-hajb-siblings", "R-hajb-grandparents", "R-asabah-order"]),
  "hajb.istighraq": R("hajb", "§6.1", ["R-furudh-then-asabah"]),
  "nuqshan.suami": R("hajb", "§6.2", ["R-spouses"]),
  "nuqshan.istri": R("hajb", "§6.2", ["R-spouses"]),
  "nuqshan.ibu": R("hajb", "§6.2", ["R-mother-third-sixth"]),
  "nuqshan.ayah": R("hajb", "§6.2", ["R-parents"]),
  // 'Asabah (§7)
  "asabah.bin_nafs": R("asabah", "§7.1", ["R-furudh-then-asabah"]),
  "asabah.bil_ghair": R("asabah", "§7.2", ["R-2to1"]),
  "asabah.maal_ghair": R("asabah", "§7.3", ["R-sister-asabah-maal-ghayr"]),
  "asabah.ayah_fardh_dan_sisa": R("asabah", "§5.2", ["R-parents"]),
  // Special (§8)
  umariyyatain: R("special", "§8.1", ["R-mother-third-sixth"], ["KHI 178(2)"]),
  musytarakah: R("special", "§8.2", ["R-special-cases"]),
  akdariyyah: R("special", "§8.3"),
  "jadd.muqasamah": R("special", "§8.4", ["R-grandfather"]),
  "jadd.sepertiga": R("special", "§8.4", ["R-grandfather"]),
  "jadd.sepertiga_sisa": R("special", "§8.4", ["R-grandfather"]),
  "jadd.seperenam": R("special", "§8.4", ["R-grandfather"]),
  "jadd.muaddah": R("special", "§8.4", ["R-grandfather"]),
  "jadd.sdr_pr_kandung_sampai_fardh": R("special", "§8.4", ["R-grandfather"]),
  // Adjust (§9–10)
  aul: R("adjust", "§9.2", ["R-awl"], ["KHI 192"]),
  "radd.tanpa_pasangan": R("adjust", "§9.4", ["R-radd"], ["KHI 193"]),
  // no rule record: R-radd states radd to the non-spouse heirs only (review 2026-10-09; G-RADD-SEMUA-UTSMAN)
  "radd.semua": R("adjust", "§9.4", undefined, ["KHI 193"]),
  baitul_mal: R("adjust", "§9.4", ["R-radd"], ["KHI 191", "SEMA 1/2022"]),
  "dzawil_arham.tanzil": R("adjust", "§10", ["R-dzawil-arham"]),
  tashih: R("adjust", "§9.3", ["R-calc-method"]),
  ikhtisar: R("adjust", "§9.3", ["R-calc-method"]),
  // KHI (§11)
  "khi.pengganti": R("khi", "§11.1", ["R-ext-mui-khi"], ["KHI 185(1)", "SEMA 3/2015", "2/Yur/Ag/2018"]),
  "khi.pengganti_batas": R("khi", "§11.1", ["R-ext-mui-khi"], ["KHI 185(2)", "109 K/AG/2016"]),
  "khi.anak_menghijab_saudara": R("khi", "§11.2", ["R-ext-mui-khi"], ["86 K/AG/1994", "122 K/AG/1995", "184 K/AG/1995"]),
  "khi.seibu_pasal_181": R("khi", "§6.3", ["R-ext-mui-khi"], ["KHI 181"]),
  "khi.ww_anak_angkat": R("khi", "§11.4", ["R-ext-mui-khi"], ["KHI 209"]),
  "khi.ww_non_muslim": R("khi", "§11.4", ["R-ext-mui-khi"], ["1/Yur/Ag/2018", "16 K/AG/2010", "51 K/Ag/1999"]),
  "khi.perdamaian": R("khi", "§11.6", undefined, ["KHI 183"]),
  // Money (§14)
  "rupiah.pembulatan": R("money", "§14"),
} as const satisfies Record<string, RuleMeta>;

export type CalcRuleId = keyof typeof RULES;
export type RuleId = CalcRuleId | `rujuk.${RujukReason}` | `catatan.${NoteId}`;

/** Every rule id the engine can emit, in a stable order (calc rules, then refusals, then notes). */
export const RULE_IDS: readonly RuleId[] = [
  ...(Object.keys(RULES) as CalcRuleId[]),
  ...RUJUK_REASONS.map((r) => `rujuk.${r}` as const),
  ...NOTES.map((n) => `catatan.${n}` as const),
];

/** Metadata for any rule id, including refusals and notes. */
export function ruleMeta(id: RuleId): RuleMeta {
  if (id.startsWith("rujuk.")) return { group: "rujuk", section: "§13" };
  if (id.startsWith("catatan.")) {
    const n = id.slice("catatan.".length);
    const added = [
      "jadd_perlu_konfirmasi",
      "kerabat_non_muslim",
      "wasiat_wajibah_ilustrasi",
      "wasiat_wajibah_plafon",
      "ww_anak_angkat_sudah_menerima_wasiat",
      "ww_orang_tua_angkat_tidak_dihitung",
      "hibah_dapat_diperhitungkan",
      "wasiat_ahli_waris_diabaikan",
    ].includes(n);
    return added ? { group: "catatan", section: "§13", added: true } : { group: "catatan", section: "§13" };
  }
  return RULES[id as CalcRuleId];
}

/**
 * Every rule id with its metadata, in RULE_IDS order: the checklist for the RuleNote author
 * (plan §9.2: "every engine rule id has exactly one reviewed RuleNote"; M1.6).
 */
export function ruleCatalog(): ({ id: RuleId } & RuleMeta)[] {
  return RULE_IDS.map((id) => ({ id, ...ruleMeta(id) }));
}

export function isRuleId(x: string): x is RuleId {
  return (RULE_IDS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------------------------
// Switches and rulesets (plan §7.2 is authoritative; engine.md §12.2).
// ---------------------------------------------------------------------------------------------

export interface Switches {
  /** KHI 96(1): surviving spouse takes ½ of each harta-bersama pool as owner first. */
  hartaBersama: boolean;
  /** Classical: any killing bars. KHI 173: only a final judgment (else rujuk dugaan_pembunuhan). */
  killerBarred: "any_killing" | "final_judgment";
  /** KHI 185 ahli waris pengganti. "luas" is documented but NOT implemented (skipped by name). */
  substitution: "none" | "cucu" | "luas";
  /** KHI 185(2) cap reading (reviewer R6). Not applicable while substitution = "none". */
  substitutionCap: "none" | "sederajat" | "per_kepala";
  /** 86 K/AG/1994 line: any child (or KHI substitute) excludes siblings, nephews, uncles, cousins. */
  daughtersExcludeSiblings: boolean;
  /** Who excludes uterine siblings: classical (incl. grandfather) or KHI 181 literal (comparison). */
  uterineExcludedBy: "classical" | "khi181";
  /** Father with only female descendants: ⅙ + residue (classical) or ⅙ then radd (KHI 177 literal). */
  fatherWithDaughters: "fardh_plus_asabah" | "fardh_then_radd";
  /** Unclaimed residue: Baitul Mal (asal), radd to non-spouses (default), or radd to all (comparison). */
  residue: "baitul_mal" | "radd_non_spouse" | "radd_all";
  dzawilArham: "none" | "tanzil";
  musytarakah: boolean;
  jadd: "zaid";
  /** KHI 209 adopted child / adoptive parent: ceiling ⅓ taken off first. */
  wasiatWajibahAdopsi: "off" | "plafon";
  /** Non-Muslim spouse/child/parent: MA as-if illustration (16 K/AG/2010) or plafon (comparison). */
  wasiatWajibahNonMuslim: "off" | "ma_16K2010" | "plafon";
}
export type SwitchName = keyof Switches;

export const SWITCH_VALUES: { readonly [K in SwitchName]: readonly Switches[K][] } = {
  hartaBersama: [true, false],
  killerBarred: ["any_killing", "final_judgment"],
  substitution: ["none", "cucu", "luas"],
  substitutionCap: ["none", "sederajat", "per_kepala"],
  daughtersExcludeSiblings: [false, true],
  uterineExcludedBy: ["classical", "khi181"],
  fatherWithDaughters: ["fardh_plus_asabah", "fardh_then_radd"],
  residue: ["baitul_mal", "radd_non_spouse", "radd_all"],
  dzawilArham: ["none", "tanzil"],
  musytarakah: [true, false],
  jadd: ["zaid"],
  wasiatWajibahAdopsi: ["off", "plafon"],
  wasiatWajibahNonMuslim: ["off", "ma_16K2010", "plafon"],
};

/** Switch values the engine documents but does not implement. Requests for them throw. */
export const NOT_IMPLEMENTED: readonly { switch: SwitchName; value: string; why: string }[] = [
  {
    switch: "substitution",
    value: "luas",
    why: "Buku II 2013 wide substitution (siblings, uncles, aunts), superseded by SEMA 3/2015; comparison only (engine.md §11.1, plan §7.2).",
  },
];

export const PROFILE_IDS = ["klasik-syafii", "standar-indonesia", "klasik-syafii-asal"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

const KLASIK: Switches = {
  hartaBersama: true,
  killerBarred: "any_killing",
  substitution: "none",
  // n/a while substitution = "none"; set equal to the court column so it is never listed as a
  // separate difference (the `substitution` switch already names it).
  substitutionCap: "sederajat",
  daughtersExcludeSiblings: false,
  uterineExcludedBy: "classical",
  fatherWithDaughters: "fardh_plus_asabah",
  residue: "radd_non_spouse",
  dzawilArham: "tanzil",
  musytarakah: true,
  jadd: "zaid",
  wasiatWajibahAdopsi: "off",
  wasiatWajibahNonMuslim: "off",
};

/** The three profiles (plan §7.2). */
export const PROFILES: { readonly [K in ProfileId]: Readonly<Switches> } = {
  /** "Menurut fikih mazhab Syafi'i" — leads the report (plan D2 = A). */
  "klasik-syafii": KLASIK,
  /** "Menurut KHI dan praktik Pengadilan Agama". */
  "standar-indonesia": {
    ...KLASIK,
    killerBarred: "final_judgment",
    substitution: "cucu",
    substitutionCap: "sederajat",
    daughtersExcludeSiblings: true,
    uterineExcludedBy: "classical",
    residue: "radd_non_spouse",
    dzawilArham: "none",
    wasiatWajibahAdopsi: "plafon",
    wasiatWajibahNonMuslim: "ma_16K2010",
  },
  /** Original Syafi'i position as applied by MAIS: Baitul Mal, no dzawil arham. Comparison only. */
  "klasik-syafii-asal": { ...KLASIK, residue: "baitul_mal", dzawilArham: "none" },
};

export const DEFAULT_PROFILE: ProfileId = "klasik-syafii";
export const COURT_PROFILE: ProfileId = "standar-indonesia";

/**
 * Comparison variants (plan §7.2: tests and comparison only; the questionnaire never offers them).
 * `standar-indonesia|substitution=luas` is listed in NOT_IMPLEMENTED and skipped by name.
 */
export const COMPARISON_VARIANTS = [
  "standar-indonesia|uterineExcludedBy=khi181",
  "standar-indonesia|wasiatWajibahNonMuslim=plafon",
  "standar-indonesia|substitutionCap=none",
  "standar-indonesia|substitutionCap=per_kepala",
  "standar-indonesia|residue=radd_all",
  "standar-indonesia|fatherWithDaughters=fardh_then_radd",
  "klasik-syafii|musytarakah=false",
] as const;

export interface Ruleset {
  /** "<profile>" or "<profile>|<switch>=<value>[|…]". */
  id: string;
  profile: ProfileId;
  switches: Readonly<Switches>;
}

export class NotImplementedVariantError extends Error {
  constructor(
    public readonly switchName: string,
    public readonly value: string,
  ) {
    super(`waris: switch value ${switchName}=${value} is documented but not implemented`);
    this.name = "NotImplementedVariantError";
  }
}

function coerce(name: SwitchName, raw: string): Switches[SwitchName] {
  const allowed = SWITCH_VALUES[name] as readonly (string | boolean)[];
  const v: string | boolean = raw === "true" ? true : raw === "false" ? false : raw;
  if (!allowed.includes(v)) throw new Error(`waris: unknown value ${raw} for switch ${name}`);
  return v as Switches[SwitchName];
}

/** Resolve "<profile>[|<switch>=<value>…]" into a Ruleset. Throws for unknown or unimplemented values. */
export function resolveRuleset(ref: string | Ruleset): Ruleset {
  if (typeof ref !== "string") return ref;
  const [head, ...mods] = ref.split("|");
  if (!(PROFILE_IDS as readonly string[]).includes(head)) throw new Error(`waris: unknown ruleset ${head}`);
  const profile = head as ProfileId;
  const sw: Switches = { ...PROFILES[profile] };
  for (const m of mods) {
    const [k, v] = m.split("=");
    if (!(k in sw)) throw new Error(`waris: unknown switch ${k}`);
    const name = k as SwitchName;
    if (NOT_IMPLEMENTED.some((x) => x.switch === name && x.value === v)) throw new NotImplementedVariantError(name, v);
    (sw as Record<SwitchName, unknown>)[name] = coerce(name, v);
  }
  return { id: ref, profile, switches: sw };
}

export function withSwitch<K extends SwitchName>(rs: Ruleset, name: K, value: Switches[K]): Ruleset {
  return { id: `${rs.id}|${name}=${String(value)}`, profile: rs.profile, switches: { ...rs.switches, [name]: value } };
}
