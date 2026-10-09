/**
 * The report's reading of the engine (architecture.md §7.1): both columns solved, the report
 * policies applied, the Ringkasan rows drafted, and the cell / label / RuleNote helpers the
 * sections share. Pure: no Date, no I/O.
 *
 * Report-level policies (each tested in checks/report.ts):
 *  - v1 refuses dzawil arham in the fikih column (plan D4): a fikih result that gives a tanzil
 *    share is a refusal (rujuk.dzawil_arham); the court column is still shown in full.
 *  - any reported killing or KHI 173 bar routes to the E-BUNUH class (plan D4 change 1): no
 *    numbers in either column, no print, no text summary, no link (plan §9.4).
 *  - display decision for the integer table: the classical asal masalah (with its 'aul / radd
 *    total) is the table base; tashih and ikhtisar ("6 → 2", flagged in M1) appear only in
 *    Catatan metode.
 */
import { eq, frac, mul, sum, ZERO, type Frac } from "../frac";
import { fraction, percent, rupiah } from "../format";
import {
  COURT_PROFILE,
  DEFAULT_PROFILE,
  resolveRuleset,
  roleRank,
  type NoteId,
  type RuleId,
  type RujukReason,
  type Ruleset,
  type SwitchName,
} from "../registry";
import { resultSignature, solve } from "../solve";
import type { FamilyInput, Hasil, IneligibleReason, Person, PersonShare, Result, ShareGroup, WarisInput } from "../types";
import { asRuleId, ruleRef, type ContentIndex } from "./content";
import { msg, REPORT_MESSAGES, type Msg, type MsgList, type ReportMsgKey } from "./messages";
import type { PewarisKind, ReportOptions } from "./options";
import type { CellView, ColumnHead, ColumnId, CompactRow, FracView, NoneView, RefusalView, RuleRefView, RupiahView, TableView } from "./types";
import { fractionWords } from "./words";

export const FIKIH_RS: Ruleset = resolveRuleset(DEFAULT_PROFILE);
export const COURT_RS: Ruleset = resolveRuleset(COURT_PROFILE);

/** Bars that route the whole report to the E-BUNUH class (plan D4: any report of a killing; KHI 173 grounds). */
const KILLER_BARS: ReadonlySet<string> = new Set(["membunuh", "membunuh_tanpa_putusan", "mencoba_membunuh", "aniaya_berat", "fitnah_pidana5th"]);

/** Notes that are soft stops: listed under "Perlu dipastikan" (plan §5.4 table, last row). */
export const SOFT_STOP_NOTES: ReadonlySet<NoteId> = new Set<NoteId>(["jadd_perlu_konfirmasi", "sisa_pasangan_saja", "harta_bersama_rumit"]);

/** Rules that decide a share (trace steps naming the heir's role). */
const SHARE_RULE = /^(fardh\.|asabah\.|nuqshan\.|jadd\.|radd\.|khi\.pengganti|khi\.seibu_pasal_181$|umariyyatain$|musytarakah$|akdariyyah$|aul$|dzawil_arham\.tanzil$)/;
const ESTATE_RULE = /^estate\./;

/** The rule ids that name each switch's KHI / court-practice position (plan §7.2). */
export const SWITCH_RULES: Readonly<Record<SwitchName, readonly RuleId[]>> = {
  hartaBersama: ["estate.harta_bersama"],
  killerBarred: ["mani.pembunuh"],
  substitution: ["khi.pengganti"],
  substitutionCap: ["khi.pengganti_batas"],
  daughtersExcludeSiblings: ["khi.anak_menghijab_saudara"],
  uterineExcludedBy: ["khi.seibu_pasal_181"],
  fatherWithDaughters: ["asabah.ayah_fardh_dan_sisa"],
  residue: ["radd.semua"],
  dzawilArham: ["dzawil_arham.tanzil"],
  musytarakah: ["musytarakah"],
  jadd: ["jadd.muqasamah"],
  wasiatWajibahAdopsi: ["khi.ww_anak_angkat"],
  wasiatWajibahNonMuslim: ["khi.ww_non_muslim"],
};

// ---------------------------------------------------------------------------------------------
// Number views
// ---------------------------------------------------------------------------------------------

export function fracView(f: Frac): FracView {
  return { t: "frac", n: f.n.toString(), d: f.d.toString(), figure: fraction(f), words: fractionWords(f), percent: percent(f) };
}

export function rupiahView(x: bigint): RupiahView {
  return { t: "rp", amount: x.toString(), text: rupiah(x) };
}

/** Nominal fardh of a rule id ("fardh.istri_1_8" → 1/8), for the 'aul / radd change text. */
export function nominalOf(rule: string): Frac | null {
  if (!rule.startsWith("fardh.")) return null;
  const m = /_([0-9]+)_([0-9]+)(?:_|$)/.exec(rule);
  return m ? frac(BigInt(m[1]), BigInt(m[2])) : null;
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export interface Ctx {
  input: WarisInput;
  ix: ContentIndex;
  opts: ReportOptions;
  showRupiah: boolean;
  /** "pengganti_<k>" → sex of the k-th predeceased child. */
  slotSex: Map<string, "L" | "P">;
  /** Dalil ids a RuleNote cites that plan D10 keeps off the page, with the reason. */
  hidden: Map<string, string>;
  /** Dalil ids in first-use order (every RuleRefView registers its ids). */
  cardOrder: Set<string>;
  rule: (id: string) => RuleRefView;
  label: (role: string, cap?: boolean) => Msg;
  /** "almarhum" / "almarhumah" / "Anda" / "beliau" (plan §5.7 messageVars), for {pewaris}. */
  pewaris: (cap?: boolean) => Msg;
  /** "saat almarhum wafat" / "jika Anda wafat hari ini", for {saat}. */
  saat: Msg;
}

const PEWARIS_KEY: Readonly<Record<PewarisKind, ReportMsgKey>> = {
  almarhum: "laporan.pewaris.almarhum",
  almarhumah: "laporan.pewaris.almarhumah",
  anda: "laporan.pewaris.anda",
  beliau: "laporan.pewaris.beliau",
};

/** Who the copy names: the questionnaire's choice, else by mode and the deceased's sex. */
export function pewarisKindOf(input: WarisInput, opts: ReportOptions): PewarisKind {
  if (opts.pewaris) return opts.pewaris;
  if (opts.mode === "simulasi") return "beliau";
  return input.family.deceased.sex === "P" ? "almarhumah" : "almarhum";
}

export function makeCtx(input: WarisInput, ix: ContentIndex, opts: ReportOptions): Ctx {
  const slotSex = new Map<string, "L" | "P">();
  let k = 0;
  for (const c of input.family.children) {
    if (c.alive) continue;
    slotSex.set(`pengganti_${k}`, c.sex);
    k += 1;
  }
  const hidden = new Map<string, string>();
  const cardOrder = new Set<string>();
  const cache = new Map<string, RuleRefView>();
  const rule = (id: string): RuleRefView => {
    const hit = cache.get(id);
    if (hit) return hit;
    const r = ruleRef(ix, asRuleId(id), hidden);
    for (const d of r.dalilIds) cardOrder.add(d);
    for (const d of r.ikhtilaf?.dalilIds ?? []) cardOrder.add(d);
    cache.set(id, r);
    return r;
  };
  const label = (role: string, cap = false): Msg => labelFor(role, slotSex, cap);
  const who = PEWARIS_KEY[pewarisKindOf(input, opts)];
  const pewaris = (cap = false): Msg => msg(who, undefined, cap);
  const saat = msg(opts.mode === "simulasi" ? "laporan.pewaris.saat_simulasi" : "laporan.pewaris.saat_wafat", { pewaris: pewaris() });
  return { input, ix, opts, showRupiah: opts.showRupiah !== false, slotSex, hidden, cardOrder, rule, label, pewaris, saat };
}

export function hasMessage(key: string): key is ReportMsgKey {
  return Object.prototype.hasOwnProperty.call(REPORT_MESSAGES, key);
}

/** The label of a role id (HeirId, dzawil-arham id, "pengganti_<k>", "anak_angkat", "furudh", …). */
export function labelFor(role: string, slotSex: Map<string, "L" | "P">, cap = false): Msg {
  if (role.startsWith("pengganti_")) {
    const base = role.split(".")[0];
    return msg(slotSex.get(base) === "P" ? "laporan.ahli.pengganti_pr" : "laporan.ahli.pengganti_lk", undefined, cap);
  }
  if (role.startsWith("wasith:")) return msg("laporan.ahli.wasith", undefined, cap);
  const key = `laporan.ahli.${role.split("#")[0]}`;
  if (!hasMessage(key)) throw new Error(`waris/report: no label for role "${role}"`);
  return msg(key, undefined, cap);
}

export const list = (items: Msg[]): MsgList => ({ list: items });

/** Reading order for seniors: spouse, children, grandchildren, parents, grandparents, siblings, others. */
const DISPLAY_ORDER: readonly string[] = [
  "suami",
  "istri",
  "anak_lk",
  "anak_pr",
  "pengganti",
  "cucu_lk",
  "cucu_pr",
  "ayah",
  "ibu",
  "kakek",
  "nenek_ayah",
  "nenek_ibu",
  "sdr_lk_kandung",
  "sdr_pr_kandung",
  "sdr_lk_seayah",
  "sdr_pr_seayah",
  "sdr_lk_seibu",
  "sdr_pr_seibu",
  "keponakan_lk_kandung",
  "keponakan_lk_seayah",
  "paman_kandung",
  "paman_seayah",
  "sepupu_lk_kandung",
  "sepupu_lk_seayah",
];

/** Sort key of a role for the report (stable sorts keep KHI slots in input order). */
export function displayRank(role: string): number {
  const base = role.startsWith("pengganti_") ? "pengganti" : role.split("#")[0];
  const i = DISPLAY_ORDER.indexOf(base);
  return i >= 0 ? i : DISPLAY_ORDER.length + roleRank(role);
}

// ---------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------

export type PState =
  | { kind: "share"; role: string; group: ShareGroup; p: PersonShare }
  | { kind: "blocked"; heir: string; by: string[]; rule: RuleId }
  | { kind: "ineligible"; heir: string; reason: IneligibleReason; rule: RuleId };

export type SharePState = Extract<PState, { kind: "share" }>;

export interface Col {
  id: ColumnId;
  rs: Ruleset;
  result: Result;
  /** null when the column refuses (engine rujuk, or the v1 dzawil-arham policy). */
  hasil: Hasil | null;
  refusal: RujukReason[] | null;
  persons: Map<string, PState>;
  /** Wasiat wajibah as-if illustration (16 K/AG/2010): no change texts, no table units. */
  ilustrasi: boolean;
  table: TableView | null;
}

function tableOf(h: Hasil, ilustrasi: boolean): TableView | null {
  if (ilustrasi) return null;
  const facts = (rule: string): { dari: string; menjadi: string } | undefined => {
    const st = h.trace.find((s) => s.rule === rule && s.facts?.masalah !== "tanzil");
    const dari = st?.facts?.dari;
    const menjadi = st?.facts?.menjadi;
    return dari !== undefined && menjadi !== undefined ? { dari, menjadi } : undefined;
  };
  const aul = facts("aul");
  const radd = facts("radd.tanpa_pasangan") ?? facts("radd.semua");
  const tashih = facts("tashih");
  const ikhtisar = facts("ikhtisar");
  const asal = h.base.toString();
  const dasar = radd?.menjadi ?? aul?.menjadi ?? asal;
  const caption = aul
    ? msg("laporan.ringkasan.asal_masalah_aul", { asal, menjadi: aul.menjadi })
    : radd && radd.menjadi !== asal
      ? msg("laporan.ringkasan.asal_masalah_radd", { asal, menjadi: radd.menjadi })
      : msg("laporan.ringkasan.asal_masalah", { asal });
  return {
    t: "tabel",
    asal,
    ...(aul ? { aul } : {}),
    ...(radd ? { radd } : {}),
    ...(tashih ? { tashih } : {}),
    ...(ikhtisar ? { ikhtisar } : {}),
    dasar,
    caption,
  };
}

export function analyseColumn(id: ColumnId, rs: Ruleset, r: Result): Col {
  const persons = new Map<string, PState>();
  if (r.kind === "rujuk") return { id, rs, result: r, hasil: null, refusal: [...r.reasons], persons, ilustrasi: false, table: null };
  // plan D4: v1 refuses dzawil arham in the fikih column (the engine's tanzil stays for v2)
  if (id === "fikih" && r.shares.some((g) => g.rule === "dzawil_arham.tanzil")) {
    return { id, rs, result: r, hasil: null, refusal: ["dzawil_arham"], persons, ilustrasi: false, table: null };
  }
  for (const g of r.shares) for (const p of g.persons) persons.set(p.personId, { kind: "share", role: g.heir, group: g, p });
  for (const b of r.blocked) for (const pid of b.personIds) persons.set(pid, { kind: "blocked", heir: b.heir, by: b.by, rule: b.rule });
  for (const b of r.ineligible) for (const pid of b.personIds) persons.set(pid, { kind: "ineligible", heir: b.heir, reason: b.reason, rule: b.rule });
  const ilustrasi = r.notes.includes("wasiat_wajibah_ilustrasi");
  return { id, rs, result: r, hasil: r, refusal: null, persons, ilustrasi, table: tableOf(r, ilustrasi) };
}

/** A person's share of the estate after debts in a column (0 when they receive nothing). */
export function lineOf(c: Col, personId: string): Frac {
  const s = c.persons.get(personId);
  return s && s.kind === "share" ? s.p.line : ZERO;
}

/** The share-deciding rules for some roles, in trace order, plus `extra` (the groups' own rules). */
export function shareRules(c: Col, roles: readonly string[], extra: readonly RuleId[] = []): RuleId[] {
  const out: RuleId[] = [];
  const want = new Set(roles);
  for (const st of c.hasil?.trace ?? []) {
    if (!SHARE_RULE.test(st.rule) || st.facts?.masalah === "tanzil") continue;
    if (st.heirs.some((h) => want.has(h)) && !out.includes(st.rule)) out.push(st.rule);
  }
  for (const r of extra) if (!out.includes(r)) out.push(r);
  return out;
}

export function estateRules(c: Col): RuleId[] {
  const out: RuleId[] = [];
  for (const st of c.hasil?.trace ?? []) if (ESTATE_RULE.test(st.rule) && !out.includes(st.rule)) out.push(st.rule);
  return out;
}

/** Every person in a family, alive or not, depth first (spouses, children, … step children). */
export function allPersons(fam: FamilyInput): Person[] {
  const out: Person[] = [];
  const walk = (p: Person | undefined) => {
    if (!p) return;
    out.push(p);
    for (const c of p.children ?? []) walk(c);
  };
  for (const p of [
    ...fam.spouses,
    ...fam.children,
    fam.father,
    fam.mother,
    fam.paternalGrandfather,
    fam.paternalGrandmother,
    fam.maternalGrandmother,
    fam.maternalGrandfather,
    ...fam.siblings,
    ...fam.paternalUncles,
    ...(fam.otherRelatives ?? []).map((o) => o.person),
    ...(fam.adoptedChildren ?? []),
    ...(fam.adoptiveParents ?? []),
    ...(fam.stepChildren ?? []),
  ])
    walk(p);
  return out;
}

export function hasKillerReport(fam: FamilyInput): boolean {
  return allPersons(fam).some((p) => (p.bars ?? []).some((b) => KILLER_BARS.has(b)));
}

// ---------------------------------------------------------------------------------------------
// Analysis of one input: both columns, the lead, the Ringkasan rows
// ---------------------------------------------------------------------------------------------

export interface RowDraft {
  /** "<column>:<role>". */
  key: string;
  role: string;
  origin: ColumnId;
  personIds: string[];
  differs: boolean;
}

export interface Analysis {
  input: WarisInput;
  fik: Col;
  crt: Col;
  /** The column that leads (fikih unless it refuses); null when both refuse or E-BUNUH. */
  lead: Col | null;
  /** The other column, when it computed. */
  other: Col | null;
  rows: RowDraft[];
  /** The other column is shown beside the lead (it differs somewhere, or it refuses). */
  otherShown: boolean;
  /** Both columns computed and take different bequests first (a wasiat wajibah in one only). */
  preDiffer: boolean;
  killer: boolean;
}

const isPre = (kind: string): boolean => kind === "wasiat" || kind === "wasiat_wajibah";

/** The bequests a column takes first (wasiat, wasiat wajibah), as a comparable string. */
export function preSignature(h: Hasil | null): string {
  if (!h) return "";
  return h.lines
    .filter((l) => isPre(l.kind))
    .map((l) => `${l.key}=${l.frac.n.toString()}/${l.frac.d.toString()}`)
    .sort()
    .join(";");
}

/**
 * What a column's shares are shown as: of the harta waris, or of the estate after debts (the MA
 * illustration; or a column that takes a bequest first when the columns take different ones).
 */
export function basisOf(a: Analysis, c: Col): "harta_waris" | "setelah_utang" {
  if (c.ilustrasi) return "setelah_utang";
  if (a.preDiffer && c.hasil && preSignature(c.hasil) !== "") return "setelah_utang";
  return "harta_waris";
}

/** The non-heir lines (wasiat, wasiat wajibah, residue) of a column, as a comparable string. */
function lineSignature(h: Hasil): string {
  return h.lines
    .filter((l) => l.kind !== "heir")
    .map((l) => `${l.key}=${l.frac.n.toString()}/${l.frac.d.toString()}`)
    .sort()
    .join(";");
}

export function analyse(input: WarisInput, given?: { fikih?: Result; court?: Result }): Analysis {
  const killer = hasKillerReport(input.family);
  const fr = given?.fikih ?? solve(input, FIKIH_RS);
  const cr = given?.court ?? solve(input, COURT_RS);
  const fik = analyseColumn("fikih", FIKIH_RS, fr);
  const crt = analyseColumn("court", COURT_RS, cr);
  if (killer) return { input, fik, crt, lead: null, other: null, rows: [], otherShown: false, preDiffer: false, killer };
  const lead = fik.hasil ? fik : crt.hasil ? crt : null;
  const otherCol = lead === fik ? crt : fik;
  const other = lead && otherCol.hasil ? otherCol : null;
  const rows: RowDraft[] = [];
  if (lead?.hasil) {
    const inRow = new Set<string>();
    for (const g of lead.hasil.shares) {
      rows.push({ key: `${lead.id}:${g.heir}`, role: g.heir, origin: lead.id, personIds: g.persons.map((p) => p.personId), differs: false });
      for (const p of g.persons) inRow.add(p.personId);
    }
    if (other?.hasil) {
      for (const g of other.hasil.shares) {
        const extra = g.persons.filter((p) => !inRow.has(p.personId)).map((p) => p.personId);
        if (extra.length === 0) continue;
        rows.push({ key: `${other.id}:${g.heir}`, role: g.heir, origin: other.id, personIds: extra, differs: false });
        for (const id of extra) inRow.add(id);
      }
    }
    rows.sort((a, b) => displayRank(a.role) - displayRank(b.role));
    if (other) for (const r of rows) r.differs = r.personIds.some((id) => !eq(lineOf(lead, id), lineOf(other, id)));
  }
  const linesDiffer = !!(lead?.hasil && other?.hasil) && lineSignature(lead.hasil) !== lineSignature(other.hasil);
  const otherShown = !!lead && (otherCol.refusal !== null || rows.some((r) => r.differs) || linesDiffer);
  const preDiffer = !!(lead?.hasil && other?.hasil) && preSignature(lead.hasil) !== preSignature(other.hasil);
  return { input, fik, crt, lead, other, rows, otherShown, preDiffer, killer };
}

/** Signature of both columns after the report policies (for the «Tidak tahu» comparison). */
export function analysisSignature(a: Analysis): string {
  if (a.killer) return "E-BUNUH";
  const col = (c: Col) => (c.hasil ? resultSignature(c.hasil) : `rujuk:${(c.refusal ?? []).join(",")}`);
  return `${col(a.fik)}||${col(a.crt)}`;
}

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

export function noneViews(ctx: Ctx, c: Col, personIds: readonly string[]): NoneView[] {
  const out: NoneView[] = [];
  const byKey = new Map<string, NoneView>();
  for (const id of personIds) {
    const s = c.persons.get(id);
    if (!s || s.kind === "share") continue;
    const kind: NoneView["kind"] = s.kind === "ineligible" ? "bukan" : s.rule === "hajb.istighraq" ? "habis" : "terhalang";
    const by = s.kind === "blocked" && kind === "terhalang" ? s.by : [];
    const key = `${kind}|${s.heir}|${s.rule}|${by.join(",")}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.count += 1;
      continue;
    }
    const v: NoneView = { kind, count: 1, label: ctx.label(s.heir), by: by.length > 0 ? list(by.map((b) => ctx.label(b))) : null, rule: ctx.rule(s.rule) };
    byKey.set(key, v);
    out.push(v);
  }
  return out;
}

export function sharesOf(c: Col, personIds: readonly string[]): SharePState[] {
  return personIds.map((id) => c.persons.get(id)).filter((s): s is SharePState => !!s && s.kind === "share");
}

export function cellOf(ctx: Ctx, c: Col, personIds: readonly string[]): CellView {
  const h = c.hasil;
  if (!h) throw new Error("waris/report: cellOf on a refused column");
  const shares = sharesOf(c, personIds);
  const total = shares.length > 0 ? sum(shares.map((s) => s.p.share)) : null;
  const allSame = shares.length > 0 && shares.every((s) => eq(s.p.share, shares[0].p.share));
  const perHead = shares.length > 1 && shares.length === personIds.length && allSame ? fracView(shares[0].p.share) : null;
  const rupiahOn = ctx.showRupiah && h.rupiah !== undefined;
  const persons =
    shares.length > 1 && !allSame
      ? shares.map((s) => ({
          personId: s.p.personId,
          share: fracView(s.p.share),
          rupiah: rupiahOn && s.p.rupiah !== undefined ? rupiahView(s.p.rupiah) : null,
        }))
      : null;
  const hasPreLines = h.lines.some((l) => l.kind === "wasiat" || l.kind === "wasiat_wajibah");
  const lineTotal = hasPreLines && shares.length > 0 ? fracView(sum(shares.map((s) => s.p.line))) : null;
  const linePerHead =
    lineTotal && perHead && shares.every((s) => eq(s.p.line, shares[0].p.line)) ? fracView(shares[0].p.line) : null;
  let rupiahTotal: RupiahView | null = null;
  let rupiahPerHead: RupiahView | null = null;
  if (rupiahOn && shares.length > 0) {
    let t = BigInt(0);
    for (const s of shares) t += s.p.rupiah ?? BigInt(0);
    rupiahTotal = rupiahView(t);
    const r0 = shares[0].p.rupiah;
    if (shares.length > 1 && r0 !== undefined && shares.every((s) => s.p.rupiah === r0)) rupiahPerHead = rupiahView(r0);
  }
  // 'aul / radd change: one whole share group whose nominal fardh moved
  let change: CellView["change"] = null;
  const groups = [...new Set(shares.map((s) => s.group))];
  const wholeGroup = groups.length === 1 && groups[0].persons.length === shares.length;
  if (!c.ilustrasi && wholeGroup) {
    const g = groups[0];
    const reason = h.adjustments.includes("aul") ? "aul" : h.adjustments.includes("radd") ? "radd" : null;
    const nominal = nominalOf(g.rule);
    if (reason && nominal && !eq(nominal, g.group)) {
      const from = fracView(nominal);
      const to = fracView(g.group);
      change = {
        reason,
        from,
        to,
        text: msg(reason === "aul" ? "laporan.ringkasan.aul" : "laporan.ringkasan.radd", { dari: from.figure, menjadi: to.figure }),
      };
    }
  }
  let units: string | null = null;
  if (c.table && total && groups.every((g) => g.persons.every((p) => personIds.includes(p.personId)))) {
    const u = mul(total, frac(BigInt(c.table.dasar)));
    if (u.d === BigInt(1)) units = u.n.toString();
  }
  const roles = [...new Set(shares.map((s) => s.role))];
  const rules = shareRules(c, roles, groups.map((g) => g.rule)).map((r) => ctx.rule(r));
  return {
    total: total ? fracView(total) : null,
    perHead,
    persons,
    lineTotal,
    linePerHead,
    rupiahTotal,
    rupiahPerHead,
    change,
    units,
    none: noneViews(ctx, c, personIds),
    rules,
  };
}

/**
 * Lead-column rows (or only the differing ones, for the court) of an analysis, compactly: shares
 * of the harta waris, or of the estate after debts when `after`. Rows whose role is in `open` are
 * a «Tidak tahu» count read as "dua orang atau lebih": no per-head share.
 */
export function compactRows(
  ctx: Ctx,
  a: Analysis,
  col: Col,
  onlyDiffering: boolean,
  after: boolean = basisOf(a, col) === "setelah_utang",
  open: ReadonlySet<string> = new Set(),
): CompactRow[] {
  const out: CompactRow[] = [];
  for (const r of a.rows) {
    if (onlyDiffering && !r.differs) continue;
    const cell = cellOf(ctx, col, r.personIds);
    const total = after ? (cell.lineTotal ?? cell.total) : cell.total;
    const perHead = after && cell.lineTotal ? cell.linePerHead : cell.perHead;
    const row: CompactRow = { label: ctx.label(r.role, true), count: r.personIds.length, total, perHead, ruleIds: cell.rules.map((x) => x.ruleId) };
    if (open.has(r.role) && r.personIds.length > 1) {
      row.perHead = null;
      row.open = true;
    }
    out.push(row);
  }
  return out;
}

export function refusalViews(ctx: Ctx, reasons: readonly RujukReason[]): RefusalView[] {
  return reasons.map((reason) => ({ reason, rule: ctx.rule(`rujuk.${reason}`), text: null }));
}

export function columnHead(ctx: Ctx, a: Analysis, c: Col): ColumnHead {
  const lead = a.lead?.id === c.id;
  const shown = lead || (c.hasil === null ? a.lead !== null : a.otherShown);
  return {
    id: c.id,
    label: msg(c.id === "fikih" ? "laporan.kolom.fikih" : "laporan.kolom.court"),
    status: c.hasil ? "hasil" : "rujuk",
    lead,
    shown,
    refusal: c.hasil ? null : refusalViews(ctx, c.refusal ?? []),
    table: c.hasil && shown && basisOf(a, c) === "harta_waris" ? c.table : null,
    basis: basisOf(a, c),
    switchesUsed: c.hasil ? [...c.hasil.switchesUsed] : [],
  };
}
