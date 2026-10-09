/**
 * Sections 4–6: Dalil untuk setiap bagian, Catatan metode, Langkah berikutnya (plan §6 rows 4–6).
 *
 * The fikih-vs-KHI table lists only the differing heirs, each with the switches whose flip back to
 * the fikih value changes them: re-solving the court column with each used switch set to its
 * klasik-syafii value (engine.md §12.1). The D7 line is the court column re-solved with
 * residue = radd_all. No sentence says anything was or will be reviewed (operator: no review).
 */
import { eq, floorTimes, type Frac } from "../frac";
import { PROFILES, withSwitch, type NoteId, type RuleId, type SwitchName } from "../registry";
import { solveOnce } from "../solve";
import type { Hasil, Result } from "../types";
import { cellOf, estateRules, fracView, lineOf, SOFT_STOP_NOTES, SWITCH_RULES, type Analysis, type Col, type Ctx } from "./analysis";
import { legalRef } from "./content";
import { dateText } from "./code";
import { msg, type Msg } from "./messages";
import { ENGINE_VERSION_DEFAULT } from "./options";
import { iddahText, lineLabel, setCol, type UnknownResult } from "./ringkasan";
import type {
  CatatanView,
  ColumnId,
  DalilRow,
  DalilRowRef,
  DalilSectionView,
  DiffRow,
  HeirRow,
  LangkahItem,
  LangkahView,
  PerluItem,
  RuleRefView,
  TidakMendapatView,
} from "./types";

// ---------------------------------------------------------------------------------------------
// 4. Dalil
// ---------------------------------------------------------------------------------------------

function dalilIdsOf(rules: readonly RuleRefView[]): string[] {
  const out: string[] = [];
  for (const r of rules) for (const d of r.dalilIds) if (!out.includes(d)) out.push(d);
  return out;
}

export function dalilSectionView(ctx: Ctx, a: Analysis, rows: readonly HeirRow[], tidak: TidakMendapatView): { view: DalilSectionView; order: string[] } {
  const lead = a.lead as Col;
  const seen: string[] = [];
  const refs = (ids: readonly string[]): DalilRowRef[] =>
    ids.map((id) => {
      const first = !seen.includes(id);
      if (first) seen.push(id);
      return { id, first };
    });
  const out: DalilRow[] = [];
  for (const row of rows) {
    const leadCell = row[lead.id];
    const otherId: ColumnId = lead.id === "fikih" ? "court" : "fikih";
    const otherCell = row[otherId];
    const rules = leadCell?.rules ?? [];
    const courtRules = (otherCell?.rules ?? []).filter((r) => !rules.some((x) => x.ruleId === r.ruleId));
    const ids = dalilIdsOf([...rules, ...courtRules]);
    const d: DalilRow = {
      anchor: row.dasarAnchor,
      title: msg("laporan.dalil.dasar_bagian", { kerabat: ctx.label(row.role) }),
      countLine: msg("laporan.dalil.rujukan", { jumlah: ids.length }),
      rules,
      dalil: refs(ids),
      courtRules,
      courtLine: courtRules.length > 0 ? msg("laporan.dalil.kolom_court") : null,
    };
    if (leadCell?.total) setCol(d, lead.id, leadCell.total);
    if (otherCell?.total) setCol(d, otherId, otherCell.total);
    out.push(d);
  }
  // estate steps: harta bersama, biaya, utang, wasiat, wasiat wajibah (both shown columns)
  const estate: RuleId[] = [];
  for (const c of [lead, ...(a.other && a.otherShown ? [a.other] : [])]) for (const r of estateRules(c)) if (!estate.includes(r)) estate.push(r);
  let sebelum: DalilRow | null = null;
  if (estate.length > 0) {
    const rules = estate.map((r) => ctx.rule(r));
    const ids = dalilIdsOf(rules);
    sebelum = { anchor: "dasar-sebelum", title: msg("laporan.dalil.sebelum"), countLine: msg("laporan.dalil.rujukan", { jumlah: ids.length }), rules, dalil: refs(ids), courtRules: [], courtLine: null };
  }
  // exclusions and non-heirs
  const tRules: RuleRefView[] = [];
  const addRule = (r: RuleRefView) => {
    if (!tRules.some((x) => x.ruleId === r.ruleId)) tRules.push(r);
  };
  for (const g of tidak.groups) {
    for (const e of g.entries) {
      for (const rv of [e.fikih, e.court]) if (rv) addRule(rv.rule);
      for (const j of e.jalan) for (const r of j.rules) addRule(r);
    }
    for (const n of g.notAsked) if (n.rule) addRule(n.rule);
  }
  let tidakRow: DalilRow | null = null;
  if (tRules.length > 0) {
    const ids = dalilIdsOf(tRules);
    tidakRow = {
      anchor: "dasar-tidak-mendapat",
      title: msg("laporan.dalil.tidak_mendapat"),
      countLine: msg("laporan.dalil.rujukan", { jumlah: ids.length }),
      rules: tRules,
      dalil: refs(ids),
      courtRules: [],
      courtLine: null,
    };
  }
  return { view: { title: msg("laporan.dalil.judul"), rows: out, sebelum, tidakMendapat: tidakRow, seeAbove: msg("laporan.dalil.lihat_atas") }, order: seen };
}

// ---------------------------------------------------------------------------------------------
// 5. Catatan metode
// ---------------------------------------------------------------------------------------------

function altLine(r: Result, personId: string): Frac | null {
  if (r.kind !== "hasil") return null;
  for (const g of r.shares) for (const p of g.persons) if (p.personId === personId) return p.line;
  return null;
}

/** Persons whose after-debts share changes when a court switch is flipped back to its fikih value. */
export function switchEffects(a: Analysis, court: Col): Map<SwitchName, Set<string> | "semua"> {
  const out = new Map<SwitchName, Set<string> | "semua">();
  const h = court.hasil as Hasil;
  const klasik = PROFILES["klasik-syafii"];
  const ids = [...court.persons.keys()];
  for (const s of h.switchesUsed) {
    const alt = solveOnce(a.input, withSwitch(court.rs, s, klasik[s]));
    if (alt.kind === "rujuk") {
      out.set(s, "semua");
      continue;
    }
    const changed = new Set<string>();
    for (const id of ids) {
      const x = altLine(alt, id);
      const now = lineOf(court, id);
      if (x === null ? now.n !== BigInt(0) : !eq(x, now)) changed.add(id);
    }
    out.set(s, changed);
  }
  return out;
}

function diffRows(ctx: Ctx, a: Analysis): DiffRow[] {
  if (!a.other || !a.lead || !a.otherShown) return [];
  const fik = a.fik.hasil ? a.fik : null;
  const crt = a.crt.hasil ? a.crt : null;
  if (!fik || !crt) return [];
  const effects = switchEffects(a, crt);
  const out: DiffRow[] = [];
  for (const r of a.rows) {
    if (!r.differs) continue;
    const fc = cellOf(ctx, fik, r.personIds);
    const cc = cellOf(ctx, crt, r.personIds);
    const switches: SwitchName[] = [];
    for (const [s, set] of effects) if (set === "semua" || r.personIds.some((id) => set.has(id))) switches.push(s);
    const ruleIds: RuleId[] = [];
    for (const s of switches.length > 0 ? switches : (crt.hasil as Hasil).switchesUsed) for (const id of SWITCH_RULES[s]) if (!ruleIds.includes(id)) ruleIds.push(id);
    const rules = ruleIds.map((id) => ctx.rule(id));
    const noneText = (c: typeof fc): Msg | null => {
      if (c.total) return null;
      const n = c.none[0];
      if (!n) return msg("laporan.ringkasan.tidak_mendapat");
      if (n.kind === "terhalang" && n.by) return msg("laporan.ringkasan.terhalang_oleh", { oleh: n.by });
      if (n.kind === "bukan") return msg("laporan.ringkasan.bukan_ahli_waris");
      return msg("laporan.ringkasan.tidak_mendapat");
    };
    // compare what the money follows: the after-debts share when either column takes a bequest first
    const afterDebts = !!(fc.lineTotal || cc.lineTotal);
    const pick = (c: typeof fc) => (afterDebts ? (c.lineTotal ?? c.total) : c.total);
    out.push({
      label: ctx.label(r.role, true),
      personIds: [...r.personIds],
      basis: afterDebts ? "setelah_utang" : "harta_waris",
      fikih: { total: pick(fc), none: noneText(fc) },
      court: { total: pick(cc), none: noneText(cc) },
      switches,
      because:
        switches.length > 0
          ? msg("laporan.catatan.beda_sebab", { aturan: rules.map((x) => x.title).join("; ") })
          : msg("laporan.catatan.beda_kombinasi"),
      rules,
    });
  }
  return out;
}

const SPOUSES = new Set(["suami", "istri"]);

function raddNote(ctx: Ctx, a: Analysis): CatatanView["raddNote"] {
  const crt = a.crt.hasil ? a.crt : null;
  if (!crt || !a.lead) return null;
  const h = crt.hasil as Hasil;
  const spouse = h.shares.find((g) => SPOUSES.has(g.heir));
  if (!h.adjustments.includes("radd") || !spouse) return null;
  const alt = solveOnce(a.input, withSwitch(crt.rs, "residue", "radd_all"));
  if (alt.kind !== "hasil") return null;
  const altG = alt.shares.find((g) => g.heir === spouse.heir);
  if (!altG || eq(altG.group, spouse.group)) return null;
  const heir = ctx.label(spouse.heir);
  const altV = fracView(altG.group);
  return {
    court: {
      text: msg("laporan.catatan.radd_pasangan", { kerabat: heir, bagian: `${altV.figure} (${altV.words})` }),
      heir,
      now: fracView(spouse.group),
      alt: altV,
    },
  };
}

/** Who received the extra rupiah of the largest-remainder rounding (engine.md §14). */
function roundingLine(ctx: Ctx, c: Col): Msg | null {
  const h = c.hasil as Hasil;
  if (!ctx.showRupiah || !h.rupiah || !h.estate) return null;
  const T = h.estate.afterDebts;
  const names: Msg[] = [];
  const keys: string[] = [];
  const addName = (key: string, m: Msg) => {
    if (keys.includes(key)) return;
    keys.push(key);
    names.push(m);
  };
  for (const l of h.lines) {
    if (l.kind === "heir") continue;
    const got = h.rupiah[l.key];
    if (got !== undefined && got > floorTimes(T, l.frac).q) addName(l.key, lineLabel(ctx, c, l));
  }
  for (const g of h.shares) {
    for (const p of g.persons) {
      if (p.rupiah !== undefined && p.rupiah > floorTimes(T, p.line).q) addName(g.heir, ctx.label(g.heir));
    }
  }
  return names.length > 0 ? msg("laporan.catatan.pembulatan_kepada", { daftar: { list: names } }) : null;
}

function tableLines(ctx: Ctx, c: Col): Msg[] {
  const out: Msg[] = [];
  const t = c.table;
  if (t?.tashih) out.push(msg("laporan.catatan.tabel_tashih", { dari: t.tashih.dari, menjadi: t.tashih.menjadi }));
  if (t?.ikhtisar) out.push(msg("laporan.catatan.tabel_ikhtisar", { dari: t.ikhtisar.dari, menjadi: t.ikhtisar.menjadi, asal: t.asal }));
  const r = roundingLine(ctx, c);
  if (r) out.push(r);
  return out;
}

export function catatanView(ctx: Ctx, a: Analysis, unknown: UnknownResult): CatatanView {
  const lead = a.lead as Col;
  const shown: Col[] = [lead, ...(a.other && a.otherShown ? [a.other] : [])];
  const computed: Col[] = [lead, ...(a.other ? [a.other] : [])];
  const flags = ctx.opts.flags ?? {};
  const traceHas = (re: RegExp) => shown.some((c) => (c.hasil?.trace ?? []).some((s) => re.test(s.rule)));
  const assumptions: CatatanView["assumptions"] = [{ text: msg("laporan.catatan.asumsi_hidup", { saat: ctx.saat }), rule: null }];
  if (traceHas(/^estate\.harta_bersama/)) assumptions.push({ text: msg("laporan.catatan.asumsi_harta_bersama"), rule: ctx.rule("estate.harta_bersama") });
  const raddWithSpouse = shown.some((c) => c.hasil?.adjustments.includes("radd") && c.hasil.shares.some((g) => SPOUSES.has(g.heir)));
  if (raddWithSpouse) assumptions.push({ text: msg("laporan.catatan.asumsi_tanpa_radd_pasangan"), rule: ctx.rule("radd.tanpa_pasangan") });
  assumptions.push({ text: msg("laporan.catatan.asumsi_pecahan"), rule: null });
  if (flags.wasiatTidakTahu) assumptions.push({ text: msg("laporan.catatan.asumsi_wasiat_tidak_tahu"), rule: ctx.rule("estate.wasiat") });
  if (!lead.hasil?.estate) assumptions.push({ text: msg("laporan.catatan.asumsi_tanpa_rupiah"), rule: null });
  if (flags.munasakhat) assumptions.push({ text: null, rule: ctx.rule("catatan.munasakhat") });

  const rows = diffRows(ctx, a);
  const perlu: PerluItem[] = [...unknown.items];
  const other: CatatanView["other"] = [];
  const noteCols = new Map<NoteId, ColumnId[]>();
  for (const c of computed) for (const n of c.hasil?.notes ?? []) noteCols.set(n, [...(noteCols.get(n) ?? []), c.id]);
  for (const [n, columns] of noteCols) {
    if (n === "munasakhat" && flags.munasakhat) continue; // already an assumption
    const rule = ctx.rule(`catatan.${n}`);
    if (SOFT_STOP_NOTES.has(n)) perlu.push({ kind: "catatan", text: null, detail: null, rule, legal: [], changes: null, outcomes: null, columns });
    else other.push({ rule, columns });
  }
  if (flags.iddahRaji) perlu.push({ kind: "flag", text: iddahText(ctx), detail: null, rule: null, legal: [], changes: null, outcomes: null, columns: [] });
  if (flags.nikahSiri) {
    perlu.push({
      kind: "flag",
      text: msg("laporan.catatan.siri"),
      detail: null,
      rule: null,
      legal: [legalRef(ctx.ix, { source: "buku-ii-2026", locator: "huruf i" })],
      changes: null,
      outcomes: null,
      columns: ["court"],
    });
  }
  const table: CatatanView["table"] = {};
  for (const c of shown) {
    const lines = tableLines(ctx, c);
    if (lines.length > 0) setCol(table, c.id, lines);
  }
  const rounding = shown.some((c) => (c.hasil?.trace ?? []).some((s) => s.rule === "rupiah.pembulatan")) ? ctx.rule("rupiah.pembulatan") : null;
  const sha = typeof ctx.ix.meta.source_sha256 === "string" ? ctx.ix.meta.source_sha256.slice(0, 8) : "-";
  const written = typeof ctx.ix.meta.written === "string" ? (dateText(ctx.ix.meta.written) ?? ctx.ix.meta.written) : "-";
  return {
    title: msg("laporan.catatan.judul"),
    assumptionsTitle: msg("laporan.catatan.asumsi_judul"),
    assumptions,
    diff: rows.length > 0 ? { title: msg("laporan.catatan.beda_judul"), why: msg("laporan.catatan.mengapa_dua"), rows } : null,
    raddNote: raddNote(ctx, a),
    perluTitle: msg("laporan.catatan.perlu_judul"),
    perlu,
    otherTitle: msg("laporan.catatan.catatan_lain"),
    other,
    table,
    roundingRule: rounding,
    version: msg("laporan.catatan.versi", { mesin: ctx.opts.engineVersion ?? ENGINE_VERSION_DEFAULT, aturan: sha, tanggal: written }),
  };
}

// ---------------------------------------------------------------------------------------------
// 6. Langkah berikutnya (plan §6 row 6)
// ---------------------------------------------------------------------------------------------

export function langkahView(ctx: Ctx, perluCount: number): LangkahView {
  const L = (source: string, locator: string) => legalRef(ctx.ix, { source, locator });
  const item = (id: LangkahItem["id"], text: Msg, extra: Partial<Omit<LangkahItem, "id" | "text">> = {}): LangkahItem => {
    for (const d of extra.dalilIds ?? []) ctx.cardOrder.add(d);
    return { id, text, rules: extra.rules ?? [], dalilIds: extra.dalilIds ?? [], legal: extra.legal ?? [], action: extra.action ?? null, sub: extra.sub ?? false };
  };
  const items: LangkahItem[] = [
    item("utang_wasiat", msg(ctx.opts.mode === "simulasi" ? "laporan.langkah.utang_wasiat_simulasi" : "laporan.langkah.utang_wasiat", { pewaris: ctx.pewaris() }), { rules: [ctx.rule("estate.utang"), ctx.rule("estate.wasiat")] }),
    item("musyawarah", msg("laporan.langkah.musyawarah"), { rules: [ctx.rule("khi.perdamaian")] }),
    item("anak_kecil", msg("laporan.langkah.anak_kecil"), {
      sub: true,
      dalilIds: ["Q-4-10"],
      legal: [L("khi", "Pasal 184"), L("uu-1-1974", "Pasal 48 dan Pasal 52")],
    }),
    item("pemberian", msg("laporan.langkah.pemberian"), { dalilIds: ["Q-4-8"] }),
    item("bukti", msg("laporan.langkah.bukti"), { legal: [L("sema-1-2017", "Rumusan Kamar Agama C.2"), L("permen-atr-bpn-16-2021", "Pasal 111")] }),
    item("sawah", msg("laporan.langkah.sawah"), { legal: [L("khi", "Pasal 189")] }),
    item("tanah_mui", msg("laporan.langkah.tanah_mui"), { sub: true, legal: [L("mui-1984-tanah-warisan", "Himpunan Fatwa MUI no. 10, hlm. 309-310")] }),
    item("sengketa", msg("laporan.langkah.sengketa"), { legal: [L("khi", "Pasal 188")] }),
  ];
  if (perluCount > 0) items.push(item("tanya", msg("laporan.langkah.tanya")));
  if (ctx.opts.flags?.munasakhat) {
    items.push(
      item("munasakhat", msg("laporan.langkah.munasakhat", { pewaris: ctx.pewaris() }), {
        rules: [ctx.rule("catatan.munasakhat")],
        action: { kind: "hitung_untuk_beliau", label: msg("laporan.langkah.hitung_beliau") },
      }),
    );
  }
  return { title: msg("laporan.langkah.judul"), items };
}
