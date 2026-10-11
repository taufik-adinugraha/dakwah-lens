/**
 * Word composition and the harakat primer (content/compose/<slug>.json) —
 * the pure part: the replay that proves every Arabic string on the stage
 * comes from bytes (a mirror of pipeline/compose.py's corpus-free checks, run
 * by src/lib/compose.test.ts in CI and at build time by compose-content.ts),
 * and what the autoplay engine needs from it (line → frame), so the engine
 * itself stays free of Arabic.
 *
 * Operator, 2026-10-10 (narration rule 14): a word made of parts is
 * explained part by part — each part, its bentuk dasar (the marfu' form,
 * never "akar"), the change of its ending and its cause, how the parts join —
 * with an animation: [بِ] + [ٱسْمُ] → the dhammah becomes kasrah → joined → the
 * alif drops → [بِسْمِ]. A word not made of parts still shows its base form →
 * the change. And a short harakat primer opens the first lesson.
 *
 * Pure TypeScript (type imports only): scripts run it under tsx without
 * node_modules.
 */
import type { ComposeChip, ComposeFile, ComposeForm, ComposeFrame, Composition, Primer } from "@/content/compose-schema";

const MARKS = {
  fathah: "َ",
  dhammah: "ُ",
  kasrah: "ِ",
  fathatain: "ً",
  dhammatain: "ٌ",
  kasratain: "ٍ",
  sukun: "ْ",
  shaddah: "ّ",
  // The small upright alif (U+0670): a mark of its letter (مَٰ), shown by the primer only.
  small_alif: "\u0670",
} as const;
type MarkName = keyof typeof MARKS;
const VOWELS: readonly MarkName[] = ["fathah", "dhammah", "kasrah", "fathatain", "dhammatain", "kasratain"];
const MARK_OF = new Map<string, MarkName>(Object.entries(MARKS).map(([k, v]) => [v, k as MarkName]));
/** One letter in two shapes: the alif maqsura of عَلَى, written ya' before a pronoun (عَلَيْهِمْ). */
const sameLetter = (a: string, b: string) => a === b || (a === "\u0649" && b === "\u064A") || (a === "\u064A" && b === "\u0649");

/** A character that belongs to the letter before it (a combining mark, or the
 *  Uthmani small waw / ya), as pipeline/compose.py is_mark. */
const isMark = (c: string) => /\p{Mn}/u.test(c) || c === "ۥ" || c === "ۦ";

/** A word cut into pieces: each a base letter and every mark after it (a
 *  whole shaped cluster): ٱلرَّحْمَٰنِ → ٱ | ل | رَّ | حْ | مَٰ | نِ. */
export function pieces(ar: string): string[] {
  const out: string[] = [];
  for (const c of ar) {
    if (out.length && isMark(c)) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

const marksOf = (p: string): MarkName[] => [...p].flatMap((c) => (MARK_OF.has(c) ? [MARK_OF.get(c)!] : []));
const vowelsOf = (p: string): MarkName[] => marksOf(p).filter((m) => VOWELS.includes(m));

type Op =
  | { mark: number; to: MarkName }
  | { remove: MarkName | "vowel"; piece: number }
  | { add: MarkName; piece: number }
  | { drop: number };

function at(ps: string[], i: unknown): number {
  if (typeof i !== "number" || !Number.isInteger(i)) throw new Error(`piece index ${String(i)}`);
  const j = i < 0 ? i + ps.length : i;
  if (j < 0 || j >= ps.length) throw new Error(`piece ${i} outside ${ps.length} pieces`);
  return j;
}

/** One deterministic edit (pipeline/compose.py apply_op). */
export function applyOp(ar: string, op: Op): string {
  const ps = pieces(ar);
  const o = op as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys === "mark,to") {
    const j = at(ps, o.mark);
    const vs = vowelsOf(ps[j]);
    const to = o.to as MarkName;
    if (vs.length !== 1 || !VOWELS.includes(to) || vs[0] === to) throw new Error(`mark: piece ${ps[j]} → ${to}`);
    ps[j] = ps[j].replace(MARKS[vs[0]], MARKS[to]);
  } else if (keys === "piece,remove") {
    const j = at(ps, o.piece);
    let name = o.remove as MarkName | "vowel";
    if (name === "vowel") {
      const vs = vowelsOf(ps[j]);
      if (vs.length !== 1) throw new Error(`remove vowel: ${ps[j]}`);
      name = vs[0];
    }
    if (!(name in MARKS) || !ps[j].includes(MARKS[name])) throw new Error(`remove ${name}: ${ps[j]}`);
    ps[j] = ps[j].replace(MARKS[name], "");
  } else if (keys === "add,piece") {
    const j = at(ps, o.piece);
    const name = o.add as MarkName;
    if (!(name in MARKS) || ps[j].includes(MARKS[name])) throw new Error(`add ${name}: ${ps[j]}`);
    if (name === "shaddah") ps[j] = ps[j][0] + MARKS[name] + ps[j].slice(1);
    else {
      if (vowelsOf(ps[j]).length || ps[j].includes(MARKS.sukun)) throw new Error(`add ${name}: ${ps[j]} has a vowel`);
      const k = ps[j].length > 1 && ps[j][1] === MARKS.shaddah ? 2 : 1;
      ps[j] = ps[j].slice(0, k) + MARKS[name] + ps[j].slice(k);
    }
  } else if (keys === "drop") {
    ps.splice(at(ps, o.drop), 1);
    if (!ps.length) throw new Error("nothing left after the drop");
  } else {
    throw new Error(`unknown op ${JSON.stringify(op)}`);
  }
  return ps.join("");
}

function slicePieces(ar: string, sl: unknown): string {
  if (sl === undefined || sl === null) return ar;
  if (!Array.isArray(sl) || sl.length !== 2) throw new Error(`pieces ${JSON.stringify(sl)}`);
  const ps = pieces(ar);
  const end = sl[1] === null ? undefined : (sl[1] as number);
  const out = ps.slice(sl[0] as number, end);
  if (!out.length) throw new Error(`pieces ${JSON.stringify(sl)} of ${ar} are empty`);
  return out.join("");
}

/**
 * Re-derives every form of a composition from its `src`: a lesson word
 * (`words`, the content's Tanzil bytes), a slice of one, an edit or a join.
 * A Tanzil token or QAC segment from elsewhere cannot be re-read here (the
 * pipeline checks it against the pinned corpus); its bytes are taken as
 * given and everything derived from them is replayed. Throws on a mismatch.
 */
export function replayForms(forms: Readonly<Record<string, ComposeForm>>, words: ReadonlyMap<string, string>): Map<string, string> {
  const done = new Map<string, string>();
  const busy = new Set<string>();
  const spec = (sp: unknown, name: string): string => {
    const s = (sp ?? {}) as Record<string, unknown>;
    if (typeof s.word === "string") {
      const w = words.get(s.word);
      if (!w) throw new Error(`${name}: ${s.word} is not a lesson word`);
      return slicePieces(w, s.pieces);
    }
    if (typeof s.tanzil === "string" || typeof s.qac === "string") return forms[name].ar;
    if (s.from !== undefined) {
      let ar = typeof s.from === "string" ? form(s.from) : spec(s.from, name);
      const ops = s.ops as Op[] | undefined;
      if (!Array.isArray(ops) || !ops.length) throw new Error(`${name}: from needs ops`);
      for (const op of ops) ar = applyOp(ar, op);
      return ar;
    }
    if (Array.isArray(s.join)) {
      let ar = (s.join as string[]).map(form).join("");
      for (const op of (s.ops as Op[] | undefined) ?? []) ar = applyOp(ar, op);
      return ar;
    }
    throw new Error(`${name}: unknown source ${JSON.stringify(sp)}`);
  };
  const form = (name: string): string => {
    const hit = done.get(name);
    if (hit !== undefined) return hit;
    if (!forms[name]) throw new Error(`unknown form ${name}`);
    if (busy.has(name)) throw new Error(`${name} is derived from itself`);
    busy.add(name);
    const ar = spec(forms[name].src, name);
    busy.delete(name);
    done.set(name, ar);
    return ar;
  };
  for (const name of Object.keys(forms)) form(name);
  return done;
}

const only = (a: MarkName[], b: MarkName[]): MarkName | null => a.find((m) => !b.includes(m)) ?? null;

/** The pieces that differ between two forms of the same letters (compose.py diff_pieces). */
export function diffPieces(a: string, b: string): ComposeChip[] {
  const pa = pieces(a);
  const pb = pieces(b);
  if (pa.length !== pb.length) throw new Error(`${a} → ${b}: ${pa.length} and ${pb.length} pieces`);
  const out: ComposeChip[] = [];
  pa.forEach((x, i) => {
    const y = pb[i];
    if (x === y) return;
    if (!sameLetter(x[0], y[0])) throw new Error(`${a} → ${b}: a letter changed`);
    out.push({ from: x, to: y, marks: [only(marksOf(x), marksOf(y)), only(marksOf(y), marksOf(x))] });
  });
  return out;
}

function droppedPieces(a: string, b: string): ComposeChip[] {
  const pa = pieces(a);
  const pb = pieces(b);
  const out: ComposeChip[] = [];
  let j = 0;
  for (const x of pa) {
    if (j < pb.length && pb[j] === x) j++;
    else out.push({ from: x, to: "" });
  }
  if (j !== pb.length || !out.length) throw new Error(`${b} is not ${a} with pieces left out`);
  return out;
}

/** The chips a frame shows, cut from its forms (compose.py frame_chips). */
export function frameChips(fr: ComposeFrame, ar: (name: string) => string | undefined): ComposeChip[] {
  if (fr.stage === "change" && typeof fr.from === "string" && fr.to) {
    const a = ar(fr.from);
    const b = ar(fr.to);
    return a && b ? diffPieces(a, b) : [];
  }
  if (fr.stage === "join" && Array.isArray(fr.from) && fr.tiles.length === 1) {
    const joined = fr.from.map((n) => ar(n) ?? "").join("");
    const to = ar(fr.tiles[0]) ?? "";
    const chips = joined !== to && pieces(joined).length === pieces(to).length ? diffPieces(joined, to) : [];
    const ps = pieces(to);
    for (const p of fr.silent ?? []) {
      if (p >= -ps.length && p < ps.length) {
        const piece = ps[p < 0 ? p + ps.length : p];
        chips.push({ from: piece, to: piece, marks: [null, null], silent: true });
      }
    }
    return chips;
  }
  if (fr.stage === "drop" && typeof fr.from === "string" && fr.tiles.length) {
    const a = ar(fr.from);
    const b = ar(fr.tiles[0]);
    return a && b ? droppedPieces(a, b) : [];
  }
  return [];
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Problems of one composition or primer (empty when fine). `wordAr`: the
 *  word as the ayah writes it (null for the primer). */
export function unitProblems(
  u: Composition | Primer,
  words: ReadonlyMap<string, string>,
  where: string,
  wordAr: string | null,
): string[] {
  const out: string[] = [];
  let ar: Map<string, string>;
  try {
    ar = replayForms(u.forms, words);
  } catch (e) {
    return [`${where}: ${(e as Error).message}`];
  }
  for (const [name, f] of Object.entries(u.forms)) {
    if (ar.get(name) !== f.ar) out.push(`${where}: form ${name} is ${f.ar}, its source gives ${ar.get(name)}`);
    if (ARABIC.test(f.translit) || ARABIC.test(f.label ?? "") || ARABIC.test(f.gloss ?? "")) out.push(`${where}: form ${name} has Arabic in its Latin fields`);
  }
  const get = (n: string) => ar.get(n);
  u.frames.forEach((fr, i) => {
    const f = `${where} frame ${i + 1}`;
    for (const n of [...fr.tiles, ...(typeof fr.from === "string" ? [fr.from] : fr.from ?? []), fr.to, fr.cause, fr.focus]) {
      if (n !== undefined && !u.forms[n]) out.push(`${f}: ${n} is not a form`);
    }
    try {
      const chips = frameChips(fr, get);
      if (JSON.stringify(chips.length ? chips : undefined) !== JSON.stringify(fr.chips)) out.push(`${f}: chips differ from a fresh cut`);
      if (fr.stage === "change") {
        if (chips.length !== 1 || !chips[0].marks?.every((m) => m !== null && VOWELS.includes(m))) out.push(`${f}: change must change one vowel`);
      }
    } catch (e) {
      out.push(`${f}: ${(e as Error).message}`);
    }
    if (fr.stage === "parts" && fr.tiles.length < 2) out.push(`${f}: parts shows two or more parts`);
    if (fr.stage === "base" && !(fr.focus && fr.tiles.includes(fr.focus))) out.push(`${f}: base rings one of its tiles`);
    if (fr.stage === "mark") {
      for (const m of fr.marks ?? []) {
        const c = MARKS[m as MarkName];
        if (!fr.tiles.some((t) => (get(t) ?? "").includes(c))) out.push(`${f}: no example carries the ${m}`);
      }
    }
    if (!u.lines.some((l) => l.frame === i + 1)) out.push(`${f}: no line is said while it shows`);
  });
  // Lines follow the frames in order.
  for (let k = 1; k < u.lines.length; k++) {
    if (u.lines[k].frame < u.lines[k - 1].frame) out.push(`${where}: line ${k + 1} goes back to an earlier frame`);
  }
  if (u.lines.some((l) => l.frame < 1 || l.frame > u.frames.length)) out.push(`${where}: a line names a frame that does not exist`);
  if (wordAr !== null) {
    const last = u.frames[u.frames.length - 1];
    const shown = last.tiles.map((t) => get(t) ?? "").join("");
    if (shown !== wordAr) out.push(`${where}: the last frame shows ${shown}, not the word ${wordAr}`);
  }
  return out;
}

/** Problems of a whole composition file against the lesson words. */
export function composeFileProblems(file: ComposeFile, words: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  if (file.primer) out.push(...unitProblems(file.primer, words, `compose/${file.slug} primer`, null));
  for (const [loc, c] of Object.entries(file.words)) {
    const w = words.get(loc);
    if (!w || c.loc !== loc || c.ar !== w) out.push(`compose/${file.slug} ${loc}: not the lesson word's own bytes`);
    out.push(...unitProblems(c, words, `compose/${file.slug} ${loc}`, w ?? null));
  }
  return out;
}

// ───────────────────────────── for the autoplay engine ─────────────────────────────

/** A composition (or the primer) as the sequence needs it: no Arabic, the
 *  lines (their prose is the caption of a line without a manifest entry) and
 *  the frame each is said over. */
export type ComposeLineInput = { frame: number; say: string };
export type ComposeUnitInput = { frames: number; lines: readonly ComposeLineInput[] };
export type ComposeInput = {
  /** The harakat primer opening this ayah, if it does. */
  primer: ComposeUnitInput | null;
  /** By word loc ("1:1:1"). */
  words: Readonly<Record<string, ComposeUnitInput & { lead?: string }>>;
};

const unitInput = (u: Composition | Primer): ComposeUnitInput => ({
  frames: u.frames.length,
  lines: u.lines.map((l) => ({ frame: l.frame, say: l.say })),
});

/** The sequence input for one ayah of a surah's composition file. */
export function composeInputFor(file: ComposeFile | null | undefined, ayah: { ayah: number; words: readonly { loc: string }[] }): ComposeInput | null {
  if (!file) return null;
  const words: Record<string, ComposeUnitInput & { lead?: string }> = {};
  for (const w of ayah.words) {
    const c = file.words[w.loc];
    if (c) words[w.loc] = c.lead ? { ...unitInput(c), lead: c.lead } : unitInput(c);
  }
  const primer = file.primer && file.primer.ayah === ayah.ayah ? unitInput(file.primer) : null;
  return primer || Object.keys(words).length ? { primer, words } : null;
}
