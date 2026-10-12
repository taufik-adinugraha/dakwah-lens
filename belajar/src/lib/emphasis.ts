/**
 * What a text emphasises (operator, 2026-10-11: "we can also use bold text or different color to
 * highlight the meanings or important things"; narration rule 18). Restrained — emphasis
 * everywhere is noise — so only three things, found in the text as it is shown:
 * - meaning: the gloss after "artinya" / "yang artinya" (also "maknanya", "bermakna", "berarti",
 *   "makna") when it is quoted, the quotes included: "artinya: “dengan nama”";
 * - term: the term being taught where it is named or given as the answer: "disebut marfu’
 *   (مَرْفُوع)", "Jadi, kata ini majrur (مَجْرُور)", "ulama menyebutnya syibhul jumlah (…)", a
 *   concept caption's name ("Konsep baru: Dhamir (ضَمِير) sya'n (…)"), and a quiz explanation's
 *   "Perannya: …" up to its full stop;
 * - sound: the letter of a harakah's sound, "Bunyinya a, i, dan u", "bunyi u panjang", "dibaca a.".
 * Pure (vitest runs it over every content string, emphasis.test.ts): presentation only — MixedText
 * draws the spans as overlays (styles, never a new line break), and the karaoke caption takes
 * them from the line's display text (alignEmphasis), so no narration, manifest or audio changes.
 *
 * Never inside a “…” quotation the span did not open: a kitab's words ("al-Jadwal menyebutnya
 * “mabni di atas kasrah, …”") and an ayah's translation ("Terjemahannya: “Dengan nama Allah …”")
 * are quoted as they are, nothing in them emphasised. Never a term named inside the prose's own
 * brackets, an aside ("rafa' (رَفْع, katanya disebut marfu' مَرْفُوع)"), nor an author's name for
 * it ("Darwisy menyebutnya zaidah"): the term a text teaches is named in its own sentence.
 *
 * How much (review 2026-10-11, restraint): a text that gives a quiz answer ("Perannya: …",
 * "Jadi, kata ini …") emphasises the answer alone, its other glosses being the reasons; a stage
 * caption (captionSpans) its first meaning, the later ones mostly naming other words ("frasa yang
 * artinya “dari kejahatan” di ayat dua"); a page a learner reads (Konsep, Materi lengkap) every
 * gloss, since each glosses an example word — at most PAGE_SPANS in one paragraph (pinned by
 * emphasis.test.ts).
 */
import { termDisplay, type Token } from "./terms";
import { ARABIC_RUN, hasArabic, joinUnits, textUnits } from "./textUnits";

export type EmphasisKind = "meaning" | "term" | "sound";
/** [from, to) of the text it was found in. */
export type Emphasis = { from: number; to: number; kind: EmphasisKind };

/** The most spans one paragraph of a reading page carries (emphasis.test.ts holds every
 *  paragraph to it; idhafah's first paragraph, seven example glosses and its term, is the most). */
export const PAGE_SPANS = 8;

/** A gloss after one of these, quoted right after it ("artinya: “…”", "yang artinya ‘…’"). */
const MEANING = /(?<!\p{L})(?:yang\s+)?(?:artinya|maknanya|bermakna|berarti|makna)\s*:?\s+/gu;
/** Longer than this, a quotation after "artinya" is no gloss (a sentence, a translation). */
const GLOSS_WORDS = 12;
/** A second gloss right after the first: "bermakna “sangat” atau “sering melakukan”". */
const CHAIN = /^(?:, | atau | dan )/u;
/** The term after these is being named ("disebut marfu’ (مَرْفُوع)"; "ulama menyebutnya", the
 *  scholars' name for it — an author's "Darwisy menyebutnya …" is that author's alias). */
const NAMED = /(?:\bdisebut|\bdinamakan|\bulama\s+menyebutnya)\s+$/u;
/** The term after this is a quiz explanation's answer ("Jadi, kata ini majrur (مَجْرُور).") */
const ANSWER = /\bJadi,\s+kata\s+ini\s+$/u;
/** A quiz explanation's answer: "Perannya: huruf jar (حَرْف جَرّ) + majrur (مَجْرُور)." */
const ROLE = /\bPerannya:\s+/gu;
/** At most this many words in a "Perannya:" answer. */
const ROLE_WORDS = 10;
/** A concept caption's title (pipeline/quiz.py CONCEPT_LEAD; the stage's fallback "Konsep baru —
 *  {title}: …", src/lib/autoplay/texts.ts): its name comes first. */
const CONCEPT = /(?<!\p{L})Konsep baru(?::| —)\s+/gu;
/** At most this many Latin words in a concept's name ("Jamak mudzakkar salim", "Mu’rab dan
 *  mabni"); a longer title opens with a description, not the name. */
const NAME_WORDS = 4;
const NAME_WORD = /^[^\s,.:;()“”«»]+/u;
/** The name's own Arabic, in brackets closed right after it: " (ضَمِير)". */
const OWN_ARABIC = new RegExp(`^ \\((?:${ARABIC_RUN.source})\\)`, "u");
/** A harakah's sound named: "bunyi a", "Bunyinya a, i, dan u", "bunyi pendek i". */
const SOUND = /\b[Bb]unyi(?:nya)?(?:\s+(?:pendek|panjang))?\s+/gu;
/** "dibaca a." — one vowel, then the clause ends (never "dibaca bi", "dibaca dobel"). */
const READ_AS = /(?<!\p{L})dibaca\s+(?=[aiuāīū][.,;])/gu;
const VOWEL = /^([aiuāīū])(?:\s+panjang)?(?!\p{L})/u;
const VOWEL_SEP = /^(?:, dan |, atau |, | dan )/u;
const LETTER = /\p{L}/u;
/** The most words of a Kosakata lead ("kata ganti untuk sasaran perbuatan (objek) yang berdiri
 *  terpisah dari kata kerjanya", 12). */
const LEAD_WORDS = 14;

/** The “…” quotations of `text` as [open, close] offsets (close: the ” itself). An opening quote
 *  never closed runs to the end; a closing one never opened starts before the beginning (-1) — a
 *  caption part cut out of a longer line may hold either half. */
function quotations(text: string): [number, number][] {
  const out: [number, number][] = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "“" && open < 0) open = i;
    else if (text[i] === "”") {
      out.push([open, i]);
      open = -1;
    }
  }
  if (open >= 0) out.push([open, text.length]);
  return out;
}

/** How deep offset `at` sits in the prose's own brackets. */
const depthAt = (text: string, at: number) => {
  let d = 0;
  for (let i = 0; i < at; i++) {
    if (text[i] === "(") d++;
    else if (text[i] === ")") d = Math.max(0, d - 1);
  }
  return d;
};

/** The quoted gloss opening at `at` ([at, end) with its quotes), or null: “ to the next ”; ' or ‘
 *  to the next ' or ’ with no space before it and no letter after it, so the apostrophe of fi'il
 *  or rafa’a never closes it. Never one with Arabic, empty, or longer than GLOSS_WORDS. */
function gloss(text: string, at: number): number | null {
  const q = text[at];
  let close = -1;
  if (q === "“") close = text.indexOf("”", at + 1);
  else if (q === "'" || q === "‘") {
    for (let k = at + 2; k < text.length; k++) {
      if ((text[k] === "'" || text[k] === "’") && !/\s/u.test(text[k - 1]) && !LETTER.test(text[k + 1] ?? "")) {
        close = k;
        break;
      }
    }
  } else return null;
  if (close < 0) return null;
  const inner = text.slice(at + 1, close).trim();
  if (!inner || hasArabic(inner) || inner.split(/\s+/u).length > GLOSS_WORDS) return null;
  return close + 1;
}

/** The units textUnits cuts `text` into, each with the offset of every part. */
function unitsOf(text: string) {
  const out: { parts: { text: string; arabic: boolean; at: number }[] }[] = [];
  let at = 0;
  for (const s of textUnits(text)) {
    if (s.kind === "unit") {
      let k = at;
      out.push({
        parts: s.parts.map((p, i) => {
          if (i > 0) k += s.gaps[i - 1].length;
          const part = { ...p, at: k };
          k += p.text.length;
          return part;
        }),
      });
    }
    at += joinUnits([s]).length;
  }
  return out;
}

/** Where a concept's name starting at `at` ends, or null: its words, each maybe with its own
 *  Arabic ("Dhamir (ضَمِير) sya'n", "Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)"), up to the title's
 *  ",", ":", "." or ";", or the " (" of its gloss ("Hal (keterangan keadaan)"). */
function conceptName(text: string, at: number): number | null {
  let k = at;
  let words = 0;
  for (;;) {
    const w = NAME_WORD.exec(text.slice(k));
    if (!w || hasArabic(w[0])) return null;
    words++;
    k += w[0].length;
    k += OWN_ARABIC.exec(text.slice(k))?.[0].length ?? 0;
    if (!/^ [^\s(]/u.test(text.slice(k))) break;
    k++;
  }
  return words <= NAME_WORDS && /^(?:$|[,.:;]| \()/u.test(text.slice(k)) ? k : null;
}

type Found = {
  /** Each gloss after a trigger, with the ones chained to it ("“sangat” atau “sering melakukan”"). */
  meanings: Emphasis[][];
  terms: Emphasis[];
  /** A quiz explanation's answer ("Perannya: …", "Jadi, kata ini …"). */
  answers: Emphasis[];
  sounds: Emphasis[];
};

/**
 * Everything `text` could emphasise. `terms: false` (TermText, whose tokens say which word is a
 * term: termEmphasis): meanings and sounds only.
 */
function find(text: string, terms = true): Found {
  const quotes = quotations(text);
  /** [from, to) inside a quotation that does not open at `from` itself. */
  const quoted = (from: number, to = from + 1) => quotes.some(([o, c]) => from > o && to <= c + 1);
  const found: Found = { meanings: [], terms: [], answers: [], sounds: [] };
  for (const m of text.matchAll(MEANING)) {
    const start = m.index ?? 0;
    if (quoted(start)) continue;
    let at = start + m[0].length;
    const group: Emphasis[] = [];
    for (;;) {
      const end = gloss(text, at);
      if (end === null) break;
      group.push({ from: at, to: end, kind: "meaning" });
      const chain = CHAIN.exec(text.slice(end));
      if (!chain) break;
      at = end + chain[0].length;
    }
    if (group.length) found.meanings.push(group);
  }

  if (terms) {
    for (const u of unitsOf(text)) {
      const ai = u.parts.findIndex((p) => p.arabic);
      if (ai <= 0) continue;
      const first = u.parts[0];
      // Not a quote, bracket or chip dot the term opens with ("· kasrah"); the ‘ain or hamza that
      // begins a transliteration ("‘Athaf", "'amil") is the term's.
      const lead = /^[^\p{L}‘’'ʿʾ]*/u.exec(first.text)![0].length;
      const from = first.at + lead;
      const before = text.slice(0, first.at);
      const answer = ANSWER.test(before);
      if (!answer && !(NAMED.test(before) && depthAt(text, from) === 0)) continue;
      const last = u.parts[ai - 1];
      let to = last.at + last.text.replace(/[,.;:!?)\]]+$/u, "").length;
      // Its own bracket of Arabic, closed right after the run: the term, "(", the Arabic and ")".
      // (The prose's bracket, "(katanya disebut marfu’ مَرْفُوع)", or a reminder after the Arabic,
      // "kasrah (كَسْرَة, tanda bunyi i …)", is not the term's: the term's words alone.)
      const ar = u.parts[ai];
      const run = ar.text.startsWith("(") ? new RegExp(ARABIC_RUN.source, "u").exec(ar.text.slice(1)) : null;
      if (run && run.index === 0 && ar.text[1 + run[0].length] === ")") to = ar.at + run[0].length + 2;
      if (to > from && !quoted(from, to)) (answer ? found.answers : found.terms).push({ from, to, kind: "term" });
    }
    for (const m of text.matchAll(CONCEPT)) {
      if (quoted(m.index ?? 0)) continue;
      const from = (m.index ?? 0) + m[0].length;
      const to = conceptName(text, from);
      if (to !== null) found.terms.push({ from, to, kind: "term" });
    }
    for (const m of text.matchAll(ROLE)) {
      const from = (m.index ?? 0) + m[0].length;
      if (quoted(m.index ?? 0)) continue;
      let depth = 0;
      let end = -1;
      for (let k = from; k < text.length; k++) {
        const ch = text[k];
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === "." && depth === 0) {
          end = k;
          break;
        }
      }
      if (end > from && text.slice(from, end).trim().split(/\s+/u).length <= ROLE_WORDS) found.answers.push({ from, to: end, kind: "term" });
    }
  }

  for (const m of text.matchAll(SOUND)) {
    if (quoted(m.index ?? 0)) continue;
    let at = (m.index ?? 0) + m[0].length;
    for (;;) {
      const v = VOWEL.exec(text.slice(at));
      if (!v) break;
      found.sounds.push({ from: at, to: at + v[1].length, kind: "sound" });
      at += v[0].length;
      const sep = VOWEL_SEP.exec(text.slice(at));
      if (!sep || !VOWEL.test(text.slice(at + sep[0].length))) break;
      at += sep[0].length;
    }
  }
  for (const m of text.matchAll(READ_AS)) {
    const at = (m.index ?? 0) + m[0].length;
    if (!quoted(m.index ?? 0)) found.sounds.push({ from: at, to: at + 1, kind: "sound" });
  }
  return found;
}

/** The spans of `lists`, sorted and disjoint: on an overlap the earlier list wins. */
function disjoint(...lists: Emphasis[][]): Emphasis[] {
  const out: Emphasis[] = [];
  for (const e of lists.flat()) if (!out.some((o) => e.from < o.to && o.from < e.to)) out.push(e);
  return out.sort((a, b) => a.from - b.from);
}

/** What a found text emphasises: a quiz answer alone, else its meanings (all, or the first gloss
 *  and its chain), terms and sounds — a meaning winning over a term or a sound it overlaps. */
function chosen(f: Found, meanings: "all" | "first"): Emphasis[] {
  if (f.answers.length) return disjoint(f.answers);
  return disjoint(meanings === "all" ? f.meanings.flat() : (f.meanings[0] ?? []), f.terms, f.sounds);
}

/**
 * The stretches `text` emphasises, sorted and disjoint. Indonesian prose only: the triggers are
 * Indonesian words, so an English text gets none (its known slots — a word card's gloss — are
 * given by the surface itself, glossSlot).
 */
export function emphasisSpans(text: string): Emphasis[] {
  return chosen(find(text), "all");
}

/** A stage caption's emphasis (text and karaoke): its first meaning, its terms and sounds, or a
 *  quiz answer alone — of the whole line, so a caption part shows its slice (partEmphasis). */
export function captionSpans(text: string): Emphasis[] {
  return chosen(find(text), "first");
}

/** Part `k` of a caption cut into `parts` (splitCaption: the line is the parts joined by
 *  spaces): the whole line's caption emphasis inside it, as offsets in the part. */
export function partEmphasis(parts: readonly string[], k: number): Emphasis[] {
  if (!parts[k]) return [];
  let at = 0;
  for (let i = 0; i < k; i++) at += parts[i].length + 1;
  const end = at + parts[k].length;
  return captionSpans(parts.join(" ")).flatMap((e) => (e.from >= at && e.to <= end ? [{ ...e, from: e.from - at, to: e.to - at }] : []));
}

/**
 * The emphasis of TermText's text (termDisplay of `tokens`): its meanings and sounds, and a term
 * TOKEN named right after "disebut" / "dinamakan" / "ulama menyebutnya" outside the prose's
 * brackets — whether or not its Arabic is shown there (review 2026-10-11: a page's own term shows
 * its Arabic in the title, so "perubahan itu disebut i'rab" has none, and the same sentence read
 * differently on two pages). The term's words, and its Arabic when it is in the term's own
 * bracket: "disebut **mudhaf (مُضَاف)**", "disebut **'amil** (عَامِل; Ibnu Ajurrum)". Grammar terms
 * never form a run (src/lib/terms.ts runFrom), so a named term is always one token with its own
 * bracket: "disebut **dhamir (ضَمِير)** munfashil (مُنْفَصِل)".
 */
export function termEmphasis(tokens: readonly Token[]): Emphasis[] {
  const { text } = termDisplay(tokens);
  const found = find(text, false);
  const quotes = quotations(text);
  let at = 0;
  for (const t of tokens) {
    const from = at;
    at += termDisplay([t]).text.length;
    if (t.kind !== "term" || t.inBracket || !NAMED.test(text.slice(0, from))) continue;
    // "(Arabic)" right after the words: none for a harakah reminder, the prose's gloss or a citation.
    const own = t.arabic && !t.hint && !t.merge && !t.cite;
    const to = from + t.surface.length + (own ? t.term.ar!.length + 3 : 0);
    if (!quotes.some(([o, c]) => from > o && to <= c + 1)) found.terms.push({ from, to, kind: "term" });
  }
  return chosen(found, "all");
}

/**
 * Kosakata's lead: the core meaning a lexeme's text opens with ("di dalam; pada.", "nama: kata
 * yang …", "ada, terjadi; dan sebagai kata kerja penghubung, “adalah”.") up to its first ":" or
 * "." outside brackets and quotes — the page's one meaning in forest, not a sub-example's gloss
 * further on (review 2026-10-11). A bracket of a citation or a place ("(ar-Raghib: …)",
 * "(2:235)") ends it before; longer than LEAD_WORDS, none.
 */
export function leadMeaning(text: string): Emphasis[] {
  let depth = 0;
  let quote = false;
  let end = text.length;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === "“") quote = true;
    else if (ch === "”") quote = false;
    else if (ch === "(") {
      const close = text.indexOf(")", k);
      if (depth === 0 && !quote && close > 0 && text.slice(k, close).includes(":")) {
        end = k;
        break;
      }
      depth++;
    } else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ":" || ch === ".") && depth === 0 && !quote) {
      end = k;
      break;
    }
  }
  const to = text.slice(0, end).trimEnd().length;
  const lead = text.slice(0, to);
  if (!lead || hasArabic(lead) || lead.split(/\s+/u).length > LEAD_WORDS) return [];
  return [{ from: 0, to, kind: "meaning" }];
}

/**
 * A known slot of a message — a word card's "yang artinya “{gloss}”", an example's "…, meaning
 * “{gloss}”" — emphasised as a meaning in any locale: `format` builds the text around a value, and
 * the slot (with the quotes right around it) is where the value lands.
 */
export function glossSlot(format: (value: string) => string, value: string, kind: EmphasisKind = "meaning"): { text: string; emphasis: Emphasis[] } {
  const text = format(value);
  const MARK = "\u0000";
  const shape = format(MARK);
  const at = shape.indexOf(MARK);
  if (at < 0 || !value) return { text, emphasis: [] };
  const tail = shape.length - at - MARK.length;
  let from = at;
  let to = text.length - tail;
  // Its quotes, when both are there: an opening one with no closing one (the value last in the
  // message) is not taken, nor a character past the end.
  const close = text[to];
  if (from > 0 && close !== undefined && "“‘'".includes(text[from - 1]) && "”’'".includes(close)) {
    from--;
    to++;
  }
  return { text, emphasis: [{ from, to, kind }] };
}

/** The letters and digits of a word, the key the karaoke words are matched by: "(مَجْرُور)." →
 *  مجرور, "“dengan" → dengan, "+" → "". */
const keyOf = (w: string) => w.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * The emphasis of each karaoke word (the narration manifest's tokens: the words as spoken, in
 * display form but WITHOUT the quotes, and now and then reworded — "+" said "dan", “aku memulai”
 * (pendapat ulama Kufah) said "aku memulai, pendapat ulama Kufah,"), from the line's display text,
 * where the quotes still mark the meanings (captionSpans: a caption's emphasis). The words of both
 * are matched by their letters (a longest common subsequence); a token takes a span's kind when
 * every word of it matches inside that one span, and a token that matches nothing ("dan" for "+")
 * takes the span of the tokens on both sides of it when they share one.
 */
export function alignEmphasis(display: string, words: readonly string[]): (EmphasisKind | null)[] {
  const spans = captionSpans(display);
  if (!spans.length) return words.map(() => null);
  // The display's words: key, and the span its letters lie in (-1: none).
  const dKeys: string[] = [];
  const dSpan: number[] = [];
  for (const m of display.matchAll(/\S+/gu)) {
    const key = keyOf(m[0]);
    if (!key) continue;
    // Where its letters start and end ("“dengan" → "dengan", "(مَجْرُور)." → the Arabic).
    const at = m.index ?? 0;
    const first = at + m[0].search(/[\p{L}\p{N}]/u);
    const last = at + m[0].length - /[^\p{L}\p{M}\p{N}]*$/u.exec(m[0])![0].length;
    dKeys.push(key);
    dSpan.push(spans.findIndex((s) => s.from <= first && last <= s.to));
  }
  const tKeys: string[] = [];
  const tOwner: number[] = [];
  words.forEach((w, i) => {
    for (const part of w.split(/\s+/u)) {
      const key = keyOf(part);
      if (key) {
        tKeys.push(key);
        tOwner.push(i);
      }
    }
  });
  // Longest common subsequence of the two key lists.
  const n = dKeys.length;
  const m = tKeys.length;
  const L = new Int32Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * W + j] = dKeys[i] === tKeys[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const matchOf = new Array<number>(m).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (dKeys[i] === tKeys[j]) {
      matchOf[j] = i;
      i++;
      j++;
    } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++;
    else j++;
  }
  // Per token: the one span all its keys match in; -2 when some key matched outside one; -1 none.
  const span = words.map((_, i) => {
    const ks = tOwner.flatMap((o, j) => (o === i ? [j] : []));
    if (!ks.length || ks.every((j) => matchOf[j] < 0)) return -1;
    const where = ks.map((j) => (matchOf[j] < 0 ? -2 : dSpan[matchOf[j]]));
    return where.every((s) => s >= 0 && s === where[0]) ? where[0] : -2;
  });
  // A run of unmatched tokens between two of one span takes it ("+" said "dan").
  for (let i = 0; i < span.length; i++) {
    if (span[i] !== -1) continue;
    let j = i;
    while (j < span.length && span[j] === -1) j++;
    if (i > 0 && j < span.length && span[i - 1] >= 0 && span[i - 1] === span[j]) span.fill(span[j], i, j);
    i = j;
  }
  return span.map((s) => (s >= 0 ? spans[s].kind : null));
}
