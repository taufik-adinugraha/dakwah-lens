/**
 * Section 2, Diagram (plan §6 row 2; architecture.md §8.1): (a) the shrinking bar from the whole
 * estate to the harta waris (only with rupiah), (b) the estate bar with a pattern + label +
 * fraction per heir, (c) the family tree with share chips and hatched blocked nodes. Each comes
 * with a caption in words, and every number sits under its column key.
 */
import { eq, frac, isZero, lt, type Frac } from "../frac";
import type { Hasil, Person } from "../types";
import { basisOf, cellOf, fracView, lineOf, list, rupiahView, type Analysis, type Col, type Ctx } from "./analysis";
import { msg, type Msg, type ReportMsgKey } from "./messages";
import type { NotAskedInput } from "./options";
import { lineLabel, setCol } from "./ringkasan";
import type { BarSegment, BarView, DiagramView, ShrinkStep, TreeNode, TreeNodeColumn, TreeView } from "./types";

const SMALL: Frac = frac(1, 12);

// ---------------------------------------------------------------------------------------------
// (a) shrinking bar
// ---------------------------------------------------------------------------------------------

function shrinkSteps(ctx: Ctx, c: Col): ShrinkStep[] | null {
  const h = c.hasil as Hasil;
  const est = h.estate;
  const rp = h.rupiah;
  if (!ctx.showRupiah || !est || !rp) return null;
  let remaining = est.grossOwn;
  for (const v of Object.values(est.hartaBersamaSpouse)) remaining += v;
  const steps: ShrinkStep[] = [
    { key: "harta_awal", label: msg("laporan.urutan.harta_awal"), amount: rupiahView(remaining), remaining: rupiahView(remaining), ruleId: null },
  ];
  const step = (key: string, label: Msg, amount: bigint, ruleId: ShrinkStep["ruleId"]) => {
    if (amount <= BigInt(0)) return;
    remaining -= amount;
    steps.push({ key, label, amount: rupiahView(amount), remaining: rupiahView(remaining), ruleId });
  };
  for (const [k, v] of Object.entries(est.hartaBersamaSpouse)) step(`harta_bersama:${k}`, msg("laporan.urutan.harta_bersama", { kerabat: ctx.label(k) }), v, "estate.harta_bersama");
  step("biaya_sakit", msg("laporan.urutan.biaya_sakit"), est.biayaSakit, "estate.biaya");
  step("biaya_jenazah", msg("laporan.urutan.biaya_jenazah"), est.biayaJenazah, "estate.biaya");
  step("utang", msg("laporan.urutan.utang", { pewaris: ctx.pewaris() }), est.utang, "estate.utang");
  for (const l of h.lines) {
    if (l.kind !== "wasiat" && l.kind !== "wasiat_wajibah") continue;
    step(l.key, lineLabel(ctx, c, l), rp[l.key] ?? BigInt(0), l.kind === "wasiat" ? "estate.wasiat" : "estate.wasiat_wajibah");
  }
  steps.push({ key: "harta_waris", label: msg("laporan.urutan.harta_waris"), amount: rupiahView(remaining), remaining: rupiahView(remaining), ruleId: null });
  return steps;
}

function sameSteps(a: ShrinkStep[] | null, b: ShrinkStep[] | null): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((s, i) => s.key === b[i].key && s.amount.amount === b[i].amount.amount);
}

// ---------------------------------------------------------------------------------------------
// (b) estate bar
// ---------------------------------------------------------------------------------------------

function barOf(ctx: Ctx, a: Analysis, c: Col): BarView {
  const h = c.hasil as Hasil;
  // the MA as-if illustration, and a column whose bequests taken first differ from the other
  // column's, lead with the after-debts share (ColumnHead.basis): the bar then shows the bequests
  // beside the heirs; otherwise it divides the harta waris
  const after = basisOf(a, c) === "setelah_utang";
  const segments: BarSegment[] = [];
  const caption: Msg[] = [];
  if (after) {
    h.lines.forEach((l, i) => {
      if (l.kind !== "wasiat" && l.kind !== "wasiat_wajibah") return;
      const label = { ...lineLabel(ctx, c, l), cap: true };
      const fv = fracView(l.frac);
      segments.push({ key: l.key, label, frac: fv, pattern: a.rows.length + 1 + i, small: lt(l.frac, SMALL), units: null, personIds: [...l.personIds], kind: "wasiat" });
      caption.push(msg("laporan.diagram.keterangan_bagian", { kerabat: label, bagian: fv.words }));
    });
  }
  a.rows.forEach((r, i) => {
    const cell = cellOf(ctx, c, r.personIds);
    const fv = after ? (cell.lineTotal ?? cell.total) : cell.total;
    if (!fv) return;
    const f = frac(BigInt(fv.n), BigInt(fv.d));
    segments.push({
      key: r.key,
      label: ctx.label(r.role, true),
      frac: fv,
      pattern: i,
      small: lt(f, SMALL),
      units: after ? null : cell.units,
      personIds: r.personIds.filter((id) => c.persons.get(id)?.kind === "share"),
      kind: "heir",
    });
    caption.push(msg("laporan.diagram.keterangan_bagian", { kerabat: ctx.label(r.role, true), bagian: fv.words }));
  });
  const sisaLine = h.lines.find((l) => l.kind === "sisa_dirujuk");
  const sisa = after ? (sisaLine?.frac ?? null) : isZero(h.residue.sisaDirujuk) ? null : h.residue.sisaDirujuk;
  if (sisa && !isZero(sisa)) {
    const fv = fracView(sisa);
    segments.push({ key: "sisa_dirujuk", label: msg("laporan.baris.sisa", undefined, true), frac: fv, pattern: a.rows.length, small: lt(sisa, SMALL), units: null, personIds: [], kind: "sisa" });
    caption.push(msg("laporan.diagram.keterangan_sisa", { bagian: fv.words }));
  }
  return { basis: after ? "setelah_utang" : "harta_waris", segments, table: after ? null : c.table, caption };
}

// ---------------------------------------------------------------------------------------------
// (c) family tree
// ---------------------------------------------------------------------------------------------

function nodeColumn(ctx: Ctx, c: Col, personId: string): TreeNodeColumn | null {
  const s = c.persons.get(personId);
  if (!s) return null;
  if (s.kind === "share") return { status: "bagian", share: fracView(s.p.share), by: null, hatch: false };
  if (s.kind === "blocked") {
    const by = s.rule === "hajb.istighraq" ? null : list(s.by.map((b) => ctx.label(b)));
    return { status: "terhalang", share: null, by, hatch: true };
  }
  return { status: "bukan", share: null, by: null, hatch: false };
}

function stateRole(c: Col, personId: string): string | null {
  const s = c.persons.get(personId);
  if (!s) return null;
  return s.kind === "share" ? s.role : s.heir;
}

type Side = TreeNode["side"];

export function treeView(ctx: Ctx, a: Analysis): TreeView {
  const lead = a.lead as Col;
  const other = a.other;
  const fam = ctx.input.family;
  const nodes: TreeNode[] = [];
  // a simulation is about a living person ("Anda", "Beliau"), never "Almarhum"
  const rootLabel = ctx.opts.mode === "simulasi" ? ctx.pewaris(true) : msg(fam.deceased.sex === "P" ? "laporan.pohon.pewaris_p" : "laporan.pohon.pewaris_l");
  nodes.push({ id: "pewaris", parent: null, generation: 0, side: "pusat", kind: "pewaris", label: rootLabel, personId: null, outside: false, groupKey: "pewaris" });

  const hasLivingDesc = (p: Person): boolean => (p.children ?? []).some((c) => c.alive || hasLivingDesc(c));
  const add = (p: Person, relation: string, parent: string, generation: number, side: Side, outside = false): string | null => {
    if (!p.alive && !hasLivingDesc(p)) return null;
    const id = `n:${p.id}`;
    const role = p.alive ? (stateRole(lead, p.id) ?? relation) : relation;
    const label = ctx.label(role, true);
    const node: TreeNode = {
      id,
      parent,
      generation,
      side,
      kind: p.alive ? "kerabat" : "wafat_lebih_dulu",
      label,
      personId: p.alive ? p.id : null,
      outside,
      groupKey: "",
    };
    let sig = p.alive ? "?" : "wafat";
    if (p.alive) {
      const lc = nodeColumn(ctx, lead, p.id);
      if (lc) {
        setCol(node, lead.id, lc);
        sig = `${lc.status}:${lc.share?.figure ?? ""}`;
      }
      if (other && !eq(lineOf(lead, p.id), lineOf(other, p.id))) {
        const oc = nodeColumn(ctx, other, p.id);
        if (oc) {
          setCol(node, other.id, oc);
          sig += `|${oc.status}:${oc.share?.figure ?? ""}`;
        }
      }
    }
    node.groupKey = `${parent}|${label.key}|${sig}`;
    nodes.push(node);
    return id;
  };

  const descend = (p: Person, parentNode: string, generation: number, childRole: (c: Person) => string) => {
    for (const c of p.children ?? []) {
      const id = add(c, childRole(c), parentNode, generation, "pusat");
      if (id) descend(c, id, generation + 1, () => "kerabat_jauh");
    }
  };

  const spouseRole = fam.deceased.sex === "L" ? "istri" : "suami";
  for (const s of fam.spouses) if (s.alive) add(s, spouseRole, "pewaris", 0, "pusat");
  for (const c of fam.children) {
    const id = add(c, c.sex === "L" ? "anak_lk" : "anak_pr", "pewaris", 1, "pusat");
    if (!id) continue;
    descend(c, id, 2, (g) => {
      if (c.sex === "L") return g.sex === "L" ? "cucu_lk" : "cucu_pr";
      return g.sex === "L" ? "cucu_lk_dari_anak_pr" : "cucu_pr_dari_anak_pr";
    });
  }
  const fatherId = fam.father ? add(fam.father, "ayah", "pewaris", -1, "ayah") : null;
  const motherId = fam.mother ? add(fam.mother, "ibu", "pewaris", -1, "ibu") : null;
  if (fam.paternalGrandfather) add(fam.paternalGrandfather, "kakek", fatherId ?? "pewaris", -2, "ayah");
  if (fam.paternalGrandmother) add(fam.paternalGrandmother, "nenek_ayah", fatherId ?? "pewaris", -2, "ayah");
  if (fam.maternalGrandmother) add(fam.maternalGrandmother, "nenek_ibu", motherId ?? "pewaris", -2, "ibu");
  if (fam.maternalGrandfather) add(fam.maternalGrandfather, "kakek_dari_ibu", motherId ?? "pewaris", -2, "ibu");
  for (const s of fam.siblings) {
    const role = s.line === "seibu" ? (s.sex === "L" ? "sdr_lk_seibu" : "sdr_pr_seibu") : `sdr_${s.sex === "L" ? "lk" : "pr"}_${s.line}`;
    const side: Side = s.line === "seayah" ? "ayah" : s.line === "seibu" ? "ibu" : "pusat";
    const id = add(s, role, "pewaris", 0, side);
    if (!id) continue;
    descend(s, id, 1, (k) => {
      if (s.line === "seibu") return "anak_sdr_seibu";
      if (s.sex === "L") return k.sex === "L" ? `keponakan_lk_${s.line}` : `anak_pr_sdr_lk_${s.line}`;
      return `anak_${k.sex === "L" ? "lk" : "pr"}_sdr_pr_${s.line}`;
    });
  }
  for (const u of fam.paternalUncles) {
    const id = add(u, u.line === "kandung" ? "paman_kandung" : "paman_seayah", fatherId ?? "pewaris", -1, "ayah");
    if (!id) continue;
    descend(u, id, 0, (k) => (k.sex === "L" ? `sepupu_lk_${u.line}` : `anak_pr_paman_${u.line}`));
  }
  for (const o of fam.otherRelatives ?? []) {
    const side: Side = ["kakek_dari_ibu", "paman_ibu", "bibi_ibu"].includes(o.relation) ? "ibu" : ["paman_seibu_ayah", "bibi_ayah"].includes(o.relation) ? "ayah" : "pusat";
    add(o.person, o.relation, "pewaris", 0, side);
  }
  for (const x of fam.adoptedChildren ?? []) add(x, "anak_angkat", "pewaris", 1, "pusat", true);
  for (const x of fam.adoptiveParents ?? []) add(x, "orang_tua_angkat", "pewaris", -1, "pusat", true);
  for (const x of fam.stepChildren ?? []) add(x, "anak_tiri", "pewaris", 1, "pusat", true);

  // "Almarhum, istri, 2 anak laki-laki, ibu"
  const counts = new Map<ReportMsgKey, number>();
  for (const n of nodes) if (n.kind === "kerabat") counts.set(n.label.key, (counts.get(n.label.key) ?? 0) + 1);
  const daftar = [...counts].map(([key, k]) => (k > 1 ? msg("laporan.pohon.jumlah", { jumlah: k, kerabat: msg(key) }) : msg(key)));
  return { nodes, aria: msg("laporan.pohon.ringkas", { pewaris: rootLabel, daftar: list(daftar) }), notAsked: notAskedLines(ctx, ctx.opts.notAsked ?? []) };
}

const GROUP_KEY: Readonly<Record<NotAskedInput["group"], ReportMsgKey>> = {
  saudara: "laporan.kelompok.saudara",
  saudara_kandung: "laporan.kelompok.saudara_kandung",
  saudara_seayah: "laporan.kelompok.saudara_seayah",
  saudara_seibu: "laporan.kelompok.saudara_seibu",
  keponakan: "laporan.kelompok.keponakan",
  paman: "laporan.kelompok.paman",
  sepupu: "laporan.kelompok.sepupu",
  kakek: "laporan.kelompok.kakek",
  nenek: "laporan.kelompok.nenek",
  cucu: "laporan.kelompok.cucu",
  kerabat_lain: "laporan.kelompok.kerabat_lain",
};

/**
 * "Saudara tidak ditanyakan karena ada anak laki-laki." (plan §5.1). A group skipped with no
 * named relative (nothing is left over for it, e.g. after an 'aul) says "karena tidak mengubah
 * pembagian", as the questionnaire's own skip line does.
 */
export function notAskedLines(ctx: Ctx, items: readonly NotAskedInput[]): Msg[] {
  return items.map((x) => {
    const kelompok = msg(GROUP_KEY[x.group], undefined, true);
    if (x.because.length === 0) return msg("laporan.tidak.ditanya_tanpa_sebab", { kelompok });
    return msg("laporan.tidak.ditanya", { kelompok, oleh: list(x.because.map((b) => ctx.label(b))) });
  });
}

// ---------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------

export function diagramView(ctx: Ctx, a: Analysis): DiagramView {
  const lead = a.lead as Col;
  const other = a.other && a.otherShown ? a.other : null;
  const leadSteps = shrinkSteps(ctx, lead);
  const otherSteps = other ? shrinkSteps(ctx, other) : null;
  let shrink: DiagramView["shrink"] = null;
  if (leadSteps) {
    shrink = { title: msg("laporan.diagram.urutan") };
    setCol(shrink, lead.id, leadSteps);
    if (other && otherSteps && !sameSteps(leadSteps, otherSteps)) setCol(shrink, other.id, otherSteps);
  }
  const bars: DiagramView["bars"] = { title: msg("laporan.diagram.bilah") };
  setCol(bars, lead.id, barOf(ctx, a, lead));
  if (other && a.rows.some((r) => r.differs)) setCol(bars, other.id, barOf(ctx, a, other));
  return {
    title: msg("laporan.diagram.judul"),
    tableToggle: msg("laporan.diagram.lihat_tabel"),
    shrink,
    bars,
    tree: { title: msg("laporan.diagram.pohon"), ...treeView(ctx, a) },
  };
}

