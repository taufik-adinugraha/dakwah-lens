/**
 * Waris engine types (engine.md §2 input model; architecture.md §5.3 result sketch).
 *
 * The engine takes a STRUCTURED family, not flat counts: each child who died first carries their
 * own children (KHI 185 per stirpes); spouses are listed in marriage order so harta-bersama pools
 * can be tagged by period. Depth stops at grandchildren, grandparents, a brother's sons and
 * paternal cousins (engine.md §2); deeper relatives refuse with `kerabat_jauh` unless excluded.
 */
import type { Frac } from "./frac";
import type {
  DzawilId,
  HeirId,
  NoteId,
  OutOfScopeFact,
  RuleId,
  RujukReason,
  Sex,
  SwitchName,
  Switches,
} from "./registry";

export type { Sex } from "./registry";

export type Religion = "islam" | "non_islam";

/** Reasons a living relative may not inherit (engine.md §4). */
export type Bar =
  | "membunuh" // killing, with a final judgment (KHI 173) — bars in both columns
  | "mencoba_membunuh" // KHI 173 (final judgment) — bars in the court column only
  | "aniaya_berat" // KHI 173 (final judgment) — court column only
  | "fitnah_pidana5th" // KHI 173 (final judgment) — court column only
  | "membunuh_tanpa_putusan" // classical: any killing bars; court column → rujuk dugaan_pembunuhan
  | "murtad"; // treated as non-Muslim (Fath al-Qarib § 116)

export interface Person {
  /** Stable key from the questionnaire, never a name. Unique within one FamilyInput. */
  id: string;
  sex: Sex;
  /** Alive at the moment of the pewaris's death. */
  alive: boolean;
  religion: Religion;
  bars?: Bar[];
  /** Filled where it matters: predeceased children, siblings (nephews/nieces), uncles (cousins). */
  children?: Person[];
}

export type SiblingLine = "kandung" | "seayah" | "seibu";
export interface SiblingPerson extends Person {
  line: SiblingLine;
}
export interface UnclePerson extends Person {
  line: "kandung" | "seayah";
}
export interface AdoptedPerson extends Person {
  /** KHI 171(h): adoption counts only by court order. */
  courtOrder: boolean;
  /** KHI 209: "yang tidak menerima wasiat" — a voluntary wasiat already given. */
  receivedWasiat?: boolean;
}

/** An explicitly entered dzawil-arham relative (engine.md §10), e.g. a paternal aunt. */
export interface OtherRelative {
  relation: DzawilId;
  /** Groups relatives under one wasith; defaults to the relation id (one wasith per relation). */
  via?: string;
  person: Person;
}

export interface FamilyInput {
  deceased: { sex: Sex; religion: Religion };
  /** Husband (0–1) or wives (0–4), married at death, in MARRIAGE ORDER (harta-bersama periods). */
  spouses: Person[];
  /** Sons and daughters, alive or predeceased (predeceased ones carry children[] when relevant). */
  children: Person[];
  father?: Person;
  mother?: Person;
  /** Father's father. */
  paternalGrandfather?: Person;
  /** Father's mother. */
  paternalGrandmother?: Person;
  /** Mother's mother. */
  maternalGrandmother?: Person;
  /** Mother's father: dzawil arham (kakek_dari_ibu). */
  maternalGrandfather?: Person;
  /** Siblings with their children (nephews/nieces). */
  siblings: SiblingPerson[];
  /** Father's brothers with their children (cousins). */
  paternalUncles: UnclePerson[];
  otherRelatives?: OtherRelative[];
  adoptedChildren?: AdoptedPerson[];
  /** When the pewaris was an adopted child (KHI 209(1)). */
  adoptiveParents?: AdoptedPerson[];
  stepChildren?: Person[];
  /**
   * Out-of-scope facts the questionnaire found relevant (it decides relevance with
   * couldAffectOutcome). Any entry refuses in both columns (engine.md §13).
   */
  outOfScope?: OutOfScopeFact[];
}

export interface WasiatInput {
  /** Person id of the recipient when the recipient is an heir. */
  toId?: string;
  toHeir: boolean;
  /** Rupiah amount (needs estate amounts) … */
  amount?: bigint;
  /** … or a fraction of the estate after debts. */
  fraction?: Frac;
}

export interface HartaBersamaPool {
  /** Period p = the first p spouses (in `spouses` order) were married to the pewaris (§3.2). */
  period: 1 | 2 | 3 | 4;
  amount: bigint;
  /** Informational label (e.g. "istri#1+istri#2"); membership comes from `period`. */
  spouseId?: string;
}

export interface EstateInput {
  /** The deceased's own property (incl. inheritance/gifts received). */
  hartaBawaan?: bigint;
  hartaBersama?: HartaBersamaPool[];
  /** An earlier wife died or divorced, or a pool is disputed: fractions only (plan D18). */
  hartaBersamaRumit?: boolean;
  biayaSakit?: bigint;
  biayaJenazah?: bigint;
  /** Debts to people, plus zakat/nazar/haji owed. */
  utang?: bigint;
  wasiat?: WasiatInput[];
  /** All heirs agree to a wasiat above ⅓ or to an heir (KHI 195(2),(3); Fath al-Qarib § 118). */
  heirsConsentToExcessWasiat?: boolean;
  /** KHI 211: reported only, never subtracted (§3.5). */
  hibahToChildren?: { childId: string; amount: bigint }[];
}

export interface WarisInput {
  family: FamilyInput;
  estate?: EstateInput;
}

// ---------------------------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------------------------

export interface TraceStep {
  rule: RuleId;
  heirs: string[];
  facts?: Record<string, string>;
}

export type Adjustment = "aul" | "radd" | "baitul_mal";
export type SpecialCase = "umariyyatain" | "musytarakah" | "akdariyyah" | "jadd";

export interface PersonShare {
  personId: string;
  /** Output key: the role id, or "<role>#<i>" (1-based, input order) when the role has several people. */
  key: string;
  sex: Sex;
  /** Share of the estate divided by fara'id (net estate). */
  share: Frac;
  /** Share of the estate after debts (counts wasiat / wasiat-wajibah lines). */
  line: Frac;
  rupiah?: bigint;
}

export interface ShareGroup {
  /** HeirId, "pengganti_<k>" (KHI 185 slot of the k-th predeceased child), or a dzawil-arham id. */
  heir: string;
  count: number;
  /** Fara'id view: share of the net estate. */
  group: Frac;
  /** After-debts view. */
  line: Frac;
  /** Per-person share (fara'id view) when every member gets the same. */
  perHead?: Frac;
  persons: PersonShare[];
  rule: RuleId;
  /** Group units at finalBase (fara'id view). */
  units: bigint;
}

export interface BlockedGroup {
  heir: string;
  personIds: string[];
  /** Roles that block (or "baitul_mal" / "furudh" for istighraq-type exclusions). */
  by: string[];
  rule: RuleId;
}

export type IneligibleReason = "beda_agama" | "pembunuh" | "anak_angkat" | "anak_tiri";
export interface IneligibleGroup {
  heir: string;
  personIds: string[];
  reason: IneligibleReason;
  rule: RuleId;
}

export type LineKind = "wasiat" | "wasiat_wajibah" | "heir" | "baitul_mal" | "sisa_dirujuk";
export interface Line {
  /** "wasiat", "wasiat#i", "wasiat_wajibah:<key>", heir group id, "baitul_mal", "sisa_dirujuk". */
  key: string;
  kind: LineKind;
  /** Share of the estate after debts. */
  frac: Frac;
  personIds: string[];
}

export interface EstateBreakdown {
  /** Each spouse's own half/share of the harta-bersama pools (rupiah key → amount). */
  hartaBersamaSpouse: Record<string, bigint>;
  grossOwn: bigint;
  biayaSakit: bigint;
  biayaJenazah: bigint;
  utang: bigint;
  afterDebts: bigint;
}

export interface Hasil {
  kind: "hasil";
  ruleset: string;
  shares: ShareGroup[];
  /** Residue lines in the fara'id view; Σ shares + baitulMal + sisaDirujuk = 1. */
  residue: { baitulMal: Frac; sisaDirujuk: Frac };
  /** After-debts view; Σ frac = 1. */
  lines: Line[];
  blocked: BlockedGroup[];
  ineligible: IneligibleGroup[];
  adjustments: Adjustment[];
  specialCase?: SpecialCase;
  /** Asal masalah (lcm of the fardh denominators, grandfather share included in jadd cases). */
  base: bigint;
  /** After 'aul / radd / tashih with ikhtisar: lcm of the per-person denominators (fara'id view). */
  finalBase: bigint;
  /** Tanzil only: the wasith heirs of the virtual problem. */
  virtualHeirs?: Partial<Record<HeirId, number>>;
  /** Integer rupiah by key (only when estate amounts were given and the pools are computable). */
  rupiah?: Record<string, bigint>;
  estate?: EstateBreakdown;
  notes: NoteId[];
  trace: TraceStep[];
  /** Switches whose klasik-syafii value would change a share (plan §6, engine.md §12.1). */
  switchesUsed: SwitchName[];
}

export interface Rujuk {
  kind: "rujuk";
  ruleset: string;
  reasons: RujukReason[];
  notes: NoteId[];
  trace: TraceStep[];
}

export type Result = Hasil | Rujuk;

// ---------------------------------------------------------------------------------------------
// Internal core model (shared by the real, the as-if and the tanzil solves). Not for UI use.
// ---------------------------------------------------------------------------------------------

export interface Member {
  personId: string;
  sex: Sex;
}

/** A unit holder: one person, or one KHI-185 slot whose share is passed down 2:1 to its members. */
export interface Holder {
  /** personId, or the slot key "pengganti_<k>". */
  id: string;
  role: string;
  sex: Sex;
  members: Member[];
  isSlot: boolean;
}

export interface Slot {
  key: string;
  /** Sex of the predeceased child the slot replaces. */
  sex: Sex;
  members: Member[];
  parentId: string;
}

export interface CoreInput {
  deceasedSex: Sex;
  sw: Switches;
  /** Eligible, living classical heirs by role (empty roles omitted). */
  roles: Partial<Record<HeirId, Member[]>>;
  /** KHI-185 slots (substitution = "cucu" only). */
  slots: Slot[];
}

export interface CoreAlloc {
  holder: Holder;
  share: Frac;
  rule: RuleId;
}

export interface CoreOut {
  allocs: CoreAlloc[];
  blocked: BlockedGroup[];
  adjustments: Adjustment[];
  specialCase?: SpecialCase;
  baitulMal: Frac;
  sisaDirujuk: Frac;
  /** Residue left open for dzawil arham (radd_non_spouse, no non-spouse fardh/asabah heir). */
  residueOpen: Frac;
  base: bigint;
  /**
   * The classical table before tashih (engine.md §9.3): the asal masalah, or the 'aul siham, or the
   * radd masalah (the radd heirs' heads when they are one class, else the sum of their siham, within
   * the spouse's table when a spouse takes no radd). solve.ts traces tashih and ikhtisar from it.
   */
  tableBase: bigint;
  notes: NoteId[];
  trace: TraceStep[];
  rujuk: RujukReason[];
}
