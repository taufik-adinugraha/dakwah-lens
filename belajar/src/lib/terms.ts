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
 *   [[“nama Allah”|q:1:1:1-2]]   a GLOSS: an example the prose gives only as its Indonesian
 *                                translation, followed by the Arabic of the ayah words it
 *                                translates → "“nama Allah” (بِسْمِ ٱللَّهِ)" (operator 2026-10-12, on
 *                                /konsep/idhafah: "also write in arabic 'bismillah'")
 * The Arabic comes from the term table (verified spellings) and from library.json `quran`
 * (Tanzil/QAC bytes resolved by the build) — for a lesson's own marked prose (its word cards, ayah
 * structure and facts, 2026-10-12) from that lesson's `quran` too (lessonLookup). Nothing here
 * types Arabic.
 *
 * Display rule (less clutter, operator 2026-10-10): a term or Qur'anic word shows its Arabic at
 * its FIRST use in a scope (a page, or one card) and plain Latin after that; a harakah term's
 * first use on a page also carries its reminder ("kasrah (كَسْرَة, tanda bunyi i di bawah huruf)")
 * and links to the Harakat page.
 *
 * Where the Arabic goes (operator 2026-10-12, "tidy them up", after a review of the brackets):
 * - on its own, in brackets after the word: "majrur (مَجْرُور)";
 * - a PHRASE of Qur'anic words — a run: two or more words that follow one another in the ayah,
 *   a single space apart — gets ONE bracket after the whole phrase, the mushaf's own text: "yaum
 *   ad-dīn (يَوْمِ ٱلدِّينِ)", never "yaum (يَوْمِ) ad-dīn (ٱلدِّينِ)" (runFrom). Grammar terms never
 *   form a run: two terms side by side are seldom one Arabic phrase ("isimnya dirafa'kan",
 *   "fi'il amr mabni", "menafikan mudhari'" were glued into one by a first version, review
 *   2026-10-12), so each keeps its own Arabic;
 * - joined to the prose's own gloss, place or citation when one follows: "nahwu (نَحْو, tata bahasa
 *   Arab)", "qul a‘ūżu (قُلْ أَعُوذُ, 113 dan 114)", "mabni (مَبْنِيّ; Ibnu 'Aqil)" (GLOSS_OPENS,
 *   CITE_OPENS);
 * - inside the prose's own brackets, right after the item with ONE SPACE, so that the commas there
 *   separate items again: "(dhammah ضَمَّة, fathah فَتْحَة, kasrah كَسْرَة)", "wa (وَ, 'athaf عَطْف,
 *   penyambungan)", "(dalam keadaan jar جَرّ)" — never "(dhammah, ضَمَّة, fathah, فَتْحَة, …)". There
 *   a term that another marked item follows stays Latin (the phrase goes on, continuesPhrase):
 *   "(mahall nashb نَصْب)", never "(mahall nashb مَحَلّ نَصْب)".
 * pipeline/quiz.py (render_marked) is the twin of annotate + termDisplay for the quiz text;
 * src/lib/quiz-content.test.ts holds the two together, character for character.
 * Pure functions only: vitest runs in node, without a DOM.
 */
import type { Library, SurahContent, Term } from "@/content/schema";

export const MARKUP = /\[\[([^[\]|]+?)(?:\|([^[\]|]+))?\]\]/g;
/** q:S:A:W · q:S:A:W1-W2 · q:S:A:W/k (QAC segment) · q:S:A:W#n (letter) */
export const QREF = /^q:(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3})|\/(\d{1,2})|#(\d{1,2}))?$/;
/** A gloss variant's surface: ONE quotation “…” with nothing outside it (pipeline/terms.py GLOSS). */
const GLOSS = /^“[^“”]+”$/u;
export const isGloss = (surface: string): boolean => GLOSS.test(surface);

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
      /** The term sits inside the prose's own brackets: its Arabic right after it, "jar جَرّ", one
       *  space and no new pair (the commas there separate items). */
      inBracket: boolean;
      run?: Run;
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
      run?: Run;
    };

/** A Qur'anic item's place in a run (a phrase of Qur'anic words, runFrom): `ar` is the Arabic of
 *  the whole run, its items' joined by spaces (the mushaf's own text); `end` is true on the last item, the one that shows it (when
 *  `arabic`) — the items before it stay Latin. */
export type Run = { ar: string; end: boolean };

export type Lookup = {
  terms: Map<string, TermView>;
  quran: Record<string, string>;
  /** The QAC segments of each word a part ref names (library.json / a lesson's `segments`): how
   *  many parts a word has, so that a part is known to be its last (a run of Qur'anic items). */
  segments?: Record<string, readonly string[]>;
};

export function lookupFrom(lib: Pick<Library, "terms" | "quran"> & Partial<Pick<Library, "segments">>): Lookup {
  return { terms: new Map(lib.terms.map((t) => [t.id, t])), quran: lib.quran, segments: lib.segments };
}

/** A marked lesson's lookup: the library's terms and Qur'anic bytes, with the lesson's own `quran`
 *  and `segments` (the q-refs its word cards, ayah structure and facts name;
 *  pipeline/build_surah.py). */
export function lessonLookup(base: Lookup, surah: Pick<SurahContent, "quran"> & Partial<Pick<SurahContent, "segments">>): Lookup {
  return { terms: base.terms, quran: { ...base.quran, ...surah.quran }, segments: { ...base.segments, ...surah.segments } };
}

/** What a page (or one card) has already shown. */
export class Scope {
  readonly shown = new Set<string>();
  readonly hinted = new Set<string>();
  /** hints: false on the Harakat page itself (its own subject). */
  constructor(readonly hints = true) {}
}

const LEADING_PUNCT = /^[,.;:!?)”]+/u;
/** The authors and kitabs the lessons cite by a capitalised name ("(Darwisy; al-Jadwal)", "(Ibnu
 *  'Aqil)", "(Abu Hayyan)", "(Ahmad Zaini Dahlan)", "(Mughni)", "(Shahih al-Bukhari no. …)"): the
 *  first word of a bracket that is a citation. The ones named with their article ("al-Jadwal",
 *  "as-Samin", "an-Nahhas") need no list: a lowercase article, a hyphen, a capital.
 *  pipeline/quiz.py CITED mirrors it; terms.test.ts pins every capitalised bracket of the content
 *  to its kind, so a new author is added here knowingly. */
export const CITED = ["Darwisy", "Ibnu", "Abu", "Ahmad", "Mughni", "Shahih", "Riyadhush"] as const;
const CITED_NAME = `(?:${CITED.join("|")})(?![\\p{L}\\p{M}])`;
/** " (" opening the prose's own gloss of the word, its ending ("(-īna)") or its place — a bracket
 *  that opens on a number: "(112:3)", "(113 dan 114)", like "(ayat 1)": Indonesian words, a quoted
 *  gloss (“…” or, in the lessons' word cards, '…': "-him (هِمْ, 'mereka')", as pipeline/quiz.py
 *  annotates; 2026-10-12), not an author citation ("(al-Jadwal)", "(Darwisy)") and not a
 *  cross-reference ("(lihat: …)"). A bracket that opens with a capital is a gloss unless its first
 *  word is a cited author's or kitab's name (CITED): "al-musta‘ān (ٱلْمُسْتَعَانُ, Yang dimohon
 *  pertolongan-Nya)", "rabb (رَبِّ, Tuhan, Pemelihara)" (operator 2026-10-12: a capital alone made
 *  them citations, "(ٱلْمُسْتَعَانُ; Yang dimohon …)"). */
const GLOSS_OPENS = new RegExp(`^ \\((?:(?=\\d)|(?![a-z]{1,2}-|lihat\\b)(?=[a-z“'‘-])|(?!${CITED_NAME})(?=\\p{Lu}))`, "u");
/** " (" opening an author citation or a cross-reference right after the word: "mabni (مَبْنِيّ)
 *  (Ibnu 'Aqil)" becomes one bracket, "mabni (مَبْنِيّ; Ibnu 'Aqil)", and "(مُبْتَدَأ; lihat: …)"
 *  (review 2026-10-10: two pairs side by side). A citation opens with a cited name (CITED) or a
 *  name with its article ("al-Jadwal"). */
const CITE_OPENS = new RegExp(`^ \\((?=lihat\\b|${CITED_NAME}|[a-z]{1,3}-[A-Z])`, "u");

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

/** Words that join a list inside brackets rather than continue a phrase ("nahwu dan sharaf"). */
const LIST_WORDS = new Set(["dan", "atau", "serta", "maupun"]);

/** Whether the text after an item or a run (`next`, and the span after it) goes on with the same
 *  phrase: another word ("mahall raf'", "manshub al-mahall") or another marked item that is not
 *  of its run (a second term, "(mahall nashb)"; a term next to a Qur'anic word), not the end of
 *  the bracket, a comma, or a list ("nahwu dan sharaf"). */
function continuesPhrase(next: Span | undefined, after: Span | undefined): boolean {
  if (!next || next.kind !== "text") return false;
  if (next.text === " ") return after?.kind === "mark";
  const m = next.text.match(/^ ([\p{L}'‘’-]+)/u);
  return !!m && !LIST_WORDS.has(m[1].toLowerCase());
}

/** A marked span resolved: a term of the table, or a Qur'anic ref with its bytes; null when the
 *  ref is unknown (drawn as its plain surface). */
type Item = { kind: "term"; term: TermView } | { kind: "quran"; ref: string; ar: string } | null;

/** Whether Qur'anic item `b` goes on where `a` ends: the next word of the same ayah — `a` a word, a
 *  run of words or the LAST part of its word (known from `segments`), `b` a word, a run or the
 *  FIRST part of its own — so that their bytes joined by a space are the mushaf's own text, never
 *  a phrase put together here ("an‘ama ‘alaihi" of 33:37, words 4 and 6, stays two brackets). A
 *  letter is never part of a run. */
function follows(a: string, b: string, lookup: Lookup): boolean {
  const x = a.match(QREF);
  const y = b.match(QREF);
  if (!x || !y || x[6] || y[6] || x[1] !== y[1] || x[2] !== y[2]) return false;
  if (x[5] && lookup.segments?.[`${x[1]}:${x[2]}:${x[3]}`]?.length !== Number(x[5])) return false;
  if (y[5] && y[5] !== "1") return false;
  return Number(y[3]) === Number(x[4] ?? x[3]) + 1;
}

/**
 * The run that starts at span `k` (operator 2026-10-12: "yaum (يَوْمِ) ad-dīn (ٱلدِّينِ)" glossed
 * a two-word phrase word by word): its spans, or null when `k` stands alone. A run is two or more
 * Qur'anic words that follow one another in the ayah ("yaum ad-dīn", "lam yūlad": follows), with
 * only a single space between them, so their Arabic joined is the mushaf's own text. Never terms
 * (the head of this file). Punctuation, a list word or any other text between
 * two items ends it ("isim (اِسْم), fi'il (فِعْل)" are two items), and so does an item of the
 * other kind ("huruf jar (حَرْف جَرّ) bi- (بِ, dengan)"), a term the table has no Arabic for, a
 * letter, and a quoted gloss ([[“nama Allah”|q:…]]: an example, not a word of the phrase).
 */
function runFrom(k: number, spans: readonly Span[], items: readonly Item[], lookup: Lookup): number[] | null {
  const joins = (i: number) => {
    const s = spans[i];
    const it = items[i];
    if (!it || s?.kind !== "mark") return false;
    return it.kind === "quran" && !isGloss(s.surface);
  };
  if (!joins(k)) return null;
  const run = [k];
  for (;;) {
    const last = run[run.length - 1];
    const gap = spans[last + 1];
    const a = items[last]!;
    const b = items[last + 2];
    if (gap?.kind !== "text" || gap.text !== " " || !joins(last + 2) || !b || b.kind !== a.kind) break;
    if (a.kind === "quran" && b.kind === "quran" && !follows(a.ref, b.ref, lookup)) break;
    run.push(last + 2);
  }
  return run.length > 1 ? run : null;
}

/** Tokens of one marked field, updating the scope (first use shows Arabic). Unknown refs render
 *  as their plain surface (src/lib/terms.test.ts keeps every ref resolving).
 *  Less clutter (review 2026-10-10): a term that already sits inside the prose's brackets takes
 *  its Arabic right after it, "(dalam keadaan jar جَرّ)", not a second pair; inside a
 *  cross-reference ("(lihat: I'rab dan tandanya)") a concept's name stays Latin; an author
 *  citation right after the Arabic joins its bracket.
 *  A run (runFrom) is one item: when any of its items is due to show its Arabic, the whole run's
 *  is shown once, after its last item ("lam yūlad (لَمْ يُولَدْ)", in brackets "(seperti yaum
 *  ad-dīn يَوْمِ ٱلدِّينِ)"), and every item of it counts as shown. It comes before continuesPhrase: an item
 *  followed by an item of its run is that run, not "a phrase going on"; unmarked words after the
 *  run still keep it Latin inside a bracket. */
export function annotate(text: string, scope: Scope, lookup: Lookup): Token[] {
  const spans = parseMarked(text);
  const items = spans.map((s): Item => {
    if (s.kind !== "mark") return null;
    if (s.ref.startsWith("q:")) {
      const ar = lookup.quran[s.ref.slice(2)];
      return ar ? { kind: "quran", ref: s.ref, ar } : null;
    }
    const term = lookup.terms.get(s.ref);
    return term ? { kind: "term", term } : null;
  });
  const out: Token[] = [];
  let before = "";
  for (let k = 0; k < spans.length; k++) {
    const s = spans[k];
    if (s.kind === "text") {
      out.push({ kind: "text", text: s.text });
      before += s.text;
      continue;
    }
    const item = items[k];
    if (!item) {
      before += s.surface;
      out.push({ kind: "text", text: s.surface });
      continue;
    }
    const { depth, crossRef } = bracketState(before);
    const run = runFrom(k, spans, items, lookup);
    const end = run ? run[run.length - 1] : k;
    // Inside the prose's brackets, an item (or a run) that more words of the same phrase follow
    // stays Latin there: its Arabic would sit inside the phrase, "(mahall, مَحَلّ raf')" for
    // "(mahall raf')", "(as-Samin: manshub, مَنْصُوب al-mahall)" (operator review 2026-10-12) — a
    // Qur'anic word too, "(as-Samin mengurai al-magḍūbi ‘alaihim menjadi …)". It is not counted
    // as shown, so its next use shows the Arabic.
    const inner = depth > 0 && continuesPhrase(spans[end + 1], spans[end + 2]);
    const live = !crossRef && !inner;
    const inBracket = depth > 0;
    const key = (it: NonNullable<Item>) => (it.kind === "term" ? it.term.id : it.ref);
    let token: Exclude<Token, { kind: "text" }>;
    if (run) {
      const members = run.map((i) => items[i]!);
      const ar = members.map((it) => (it.kind === "term" ? it.term.ar! : it.ar)).join(" ");
      const due = live && members.some((it) => !scope.shown.has(key(it)));
      let made: Exclude<Token, { kind: "text" }> | undefined;
      for (let n = 0; n < run.length; n++) {
        const it = members[n];
        const surface = (spans[run[n]] as Extract<Span, { kind: "mark" }>).surface;
        const last = n === run.length - 1;
        if (made) {
          out.push(made, { kind: "text", text: " " });
          before += " ";
        }
        before += surface;
        if (live) scope.shown.add(key(it));
        const shape = { surface, arabic: last && due, after: "", merge: false, cite: false, inBracket, run: { ar, end: last } };
        made = it.kind === "term" ? { kind: "term", term: it.term, hint: false, ...shape } : { kind: "quran", ref: it.ref, ar: it.ar, ...shape };
      }
      token = made!;
      k = end;
    } else if (item.kind === "quran") {
      before += s.surface;
      const arabic = live && !scope.shown.has(item.ref);
      if (arabic) scope.shown.add(item.ref);
      token = { kind: "quran", surface: s.surface, ref: item.ref, ar: item.ar, arabic, after: "", merge: false, cite: false, inBracket };
    } else {
      before += s.surface;
      const term = item.term;
      const hint = live && term.group === "harakah" && scope.hints && !scope.hinted.has(term.id) && !!term.hint;
      const arabic = live && !!term.ar && (hint || !scope.shown.has(term.id));
      if (live) scope.shown.add(term.id);
      if (hint) scope.hinted.add(term.id);
      token = { kind: "term", surface: s.surface, term, arabic, hint, after: "", merge: false, cite: false, inBracket };
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

/** A stretch of termDisplay's text drawn in a style, [from, to) as offsets: a term's Arabic, a
 *  Qur'anic word's, and a harakah term's word (at its first use, the link to the Harakat page). */
export type DisplayMark = { from: number; to: number; kind: "term" | "quran" | "link" };

/**
 * The text TermText shows for a field's tokens, and its styled stretches. A token with its Arabic
 * reads "majrur (مَجْرُور)", a harakah term at its first use "kasrah (كَسْرَة, tanda bunyi i di
 * bawah huruf)", a run's last item the whole run's "yaum ad-dīn (يَوْمِ ٱلدِّينِ)", inside the
 * prose's own bracket "(dalam keadaan jar جَرّ)" — one space, so that a comma there separates two
 * items, "(dhammah ضَمَّة, fathah فَتْحَة)", and a reminder follows its comma, "(kasrah كَسْرَة, tanda
 * bunyi i di bawah huruf)" — joined to the prose's gloss "nahwu (نَحْو, tata bahasa Arab)" or to
 * a citation "mabni (مَبْنِيّ; Ibnu 'Aqil)"; any other token is its surface. One string, so
 * MixedText cuts it into line-break pieces exactly as it cuts any other text (rule 15, review
 * 2026-10-11: drawn token by token, a break was left next to every term, "keduanya ( ⏎ mudhaf",
 * "waswasa– ⏎ yuwaswisu", and "al- ⏎ qaul" in a plain one). Each token's text depends on that
 * token alone (termEmphasis adds them up).
 */
export function termDisplay(tokens: readonly Token[]): { text: string; marks: DisplayMark[] } {
  let text = "";
  const marks: DisplayMark[] = [];
  for (const t of tokens) {
    if (t.kind === "text") {
      text += t.text;
      continue;
    }
    const words = t.surface.split(" ");
    const lead = words.slice(0, -1).join(" ");
    const last = words[words.length - 1];
    if (!t.arabic) {
      text += t.surface;
      continue;
    }
    if (lead) text += `${lead} `;
    if (t.kind === "term" && t.hint) marks.push({ from: text.length, to: text.length + last.length, kind: "link" });
    text += last;
    const ar = t.run ? t.run.ar : t.kind === "term" ? t.term.ar! : t.ar;
    const hint = t.kind === "term" && t.hint && !t.merge ? t.term.hint : null;
    // What opens before the Arabic and closes right after it, and the reminder after that.
    const open = t.inBracket ? " " : " (";
    const close = hint || t.merge ? "," : t.cite ? ";" : t.inBracket ? t.after : `)${t.after}`;
    text += open;
    marks.push({ from: text.length, to: text.length + ar.length, kind: t.kind });
    text += ar + close;
    if (hint) text += ` ${hint}${t.inBracket ? t.after : t.cite ? ";" : `)${t.after}`}`;
    if (t.merge || t.cite) text += " ";
  }
  return { text, marks };
}

/** One term of a title's Arabic headword, with its SIGN when it names one harakah ("ضَمَّة" with
 *  ـُ): a beginner meets dhammah in the tanda-irab title before any reminder (review 2026-10-10),
 *  and meets it as the symbol, not as its sound in Latin (operator 2026-10-12: "better not use
 *  'a', 'i', 'u', but use harakat symbols"). Tanwin names three signs: none is shown for it. */
export type HeadTerm = { ar: string; mark?: string };

/** Harakah term id → the one sign it names (fathah → U+064E …); tanwin's three are left out. */
const SIGN_OF_TERM: Record<string, string> = (() => {
  const by: Record<string, string[]> = {};
  for (const [ch, name] of Object.entries(MARK_NAME)) {
    const term = MARK_TERM[name];
    if (term) (by[term] ??= []).push(ch);
  }
  return Object.fromEntries(Object.entries(by).flatMap(([term, chs]) => (chs.length === 1 ? [[term, chs[0]]] : [])));
})();

/** A field's marked twin annotated in `scope` (call in reading order); null without one: the
 *  page draws the plain text as before (TermText's Prose). */
export function markedTokens(marked: string | undefined, scope: Scope, lookup: Lookup): Token[] | null {
  return marked === undefined ? null : annotate(marked, scope, lookup);
}

/** The Arabic headword of a concept's title (its first term with Arabic): a chip shows it beside the
 *  title, as the Konsep page's related chips do. */
export function headwordOf(marked: string | undefined, lookup: Lookup): string | null {
  return marked ? (titleParts(marked, new Scope(), lookup).head[0]?.ar ?? null) : null;
}

/** A title: its terms become the Arabic headword (shown large beside the Latin title, not as
 *  "(…)" inside it) and count as shown for the page (a harakah term keeps its reminder for its
 *  first use in the text); Qur'anic words stay inline, annotated with the text around them so a
 *  gloss in brackets after one is merged ("Zharaf iżā (إِذَا, keterangan waktu “apabila”)").
 *  Runs (runFrom) in a title: its terms are plain words inline, so only Qur'anic words form one
 *  there ("Ar-raḥmān ar-raḥīm (ٱلرَّحْمَٰنِ ٱلرَّحِيمِ) berdampingan"); the headword keeps one entry
 *  per term, as before ("فِعْل · مَجْهُول"), each a short box that fits a phone's line. */
export function titleParts(text: string, scope: Scope, lookup: Lookup): { tokens: Token[]; head: HeadTerm[] } {
  const head: HeadTerm[] = [];
  const parts: string[] = [];
  for (const s of parseMarked(text)) {
    if (s.kind === "text") parts.push(s.text);
    else if (s.ref.startsWith("q:")) parts.push(`[[${s.surface}|${s.ref}]]`);
    else {
      const term = lookup.terms.get(s.ref);
      if (term?.ar && !head.some((h) => h.ar === term.ar)) {
        const mark = term.group === "harakah" ? SIGN_OF_TERM[term.id] : undefined;
        head.push(mark ? { ar: term.ar, mark } : { ar: term.ar });
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
  /** `dropped`: 1-based letters of the tile the word does not write (shown faded). `q`: the
   *  tile's q-ref (its clip, src/lib/clips.ts: a whole word has the imam's voice, a part none).
   *  `washal`: a whole-word tile that starts with hamzat washal mid-ayah is heard without its alif,
   *  so it plays the run with the word before it (`run`, a clip key) and names what is heard
   *  (`heard`, "tabārakasmu"); derived by the build (pipeline/clips.py washal_of). */
  tiles: {
    q: string;
    ar: string;
    dropped: number[];
    translit: string;
    label: Token[];
    gloss: string;
    washal?: { run: string; heard: string };
  }[];
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
    tiles: { q: string; translit: string; label: string; gloss: string; washal?: { run: string; before: string; heard: string } }[];
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
    q: t.q,
    ar: bytes[i],
    dropped: part.drops.filter((d) => d.tile === i + 1).map((d) => d.letter),
    translit: t.translit,
    label: annotate(t.label, scope, lookup),
    gloss: t.gloss,
    ...(t.washal ? { washal: { run: t.washal.run, heard: t.washal.heard } } : {}),
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
  /** The example letter as the ayah writes it, and the word it comes from (`loc`). */
  letter: string;
  loc: string;
  /** That word when it is NOT a lesson word (سَلَٰمٌ of QS 97:5, where the tanwin is heard): its
   *  Tanzil bytes (library.json `quran`) and the sign's own transliteration; null for a lesson
   *  word, which the page draws from the lesson content. */
  word: { ar: string; translit: string } | null;
  sound: string;
  place: string;
  shape: string;
  reading: string;
};

export function prepareSigns(
  signs: { term: string; example: string; translit?: string; marks: string[]; sound: string; place: string; shape: string; reading: string }[],
  lookup: Lookup,
): PreparedSign[] {
  return signs.map((s) => {
    const letter = lookup.quran[s.example.slice(2)];
    const m = s.example.match(QREF);
    if (!letter || !m || !m[6]) throw new Error(`harakat sign ${s.term}: ${s.example} is not a resolved letter ref`);
    const loc = `${m[1]}:${m[2]}:${m[3]}`;
    const ar = lookup.quran[loc];
    return {
      term: lookup.terms.get(s.term) ?? null,
      mark: marksOf(letter, s.marks),
      letter,
      loc,
      word: s.translit && ar ? { ar, translit: s.translit } : null,
      sound: s.sound,
      place: s.place,
      shape: s.shape,
      reading: s.reading,
    };
  });
}

/** The harakah terms whose sign on its dotted circle IS its sound (a vowel, or a vowel + n): no
 *  Latin "a", "i", "u", "-un" is written after it (operator 2026-10-12: "better not use 'a', 'i',
 *  'u', but use harakat symbols"). */
const VOWEL_TERMS: ReadonlySet<string> = new Set(["fathah", "kasrah", "dhammah", "tanwin"]);

/** What a parts diagram writes after a changed mark's name: nothing for a vowel sign (the sign
 *  says it), the sound in words for the others — sukun's "mati, tanpa vokal". Decided by the
 *  mark's TERM, not by the sound's length (review 2026-10-12: `said.length > 3` would have dropped
 *  a short description and kept a long vowel label). */
export function soundAfterSign(term: Pick<TermView, "id"> | null, said: string): string {
  return term && !VOWEL_TERMS.has(term.id) ? said : "";
}

/** Term id → its sound on the Harakat page ("a", "i", "u", "mati, tanpa vokal"). */
export function soundsOf(signs: { term: string; sound: string; marks: string[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of signs) if (!(s.term in out) && !s.marks.some((m) => m.endsWith("tain"))) out[s.term] = s.sound;
  return out;
}

// ───────────────────────── checks (vitest, CI: no corpus needed)
/** Arabic letters typed into a marked field: runs of two or more outside «…» (pipeline/terms.py
 *  typed_arabic; single letters, a root's "ر ح م", are prose). */
const TYPED_AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]{2,}/u;
const typedArabic = (marked: string) => TYPED_AR.exec(marked.replace(/«[^«»]*»/gu, " "))?.[0] ?? null;

/** The checks one byte map supports (library.json's `quran` and `segments`, or a lesson's): every
 *  ref resolves; a Qur'anic ref into a lesson word carries that word's content bytes; a part ref is
 *  the word's QAC segment, and the segments join to the word; a letter ref is the word's letter; a
 *  gloss ([[“…”|q:…]]) is one quotation and names words, not a term or a letter; a term ref is in
 *  the table; plain = strip(marked); no markup in a plain field; no Arabic typed into a marked one
 *  (`typedOk`: a wazn or a tashrif bab, typed patterns by design); "klik", "yang artinya" (`style`). */
function checker(
  quran: Record<string, string>,
  segments: Record<string, string[]>,
  wordAr: Record<string, string>,
  termIds: Set<string>,
  mapName: string,
  out: string[],
) {
  const checkRefs = (text: string, where: string) => {
    for (const s of parseMarked(text)) {
      if (s.kind !== "mark") continue;
      const { ref, surface } = s;
      const quoted = surface.includes("“") || surface.includes("”");
      if (quoted && !isGloss(surface)) out.push(`${where}: [[${surface}|${ref}]]: a gloss variant's surface must be one quotation “…”`);
      if (quoted && !ref.startsWith("q:")) out.push(`${where}: [[${surface}|${ref}]]: a gloss names the Qur'anic words it translates, not a term`);
      if (ref.startsWith("q:")) {
        const m = ref.match(QREF);
        const key = ref.slice(2);
        const bytes = quran[key];
        if (quoted && m?.[6]) out.push(`${where}: [[${surface}|${ref}]]: a gloss translates words, not a letter`);
        if (!m || bytes === undefined) {
          out.push(`${where}: ${ref} has no bytes in ${mapName} quran`);
          continue;
        }
        const loc = `${m[1]}:${m[2]}:${m[3]}`;
        const word = wordAr[loc];
        if (word === undefined) continue; // a Tanzil token outside the lessons (checked with the corpus)
        if (m[4]) {
          const run = Array.from({ length: Number(m[4]) - Number(m[3]) + 1 }, (_, k) => wordAr[`${m[1]}:${m[2]}:${Number(m[3]) + k}`]);
          if (run.includes(undefined as unknown as string) || bytes !== run.join(" ")) out.push(`${where}: ${ref} is not the ayah's words ${run.join(" ")}`);
        } else if (m[5]) {
          const segs = segments[loc];
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
  const checkField = (
    marked: string | undefined,
    plainText: string | undefined,
    where: string,
    { style = true, typedOk = false }: { style?: boolean; typedOk?: boolean } = {},
  ) => {
    if (marked === undefined && plainText === undefined) return;
    if (marked === undefined || plainText === undefined) return void out.push(`${where}: marked and plain differ in presence`);
    if (stripMarked(marked) !== plainText) out.push(`${where}: the plain text is not the marked text without its markup`);
    if (plainText.includes("[[") || plainText.includes("]]")) out.push(`${where}: markup left in the plain text`);
    checkRefs(marked, where);
    const typed = typedOk ? null : typedArabic(marked);
    if (typed) out.push(`${where}: typed Arabic ${typed} in a marked field (the Arabic comes from the markup)`);
    if (!style) return;
    if (/\b(ketuk|mengetuk|diketuk)\b/i.test(plainText)) out.push(`${where}: says "ketuk" (klik, never ketuk)`);
    if (/\byang berarti\b/i.test(plainText)) out.push(`${where}: says "yang berarti" (meanings use "yang artinya")`);
  };
  return { checkRefs, checkField };
}

/** Everything the app can prove about the marked library from library.json and the lesson
 *  content alone (pipeline/validate_terms.py repeats these, plus the corpus checks, in Python):
 *  plain = strip(marked); every ref resolves; every Qur'anic ref into a lesson word carries that
 *  word's content bytes; part refs are the word's QAC segments, which join to the word; letter
 *  refs are the word's letters; each Harakat sign's mark is cut from its letter; every parts
 *  diagram spells its word; no "ketuk", no "yang berarti"; the gloss variant; no typed Arabic;
 *  the Kosakata prose (meaning, word class, tashrif bab and labels, i'lal rules, root meanings)
 *  likewise, without the style rules (its wording predates them and is kept). */
export function libraryProblems(
  lib: Pick<Library, "concepts" | "basics" | "parts" | "terms" | "quran" | "segments"> & Partial<Pick<Library, "lexicon" | "roots">>,
  wordAr: Record<string, string>,
): string[] {
  const out: string[] = [];
  const termIds = new Set(lib.terms.map((t) => t.id));
  const { checkRefs, checkField } = checker(lib.quran, lib.segments, wordAr, termIds, "library.json", out);
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
  for (const lx of lib.lexicon ?? []) {
    const w = `lexeme ${lx.id}`;
    const mk = lx.marked;
    if (!mk) {
      out.push(`${w}: no marked prose`);
      continue;
    }
    checkField(mk.meaning, lx.meaning, `${w}.meaning`, { style: false });
    checkField(mk.pos, lx.pos, `${w}.pos`, { style: false });
    checkField(mk.bab, lx.tashrif?.bab, `${w}.bab`, { style: false, typedOk: true });
    const forms = lx.tashrif?.forms ?? [];
    if (mk.labels.length !== forms.length) out.push(`${w}: ${mk.labels.length} marked tashrif labels for ${forms.length} forms`);
    forms.forEach((f, i) => checkField(mk.labels[i], f.label, `${w}.labels[${i}]`, { style: false }));
    if (mk.ilal.length !== lx.ilal.length) out.push(`${w}: ${mk.ilal.length} marked i'lal rules for ${lx.ilal.length}`);
    lx.ilal.forEach((il, i) => checkField(mk.ilal[i], il.rule, `${w}.ilal[${i}]`, { style: false }));
  }
  for (const r of lib.roots ?? []) {
    if (!r.marked) out.push(`root ${r.id}: no marked prose`);
    else checkField(r.marked.meaning, r.meaning, `root ${r.id}.meaning`, { style: false });
  }
  for (const t of lib.terms) {
    if (t.ar !== null && !/^[ء-غف-ْ ]+$/u.test(t.ar)) out.push(`term ${t.id}: ${t.ar} is not typed Arabic (letters + harakat)`);
    if (t.group === "harakah" && !t.hint) out.push(`term ${t.id}: a harakah term needs its reminder`);
  }
  return out;
}

/** The same checks for a marked lesson's own prose (pipeline/build_surah.py MARKED_SURAHS; operator
 *  2026-10-12 on a word card: "write the arabic words, not only the transliteration"): each word's
 *  why, role, sign, wazn and ikhtilaf, the ayah structure, the facts — plain = strip(marked), the
 *  refs against the lesson's own `quran` and `segments`, the terms in the library's table. A lesson
 *  with no marked prose at all (the hidden Mu'awwidzat) has nothing to check; a marked one must
 *  carry every twin. */
export function lessonProblems(
  s: Pick<SurahContent, "slug" | "ayat" | "facts" | "quran" | "segments">,
  lib: Pick<Library, "terms">,
  wordAr: Record<string, string>,
): string[] {
  const out: string[] = [];
  const marked =
    s.ayat.some((a) => a.words.some((w) => w.marked) || a.structure?.marked) || s.facts.some((f) => f.marked) || Object.keys(s.quran).length > 0;
  if (!marked) return out;
  const termIds = new Set(lib.terms.map((t) => t.id));
  const { checkField } = checker(s.quran, s.segments, wordAr, termIds, `content/${s.slug}.json`, out);
  for (const a of s.ayat) {
    for (const w of a.words) {
      const wp = `${s.slug} word ${w.loc}`;
      const mk = w.marked;
      if (!mk) {
        out.push(`${wp}: no marked prose`);
        continue;
      }
      checkField(mk.why, w.why, `${wp}.why`);
      checkField(mk.role, w.role ?? undefined, `${wp}.role`);
      checkField(mk.sign, w.case.sign === "—" ? undefined : w.case.sign, `${wp}.sign`);
      checkField(mk.wazn, w.wazn ?? undefined, `${wp}.wazn`, { typedOk: true });
      if (mk.ikhtilaf.length !== w.ikhtilaf.length) out.push(`${wp}: ${mk.ikhtilaf.length} marked ikhtilaf for ${w.ikhtilaf.length}`);
      w.ikhtilaf.forEach((x, i) => {
        const y = mk.ikhtilaf[i];
        checkField(y?.point, x.point, `${wp}.ikhtilaf[${i}].point`);
        if ((y?.options.length ?? 0) !== x.options.length) out.push(`${wp}.ikhtilaf[${i}]: marked and plain options differ in number`);
        x.options.forEach((o, j) => checkField(y?.options[j], o, `${wp}.ikhtilaf[${i}].options[${j}]`));
      });
    }
    const st = a.structure;
    if (st) {
      const sp = `${s.slug} structure ${a.loc}`;
      if (!st.marked) out.push(`${sp}: no marked prose`);
      else {
        checkField(st.marked.type, st.type, `${sp}.type`);
        checkField(st.marked.summary, st.summary, `${sp}.summary`);
        if (st.marked.groups.length !== st.groups.length) out.push(`${sp}: ${st.marked.groups.length} marked labels for ${st.groups.length} groups`);
        st.groups.forEach((g, i) => checkField(st.marked!.groups[i], g.label, `${sp}.groups[${i}]`));
      }
    }
  }
  for (const f of s.facts) {
    const fp = `${s.slug} fact ${f.id}`;
    if (!f.marked) {
      out.push(`${fp}: no marked prose`);
      continue;
    }
    checkField(f.marked.title, f.title, `${fp}.title`);
    checkField(f.marked.body, f.body, `${fp}.body`);
    checkField(f.marked.method, f.method, `${fp}.method`);
  }
  return out;
}
