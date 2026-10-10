/**
 * Grammar terms in Arabic script and the Konsep library's inline markup (pipeline/terms.py has
 * the authoring side). Operator, 2026-10-10, on /belajar/id/konsep: "mention the arabic word like
 * majrur in arabic letter etc, not only the transliteration" — and, from the narration review the
 * same day: Qur'anic words in Arabic from content bytes with "yang artinya", the harakat explained
 * for beginners, words explained by their parts, letters shown as the ayah writes them.
 *
 * library.json ships each prose field twice: plain (narration, metadata, search) and marked:
 *   [[majrur|majrur]]            a term, by id → "majrur (مَجْرُور)"
 *   [[bismi|q:1:1:1]]            a Qur'anic word → "bismi (بِسْمِ)"
 *   [[huwa Allāhu aḥad|q:112:1:2-4]]  a run of words
 *   [[bi-|q:1:1:1/1]]            a part (QAC segment) → "bi- (بِ)"
 *   [[ya'|q:1:2:4#6]]            a letter as in the ayah → "ya' (ي)"
 * The Arabic comes from the term table (verified spellings) and from library.json `quran`
 * (Tanzil/QAC bytes resolved by the build). Nothing here types Arabic.
 *
 * Display rule (less clutter, operator 2026-10-10): a term or Qur'anic word shows its Arabic at
 * its FIRST use in a scope (a page, or one card) and plain Latin after that; a harakah term's
 * first use on a page also carries its reminder ("kasrah (كَسْرَة, tanda bunyi i di bawah huruf)")
 * and links to the Harakat page. Pure functions only: vitest runs in node, without a DOM.
 */
import type { Library, Term } from "@/content/schema";

export const MARKUP = /\[\[([^[\]|]+?)(?:\|([^[\]|]+))?\]\]/g;
/** q:S:A:W · q:S:A:W1-W2 · q:S:A:W/k (QAC segment) · q:S:A:W#n (letter) */
export const QREF = /^q:(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3})|\/(\d{1,2})|#(\d{1,2}))?$/;

export type Span = { kind: "text"; text: string } | { kind: "mark"; surface: string; ref: string };

/** The marked text as text and markup spans, in order. */
export function parseMarked(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "mark", surface: m[1], ref: m[2] ?? m[1] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The plain text: every [[surface|ref]] becomes its surface (= the record's plain field). */
export function stripMarked(text: string): string {
  return text.replace(MARKUP, (_m, surface: string) => surface);
}

// ───────────────────────── letters and marks
/** Marks that belong to the letter before them: harakat, dagger alif, the mushaf's small signs. */
const COMBINING = /[ً-ٰٟۖ-ۭ]/u;

/** The word cut into letters, each with the marks that follow it (بِسْمِ → بِ | سْ | مِ).
 *  Same rule as pipeline/terms.py letters(). */
export function letters(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    if (COMBINING.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** The n-th letter (1-based; -1 = the last) with its marks. */
export function letterOf(word: string, n: number): string {
  const ls = letters(word);
  const i = n === -1 ? ls.length - 1 : n - 1;
  if (i < 0 || i >= ls.length) throw new Error(`letter ${n} of ${word}: the word has ${ls.length} letters`);
  return ls[i];
}

/** Unicode identity of each harakah mark (a lookup for checks and labels, not display text). */
export const MARK_NAME: Record<string, string> = {
  "ً": "fathatain",
  "ٌ": "dhammatain",
  "ٍ": "kasratain",
  "َ": "fathah",
  "ُ": "dhammah",
  "ِ": "kasrah",
  "ّ": "shaddah",
  "ْ": "sukun",
};
/** The term (library.terms.json id) that names each mark. */
export const MARK_TERM: Record<string, string> = {
  fathatain: "tanwin",
  dhammatain: "tanwin",
  kasratain: "tanwin",
  fathah: "fathah",
  dhammah: "dhammah",
  kasrah: "kasrah",
  shaddah: "tasydid",
  sukun: "sukun",
};

/** The named marks of a letter, cut from its bytes (رَبِّ's بِّ, ["shaddah"] → U+0651). */
export function marksOf(letter: string, names: readonly string[]): string {
  return [...letter].filter((ch) => names.includes(MARK_NAME[ch] ?? "")).join("");
}

/** The vowel marks of a letter (everything but shaddah), e.g. مُ → U+064F. */
export function vowelOf(letter: string): string {
  return [...letter].filter((ch) => MARK_NAME[ch] && MARK_NAME[ch] !== "shaddah").join("");
}

/** Carrier for a mark shown alone on its dotted circle: the tatweel (U+0640), as Arabic primers
 *  write ـَ ـِ ـُ — Amiri has it, and a mark on a no-break space would float unanchored. */
export const TATWEEL = "ـ";

// ───────────────────────── word parts (rule 14)
export type PartsSpec = {
  changes: { tile: number; letter: number; to: number }[];
  drops: { tile: number; letter: number }[];
};

const ALIF = new Set(["ا", "ٱ", "أ", "إ", "آ"]);
const fold = (s: string) => [...s].filter((ch) => !COMBINING.test(ch)).join("");
/** The one letter (not vowel) change a join makes here: عَلَىٰ's alif maqsurah written ya' (عَلَيْهِمْ). */
const LETTER_CHANGES = new Set(["ى>ي"]);

/** The parts must add up to the word as the ayah writes it (pipeline/terms.py parts_problems):
 *  the tiles' letters, minus the dropped ones (an alif; after it, the lam of al-), with each
 *  changed letter replaced by the word's own letter (same consonant, another vowel; or ى → ي),
 *  spell the word byte for byte. */
export function partsProblems(tiles: string[], spec: PartsSpec, word: string): string[] {
  const out: string[] = [];
  const cut = tiles.map(letters);
  let flat = cut.flatMap((ls, i) => ls.map((ch, j) => ({ i, j, ch })));
  const wl = letters(word);
  for (const c of spec.changes) {
    const ti = c.tile - 1;
    const lj = c.letter === -1 ? (cut[ti]?.length ?? 0) - 1 : c.letter - 1;
    const a = cut[ti]?.[lj];
    const b = wl[c.to - 1];
    if (!a || !b) return [`change names a letter that does not exist`];
    if (fold(a) !== fold(b) && !LETTER_CHANGES.has(`${fold(a)}>${fold(b)}`)) out.push(`change: ${a} and ${b} are not the same letter`);
    else if (fold(a) === fold(b) && vowelOf(a) === vowelOf(b)) out.push(`change: ${a} → ${b} does not change the vowel`);
    flat = flat.map((x) => (x.i === ti && x.j === lj ? { ...x, ch: b } : x));
  }
  const dropped = new Set(spec.drops.map((d) => `${d.tile - 1}:${d.letter - 1}`));
  for (const d of spec.drops) {
    const ch = cut[d.tile - 1]?.[d.letter - 1];
    if (!ch) return [...out, `drop names a letter that does not exist`];
    const articleLam = ch === "ل" && d.letter === 2 && dropped.has(`${d.tile - 1}:0`) && cut[d.tile - 1][0][0] === "ٱ";
    if (!ALIF.has([...ch][0]) && !articleLam) out.push(`drop: ${ch} is not an alif or the lam of al-`);
  }
  flat = flat.filter((x) => !dropped.has(`${x.i}:${x.j}`));
  const spelled = flat.map((x) => x.ch).join("");
  if (spelled !== word) out.push(`the tiles spell ${spelled}, not the ayah's ${word}`);
  return out;
}

// ───────────────────────── tokens and the first-use scope
export type TermView = Pick<Term, "id" | "latin" | "ar" | "group" | "hint">;

export type Token =
  | { kind: "text"; text: string }
  | {
      kind: "term";
      surface: string;
      term: TermView;
      /** Show "(Arabic)" after the surface. */
      arabic: boolean;
      /** Harakah term at its first use: the reminder, and a link to the Harakat page. */
      hint: boolean;
      /** Punctuation that followed the span, kept on the same line as the Arabic (rule 15). */
      after: string;
      /** The prose's own gloss in brackets follows: the Arabic joins it, "nahwu (نَحْو, tata
       *  bahasa Arab)", instead of a second pair of brackets (and a harakah reminder gives way
       *  to the prose's gloss: "dhammah (ضَمَّة, bunyi u)"). */
      merge: boolean;
      /** An author citation follows: one bracket, "mabni (مَبْنِيّ; Ibnu 'Aqil)". */
      cite: boolean;
      /** The term sits inside the prose's own brackets: "jar, جَرّ" with a comma, no new pair. */
      inBracket: boolean;
    }
  | {
      kind: "quran";
      surface: string;
      ref: string;
      ar: string;
      arabic: boolean;
      after: string;
      merge: boolean;
      cite: boolean;
      inBracket: boolean;
    };

export type Lookup = {
  terms: Map<string, TermView>;
  quran: Record<string, string>;
};

export function lookupFrom(lib: Pick<Library, "terms" | "quran">): Lookup {
  return { terms: new Map(lib.terms.map((t) => [t.id, t])), quran: lib.quran };
}

/** What a page (or one card) has already shown. */
export class Scope {
  readonly shown = new Set<string>();
  readonly hinted = new Set<string>();
  /** hints: false on the Harakat page itself (its own subject). */
  constructor(readonly hints = true) {}
}

const LEADING_PUNCT = /^[,.;:!?)”]+/u;
/** " (" opening the prose's own gloss of the word, its ending ("(-īna)") or its place ("(112:3)",
 *  like "(ayat 1)"): lowercase Indonesian, not an author citation ("(al-Jadwal)", "(Darwisy)")
 *  and not a cross-reference ("(lihat: …)"). */
const GLOSS_OPENS = /^ \((?:(?=\d{1,3}:\d)|(?![a-z]{1,2}-|lihat\b)(?=[a-z“-]))/u;
/** " (" opening an author citation or a cross-reference right after the word: "mabni (مَبْنِيّ)
 *  (Ibnu 'Aqil)" becomes one bracket, "mabni (مَبْنِيّ; Ibnu 'Aqil)", and "(مُبْتَدَأ; lihat: …)"
 *  (review 2026-10-10: two pairs side by side). */
const CITE_OPENS = /^ \((?=lihat\b|[A-Z]|[a-z]{1,3}-[A-Z])/u;

/** How deep the text so far sits inside the prose's own brackets, and whether the innermost one
 *  is a cross-reference ("(lihat: …)"). */
function bracketState(before: string): { depth: number; crossRef: boolean } {
  const open: number[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "(") open.push(i);
    else if (before[i] === ")") open.pop();
  }
  const last = open[open.length - 1];
  return { depth: open.length, crossRef: last !== undefined && /^\(lihat\b/u.test(before.slice(last)) };
}

/** Tokens of one marked field, updating the scope (first use shows Arabic). Unknown refs render
 *  as their plain surface (src/lib/terms.test.ts keeps every ref resolving).
 *  Less clutter (review 2026-10-10): a term that already sits inside the prose's brackets takes
 *  its Arabic with a comma, "(dalam keadaan jar, جَرّ)", not a second pair; inside a
 *  cross-reference ("(lihat: I'rab dan tandanya)") a concept's name stays Latin; an author
 *  citation right after the Arabic joins its bracket. */
export function annotate(text: string, scope: Scope, lookup: Lookup): Token[] {
  const spans = parseMarked(text);
  const out: Token[] = [];
  let before = "";
  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    if (s.kind === "text") {
      out.push({ kind: "text", text: s.text });
      before += s.text;
      continue;
    }
    const { depth, crossRef } = bracketState(before);
    before += s.surface;
    let token: Token | null = null;
    if (s.ref.startsWith("q:")) {
      const ar = lookup.quran[s.ref.slice(2)];
      if (ar) {
        const arabic = !crossRef && !scope.shown.has(s.ref);
        if (arabic) scope.shown.add(s.ref);
        token = { kind: "quran", surface: s.surface, ref: s.ref, ar, arabic, after: "", merge: false, cite: false, inBracket: depth > 0 };
      }
    } else {
      const term = lookup.terms.get(s.ref);
      if (term) {
        const hint = !crossRef && term.group === "harakah" && scope.hints && !scope.hinted.has(term.id) && !!term.hint;
        const arabic = !crossRef && !!term.ar && (hint || !scope.shown.has(term.id));
        if (!crossRef) scope.shown.add(term.id);
        if (hint) scope.hinted.add(term.id);
        token = { kind: "term", surface: s.surface, term, arabic, hint, after: "", merge: false, cite: false, inBracket: depth > 0 };
      }
    }
    if (!token) {
      out.push({ kind: "text", text: s.surface });
      continue;
    }
    // Keep the closing punctuation with the Arabic gloss: "majrur (مَجْرُور)," never breaks before ",".
    const next = spans[k + 1];
    if (token.arabic && next?.kind === "text") {
      const m = next.text.match(LEADING_PUNCT);
      if (m) {
        token.after = m[0];
        spans[k + 1] = { kind: "text", text: next.text.slice(m[0].length) };
        before += m[0];
      } else if (!token.inBracket && (GLOSS_OPENS.test(next.text) || (next.text === " (" && spans[k + 2]?.kind === "mark"))) {
        token.merge = true;
        spans[k + 1] = { kind: "text", text: next.text.slice(2) };
        before += " (";
      } else if (!token.inBracket && CITE_OPENS.test(next.text)) {
        token.cite = true;
        spans[k + 1] = { kind: "text", text: next.text.slice(2) };
        before += " (";
      }
    }
    out.push(token);
  }
  return out.filter((t) => t.kind !== "text" || t.text !== "");
}

/** One term of a title's Arabic headword, with its sound when it names a harakah ("ضَمَّة" u):
 *  a beginner meets dhammah in the tanda-irab title before any reminder (review 2026-10-10). */
export type HeadTerm = { ar: string; sound?: string };

/** A title: its terms become the Arabic headword (shown large beside the Latin title, not as
 *  "(…)" inside it) and count as shown for the page (a harakah term keeps its reminder for its
 *  first use in the text); Qur'anic words stay inline, annotated with the text around them so a
 *  gloss in brackets after one is merged ("Zharaf iżā (إِذَا, keterangan waktu “apabila”)").
 *  `sounds`: harakah term id → its sound on the Harakat page. */
export function titleParts(
  text: string,
  scope: Scope,
  lookup: Lookup,
  sounds: Record<string, string> = {},
): { tokens: Token[]; head: HeadTerm[] } {
  const head: HeadTerm[] = [];
  const parts: string[] = [];
  for (const s of parseMarked(text)) {
    if (s.kind === "text") parts.push(s.text);
    else if (s.ref.startsWith("q:")) parts.push(`[[${s.surface}|${s.ref}]]`);
    else {
      const term = lookup.terms.get(s.ref);
      if (term?.ar && !head.some((h) => h.ar === term.ar)) {
        const sound = term.group === "harakah" ? sounds[term.id] : undefined;
        // a, i, u (-an …): a short sound; sukun's "mati, tanpa vokal" stays in the reminder
        head.push(sound && sound.length <= 3 ? { ar: term.ar, sound } : { ar: term.ar });
      }
      if (term) scope.shown.add(term.id);
      parts.push(s.surface);
    }
  }
  return { tokens: annotate(parts.join(""), scope, lookup), head };
}

/** All refs of a marked text (for checks). */
export function refsOf(text: string): string[] {
  return parseMarked(text).flatMap((s) => (s.kind === "mark" ? [s.ref] : []));
}

/** "bismi: kasrah, …" under a row that already shows bismi: drop the repeated word and colon. */
export function noteWithoutWord(note: string, translit: string): string {
  const spans = parseMarked(note);
  const first = spans[0];
  const rest = spans[1];
  if (first?.kind !== "mark" || first.surface.toLowerCase() !== translit.toLowerCase()) return note;
  if (rest?.kind !== "text" || !rest.text.startsWith(": ")) return note;
  const tail = note.slice(note.indexOf("]]") + 4);
  // Capitalise the first letter the reader sees, inside a span too ("[[fi'il|fiil]], …").
  const at = tail.startsWith("[[") ? 2 : 0;
  return tail.slice(0, at) + tail.charAt(at).toUpperCase() + tail.slice(at + 1);
}

// ───────────────────────── a parts diagram, ready to render
/** One letter that changes as the parts join, and WHERE (review 2026-10-10: "Akhirnya berubah"
 *  under ‘alaihim was wrong, the vowel that changes is on the pronoun's FIRST letter). */
export type PartsChange = {
  /** The part's Latin ("hum") and the place of the letter in it. */
  part: string;
  where: "end" | "first" | "only" | "nth";
  /** 1-based letter of the part. */
  n: number;
  /** vowel: another mark on the same letter, shown alone on dotted circles; letter: the letter
   *  itself changes (عَلَىٰ's ىٰ → يْ), shown whole. Both cut from the bytes. */
  kind: "vowel" | "letter";
  from: string;
  to: string;
  fromTerm: TermView | null;
  toTerm: TermView | null;
  fromSound: string;
  toSound: string;
  /** For a letter change: the letters' Latin names ("alif", "ya’"). */
  fromName: string;
  toName: string;
};

export type PreparedParts = {
  loc: string;
  word: { ar: string; translit: string; gloss: string };
  /** `dropped`: 1-based letters of the tile the word does not write (shown faded). */
  tiles: { ar: string; dropped: number[]; translit: string; label: Token[]; gloss: string }[];
  changes: PartsChange[];
  steps: Token[][];
};

/** Latin names of the letters a letter change involves (the alif maqsurah and the ya'). */
const LETTER_LATIN: Record<string, string> = { "ى": "alif", "ي": "ya’" };

/** Tiles from library.json `quran`, each change cut from the tile's and the word's letters, the
 *  marked labels and steps annotated in the page's scope. `sounds`: term id → sound ("a", "i",
 *  "u"), from the Harakat page's signs. Throws on a broken diagram (vitest keeps them whole). */
export function prepareParts(
  part: {
    loc: string;
    tiles: { q: string; translit: string; label: string; gloss: string }[];
    changes: { tile: number; letter: number; to: number }[];
    drops: { tile: number; letter: number }[];
    steps: string[];
  },
  word: { ar: string; translit: string; gloss: string },
  scope: Scope,
  lookup: Lookup,
  sounds: Record<string, string>,
): PreparedParts {
  const bytes = part.tiles.map((t) => {
    const ar = lookup.quran[t.q.slice(2)];
    if (!ar) throw new Error(`parts ${part.loc}: no bytes for ${t.q}`);
    return ar;
  });
  const tiles = part.tiles.map((t, i) => ({
    ar: bytes[i],
    dropped: part.drops.filter((d) => d.tile === i + 1).map((d) => d.letter),
    translit: t.translit,
    label: annotate(t.label, scope, lookup),
    gloss: t.gloss,
  }));
  const termOf = (m: string) => lookup.terms.get(MARK_TERM[MARK_NAME[m] ?? ""] ?? "") ?? null;
  const soundOf = (t: TermView | null) => (t ? (sounds[t.id] ?? "") : "");
  const changes = part.changes.map((c): PartsChange => {
    const ls = letters(bytes[c.tile - 1]);
    const at = c.letter === -1 ? ls.length - 1 : c.letter - 1;
    const a = letterOf(bytes[c.tile - 1], c.letter);
    const b = letterOf(word.ar, c.to);
    const kind = fold(a) === fold(b) ? "vowel" : "letter";
    const from = kind === "vowel" ? vowelOf(a) : a;
    const to = kind === "vowel" ? vowelOf(b) : b;
    const fromTerm = termOf(vowelOf(a));
    const toTerm = termOf(vowelOf(b));
    for (const t of [fromTerm, toTerm]) if (t) scope.shown.add(t.id);
    return {
      part: part.tiles[c.tile - 1].translit,
      where: ls.length === 1 ? "only" : at === ls.length - 1 ? "end" : at === 0 ? "first" : "nth",
      n: at + 1,
      kind,
      from,
      to,
      fromTerm: kind === "vowel" ? fromTerm : null,
      toTerm,
      fromSound: kind === "vowel" ? soundOf(fromTerm) : "",
      toSound: kind === "vowel" ? soundOf(toTerm) : "",
      fromName: LETTER_LATIN[fold(a)] ?? "",
      toName: LETTER_LATIN[fold(b)] ?? "",
    };
  });
  return { loc: part.loc, word, tiles, changes, steps: part.steps.map((s) => annotate(s, scope, lookup)) };
}

// ───────────────────────── the Harakat page's signs, ready to render
export type PreparedSign = {
  term: TermView | null;
  /** The sign alone (cut from the example letter), for its dotted circle. */
  mark: string;
  /** The example letter as the ayah writes it, and the word it comes from (a lesson word). */
  letter: string;
  loc: string;
  sound: string;
  place: string;
  shape: string;
  reading: string;
};

export function prepareSigns(
  signs: { term: string; example: string; marks: string[]; sound: string; place: string; shape: string; reading: string }[],
  lookup: Lookup,
): PreparedSign[] {
  return signs.map((s) => {
    const letter = lookup.quran[s.example.slice(2)];
    const m = s.example.match(QREF);
    if (!letter || !m || !m[6]) throw new Error(`harakat sign ${s.term}: ${s.example} is not a resolved letter ref`);
    return {
      term: lookup.terms.get(s.term) ?? null,
      mark: marksOf(letter, s.marks),
      letter,
      loc: `${m[1]}:${m[2]}:${m[3]}`,
      sound: s.sound,
      place: s.place,
      shape: s.shape,
      reading: s.reading,
    };
  });
}

/** Term id → its sound on the Harakat page ("a", "i", "u", "mati, tanpa vokal"). */
export function soundsOf(signs: { term: string; sound: string; marks: string[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of signs) if (!(s.term in out) && !s.marks.some((m) => m.endsWith("tain"))) out[s.term] = s.sound;
  return out;
}

// ───────────────────────── checks (vitest, CI: no corpus needed)
/** Everything the app can prove about the marked library from library.json and the lesson
 *  content alone (pipeline/validate_terms.py repeats these, plus the corpus checks, in Python):
 *  plain = strip(marked); every ref resolves; every Qur'anic ref into a lesson word carries that
 *  word's content bytes; part refs are the word's QAC segments, which join to the word; letter
 *  refs are the word's letters; each Harakat sign's mark is cut from its letter; every parts
 *  diagram spells its word; no "ketuk", no "yang berarti". */
export function libraryProblems(
  lib: Pick<Library, "concepts" | "basics" | "parts" | "terms" | "quran" | "segments">,
  wordAr: Record<string, string>,
): string[] {
  const out: string[] = [];
  const termIds = new Set(lib.terms.map((t) => t.id));
  const checkRefs = (text: string, where: string) => {
    for (const ref of refsOf(text)) {
      if (ref.startsWith("q:")) {
        const m = ref.match(QREF);
        const key = ref.slice(2);
        const bytes = lib.quran[key];
        if (!m || bytes === undefined) {
          out.push(`${where}: ${ref} has no bytes in library.json quran`);
          continue;
        }
        const loc = `${m[1]}:${m[2]}:${m[3]}`;
        const word = wordAr[loc];
        if (word === undefined) continue; // a Tanzil token outside the lessons (checked with the corpus)
        if (m[4]) {
          const run = Array.from({ length: Number(m[4]) - Number(m[3]) + 1 }, (_, k) => wordAr[`${m[1]}:${m[2]}:${Number(m[3]) + k}`]);
          if (run.includes(undefined as unknown as string) || bytes !== run.join(" ")) out.push(`${where}: ${ref} is not the ayah's words ${run.join(" ")}`);
        } else if (m[5]) {
          const segs = lib.segments[loc];
          if (!segs || segs.join("") !== word) out.push(`${where}: the QAC segments of ${loc} do not join to its content bytes ${word}`);
          else if (segs[Number(m[5]) - 1] !== bytes) out.push(`${where}: ${ref} is not segment ${m[5]} of ${word}`);
        } else if (m[6]) {
          let letter: string | null = null;
          try {
            letter = letterOf(word, Number(m[6]));
          } catch {
            letter = null;
          }
          if (letter !== bytes) out.push(`${where}: ${ref} is not letter ${m[6]} of ${word}`);
        } else if (bytes !== word) {
          out.push(`${where}: ${ref} shows ${bytes}, but the lesson word ${loc} is ${word}`);
        }
      } else if (!termIds.has(ref)) {
        out.push(`${where}: term ${ref} is not in library.json terms`);
      }
    }
  };
  const checkField = (marked: string | undefined, plainText: string | undefined, where: string) => {
    if (marked === undefined && plainText === undefined) return;
    if (marked === undefined || plainText === undefined) return void out.push(`${where}: marked and plain differ in presence`);
    if (stripMarked(marked) !== plainText) out.push(`${where}: the plain text is not the marked text without its markup`);
    if (plainText.includes("[[") || plainText.includes("]]")) out.push(`${where}: markup left in the plain text`);
    checkRefs(marked, where);
    if (/\b(ketuk|mengetuk|diketuk)\b/i.test(plainText)) out.push(`${where}: says "ketuk" (klik, never ketuk)`);
    if (/\byang berarti\b/i.test(plainText)) out.push(`${where}: says "yang berarti" (meanings use "yang artinya")`);
  };
  for (const c of lib.concepts) {
    const w = `concept ${c.id}`;
    if (!c.marked) {
      out.push(`${w}: no marked prose`);
      continue;
    }
    checkField(c.marked.title, c.title, `${w}.title`);
    checkField(c.marked.summary, c.summary, `${w}.summary`);
    if (c.marked.explanation.length !== c.explanation.length) out.push(`${w}: marked explanation has ${c.marked.explanation.length} paragraphs, plain ${c.explanation.length}`);
    c.explanation.forEach((p, i) => checkField(c.marked!.explanation[i], p, `${w}.explanation[${i}]`));
    checkField(c.marked.bridge, c.bridge, `${w}.bridge`);
    if (c.marked.notes.length !== c.examples.length) out.push(`${w}: ${c.marked.notes.length} marked notes for ${c.examples.length} examples`);
    c.examples.forEach((e, i) => {
      checkField(c.marked!.notes[i], e.note, `${w}.examples[${i}]`);
      if (wordAr[e.loc] === undefined) out.push(`${w}: example ${e.loc} is not a lesson word (its row has no Arabic)`);
    });
  }
  for (const b of lib.basics) {
    const w = `basic ${b.id}`;
    if (!b.marked) {
      out.push(`${w}: no marked prose`);
      continue;
    }
    checkField(b.marked.title, b.title, `${w}.title`);
    checkField(b.marked.summary, b.summary, `${w}.summary`);
    b.explanation.forEach((p, i) => checkField(b.marked!.explanation[i], p, `${w}.explanation[${i}]`));
    for (const s of b.signs) {
      const m = s.example.match(QREF);
      const letter = lib.quran[s.example.slice(2)];
      if (!m || !m[6] || !letter) {
        out.push(`${w}: sign ${s.term}: ${s.example} is not a resolved letter ref`);
        continue;
      }
      checkRefs(`[[x|${s.example}]]`, `${w}.sign ${s.term}`);
      const cut = marksOf(letter, s.marks);
      const names = [...cut].map((ch) => MARK_NAME[ch]);
      if (!cut || names.length !== s.marks.length || !s.marks.every((n) => names.includes(n)))
        out.push(`${w}: sign ${s.term}: ${letter} does not carry exactly ${s.marks.join(" + ")}`);
      if (!termIds.has(s.term)) out.push(`${w}: sign term ${s.term} is not in library.json terms`);
    }
  }
  for (const p of lib.parts) {
    const w = `parts ${p.loc}`;
    const word = wordAr[p.loc];
    if (word === undefined) {
      out.push(`${w}: not a lesson word`);
      continue;
    }
    const tiles = p.tiles.map((t) => lib.quran[t.q.slice(2)]);
    if (tiles.some((x) => x === undefined)) {
      out.push(`${w}: a tile has no bytes`);
      continue;
    }
    for (const t of p.tiles) checkRefs(`[[x|${t.q}]] ${t.label}`, `${w}.tile`);
    p.steps.forEach((s, i) => checkRefs(s, `${w}.steps[${i}]`));
    for (const x of partsProblems(tiles, { changes: p.changes, drops: p.drops }, word)) out.push(`${w}: ${x}`);
  }
  for (const t of lib.terms) {
    if (t.ar !== null && !/^[ء-غف-ْ ]+$/u.test(t.ar)) out.push(`term ${t.id}: ${t.ar} is not typed Arabic (letters + harakat)`);
    if (t.group === "harakah" && !t.hint) out.push(`term ${t.id}: a harakah term needs its reminder`);
  }
  return out;
}
