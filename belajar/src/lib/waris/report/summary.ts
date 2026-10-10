/**
 * "Salin ringkasan teks" (plan §6 Print and PDF, D9): plain text for WhatsApp, rendered from the
 * view-model (no new copy, no Arabic). Rupiah only when the user ticks "Sertakan nilai rupiah"
 * (the same opt-in as the link). Always carries the disclaimer line and the privacy line.
 * Returns null for a report that may not be shared (the E-BUNUH class, plan §9.4): the killer
 * answer never reaches a text summary.
 *
 * When one «Tidak tahu» changes the division (plan D15) the summary never prints one reading as
 * "the" division: it prints every reading, each with its own shares, and no list of relatives
 * who receive nothing (that list belongs to one reading).
 */
import { msg, renderMsg, type Msg, type ReportMsgKey } from "./messages";
import type { CellView, ColumnId, CompactRow, HeirRow, OutcomeView, ReportModel } from "./types";

/** One line of a reading's column: a share (or a refusal reason), or the note on what the shares are of. */
export interface OutcomeLine {
  text: string;
  note: boolean;
}

/**
 * The lines of one column of a «Tidak tahu» reading (plan D15), for the text summary and the
 * page: the bequests taken first, the heirs, and what their shares are of. `R` renders a Msg.
 */
export function outcomeColumnLines(part: NonNullable<OutcomeView["fikih"]>, R: (m: Msg) => string): OutcomeLine[] {
  if ("refusal" in part) return part.refusal.map((x) => ({ text: x.rule ? x.rule.title : x.text ? R(x.text) : x.reason, note: false }));
  const out: OutcomeLine[] = [];
  for (const p of part.pre) out.push({ text: compactRowLine(p, R), note: false });
  for (const r of part.rows) out.push({ text: compactRowLine(r, R), note: false });
  if (part.basis === "setelah_utang") out.push({ text: R(msg("laporan.teks.dari_harta_setelah_utang")), note: true });
  else if (part.pre.length > 0) out.push({ text: R(msg("laporan.ringkasan.basis")), note: true });
  return out;
}

/** "Anak laki-laki: 2/3 (dua pertiga)", "2 anak perempuan: 2/3 (dua pertiga); masing-masing 1/3", … */
export function compactRowLine(r: CompactRow, R: (m: Msg) => string): string {
  const who = r.open
    ? R(msg("laporan.ringkasan.kelompok_terbuka", { kerabat: r.label, jumlah: r.count }))
    : r.count > 1
      ? R(msg("laporan.pohon.jumlah", { jumlah: r.count, kerabat: { ...r.label, cap: false } }, true))
      : R({ ...r.label, cap: true });
  if (!r.total) return R(msg("laporan.ringkasan.baris_ringkas", { kerabat: who, bagian: msg("laporan.ringkasan.tidak_mendapat") }));
  let bagian = `${r.total.figure} (${r.total.words})`;
  if (r.open) bagian += `, ${R(msg("laporan.ringkasan.dibagi_rata"))}`;
  else if (r.perHead && r.count > 1) bagian += `; ${R(msg("laporan.ringkasan.masing", { bagian: r.perHead.figure }))}`;
  return R(msg("laporan.ringkasan.baris_ringkas", { kerabat: who, bagian }));
}

export interface TextSummaryOptions {
  /** "Sertakan nilai rupiah" ticked. Default false. */
  includeRupiah?: boolean;
  /** The share link (fragment form, plan D9), when the user made one. */
  link?: string;
  /** Raw template lookup (default: the built-in Indonesian table; in the UI: next-intl t.raw). */
  lookup?: (key: ReportMsgKey) => string;
}

export function buildTextSummary(model: ReportModel, o: TextSummaryOptions = {}): string | null {
  if (!model.shareAllowed) return null;
  const R = (m: Msg) => renderMsg(m, o.lookup);
  const finish = (lines: string[]): string => {
    lines.push("");
    lines.push(R(msg("laporan.penutup.ai")));
    lines.push(R(msg("laporan.penutup.privasi")));
    if (o.link) lines.push(R(msg("laporan.teks.tautan", { tautan: o.link })));
    return lines.join("\n");
  };
  const k = model.kepala;
  const out: string[] = [];
  out.push(R(msg("laporan.teks.judul", { judul: k.title, subjudul: k.subtitle })));
  out.push(`${R(k.label)}.`);
  out.push(k.date ? `${R(msg("laporan.teks.kode", { kode: k.answerCode }))} · ${k.date.text}` : R(msg("laporan.teks.kode", { kode: k.answerCode })));
  if (k.simulasiNote) out.push(R(k.simulasiNote));

  if (model.kind === "rujuk" || !model.ringkasan) {
    const r = model.rujuk;
    if (r) {
      out.push("");
      out.push(R(r.lead));
      for (const x of r.reasons) out.push(`- ${x.rule ? x.rule.title : x.text ? R(x.text) : x.reason}`);
      out.push(R(r.whereToAsk));
    }
  } else {
    const g = model.ringkasan;
    const lead: ColumnId = k.leadColumn;
    const otherId: ColumnId = lead === "fikih" ? "court" : "fikih";
    const afterDebts = (col: ColumnId) => g.columns[col].basis === "setelah_utang";
    const share = (col: ColumnId, c: CellView | undefined): string | null => {
      // a column without bequests of its own has no lineTotal: its harta waris is the estate after debts
      const f = afterDebts(col) ? (c?.lineTotal ?? c?.total) : c?.total;
      if (!c || !f) return null;
      const base = `${f.figure} (${f.words})`;
      return o.includeRupiah && c.rupiahTotal ? R(msg("laporan.teks.rupiah", { bagian: base, rupiah: c.rupiahTotal.text })) : base;
    };
    const perHead = (col: ColumnId, c: CellView): string | null => {
      const f = afterDebts(col) && c.lineTotal ? c.linePerHead : c.perHead;
      if (!f) return null;
      return o.includeRupiah && c.rupiahPerHead ? R(msg("laporan.teks.rupiah", { bagian: f.figure, rupiah: c.rupiahPerHead.text })) : f.figure;
    };
    const basisLine = (col: ColumnId): string | null => {
      if (afterDebts(col)) return R(msg("laporan.teks.dari_harta_setelah_utang"));
      return g.preLines.some((p) => p[col]) ? R(msg("laporan.ringkasan.basis")) : null;
    };
    const rowLine = (col: ColumnId, row: HeirRow, c: CellView | undefined): string => {
      const s = share(col, c) ?? R(msg("laporan.ringkasan.tidak_mendapat"));
      const per = c ? perHead(col, c) : null;
      if (row.count > 1 && per) return R(msg("laporan.teks.baris_orang", { kerabat: row.label, jumlah: row.count, bagian: s, per }));
      if (row.count > 1) return R(msg("laporan.teks.baris", { kerabat: msg("laporan.pohon.jumlah", { jumlah: row.count, kerabat: { ...row.label, cap: false } }, true), bagian: s }));
      return R(msg("laporan.teks.baris", { kerabat: row.label, bagian: s }));
    };
    if (g.bergantung) {
      // plan D15: every reading side by side, never one of them as "the" division
      out.push("");
      out.push(R(g.bergantung.line));
      for (const oc of g.bergantung.outcomes) {
        out.push("");
        out.push(R(msg("laporan.teks.kolom", { kolom: oc.option })));
        for (const col of [lead, otherId]) {
          const part = oc[col];
          if (!part) continue;
          // the court column beside the fikih lead lists only the heirs whose share differs
          const head =
            "refusal" in part
              ? msg("laporan.rujuk.kolom", { kolom: g.columns[col].label })
              : col === "court" && col !== lead
                ? msg("laporan.teks.berbeda")
                : msg("laporan.teks.kolom", { kolom: g.columns[col].label });
          out.push(R(head));
          for (const line of outcomeColumnLines(part, R)) out.push(line.note ? line.text : `- ${line.text}`);
        }
      }
      return finish(out);
    }
    out.push("");
    out.push(R(msg("laporan.teks.kolom", { kolom: g.columns[lead].label })));
    const bl = basisLine(lead);
    if (bl) out.push(bl);
    for (const p of g.preLines) {
      const c = p[lead];
      if (c) out.push(R(msg("laporan.teks.baris", { kerabat: p.label, bagian: `${c.frac.figure} (${c.frac.words})` })));
    }
    for (const row of g.rows) if (row[lead]?.total) out.push(rowLine(lead, row, row[lead]));
    const sisaLead = g.residue?.[lead];
    if (g.residue && sisaLead) {
      const bagian = `${sisaLead.frac.figure} (${sisaLead.frac.words})`;
      const withRp = o.includeRupiah && sisaLead.rupiah ? R(msg("laporan.teks.rupiah", { bagian, rupiah: sisaLead.rupiah.text })) : bagian;
      out.push(R(msg("laporan.teks.baris", { kerabat: msg("laporan.baris.sisa", undefined, true), bagian: withRp })));
      out.push(`  ${R(g.residue.text)}`);
    }
    const oh = g.columns[otherId];
    if (oh.status === "rujuk" && oh.shown) {
      out.push("");
      out.push(R(msg("laporan.rujuk.kolom", { kolom: oh.label })));
      for (const x of oh.refusal ?? []) out.push(`- ${x.rule ? x.rule.title : x.reason}`);
    } else if (oh.shown && g.rows.some((r) => r.differs)) {
      out.push("");
      out.push(R(msg("laporan.teks.berbeda")));
      const ob = basisLine(otherId);
      if (ob) out.push(ob);
      for (const p of g.preLines) {
        const c = p[otherId];
        if (c) out.push(R(msg("laporan.teks.baris", { kerabat: p.label, bagian: `${c.frac.figure} (${c.frac.words})` })));
      }
      for (const row of g.rows) if (row.differs) out.push(rowLine(otherId, row, row[otherId]));
    } else if (g.agree) {
      out.push(R(g.agreeLine));
    }
    const none: Msg[] = [];
    for (const grp of model.tidakMendapat?.groups ?? []) {
      for (const e of grp.entries) {
        const who: Msg = e.count > 1 ? msg("laporan.pohon.jumlah", { jumlah: e.count, kerabat: { ...e.label, cap: false } }) : { ...e.label, cap: false };
        none.push(msg(grp.kind === "bukan" ? "laporan.teks.bukan" : "laporan.teks.terhalang", { kerabat: who }));
      }
    }
    if (none.length > 0) {
      out.push("");
      out.push(R(msg("laporan.teks.tidak_mendapat", { daftar: { list: none } })));
    }
  }
  return finish(out);
}
