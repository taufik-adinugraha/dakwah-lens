/**
 * Guided lesson ("Pelajaran dipandu") step script for one ayah, derived from
 * the content — never hand-written per ayah, so it updates with the content
 * and its review status. Pure: unit-tested, rendered by LessonStage.
 *
 * Step kinds:
 *  - recite_ayah : the imam recites the whole ayah (human recitation)
 *  - recite_word : the imam's recitation, seeked to one word
 *  - explain     : an explanation caption (later: narration audio, rendered
 *                  once on ElevenLabs v3 — the narrator NEVER voices Qur'an;
 *                  captions carry Latin transliteration only, plan §6.1 A1:
 *                  a sentence with Arabic script is left out of a caption,
 *                  the full text stays on the cards below the stage)
 *  - practice    : pause for the learner to do the exercises
 *
 * Audience: adults, many of them 60+ (operator decisions, 2026-10-09). Reading
 * pace and caption length follow docs/belajar-research/senior-ux.md §3.5.
 */
import type { Ayah, Concept } from "@/content/schema";

export type LessonStep =
  | { kind: "recite_ayah"; id: string; caption: string }
  | { kind: "recite_word"; id: string; word: number; loc: string; caption: string }
  | {
      kind: "explain";
      id: string;
      caption: string;
      /** Word loc this explanation is about (shown in the stage). */
      focus?: string;
      /** 1-based index of that word in the ayah. */
      word?: number;
    }
  | { kind: "practice"; id: string; caption: string };

export type StepTexts = {
  intro: (n: number) => string;
  wordIntro: (translit: string) => string;
  meaning: (gloss: string) => string;
  concept: (title: string, summary: string) => string;
  /** A concept whose summary cannot be captioned (it carries Arabic). */
  conceptBrief: (title: string) => string;
  structure: (summary: string) => string;
  practice: string;
  recap: string;
};

/**
 * How the guided lesson moves on: by itself at a normal or a slow reading
 * pace, or never by itself ("tunggu": the learner presses Lanjut — the WCAG
 * 2.2.1 "turn off" option).
 */
export type Pace = "biasa" | "pelan" | "tunggu";
export type AutoPace = Exclude<Pace, "tunggu">;
export const PACES: readonly Pace[] = ["biasa", "pelan", "tunggu"];

/** Characters per second. Older readers: ≤14 cps at most (Skorupska 2018). */
const CPS: Record<AutoPace, number> = { biasa: 10, pelan: 6 };

/**
 * How long a caption stays before the lesson moves on by itself (no narration
 * audio yet): a settle time for the eyes to move from the mushaf line to the
 * caption, plus reading time. Deliberately NO upper cap — a long caption is
 * split into several steps instead (splitCaption), never rushed.
 */
export function captionMs(text: string, pace: AutoPace): number {
  const settle = pace === "pelan" ? 3000 : 2500;
  const min = pace === "pelan" ? 6000 : 5000;
  return Math.round(Math.max(min, settle + (text.length / CPS[pace]) * 1000));
}

/** Longest caption shown as one step. */
export const MAX_CAPTION = 180;

/** A sentence ends after . ! ? or … (optionally closed by a quote or
 *  bracket) that follows a lowercase letter, digit, apostrophe or closing
 *  mark — so "Q.S." or "H.R." never end a sentence — and the next sentence
 *  starts with a capital, a digit or an opening mark. No lookbehind: this
 *  module also ships to the browser, and Safari before 16.4 (older iPhones)
 *  rejects lookbehind at parse time. */
const SENTENCE_BREAK = /([\p{Ll}\p{N}'’ʼ)\]"”][.!?…][)\]"”’]?)\s+(?=[\p{Lu}\p{N}"“‘(])/gu;
const CUT = "\u0000";

/** Arabic script: letters, harakat, presentation forms. */
const AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const ARABIC = new RegExp(`[${AR}]`);
const ARABIC_RUN = new RegExp(`[${AR}]+(?:[\\s\\u060C-]+[${AR}]+)*`, "g");

/** Whitespace-normalised sentences of a text. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(SENTENCE_BREAK, `$1${CUT}`)
    .split(CUT)
    .filter(Boolean);
}

/**
 * The sentences of `text` that contain no Arabic script, joined. Captions
 * are narration text and never carry Arabic (plan §6.1 A1), e.g. a concept
 * summary that writes a wazan as "ف ع ل" loses that sentence in the caption.
 */
export function latinSentences(text: string): string {
  return sentences(text)
    .filter((x) => !ARABIC.test(x))
    .join(" ");
}

/** Last resort for template parts (a title, a gloss): drop Arabic runs. */
const stripArabic = (text: string) =>
  ARABIC.test(text) ? text.replace(ARABIC_RUN, "").replace(/\s+([,.;:)])/g, "$1").replace(/\s+/g, " ").trim() : text;

/** Greedily joins pieces with a space while the result stays ≤ max. */
function pack(pieces: string[], max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + 1 + p.length <= max) cur += ` ${p}`;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Clauses of one sentence, cut after a comma, semicolon or colon that is
 *  not inside brackets — "(mabni di atas fathah, berkedudukan nashab)" stays
 *  in one piece. Expects single spaces (splitCaption normalises them). */
function clauses(sentence: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sentence.length; i++) {
    const c = sentence[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if ((c === "," || c === ";" || c === ":") && depth === 0 && sentence[i + 1] === " ") {
      out.push(sentence.slice(start, i + 1));
      start = i + 2;
    }
  }
  out.push(sentence.slice(start));
  return out;
}

/** What a cut after a piece costs: a sentence end is free, a comma costs
 *  more, a gap between two words most — so whole sentences stay together
 *  whenever the lengths allow. */
const CUT_COST = { sentence: 0, clause: 3000, word: 8000 } as const;
type Piece = { text: string; cut: number };

/**
 * Joins pieces into the fewest parts of ≤ max characters (the greedy count),
 * choosing the cut points so the parts come out as even as possible (least
 * sum of squared lengths plus cut costs): no 20-character tail is left alone
 * on a step of its own.
 */
function balance(pieces: Piece[], max: number): string[] {
  const texts = pieces.map((p) => p.text);
  const k = pack(texts, max).length;
  if (k <= 1) return [texts.join(" ")];
  const n = pieces.length;
  const pre = [0];
  for (const t of texts) pre.push(pre[pre.length - 1] + t.length);
  /** Length of pieces i..j-1 joined with single spaces. */
  const width = (i: number, j: number) => pre[j] - pre[i] + (j - i - 1);
  const cost = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = 1; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        const w = width(i, j);
        if (cost[g - 1][i] === Infinity || w > max) continue;
        const c = cost[g - 1][i] + w * w + (j < n ? pieces[j - 1].cut : 0);
        if (c < cost[g][j]) {
          cost[g][j] = c;
          from[g][j] = i;
        }
      }
    }
  }
  if (cost[k][n] === Infinity) return pack(texts, max); // one word longer than max
  const out: string[] = [];
  let j = n;
  for (let g = k; g > 0; g--) {
    const i = from[g][j];
    out.unshift(texts.slice(i, j).join(" "));
    j = i;
  }
  return out;
}

/**
 * Splits a caption longer than `max` characters into consecutive, evenly
 * sized parts, cutting at sentence ends wherever possible. A single sentence
 * longer than `max` is cut after a comma, semicolon or colon (never inside
 * brackets), and only a clause that is still too long between words. The
 * parts joined with a space give back the caption, whitespace normalised.
 */
export function splitCaption(text: string, max = MAX_CAPTION): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  const pieces: Piece[] = [];
  for (const s of sentences(clean)) {
    if (s.length <= max) {
      pieces.push({ text: s, cut: CUT_COST.sentence });
      continue;
    }
    const parts = clauses(s);
    parts.forEach((c, ci) => {
      const end = ci === parts.length - 1 ? CUT_COST.sentence : CUT_COST.clause;
      if (c.length <= max) {
        pieces.push({ text: c, cut: end });
        return;
      }
      const words = c.split(" ");
      words.forEach((w, wi) => pieces.push({ text: w, cut: wi === words.length - 1 ? end : CUT_COST.word }));
    });
  }
  return balance(pieces, max);
}

export function buildLessonSteps(
  ayah: Ayah,
  introduced: Concept[],
  texts: StepTexts,
): LessonStep[] {
  const steps: LessonStep[] = [
    { kind: "recite_ayah", id: "intro", caption: texts.intro(ayah.ayah) },
  ];
  /** A long explanation becomes several consecutive steps (ids id, id:2, …). */
  const explain = (id: string, caption: string, about?: { focus: string; word: number }) => {
    splitCaption(stripArabic(caption)).forEach((part, i) => {
      steps.push({ kind: "explain", id: i === 0 ? id : `${id}:${i + 1}`, caption: part, ...about });
    });
  };

  ayah.words.forEach((w, i) => {
    const n = i + 1;
    steps.push({
      kind: "recite_word",
      id: `w${n}`,
      word: n,
      loc: w.loc,
      caption: stripArabic(texts.wordIntro(w.translit)),
    });
    explain(`w${n}-meaning`, `${texts.meaning(w.gloss)} ${latinSentences(w.why)}`, { focus: w.loc, word: n });
  });

  for (const c of introduced) {
    const summary = latinSentences(c.summary);
    explain(`c-${c.id}`, summary ? texts.concept(c.title, summary) : texts.conceptBrief(c.title));
  }
  const structure = ayah.structure ? latinSentences(ayah.structure.summary) : "";
  if (structure) explain("structure", texts.structure(structure));
  steps.push({ kind: "practice", id: "practice", caption: texts.practice });
  steps.push({ kind: "recite_ayah", id: "recap", caption: texts.recap });
  return steps;
}
