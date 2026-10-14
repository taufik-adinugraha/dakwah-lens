/**
 * Which examples a lesson plays, and by what is HEARD (operator 2026-10-12: "in explanation, for
 * example when explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read
 * by voice + show visual) when combined with harf jar, it becomes ismi (read by voice + visual). in
 * principel, each explanation should be followed by examples (visual + voice)" — "not only for
 * harakah, but also for all rules"; plan L20). PR #100 did this on the static pages (Konsep,
 * Harakat, the word-parts diagrams); this is the same inside the autoplay lesson, where the
 * narrator explains each word, each new concept and each word by its parts.
 *
 * Derived from the content, never listed by hand (lessonExamples):
 *
 * (a) CONCEPT — after the line of a step this ayah's lesson teaches ("Konsep baru: …"; the
 *     curriculum decides which, plan L26), in an example step of its own: its example in THIS
 *     ayah — the first of its `examples` as curriculum.ts taughtIn orders them: a record's own
 *     example in this ayah, or, for a step with its own text (majrur, alif lam) and for a record
 *     with no example here, the first word of the ayah it occurs on: the lesson's own word, lit
 *     on the mushaf line and recited on the stage's own recitation player. A step that occurs on
 *     no word of its ayah has no example, and is listed with that reason. If that word ends its ayah, the imam
 *     stops on it and its last harakah is not heard (waqf): the beat says so — and when the
 *     example itself is about that ending (its note on the Konsep page names the word's own
 *     harakah: "bismi: kasrah, tanda jar …"), ONE more example follows, the first of the
 *     concept's other examples that does not end its ayah (a clip; library.json `clips`).
 * (b) BENTUK DASAR — in a word-by-parts composition (rule 14: bi + ismu → bismi), when the `base`
 *     frame is on screen and its lines are said: the imam's clip of that base form where the
 *     build found it heard as shown (content/compose `examples`, pipeline/compose.py: never an
 *     ayah's last word; a word that starts with hamzat washal mid-ayah is played with the word
 *     before it, "tabārakasmu", and says so). The joined word — "… becomes ismi (read by voice +
 *     visual)" — is the lesson's own word, which the imam recites when its step opens
 *     ("w${n}:recite"), before it is explained. A base frame without a voice of its own is listed
 *     with the build's reason (gaps).
 *
 * NO SECOND RECITATION OF THE LESSON'S OWN WORD (operator 2026-10-13: "when transation from word X
 * to X+1, i think we dont need to recite the X, just directly to X+1"; plan L24). Until then the
 * imam said word n again when its explanation was through — at the end of its composition step,
 * and, for a word without a composition, as a beat (c) after the line that explains its harakah —
 * and then word n + 1 at once: two recitations and two reading pauses between two explanations.
 * A word is now recited once, at its opening step; rule (c) and its list of harakat that are not
 * heard are gone with it. One word is still recited a second time: the ayah's LAST word, after
 * the last line of its composition, which says the imam stops on it and what is not heard there
 * (no next word follows it; composition.ts STOP_NOTE, sequence.ts).
 *
 * At most two beats per rule. Every beat is labelled by what is heard (src/lib/heard.ts, the
 * rules of PR #100's review): `waqf` on an ayah-final word whose last harakah the pause drops,
 * `washal` with the heard form of a run. Pure (type imports only): scripts/autoplay-check.ts runs
 * it under tsx without node_modules; unit-tested over every lesson (examples.test.ts).
 */
import type { Ayah } from "@/content/schema";

import { waqfDrop } from "../heard";
import type { ExampleClip, ExampleOf } from "./types";

/** The harakat a word's `case.sign` can name, as the mark names of src/lib/heard.ts. */
const HARAKAT: ReadonlySet<string> = new Set(["fathah", "kasrah", "dhammah", "fathatain", "kasratain", "dhammatain"]);
/** The harakat the stage can name beside an example (content/compose `marks`: its term and sound). */
export const ENDING_MARKS = ["fathah", "kasrah", "dhammah"] as const;
export type EndingMark = (typeof ENDING_MARKS)[number];

/** At most this many example beats per rule (a concept, a bentuk dasar). */
export const MAX_EXAMPLES_PER_RULE = 2;
/** … and in lesson zero, where the one concept names three kinds of word (isim, fi'il, huruf):
 *  one example of each, in the record's order (operator's audit of lesson zero, 2026-10-14:
 *  "give general example with showing the words"). */
export const MAX_EXAMPLES_ZERO = 3;

/** Why a `base` frame of a composition has no voice of its own (pipeline/compose.py UNVOICED). */
export const UNVOICED_REASON: Readonly<Record<string, string>> = {
  own: "the bentuk dasar is this very word, which the imam recites when its step opens",
  unattested: "no word of the Qur'an has these bytes (a teaching form)",
  unheard: "the Qur'an has these bytes, but in no place are they heard as shown",
};

/** One entry of content/compose/<slug>.json `examples[loc]` (src/content/compose-schema.ts). */
export type ComposeExampleLike = {
  frame: number;
  form: string;
  loc?: string;
  key?: string;
  clip?: ExampleClip;
  washal?: { run: string; before: string; heard: string };
  unvoiced?: string;
};

/** What this module reads of a composition file (raw JSON or the parsed ComposeFile). */
export type ComposeLike = {
  words: Readonly<
    Record<
      string,
      {
        forms: Readonly<Record<string, { ar: string; translit: string; gloss?: string }>>;
        frames: readonly { stage: string; focus?: string }[];
        lines: readonly { frame: number }[];
      }
    >
  >;
  examples?: Readonly<Record<string, readonly ComposeExampleLike[]>>;
};

type WordLike = Pick<Ayah["words"][number], "loc" | "ar" | "translit" | "gloss" | "case">;

export type ExampleSource = {
  ayah: { surah: number; ayah: number; words: readonly WordLike[] };
  /** A lesson with NO ayah (lesson zero): a concept's examples are then all words of other
   *  places, so each is the imam's clip of its own ayah — the record's first
   *  MAX_EXAMPLES_ZERO that have one and do not end their ayah (there the imam's stop
   *  changes what is heard) — and each says what it is an example of (`about`). */
  zero?: boolean;
  /** What this ayah's lesson teaches as "Konsep baru" (curriculum.ts taughtIn): each with its
   *  examples, the one in this ayah first. */
  introduced: readonly { id: string; examples: readonly { loc: string; note: string }[] }[];
  /** content/compose/<slug>.json, or null (a surah without compositions). */
  compose: ComposeLike | null;
  /** content/library.json `clips`: the imam's voice of every concept example. */
  clips: Readonly<Record<string, ExampleClip>>;
  /** A lesson word of any surah, by loc: a concept's example in another ayah. */
  wordAt: (loc: string) => { ar: string; translit: string; gloss: string } | undefined;
};

/** One example the lesson plays. The Latin fields go into the sequence (captions); `ar`,
 *  `gloss` and `ending` are for the stage's drawing only (the sequence carries no Arabic). */
export type LessonExample = {
  id: string;
  of: ExampleOf;
  /** The step it plays in: an example step of its own ("concept:${id}:ex") or the lesson step
   *  it is part of ("w1:compose"). */
  step: string;
  /** base: the composition frame it plays over (after that frame's last line); else null. */
  frame: number | null;
  key: string;
  /** A word of this ayah (1-based), recited on the stage's own player; null: `clip`. */
  word: number | null;
  clip: ExampleClip | null;
  translit: string;
  gloss: string | null;
  /** Where the example stands in the Qur'an. */
  place: { surah: number; ayah: number };
  /** It ends its ayah and the imam's stop drops its last harakah (heard.ts hasWaqfNote). */
  waqf: boolean;
  /** Played with the word before it: what is heard. */
  washal: { before: string; heard: string } | null;
  /** The example's Arabic, exactly the content's bytes. */
  ar: string;
  /** The harakah the example is about, when it is heard there: named beside it on the stage. */
  ending: EndingMark | null;
  /** Lesson zero: what the word is an example of, from the record's note without the word it
   *  opens with ("na‘budu: fi'il, kata kerja." → "fi'il, kata kerja."). Shown on the card and in
   *  the caption: with no ayah on screen, nothing else tells the learner which kind it is. Null
   *  elsewhere (the narrator's line is about the word on the mushaf line). */
  about: string | null;
};

/** A rule explained without an example beat of its own, and why. */
export type ExampleGap = { step: string; rule: string; why: string };

const placeOf = (loc: string) => {
  const [surah, ayah, word] = loc.split(":").map(Number);
  return { surah, ayah, word };
};

/** Does the example's note name the word's own harakah ("bismi: kasrah, tanda jar …")? Then the
 *  example is about that ending. */
export function claimsEnding(note: string, sign: string): boolean {
  if (!HARAKAT.has(sign)) return false;
  return new RegExp(`(^|[^\\p{L}])${sign}([^\\p{L}]|$)`, "iu").test(note);
}

/** A record note without the word it opens with ("na‘budu: fi'il, kata kerja." → "fi'il, kata
 *  kerja."): the card shows the word above it. A note with no "…:" lead is kept whole. */
export function aboutOf(note: string): string {
  const i = note.indexOf(": ");
  return i > 0 ? note.slice(i + 2).trim() : note.trim();
}

const endingMark = (sign: string): EndingMark | null => (ENDING_MARKS as readonly string[]).includes(sign) ? (sign as EndingMark) : null;

export function lessonExamples(src: ExampleSource): { examples: LessonExample[]; gaps: ExampleGap[] } {
  const { ayah } = src;
  const words = ayah.words;
  const numberOf = new Map(words.map((w, i) => [w.loc, i + 1]));
  const examples: LessonExample[] = [];
  const gaps: ExampleGap[] = [];
  const here = { surah: ayah.surah, ayah: ayah.ayah };

  // (b) the bentuk dasar of a composition (a word without one has no beat of its own: plan L24)
  words.forEach((w, i) => {
    const n = i + 1;
    const unit = src.compose?.words[w.loc];
    if (unit && unit.lines.length) {
      for (const e of (src.compose?.examples?.[w.loc] ?? []).slice(0, MAX_EXAMPLES_PER_RULE)) {
        const form = unit.forms[e.form];
        const step = `w${n}:compose`;
        if (!form) continue;
        if (!e.clip || !e.key || !e.loc) {
          gaps.push({ step, rule: `bentuk dasar ${form.translit}`, why: UNVOICED_REASON[e.unvoiced ?? ""] ?? `no voice (${e.unvoiced ?? "?"})` });
          continue;
        }
        const at = placeOf(e.loc);
        // A base form that is another word of this very ayah, played alone: the stage's own player.
        const own = e.key === e.loc ? (numberOf.get(e.loc) ?? null) : null;
        examples.push({
          id: `w${n}:base:${e.frame}`,
          of: "base",
          step,
          frame: e.frame,
          key: e.key,
          word: own,
          clip: own === null ? e.clip : null,
          translit: form.translit,
          gloss: form.gloss ?? null,
          place: { surah: at.surah, ayah: at.ayah },
          waqf: false,
          washal: e.washal ? { before: e.washal.before, heard: e.washal.heard } : null,
          ar: form.ar,
          ending: null,
          about: null,
        });
      }
    }
  });

  // (a) each concept introduced here: its example in this ayah, then at most one from elsewhere
  for (const c of src.introduced) {
    const first = c.examples[0];
    const n = first ? numberOf.get(first.loc) : undefined;
    const step = `concept:${c.id}:ex`;
    if (src.zero) {
      const picks = c.examples.filter((x) => !!src.clips[x.loc] && !src.clips[x.loc].last && !!src.wordAt(x.loc)).slice(0, MAX_EXAMPLES_ZERO);
      if (!picks.length) gaps.push({ step, rule: c.id, why: "the lesson has no ayah, and the concept has no example whose clip does not end its ayah" });
      picks.forEach((x, k) => {
        const word = src.wordAt(x.loc)!;
        const at = placeOf(x.loc);
        examples.push({
          id: `concept:${c.id}:${k + 1}`,
          of: "concept",
          step,
          frame: null,
          key: x.loc,
          word: null,
          clip: src.clips[x.loc],
          translit: word.translit,
          gloss: word.gloss,
          place: { surah: at.surah, ayah: at.ayah },
          waqf: false,
          washal: null,
          ar: word.ar,
          ending: null,
          about: aboutOf(x.note),
        });
      });
      continue;
    }
    if (!first || n === undefined) {
      gaps.push({ step, rule: c.id, why: first ? "its first example is not a word of this ayah" : "no word of this ayah carries it" });
      continue;
    }
    const w = words[n - 1];
    const last = n === words.length;
    const drop = last ? waqfDrop(w.ar) : "none";
    const claims = claimsEnding(first.note, w.case.sign);
    examples.push({
      id: `concept:${c.id}:1`,
      of: "concept",
      step,
      frame: null,
      key: w.loc,
      word: n,
      clip: null,
      translit: w.translit,
      gloss: w.gloss,
      place: here,
      waqf: drop === "harakat",
      washal: null,
      ar: w.ar,
      ending: claims && !last ? endingMark(w.case.sign) : null,
      about: null,
    });
    if (!(last && drop !== "none" && claims)) continue;
    // The example is about an ending that is not heard here: one more, where it is.
    const other = c.examples.slice(1).find((x) => {
      const clip = src.clips[x.loc];
      return !!clip && !clip.last && !!src.wordAt(x.loc);
    });
    const word = other ? src.wordAt(other.loc) : undefined;
    if (!other || !word) {
      gaps.push({ step, rule: c.id, why: `its example here ends the ayah, where the ${w.case.sign} it is about is not heard, and the concept has no other example that does not end its ayah` });
      continue;
    }
    const at = placeOf(other.loc);
    const own = numberOf.get(other.loc) ?? null;
    examples.push({
      id: `concept:${c.id}:2`,
      of: "concept",
      step,
      frame: null,
      key: other.loc,
      word: own,
      clip: own === null ? src.clips[other.loc] : null,
      translit: word.translit,
      gloss: word.gloss,
      place: { surah: at.surah, ayah: at.ayah },
      waqf: false,
      washal: null,
      ar: word.ar,
      ending: null,
      about: null,
    });
  }
  return { examples, gaps };
}

/** The part of a LessonExample the sequence is built from: no Arabic, nothing for drawing. */
export type ExampleInput = Pick<LessonExample, "id" | "of" | "step" | "frame" | "key" | "word" | "clip" | "translit" | "place" | "waqf" | "washal" | "about">;

/** What the stage draws for one beat, by its id (content bytes; LessonStage). */
export type StageExample = Pick<LessonExample, "of" | "key" | "word" | "translit" | "gloss" | "place" | "ar" | "ending" | "waqf" | "washal" | "about">;

export function stageExamples(examples: readonly LessonExample[]): Record<string, StageExample> {
  return Object.fromEntries(
    examples.map((e) => [
      e.id,
      { of: e.of, key: e.key, word: e.word, translit: e.translit, gloss: e.gloss, place: e.place, ar: e.ar, ending: e.ending, waqf: e.waqf, washal: e.washal, about: e.about },
    ]),
  );
}
