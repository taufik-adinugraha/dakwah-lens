/**
 * Section 1, Ringkasan (plan §6 row 1): one row per heir group with the fikih cell, and the court
 * cell only where the share differs (plan D2 = A); the bequests taken first; the unassigned
 * residue; and the «Tidak tahu» outcomes side by side (plan D15).
 */
import { eq, isZero } from "../frac";
import type { Hasil, Line } from "../types";
import {
  analyse,
  analysisSignature,
  basisOf,
  cellOf,
  columnHead,
  compactRows,
  fracView,
  preSignature,
  refusalViews,
  rupiahView,
  SOFT_STOP_NOTES,
  type Analysis,
  type Col,
  type Ctx,
} from "./analysis";
import { msg, type Msg, type MsgValue, type ReportMsgKey } from "./messages";
import type { UnknownAnswer, UnknownInput, UnknownOption, UnknownSubject } from "./options";
import type { ColumnId, CompactRow, HeirRow, OutcomeView, PerluItem, PreLineCell, PreLineView, RingkasanView } from "./types";

/** Assign a column-keyed value (the model keeps every number under "fikih" / "court"). */
export function setCol<T, V>(obj: T, id: ColumnId, value: V): T {
  (obj as unknown as Record<string, V>)[id] = value;
  return obj;
}

const SUBJECT_KEY: Readonly<Partial<Record<UnknownSubject, ReportMsgKey>>> = {
  pasangan: "laporan.hal.pasangan",
  anak: "laporan.hal.anak",
  cucu: "laporan.hal.cucu",
  orang_tua: "laporan.hal.orang_tua",
  kakek_nenek: "laporan.hal.kakek_nenek",
  saudara: "laporan.hal.saudara",
  kerabat_lain: "laporan.hal.kerabat_lain",
  agama: "laporan.hal.agama",
  wasiat: "laporan.hal.wasiat",
  persetujuan_wasiat: "laporan.hal.persetujuan_wasiat",
};

const OPTION_KEY: Readonly<Record<UnknownOption, ReportMsgKey>> = {
  ada: "laporan.kemungkinan.ada",
  tidak_ada: "laporan.kemungkinan.tidak_ada",
  satu: "laporan.kemungkinan.satu",
  dua_atau_lebih: "laporan.kemungkinan.dua_atau_lebih",
  muslim: "laporan.kemungkinan.muslim",
  bukan_muslim: "laporan.kemungkinan.bukan_muslim",
  setuju: "laporan.kemungkinan.setuju",
  belum_setuju: "laporan.kemungkinan.belum_setuju",
  mewarisi: "laporan.kemungkinan.mewarisi",
  tidak_mewarisi: "laporan.kemungkinan.tidak_mewarisi",
};

/** What a «Tidak tahu» answer was about: a relationship group, or one heir position. */
export function subjectLabel(ctx: Ctx, s: UnknownSubject): Msg {
  const key = SUBJECT_KEY[s];
  if (!key) return ctx.label(s);
  const values: Record<string, MsgValue> = {};
  if (key === "laporan.hal.agama") values.saat = ctx.saat;
  else if (key !== "laporan.hal.kerabat_lain" && key !== "laporan.hal.persetujuan_wasiat") values.pewaris = ctx.pewaris();
  return Object.keys(values).length > 0 ? msg(key, values) : msg(key);
}

/** The "bergantung" line and the "Perlu dipastikan" item for the answer that opened the readings. */
function unknownTexts(ctx: Ctx, u: UnknownInput): { line: Msg; item: Msg } {
  const kind: UnknownAnswer = u.answer ?? "tidak_tahu";
  if (kind === "iddah") return { line: msg("laporan.ringkasan.bergantung_iddah"), item: msg("laporan.catatan.iddah_bergantung") };
  if (kind === "belum_dibicarakan") return { line: msg("laporan.ringkasan.bergantung_belum"), item: msg("laporan.catatan.belum_dibicarakan") };
  const hal = subjectLabel(ctx, u.subject);
  return { line: msg("laporan.ringkasan.bergantung", { hal }), item: msg("laporan.catatan.tidak_tahu", { hal }) };
}

// ---------------------------------------------------------------------------------------------
// Bequests taken first, and the unassigned residue
// ---------------------------------------------------------------------------------------------

/** Label of a wasiat wajibah recipient: "anak angkat", "anak perempuan yang berbeda agama". */
export function wwLabel(ctx: Ctx, c: Col, personId: string): Msg {
  const s = c.persons.get(personId);
  if (!s || s.kind !== "ineligible") return msg("laporan.ahli.kerabat_jauh");
  return s.reason === "beda_agama" ? msg("laporan.ahli.beda_agama", { kerabat: ctx.label(s.heir) }) : ctx.label(s.heir);
}

export function lineLabel(ctx: Ctx, c: Col, l: Line): Msg {
  if (l.kind === "wasiat_wajibah") return msg("laporan.baris.wasiat_wajibah", { kerabat: wwLabel(ctx, c, l.personIds[0] ?? "") });
  if (l.kind === "wasiat") {
    const m = /^wasiat#([0-9]+)$/.exec(l.key);
    return m ? msg("laporan.baris.wasiat_ke", { ke: m[1] }) : msg("laporan.baris.wasiat");
  }
  if (l.kind === "sisa_dirujuk") return msg("laporan.baris.sisa");
  return ctx.label(l.key);
}

/** Wasiat wajibah notes (plan D8): the adoption ceiling, or the MA as-if illustration. */
export function wwNote(c: Col, l: Line): Msg | null {
  if (l.kind !== "wasiat_wajibah") return null;
  const s = c.persons.get(l.personIds[0] ?? "");
  const nonMuslim = !!s && s.kind === "ineligible" && s.reason === "beda_agama";
  if (nonMuslim && c.rs.switches.wasiatWajibahNonMuslim === "ma_16K2010") return msg("laporan.baris.ww_ilustrasi");
  return msg("laporan.baris.ww_plafon");
}

function preCell(ctx: Ctx, c: Col, l: Line): PreLineCell {
  const h = c.hasil as Hasil;
  const rp = ctx.showRupiah ? h.rupiah?.[l.key] : undefined;
  return { frac: fracView(l.frac), rupiah: rp !== undefined ? rupiahView(rp) : null, note: wwNote(c, l) };
}

export function preLines(ctx: Ctx, a: Analysis): PreLineView[] {
  const lead = a.lead as Col;
  const other = a.other;
  const isPre = (l: Line) => l.kind === "wasiat" || l.kind === "wasiat_wajibah";
  const keys: string[] = [];
  for (const c of [lead, other]) for (const l of c?.hasil?.lines ?? []) if (isPre(l) && !keys.includes(l.key)) keys.push(l.key);
  const out: PreLineView[] = [];
  for (const key of keys) {
    const ll = lead.hasil?.lines.find((l) => l.key === key);
    const ol = other?.hasil?.lines.find((l) => l.key === key);
    const any = (ll ?? ol) as Line;
    const from = ll ? lead : (other as Col);
    const view: PreLineView = {
      key,
      kind: any.kind === "wasiat" ? "wasiat" : "wasiat_wajibah",
      label: lineLabel(ctx, from, any),
      personIds: [...any.personIds],
    };
    if (ll) setCol(view, lead.id, preCell(ctx, lead, ll));
    if (ol && other && (!ll || !eq(ll.frac, ol.frac))) setCol(view, other.id, preCell(ctx, other, ol));
    out.push(view);
  }
  return out;
}

function residueOf(ctx: Ctx, a: Analysis): RingkasanView["residue"] {
  const lead = a.lead as Col;
  const ls = lead.hasil?.residue.sisaDirujuk;
  const os = a.other?.hasil?.residue.sisaDirujuk;
  const has = (x: typeof ls) => !!x && !isZero(x);
  if (!has(ls) && !has(os)) return null;
  const cell = (c: Col) => {
    const h = c.hasil as Hasil;
    const rp = ctx.showRupiah ? h.rupiah?.sisa_dirujuk : undefined;
    return { frac: fracView(h.residue.sisaDirujuk), rupiah: rp !== undefined ? rupiahView(rp) : null };
  };
  const view: NonNullable<RingkasanView["residue"]> = { key: "sisa_dirujuk", text: msg("laporan.ringkasan.sisa_dirujuk") };
  if (has(ls)) setCol(view, lead.id, cell(lead));
  if (a.other && has(os) && (!ls || !os || !eq(ls, os))) setCol(view, a.other.id, cell(a.other));
  return view;
}

// ---------------------------------------------------------------------------------------------
// «Tidak tahu» (plan D15)
// ---------------------------------------------------------------------------------------------

export interface UnknownResult {
  items: PerluItem[];
  /** Unknowns whose readings change the division. */
  changing: { u: UnknownInput; outcomes: OutcomeView[] }[];
}

/** The bequests a column takes first, as compact rows (shares of the estate after debts). */
function preRows(ctx: Ctx, c: Col): CompactRow[] {
  const out: CompactRow[] = [];
  for (const l of c.hasil?.lines ?? []) {
    if (l.kind !== "wasiat" && l.kind !== "wasiat_wajibah") continue;
    out.push({ label: { ...lineLabel(ctx, c, l), cap: true }, count: 1, total: fracView(l.frac), perHead: null, ruleIds: [] });
  }
  return out;
}

/**
 * One reading's columns. `afterAll`: the readings take different bequests first (e.g. G4 consent),
 * so every reading shows the estate after debts, where the difference is visible. `open`: roles
 * whose count is a «Tidak tahu» read as "dua orang atau lebih".
 */
function outcomeView(ctx: Ctx, option: Msg, base: boolean, an: Analysis, afterAll: boolean, open: ReadonlySet<string>): OutcomeView {
  const out: OutcomeView = { option, base };
  if (an.killer) {
    const r = refusalViews(ctx, ["dugaan_pembunuhan"]);
    return { option, base, fikih: { refusal: r }, court: { refusal: r } };
  }
  for (const c of [an.fik, an.crt]) {
    if (!c.hasil) {
      setCol(out, c.id, { refusal: refusalViews(ctx, c.refusal ?? []) });
      continue;
    }
    const lead = an.lead?.id === c.id;
    if (!lead && !an.otherShown) continue;
    const pre = preRows(ctx, c);
    const after = basisOf(an, c) === "setelah_utang" || (afterAll && pre.length > 0);
    setCol(out, c.id, { pre, rows: compactRows(ctx, an, c, !lead, after, open), basis: after ? "setelah_utang" : "harta_waris" });
  }
  return out;
}

/** Roles whose count differs from the base reading's (a «Tidak tahu» count: F1n, F2n, F3n). */
function openRoles(option: UnknownOption, an: Analysis, base: Analysis | undefined): Set<string> {
  const out = new Set<string>();
  if (option !== "dua_atau_lebih" || !base) return out;
  const count = (a: Analysis, role: string) => a.rows.filter((r) => r.role === role).reduce((n, r) => n + r.personIds.length, 0);
  for (const r of an.rows) if (count(an, r.role) !== count(base, r.role)) out.add(r.role);
  return out;
}

export function unknownResults(ctx: Ctx): UnknownResult {
  const items: PerluItem[] = [];
  const changing: UnknownResult["changing"] = [];
  for (const u of ctx.opts.unknowns ?? []) {
    const readings = u.variants.map((v) => ({ v, an: analyse(v.input) }));
    const changes = new Set(readings.map((x) => analysisSignature(x.an))).size > 1;
    const baseAn = (readings.find((x) => x.v.base) ?? readings[0])?.an;
    const afterAll = new Set(readings.map((x) => `${preSignature(x.an.fik.hasil)}|${preSignature(x.an.crt.hasil)}`)).size > 1;
    const outcomes = changes
      ? readings.map((x) => outcomeView(ctx, msg(OPTION_KEY[x.v.option]), x.v.base === true, x.an, afterAll, openRoles(x.v.option, x.an, baseAn)))
      : null;
    if (outcomes) changing.push({ u, outcomes });
    items.push({
      kind: "tidak_tahu",
      text: unknownTexts(ctx, u).item,
      detail: msg(changes ? "laporan.catatan.tidak_tahu_beda" : "laporan.catatan.tidak_tahu_sama"),
      rule: null,
      legal: [],
      changes,
      outcomes,
      columns: [],
    });
  }
  return { items, changing };
}

// ---------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------

export function ringkasanView(ctx: Ctx, a: Analysis, unknown: UnknownResult): RingkasanView {
  const lead = a.lead as Col;
  const other = a.other;
  const rows: HeirRow[] = a.rows.map((r) => {
    const row: HeirRow = {
      key: r.key,
      role: r.role,
      label: ctx.label(r.role, true),
      count: r.personIds.length,
      countText: msg("laporan.ringkasan.orang", { jumlah: r.personIds.length }),
      personIds: [...r.personIds],
      differs: r.differs && !!other,
      dasarAnchor: `dasar-${r.key.replace(/[^a-z0-9]+/g, "-")}`,
    };
    setCol(row, lead.id, cellOf(ctx, lead, r.personIds));
    if (other && r.differs) setCol(row, other.id, cellOf(ctx, other, r.personIds));
    return row;
  });
  let heirs = 0;
  let blocked = 0;
  let bukan = 0;
  for (const s of lead.persons.values()) {
    if (s.kind === "share") heirs += 1;
    else if (s.kind === "blocked") blocked += 1;
    else bukan += 1;
  }
  const sentence: Msg[] = [msg("laporan.ringkasan.kalimat_ahli", { jumlah: heirs })];
  if (blocked > 0) sentence.push(msg("laporan.ringkasan.kalimat_terhalang", { jumlah: blocked }));
  if (bukan > 0) sentence.push(msg("laporan.ringkasan.kalimat_bukan", { jumlah: bukan }));
  const otherCol = lead.id === "fikih" ? a.crt : a.fik;
  const agree = !!other && !a.otherShown;
  const agreeLine = other
    ? msg(agree ? "laporan.ringkasan.sama" : "laporan.ringkasan.berbeda")
    : msg("laporan.rujuk.kolom", { kolom: msg(otherCol.id === "fikih" ? "laporan.kolom.fikih" : "laporan.kolom.court") });
  const pre = preLines(ctx, a);
  const shownCols = [lead, ...(other && a.otherShown ? [other] : [])];
  const rupiahShown = ctx.showRupiah && lead.hasil?.rupiah !== undefined;
  const rumit = shownCols.some((c) => c.hasil?.notes.includes("harta_bersama_rumit"));
  const one = unknown.changing.length === 1 ? unknown.changing[0] : null;
  const stamps: RingkasanView["stamps"] = [];
  for (const n of SOFT_STOP_NOTES) {
    const columns = shownCols.filter((c) => c.hasil?.notes.includes(n)).map((c) => c.id);
    if (columns.length > 0) stamps.push({ text: null, rule: ctx.rule(`catatan.${n}`), columns });
  }
  if (ctx.opts.flags?.iddahRaji) stamps.push({ text: iddahText(ctx), rule: null, columns: shownCols.map((c) => c.id) });
  // a column that takes a bequest first while the other takes a different one shows the estate after debts
  const afterShown = shownCols.some((c) => c.hasil && basisOf(a, c) === "setelah_utang" && preSignature(c.hasil) !== "");
  const baseOutcome = one ? (one.outcomes.find((o) => o.base) ?? one.outcomes[0]) : null;
  return {
    title: msg("laporan.ringkasan.judul"),
    sentence,
    agree,
    agreeLine,
    columns: { fikih: columnHead(ctx, a, a.fik), court: columnHead(ctx, a, a.crt) },
    rows,
    preLines: pre,
    residue: residueOf(ctx, a),
    basisNote: pre.length === 0 ? null : msg(afterShown ? "laporan.ringkasan.basis_setelah_utang" : "laporan.ringkasan.basis"),
    fractionNote: msg("laporan.ringkasan.catatan_pecahan"),
    rupiahShown,
    rupiahNote: rumit ? msg("laporan.ringkasan.rupiah_rumit") : null,
    stamps,
    bergantung: one && baseOutcome ? { line: unknownTexts(ctx, one.u).line, node: one.u.node, outcomes: one.outcomes, baseOption: baseOutcome.option } : null,
  };
}

/** The 'iddah stamp: the deceased husband's wife in her 'iddah, or the deceased wife in hers. */
export function iddahText(ctx: Ctx): Msg {
  return msg(ctx.input.family.deceased.sex === "P" ? "laporan.catatan.iddah_p" : "laporan.catatan.iddah", { pewaris: ctx.pewaris(true) });
}
