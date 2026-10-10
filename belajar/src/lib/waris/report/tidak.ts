/**
 * Section 3, "Yang tidak mendapat bagian, dan mengapa" (plan §6 row 3): blocked relatives with who
 * blocks them and the rule; non-heirs (adopted, of another religion, step children) with the way
 * that stays open (wasiat, hadiah; the court column's wasiat wajibah, plan D8); groups never asked
 * ("tidak ditanyakan karena …"). Every group ends with the QS 4:8 line, its card from dalil.json.
 * Rahma tone: never "tidak berhak apa-apa" alone.
 */
import { eq } from "../frac";
import { displayRank, fracView, list, type Analysis, type Col, type Ctx, type PState } from "./analysis";
import { notAskedLines } from "./diagram";
import { msg } from "./messages";
import { setCol } from "./ringkasan";
import type { FracView, JalanView, ReasonView, TidakEntry, TidakGroup, TidakMendapatView } from "./types";

/** The QS 4:8 card that closes every group (plan §6 row 3). */
export const CLOSING_DALIL = "Q-4-8";

function sig(s: PState): string {
  if (s.kind === "share") return `share:${s.role}`;
  if (s.kind === "blocked") return `blocked:${s.heir}:${s.rule}:${s.by.join(",")}`;
  return `bukan:${s.heir}:${s.reason}`;
}

export function reasonView(ctx: Ctx, s: PState): ReasonView | null {
  if (s.kind === "share") return null;
  const kerabat = ctx.label(s.heir, true);
  if (s.kind === "blocked") {
    if (s.rule === "hajb.istighraq") return { kind: "habis", text: msg("laporan.tidak.habis", { kerabat }), rule: ctx.rule(s.rule) };
    return { kind: "terhalang", text: msg("laporan.tidak.oleh", { kerabat, oleh: list(s.by.map((b) => ctx.label(b))) }), rule: ctx.rule(s.rule) };
  }
  return { kind: "bukan", text: msg("laporan.tidak.bukan_ahli", { kerabat }), rule: ctx.rule(s.rule) };
}

/** The ways open to non-heirs (plan D8; MUI 5/2005 and the 1984 adoption fatwa: hibah, wasiat, hadiah). */
function jalanFor(ctx: Ctx, a: Analysis, personIds: readonly string[], s: PState): JalanView[] {
  if (s.kind !== "ineligible") return [];
  const out: JalanView[] = [
    { text: msg("laporan.tidak.jalan_wasiat", { pewaris: ctx.pewaris() }), rules: [ctx.rule("estate.wasiat")] },
    { text: msg("laporan.tidak.jalan_hadiah"), rules: s.reason === "beda_agama" ? [ctx.rule("catatan.kerabat_non_muslim")] : [] },
  ];
  for (const c of [a.lead, a.other]) {
    if (!c?.hasil) continue;
    const ww = c.hasil.lines.filter((l) => l.kind === "wasiat_wajibah" && l.personIds.some((p) => personIds.includes(p)));
    if (ww.length === 0) continue;
    const nonMuslim = s.reason === "beda_agama";
    const ilustrasi = nonMuslim && c.rs.switches.wasiatWajibahNonMuslim === "ma_16K2010";
    const rules = [
      ctx.rule(nonMuslim ? "khi.ww_non_muslim" : "khi.ww_anak_angkat"),
      ctx.rule(ilustrasi ? "catatan.wasiat_wajibah_ilustrasi" : "catatan.wasiat_wajibah_plafon"),
    ];
    const text = msg(ilustrasi ? "laporan.tidak.jalan_ww_ilustrasi" : "laporan.tidak.jalan_ww_plafon");
    const same = ww.every((l) => eq(l.frac, ww[0].frac));
    if (same && ww.length === personIds.length) out.push(setCol<JalanView, FracView>({ text, rules }, c.id, fracView(ww[0].frac)));
    else for (const l of ww) out.push(setCol<JalanView, FracView>({ text, rules }, c.id, fracView(l.frac)));
  }
  return out;
}

export function tidakMendapatView(ctx: Ctx, a: Analysis): TidakMendapatView {
  const lead = a.lead as Col;
  const other = a.other;
  const inRows = new Set(a.rows.flatMap((r) => r.personIds));
  const entries = new Map<string, { s: PState; o: PState | null; ids: string[] }>();
  const order: string[] = [];
  for (const [pid, s] of lead.persons) {
    if (inRows.has(pid) || s.kind === "share") continue;
    const o = other?.persons.get(pid) ?? null;
    const oDiff = o && sig(o) !== sig(s) ? o : null;
    const key = `${sig(s)}#${oDiff ? sig(oDiff) : ""}`;
    const hit = entries.get(key);
    if (hit) hit.ids.push(pid);
    else {
      entries.set(key, { s, o: oDiff, ids: [pid] });
      order.push(key);
    }
  }
  const heirOf = (s: PState) => (s.kind === "share" ? s.role : s.heir);
  order.sort((x, y) => displayRank(heirOf((entries.get(x) as { s: PState }).s)) - displayRank(heirOf((entries.get(y) as { s: PState }).s)));
  const terhalang: TidakEntry[] = [];
  const bukan: TidakEntry[] = [];
  for (const key of order) {
    const e = entries.get(key) as { s: PState; o: PState | null; ids: string[] };
    const entry: TidakEntry = { label: ctx.label(heirOf(e.s), true), count: e.ids.length, personIds: e.ids, jalan: jalanFor(ctx, a, e.ids, e.s) };
    const lr = reasonView(ctx, e.s);
    if (lr) setCol(entry, lead.id, lr);
    if (other && e.o) {
      const or = reasonView(ctx, e.o);
      if (or) setCol(entry, other.id, or);
    }
    (e.s.kind === "ineligible" ? bukan : terhalang).push(entry);
  }
  const closing = () => {
    ctx.cardOrder.add(CLOSING_DALIL);
    return { text: msg("laporan.tidak.akhir"), dalilId: CLOSING_DALIL };
  };
  const groups: TidakGroup[] = [];
  if (terhalang.length > 0) groups.push({ kind: "terhalang", title: msg("laporan.tidak.terhalang"), entries: terhalang, notAsked: [], closing: closing() });
  if (bukan.length > 0) groups.push({ kind: "bukan", title: msg("laporan.tidak.bukan"), entries: bukan, notAsked: [], closing: closing() });
  const items = ctx.opts.notAsked ?? [];
  if (items.length > 0) {
    // hajb.hirman only where someone present made the group irrelevant; a group skipped because
    // nothing is left over (or for no named relative) gets no exclusion rule
    const lines = notAskedLines(ctx, items);
    const notAsked = items.map((x, i) => ({ text: lines[i], rule: x.because.length > 0 ? ctx.rule("hajb.hirman") : null }));
    groups.push({ kind: "tidak_ditanya", title: msg("laporan.tidak.tidak_ditanya"), entries: [], notAsked, closing: closing() });
  }
  return { title: msg("laporan.tidak.judul"), groups };
}
