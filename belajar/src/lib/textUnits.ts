/**
 * Where a line may break in Latin text with Arabic inside it (operator,
 * 2026-10-10: "make sure the line break is clean and easy to read, sometime
 * i see wrong line break especially for arabic words"). Pure, so vitest runs
 * it over every content string, manifest token and message (textUnits.test.ts);
 * MixedText renders what it returns, with the boxes in globals.css (.lb-*).
 *
 * A string becomes three kinds of piece:
 * - unit: Arabic with the punctuation touching it, the term in front of a
 *   bracket of Arabic ("huruf jar (حَرْف جَرّ),") and the start of a gloss
 *   after it ("«ٱهْدِنَا» (tunjukilah kami)"). Inside it, its SEAM — the Arabic
 *   and only the Latin words touching it, "jar (حَرْف جَرّ),", "«ٱهْدِنَا»
 *   (tunjukilah" — is a unit of its own. The whole unit moves to the next line
 *   while it fits one; wider than its line, it breaks in the paragraph's flow
 *   (src/lib/lineFit.ts), first outside its seam ("huruf" ⏎ "jar (حَرْف جَرّ),"),
 *   and only a seam wider than its line before its bracket ("jar" ⏎ "(…)").
 *   A quotation of 4+ words is a unit with nothing glued to it.
 * - glue: a Latin word that a hyphen, dash, slash or footnote mark could split
 *   ("Al-Fatihah", "jar-majrur", "-nya", "pembalasan.[1]"), or a word with the
 *   separator after it ("nashab —", "(Kufah) ·"), so no line starts with
 *   "·", "—" or "-" and no word is cut at its hyphen.
 * - text: everything else, wrapping at its spaces as usual.
 *
 * The seams kept are exactly the ones the browser check reports
 * (scripts/ci/linebreaks-measure.mjs, seamKinds): textUnits.test.ts runs that
 * check over every break this leaves open in the corpus.
 *
 * Joined, the pieces give the input back byte for byte: nothing is retyped
 * and no invisible joiner is added (a word joiner or no-break space would
 * change copy/paste and could break Arabic letter joining). The Arabic runs
 * inside the units are exactly ARABIC_RUN's matches over the whole string,
 * so every run MixedText isolated before is isolated the same way.
 */

/** Arabic letters, harakat and presentation forms. */
const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
/** One Arabic run: Arabic words joined by spaces, dashes or the Arabic
 *  comma ("فَعِلَ–يَفْعَلُ", "ر ح م", "مِلْكًا، مَلْكًا"). Each run is one RTL
 *  `bdi` in MixedText. */
export const ARABIC_RUN = new RegExp(`[${AR}]+(?:[\\s\\u2013\\u060C-]+[${AR}]+)*`, "g");
const HAS_AR = new RegExp(`[${AR}]`);
export const hasArabic = (s: string): boolean => HAS_AR.test(s);

/** Harakat and Qur'anic marks: not letters when counting a word's length. */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
/** A word that is only a separator ("·", "—", "-", "…", "...") or a footnote
 *  mark ("[1]"), maybe with closing punctuation: it stays with the word before. */
const SEP = String.raw`(?:[·•—–-]+|…|\.{3}|\[\d+\])[)\]}”’»,.;:!?]*`;
const SEPARATOR = new RegExp(`^${SEP}$`, "u");
/** Separators merged onto the end of a word ("جَرّ) —"). */
const SEP_TAIL = new RegExp(`(?:\\s+${SEP})+$`, "u");
/** A word a line could break inside: a hyphen, dash or slash between letters
 *  or digits ("Al-Fatihah", "ke-1", "waswasa–yuwaswisu", "orang/jenis"), a
 *  leading hyphen ("-nya"), a footnote mark after a word ("pembalasan.[1]"). */
const GLUE_WORD = /[\p{L}\p{N}][-–—‐‑/][\p{L}\p{N}]|^[-–]\p{L}|\S\[\d+\]/u;
/** A word of letters (a transliteration: "jar", "ba’", "Al-Fatihah"). */
const LATIN_WORD = /^[\p{L}\p{M}’‘'ʿʾʼ-]*\p{Script=Latin}[\p{L}\p{M}’‘'ʿʾʼ-]*$/u;

export type UnitPart = { text: string; arabic: boolean };
export type Seg =
  | { kind: "text"; text: string }
  | { kind: "glue"; text: string }
  /** `gaps[k]` is the whitespace between parts[k] and parts[k + 1], as written. `seam` [from, to]:
   *  the parts that touch the Arabic (the Latin word right before it, the Arabic, the first word of
   *  a gloss after it), a unit inside the unit. The parts outside it are the rest of a term ("huruf")
   *  or of a gloss ("kami)"): Latin only. */
  | { kind: "unit"; parts: UnitPart[]; gaps: string[]; seam: [number, number] };

/** Arabic words of ≥ 2 letters (root letters and single letters do not count), counted as the
 *  browser check counts them (linebreaks-measure.mjs longWords). */
const ARABIC_WORD = new RegExp(`[${AR}]+`, "g");
const letters = (w: string) => w.replace(MARKS, "").length;
const longWords = (s: string) => (s.match(ARABIC_WORD) ?? []).filter((w) => letters(w) >= 2).length;
/** From this many words, an Arabic run is a quotation: nothing glued to it. */
export const QUOTE_WORDS = 4;
/** A gloss stays with an Arabic run of at most this many words (root letters count as none): a
 *  word or a phrase and its meaning, "«مَلِكِ» (raja)", "«يَوْمِ ٱلدِّينِ» (hari pembalasan)". The
 *  browser check uses the same number (linebreaks-measure.mjs). */
export const GLOSS_WORDS = QUOTE_WORDS - 1;
/** At most this many Latin words of a term stay with its Arabic ("jumlah fi’liyyah (…)"). */
const TERM_WORDS = 3;
/** A line that ends in a Latin letter (maybe with ’): the word a term in brackets keeps. */
const ENDS_LATIN = /\p{Script=Latin}[’'ʼ]?$/u;
/** A bracket opening on Arabic, up to where it closes: "(حَرْف جَرّ)", "(ٱ أ إ آ dan alif kecil U+0670)". */
const BRACKET = /^\(([^)]*)\)/u;
/** The end of an Arabic word, maybe closed by » ” ): a gloss after it stays with it. */
const ENDS_ARABIC = new RegExp(`[${AR}][»”)]*$`);
/** A gloss opening: "(raja)", "(“tersembunyi”)". */
const GLOSS_OPEN = /^\([“‘"']?\p{Script=Latin}/u;
/** More ")" than "(": the text closes a parenthesis opened before it. */
const closesOpen = (s: string) => (s.match(/\)/g)?.length ?? 0) > (s.match(/\(/g)?.length ?? 0);

/** `text` cut into line-break pieces (see the module comment). */
export function textUnits(text: string): Seg[] {
  // Words with the whitespace after each; `lead` is whitespace before the first.
  const bits = text.split(/(\s+)/);
  const toks: { w: string; ws: string }[] = [];
  let lead = "";
  for (let k = 0; k < bits.length; k += 2) {
    const w = bits[k];
    const ws = bits[k + 1] ?? "";
    if (w !== "") toks.push({ w, ws });
    else if (toks.length === 0) lead += ws;
    else toks[toks.length - 1].ws += ws;
  }

  // A separator joins the word before it (at the very start: the word after).
  for (let i = 0; i < toks.length; i++) {
    if (!SEPARATOR.test(toks[i].w)) continue;
    if (i > 0) {
      const p = toks[i - 1];
      toks.splice(i - 1, 2, { w: p.w + p.ws + toks[i].w, ws: toks[i].ws });
      i--;
    } else if (toks.length > 1) {
      toks.splice(0, 2, { w: toks[0].w + toks[0].ws + toks[1].w, ws: toks[1].ws });
      i--;
    }
  }

  const ar = toks.map((t) => HAS_AR.test(t.w));
  const owner: (number | undefined)[] = new Array(toks.length);
  const free = (k: number) => owner[k] === undefined;
  const join = (from: number, to: number) => {
    let s = "";
    for (let k = from; k <= to; k++) s += k < to ? toks[k].w + toks[k].ws : toks[k].w;
    return s;
  };
  const units = new Map<number, { end: number; seg: Seg }>();

  for (let i = 0; i < toks.length; i++) {
    if (!ar[i]) continue;
    // The Arabic group: this word and every Arabic-bearing word after it.
    let j = i;
    while (j + 1 < toks.length && ar[j + 1]) j++;
    const group = join(i, j);
    const core = group.replace(SEP_TAIL, "");
    const runs = [...core.matchAll(ARABIC_RUN)].map((m) => m[0]);

    // Before: a term in front of a bracket that opens on Arabic and holds ≤ 3 Arabic words — as
    // many Latin words as the bracket has Arabic words (root letters count as one), at most 3:
    // "huruf jar (حَرْف جَرّ)", "kasrah (كَسْرَة)", "entri (و س و س)", "alif (ٱ أ إ آ dan alif
    // kecil …)" (the bracket may close after Latin words). The last of them is the seam's.
    let b = i;
    const bracket = BRACKET.exec(join(i, toks.length - 1));
    if (bracket && hasArabic(bracket[1].trim()[0] ?? "") && longWords(bracket[1]) < QUOTE_WORDS) {
      const inside = bracket[1].match(ARABIC_WORD) ?? [];
      const n = Math.min(TERM_WORDS, inside.every((w) => letters(w) <= 1) ? 1 : inside.length);
      const latin = (k: number) => k >= 0 && free(k) && !ar[k] && LATIN_WORD.test(toks[k].w);
      if (latin(i - 1) && ENDS_LATIN.test(toks[i - 1].w)) {
        b = i - 1;
        while (i - b < n && latin(b - 1)) b--;
      }
    } else if (closesOpen(core) && longWords(core) < QUOTE_WORDS) {
      // A short parenthetical that closes on the Arabic, "(seperti عَلِمَ–يَعْلَمُ)": the Latin
      // words back to its "(" (at most 2).
      for (let k = i - 1; k >= 0 && i - k <= 2 && free(k) && !ar[k]; k--) {
        const w = toks[k].w;
        if (w.includes(")") || !/^\(?[\p{L}\p{M}’‘'ʿʾʼ-]+$/u.test(w)) break;
        if (w.startsWith("(")) {
          b = k;
          break;
        }
      }
    }

    // After: a Latin gloss right after a word or phrase (GLOSS_WORDS), "«مَلِكِ» (raja)",
    // "«ٱهْدِنَا» (tunjukilah kami)", quoted or not: up to its ")" when that is within 2 words,
    // else its first word; the first word is the seam's. Not when the parenthesis holds Arabic
    // within its first two words (it is then that Arabic's own).
    let e = j;
    if (
      group === core &&
      j + 1 < toks.length &&
      ENDS_ARABIC.test(core) &&
      GLOSS_OPEN.test(toks[j + 1].w) &&
      longWords(runs[runs.length - 1] ?? "") <= GLOSS_WORDS
    ) {
      let close = -1;
      let arabicInside = false;
      for (let k = j + 1; k < toks.length && k - j <= 2; k++) {
        if (ar[k]) {
          arabicInside = true;
          break;
        }
        if (toks[k].w.includes(")")) {
          close = k;
          break;
        }
      }
      if (!arabicInside) e = close > 0 ? close : j + 1;
    }

    // [the rest of the term] [its last word] [the Arabic] [the gloss's first word] [its rest]
    const parts: UnitPart[] = [];
    const gaps: string[] = [];
    const part = (text: string, arabic: boolean, gap: string) => {
      if (parts.length) gaps.push(gap);
      parts.push({ text, arabic });
      return parts.length - 1;
    };
    if (b < i - 1) part(join(b, i - 2), false, "");
    const seamStart = b < i ? part(toks[i - 1].w, false, i - 2 >= b ? toks[i - 2].ws : "") : -1;
    const at = part(group, true, b < i ? toks[i - 1].ws : "");
    const seamEnd = e > j ? part(toks[j + 1].w, false, toks[j].ws) : at;
    if (e > j + 1) part(join(j + 2, e), false, toks[j + 1].ws);
    for (let k = b; k <= e; k++) owner[k] = b;
    units.set(b, { end: e, seg: { kind: "unit", parts, gaps, seam: [seamStart < 0 ? at : seamStart, seamEnd] } });
    i = e;
  }

  const out: Seg[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  pushText(lead);
  for (let k = 0; k < toks.length; ) {
    const u = units.get(k);
    if (u) {
      out.push(u.seg);
      pushText(toks[u.end].ws);
      k = u.end + 1;
      continue;
    }
    const { w, ws } = toks[k];
    if (/\s/.test(w) || GLUE_WORD.test(w)) out.push({ kind: "glue", text: w });
    else pushText(w);
    pushText(ws);
    k++;
  }
  return out;
}

/** A unit's text: its parts joined by its gaps. */
const unitText = (s: { parts: readonly UnitPart[]; gaps: readonly string[] }) =>
  s.parts.map((p, k) => (k > 0 ? s.gaps[k - 1] : "") + p.text).join("");

/** The text a piece list renders: always the input of textUnits, unchanged. */
export const joinUnits = (segs: readonly Seg[]): string =>
  segs.map((s) => (s.kind === "unit" ? unitText(s) : s.text)).join("");

/** A unit part cut into its Arabic runs (each one RTL `bdi`) and the text between. */
export function arabicRuns(text: string): UnitPart[] {
  const out: UnitPart[] = [];
  let last = 0;
  for (const m of text.matchAll(ARABIC_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), arabic: false });
    out.push({ text: m[0], arabic: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), arabic: false });
  return out;
}

/** The brackets and guillemets an Arabic run can sit in: mirrored characters, so inside a
 *  right-to-left span they look exactly as they do around it (“ ” are not mirrored: left out). */
const RTL_PAIRS: Readonly<Record<string, string>> = { "«": "»", "(": ")", "[": "]" };

/** An Arabic part cut into its Arabic runs and the text between, each run with the bracket or
 *  guillemets right around it moved onto it ("«…»", "(…)"): MixedText sets the run and its marks
 *  right to left, so on one line they look as before, and a part wider than its line wraps with
 *  its lines in reading order, opening on the right of its first line and closing on the left of
 *  its last. Punctuation after the marks ("»,") stays outside, in the Latin sentence. Joined, the
 *  input unchanged. */
export function rtlRuns(text: string): (UnitPart & { open?: string; close?: string })[] {
  const out: (UnitPart & { open?: string; close?: string })[] = arabicRuns(text);
  for (let k = 1; k + 1 < out.length; k++) {
    const [before, run, after] = [out[k - 1], out[k], out[k + 1]];
    if (!run.arabic || before.arabic || after.arabic) continue;
    const open = before.text.slice(-1);
    const close = RTL_PAIRS[open];
    if (!close || !after.text.startsWith(close)) continue;
    before.text = before.text.slice(0, -1);
    after.text = after.text.slice(close.length);
    run.open = open;
    run.close = close;
  }
  return out.filter((r) => r.arabic || r.text);
}
