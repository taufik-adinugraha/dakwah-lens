/**
 * Deterministic checks of the autoplay engine over EVERY ayah of every
 * surah — run by `npx --yes tsx@4.19.2 scripts/autoplay-check.ts` (no
 * node_modules needed) and in CI by autoplay.test.ts and stage.test.ts:
 *
 *  1. sequences: non-empty, in lesson order, unique step ids, every caption
 *     non-empty and ≤ 180 characters per part, Arabic script in a caption
 *     only from a manifest's display, line ids on the contract, the right
 *     exercises, the last ayah ends "done"; the concept steps are the steps
 *     the CURRICULUM teaches in that ayah's lesson (content/curriculum.json,
 *     plan L26; the file itself held to the lessons); in a surah with a lesson
 *     map (content/map, plan L23, L26) the map's opening steps — one per group
 *     of its card, each with its lines (MAP_LINES) — right after the imam's
 *     ayah and the "learned" step right before the recap, and none anywhere
 *     else;
 *     the harakat primer right after the imam's ayah (after the map steps,
 *     where there are any), and each word's recite → explain → compose (when it
 *     has a composition: one cue per line, frames in order); each word
 *     recited by ONE step, its opening one — and the ayah's last word once
 *     more, by the composition that ends on the stop frame (operator
 *     2026-10-13, plan L24); the composition files themselves replayed
 *     (src/lib/composition.ts: every Arabic form from its source);
 *  2. narration manifests, IF they exist: every line the sequences play is
 *     there, ids are well-formed, spoken text never carries a transliterated
 *     Qur'anic word (nor digits, ALL CAPS, "kamu") and Arabic script only as
 *     a term of the pronunciation dictionary (pipeline/authored/
 *     pronunciation.json); captions (display, karaoke words) show Arabic only
 *     as a dictionary display form or the lesson's own words; highlight and
 *     focus name words of the line's own ayah; audio is same-origin; word
 *     timings stay inside their audio; missing manifests are skipped and
 *     reported as notes;
 *  3. the machine, driven to the end in every pace, caption-only and with
 *     (synthetic) audio: every step is entered once in order, exercises
 *     wait for the learner, the navigation intent is right;
 *  4. property runs on seeded random event streams: an exercise step never
 *     moves on without exercise_done/skip, stale end events change nothing,
 *     one activity at a time (narration and the imam never overlap),
 *     reminders ≤ 3 per idle stretch, states survive a JSON round trip, the
 *     same events give the same states;
 *  5. the EXAMPLE BEATS (operator 2026-10-12: "each explanation should be
 *     followed by examples (visual + voice)", "not only for harakah, but also
 *     for all rules"; plan L20; exampleProblems): every concept line is
 *     followed by its example step, every bentuk dasar a composition shows
 *     has its beat — or is listed with the reason (no Qur'anic example
 *     exists, it is the lesson's own word); each beat has its Arabic (the
 *     content's bytes) and a recording (the narrator's of this ayah's word,
 *     or of the form it shows), is labelled by what is
 *     heard (waqf, hamzat washal), is no narration line, and at most two
 *     follow one rule. A beat whose recording cannot be played never stops
 *     the lesson (the machine checks);
 *  6. THE WORDS' VOICES (operator 2026-10-14: every Qur'anic word played on its
 *     own is the narrator Kang Nandar's recording of it, never a cut of the
 *     imam's recitation; wordVoiceProblems): every word of every lesson ayah
 *     has its recording in content/wordvoice.json, the sequence carries exactly
 *     that recording for it, and every step that plays one word plays it — a
 *     word with no recording is an error here, never a silent fall-back to the
 *     imam.
 * Pure: file access is injected (loadCheckInput).
 */
import type { ComposeFile } from "@/content/compose-schema";
import type { Ayah, Concept, Lexeme } from "@/content/schema";

import { composeFileProblems, composeInputFor, type ComposeInput } from "../composition";
import { hasWaqfNote, waqfDrop } from "../heard";
import { voiceFrom, type WordVoiceManifest } from "../wordvoice-core";
import { MAX_CAPTION, type Pace } from "../lessonSteps";
import { SURAH_SLUGS } from "../routes";
import { lessonExamples, MAX_EXAMPLES_PER_RULE, MAX_EXAMPLES_ZERO, type ComposeLike, type ExampleGap, type LessonExample } from "./examples";
import { availableExercises, questionNumbers, type QuizAyahLike } from "./exercises";
import { LINE_ID_RE, manifestParts, parseLineId, promptLineId, ZERO_AYAH } from "./ids";
import { curriculumProblems, taughtIn, type CurriculumFile } from "./curriculum";
import { hostsZero, zeroAyah } from "./zero";
import { lessonMapInputOf, lessonMapProblems, MAP_GROUPS, MAP_LINES, mapClosingLines, mapOpening, type LessonMapFile, type LessonMapInput } from "./lessonMap";
import {
  createAutoplayState,
  reduceAutoplay,
  wantsIdleTicks,
  type Activity,
  type AutoplayEvent,
  type AutoplayState,
} from "./machine";
import {
  captionArabicProblems,
  hasArabicScript,
  maskNamedSaid,
  namedSaid,
  parseNarrationManifest,
  parsePronunciation,
  quranTokenSet,
  spokenTextProblems,
  usableTokens,
} from "./narration";
import { buildAutoplaySequence, sequenceLineIds, type SequenceInput } from "./sequence";
import { ID_TEXTS } from "./texts";
import { IDLE_TICK_MS, MAX_REMINDERS } from "./timing";
import {
  EXERCISE_KEYS,
  GUIDE_PARTS,
  OPENING_EXERCISES,
  PARTS_OF,
  SHARED_KEYS,
  type AutoplaySequence,
  type AutoplayStep,
  type AutoplayTexts,
  type ExampleClip,
  type ExerciseKey,
  type NarrationManifest,
} from "./types";

export type CheckSurah = { slug: string; name_id: string; ayat: readonly Ayah[] };
/** What the checks read of a lesson's "ayah": an ayah of the content, or lesson zero's place. */
type LessonAyah = Pick<Ayah, "ayah" | "loc" | "words" | "structure" | "recitation"> & { surah: number };

export type CheckInput = {
  surahs: readonly CheckSurah[];
  concepts: readonly Concept[];
  lexicon: readonly Pick<Lexeme, "id" | "tashrif">[];
  /** Parsed content/narration/${slug}.json per slug; null/absent = no file. */
  manifests: Readonly<Record<string, unknown>>;
  /** Parsed content/narration/shared.json; null = no file. */
  sharedManifest: unknown;
  /** Parsed pipeline/authored/pronunciation.json (the dictionary of terms
   *  the narrator may say in Arabic script); null/absent = no file, and
   *  then any Arabic in spoken text or a caption is an error. */
  pronunciation?: unknown;
  /** Parsed content/compose/${slug}.json per slug (word compositions and
   *  the harakat primer); null/absent = none for that surah. */
  compose?: Readonly<Record<string, unknown>>;
  /** Parsed content/quiz/${slug}.json per slug (the exercises each ayah
   *  shows and their questions); null/absent = no exercise in that surah. */
  quiz?: Readonly<Record<string, unknown>>;
  /** Parsed content/map/${slug}.json per slug (the lesson map, plan L23);
   *  null/absent = the surah has none, and its lessons no map / learned step. */
  maps?: Readonly<Record<string, unknown>>;
  /** Parsed content/curriculum.json (plan L26): which steps each ayah's lesson teaches.
   *  null/absent = an error: every lesson is placed by the curriculum. */
  curriculum?: unknown;
  /** Parsed content/wordvoice.json: the narrator's recording of every form (an example beat
   *  that is not a word of its own ayah plays one). */
  voices?: WordVoiceManifest;
  texts?: AutoplayTexts;
  property?: { streams?: number; length?: number; seed?: number };
};

export type CheckReport = {
  errors: string[];
  notes: string[];
  stats: {
    surahs: number;
    ayat: number;
    steps: number;
    lines: number;
    exerciseSteps: number;
    simulatedEvents: number;
    /** Estimated minutes per surah (caption-only, a learner who answers at
     *  once; "tunggu" counts no time for the Lanjut taps). */
    minutes: Record<string, Record<Pace, number>>;
    /** The example beats per ayah ("${slug}/${ayah}"): each beat (its rule's step, what the
     *  imam recites) and the seconds the beats add to the ayah's lesson in Biasa and Pelan
     *  (the same lesson played with and without them); the rules without a beat, and why. */
    examples: Record<string, { beats: { id: string; step: string; key: string; own: boolean }[]; addedMs: { biasa: number; pelan: number }; gaps: ExampleGap[] }>;
  };
};

// ───────────────────────────── loading ─────────────────────────────

/** The pronunciation dictionary, relative to content/. */
export const PRONUNCIATION_PATH = "../pipeline/authored/pronunciation.json";

/**
 * Builds the check input from files, `read(relativePath)` returning the
 * text or null when the file does not exist (paths relative to content/;
 * the pronunciation dictionary is PRONUNCIATION_PATH).
 */
export function loadCheckInput(read: (rel: string) => string | null): { input: CheckInput; errors: string[] } {
  const errors: string[] = [];
  const json = (rel: string, required: boolean): unknown => {
    const text = read(rel);
    if (text === null) {
      if (required) errors.push(`content/${rel}: missing`);
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      errors.push(`content/${rel}: not valid JSON (${(err as Error).message})`);
      return null;
    }
  };
  const surahs: CheckSurah[] = [];
  const manifests: Record<string, unknown> = {};
  const compose: Record<string, unknown> = {};
  const quiz: Record<string, unknown> = {};
  const maps: Record<string, unknown> = {};
  for (const slug of SURAH_SLUGS) {
    const s = json(`${slug}.json`, true) as CheckSurah | null;
    if (s) surahs.push(s);
    manifests[slug] = json(`narration/${slug}.json`, false);
    compose[slug] = json(`compose/${slug}.json`, false);
    quiz[slug] = json(`quiz/${slug}.json`, true);
    maps[slug] = json(`map/${slug}.json`, false);
  }
  const library = (json("library.json", true) ?? { concepts: [], lexicon: [] }) as {
    concepts: Concept[];
    lexicon: Lexeme[];
  };
  return {
    input: {
      surahs,
      concepts: library.concepts,
      lexicon: library.lexicon,
      manifests,
      sharedManifest: json("narration/shared.json", false),
      pronunciation: json(PRONUNCIATION_PATH, false),
      compose,
      quiz,
      maps,
      curriculum: json("curriculum.json", true),
      voices: json("wordvoice.json", true) as WordVoiceManifest | undefined,
    },
    errors,
  };
}

// ───────────────────────────── seeded randomness ─────────────────────────────

function hashSeed(s: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── sequence checks ─────────────────────────────

/** Structural problems of one ayah's sequence (empty when fine). */
export function sequenceProblems(
  seq: AutoplaySequence,
  ctx: {
    ayah: Pick<Ayah, "words" | "structure">;
    last: boolean;
    exercises: readonly ExerciseKey[];
    introduced: readonly { id: string; lead?: unknown }[];
    compose?: ComposeInput | null;
    /** This ayah's lesson map (plan L23), or null / absent: its surah has none. */
    map?: LessonMapInput | null;
    /** LESSON ZERO (zero.ts): no ayah, so no recitation of one and no recap; the primer comes
     *  right after the opening line, and the lesson leads to ayah 1. */
    zero?: boolean;
  },
): string[] {
  const out: string[] = [];
  const steps = seq.steps;
  if (steps.length === 0) return ["the sequence is empty"];
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push("step ids are not unique");
  // A named word's markup ({{1:6:2}}, operator 2026-10-17) is resolved before the screen: the
  // manifest's caption shows the word, a caption-only line its transliteration (unmarkNamed).
  for (const s of steps) {
    for (const c of s.cues) {
      if (/\{\{|\}\}/.test(c.caption) || /\{\{|\}\}/.test(c.display ?? "")) out.push(`${c.line}: the caption shows a named word's markup`);
    }
  }
  if (steps[0].kind !== "intro") out.push("does not open with the intro");
  const zero = ctx.zero === true;
  /** How many steps open the lesson before its map / primer: the intro, and the imam's ayah. */
  const head = zero ? 1 : 2;
  if (zero) {
    const off = steps.filter((s) => s.recite?.target === "ayah" || s.kind === "recite_ayah" || s.kind === "recap" || s.kind === "recite_word" || s.kind === "exercise");
    if (off.length) out.push(`lesson zero has no ayah: it cannot have the step(s) ${off.map((s) => s.id).join(", ")}`);
    if (seq.ayah !== 0) out.push("lesson zero's lines are the lines of “ayah 0”");
    if (!steps.some((s) => s.kind === "primer")) out.push("lesson zero does not play the harakat primer");
  } else if (steps[1]?.kind !== "recite_ayah") out.push("the imam does not recite the ayah second");

  // Every word: recite_word then explain (then compose, for a word with a
  // composition), in order; the primer, when there is one, right after the
  // imam's ayah.
  const composed = (i: number) => !!ctx.compose?.words[ctx.ayah.words[i]?.loc ?? ""]?.lines.length;
  const wordSteps = steps.filter((s) => s.kind === "recite_word" || s.kind === "explain" || s.kind === "compose");
  const expected = ctx.ayah.words.flatMap((_, i) => [`w${i + 1}:recite`, `w${i + 1}`, ...(composed(i) ? [`w${i + 1}:compose`] : [])]);
  if (JSON.stringify(wordSteps.map((s) => s.id)) !== JSON.stringify(expected)) out.push("word steps are not recite + explain (+ compose) per word in order");
  // The lesson map (plan L23, L26): with one, what the ayah brings is said right after the imam's
  // ayah — one step per group of its card, in the card's order — and what it taught right before
  // the recap; without one, none of these steps exists.
  const mapped = !!ctx.map;
  const maps = steps.filter((s) => s.kind === "map");
  const learned = steps.filter((s) => s.kind === "learned");
  const opening = ctx.map ? mapOpening(ctx.map).map((g) => `map:${g}`) : [];
  if (!mapped && maps.length) out.push("a map step in a lesson without a lesson map");
  else if (JSON.stringify(steps.slice(head, head + opening.length).map((s) => s.id)) !== JSON.stringify(opening) || maps.length !== opening.length) {
    out.push(`the lesson map's steps (${opening.join(", ")}) are not the steps right after the imam's ayah, one per group`);
  }
  if (learned.length !== (mapped ? 1 : 0) || (mapped && steps[steps.length - 3] !== learned[0])) {
    out.push(mapped ? "what the ayah taught is not said in the step right before the recap" : "a learned step in a lesson without a lesson map");
  }
  for (const s of [...maps, ...learned]) {
    // Each step says its lines, one sentence each, in order (MAP_LINES; since 2026-10-15 every
    // counted step is named, so the learnt, later and closing steps have two lines).
    const group = s.kind === "learned" ? (s.id === "learned" ? "learned" : null) : (MAP_GROUPS.find((g) => s.id === `map:${g}`) ?? null);
    const want = group ? (group === "learned" && ctx.map ? mapClosingLines(ctx.map) : MAP_LINES[group]).map((part) => `${seq.slug}:${seq.ayah}:${part}`) : [];
    if (!group || JSON.stringify(s.cues.map((c) => c.line)) !== JSON.stringify(want)) {
      out.push(`${s.id}: a lesson map step is its lines${group ? ` (${want.join(", ")})` : ""}, in order`);
    }
    if (s.recite || s.examples?.length || s.cues.some((c) => c.highlight.length > 0 || c.focus !== null)) {
      out.push(`${s.id}: a lesson map step recites nothing and marks no word (its card is what the stage shows)`);
    }
  }
  const primers = steps.filter((s) => s.kind === "primer");
  if (primers.length !== (ctx.compose?.primer?.lines.length ? 1 : 0) || (primers.length && steps[head + opening.length] !== primers[0])) {
    out.push(zero ? "the harakat primer is not the step right after lesson zero's opening line" : "the harakat primer is not the step right after the imam's ayah (and the lesson map, where there is one)");
  }
  for (const s of steps) {
    if (s.kind === "recite_word" && (s.recite?.target !== "word" || s.recite.word !== s.word)) out.push(`${s.id}: recites the wrong thing`);
    if ((s.kind === "recite_ayah" || s.kind === "recap") && s.recite?.target !== "ayah") out.push(`${s.id}: the imam does not recite the ayah`);
    // A word is recited once, by its opening step (plan L24; until 2026-10-13 every composition
    // step ended with the imam too) — except the ayah's last word, once more at the end of the
    // composition that ends on the stop frame (composition.ts STOP_NOTE): that step, and no other.
    if (s.kind !== "recite_word") {
      const stop = s.kind === "compose" && s.word === ctx.ayah.words.length && ctx.compose?.words[s.loc ?? ""]?.stop === true;
      if (s.recite?.target === "word" && !stop) {
        out.push(`${s.id}: a ${s.kind} step ends with the imam reciting word ${s.recite.word} (a word is recited once, when its step opens; only the ayah's last word again, after the line that says he stops on it)`);
      } else if (stop && (s.recite?.target !== "word" || s.recite.word !== s.word)) {
        out.push(`${s.id}: the ayah's last word, whose last line says the imam stops on it, is not recited after that line`);
      }
    }
    if (s.kind === "compose" || s.kind === "primer") {
      const unit = s.kind === "primer" ? ctx.compose?.primer : ctx.compose?.words[s.loc ?? ""];
      if (!unit || s.cues.length !== unit.lines.length || s.frames !== unit.frames) out.push(`${s.id}: cues/frames differ from its composition`);
      const frames = s.cues.map((c) => c.frame);
      if (frames.some((f, k) => f === null || f < 1 || f > (s.frames ?? 0) || (k > 0 && f < (frames[k - 1] ?? 0)))) {
        out.push(`${s.id}: cue frames ${JSON.stringify(frames)} not in order within 1..${s.frames}`);
      } else if (frames[0] !== 1 || frames[frames.length - 1] !== s.frames) {
        out.push(`${s.id}: the cues do not cover the frames from the first to the last`);
      }
    } else if (s.cues.some((c) => c.frame !== null)) {
      out.push(`${s.id}: a cue outside a primer / compose step names an animation frame`);
    }
  }

  const order = steps.map((s) => s.kind);
  const lastWord = Math.max(order.lastIndexOf("explain"), order.lastIndexOf("compose"));
  // The warm-up OPENS the lesson (operator 2026-10-13; types.ts OPENING_EXERCISES): it is the
  // step right before the first word, after what the ayah brings (the map, the primer). Every
  // other exercise follows the explanations, as before.
  const opens = (s: AutoplayStep) => s.kind === "exercise" && !!s.exercise && OPENING_EXERCISES.includes(s.exercise.key);
  const openers = steps.filter(opens);
  const firstWordAt = order.indexOf("recite_word");
  const openAt = head + opening.length + primers.length;
  if (openers.length && (firstWordAt === -1 || steps.slice(openAt, firstWordAt).length !== openers.length || steps.slice(openAt, firstWordAt).some((s) => !opens(s)))) {
    out.push(`the warm-up (${openers.map((s) => s.id).join(", ")}) is not the step right before the first word, after the lesson map and the primer`);
  }
  const firstAfter = (k: string) => (k === "exercise" ? steps.findIndex((s) => s.kind === "exercise" && !opens(s)) : order.indexOf(k as (typeof order)[number]));
  for (const k of ["structure", "concept", "exercise", "learned", "recap"]) {
    const i = firstAfter(k);
    if (i !== -1 && i < lastWord) out.push(`${k} comes before the words are explained`);
  }
  // A step's slide before its line (lesson zero: kalimah is not the Indonesian kalimat, operator
  // 2026-10-15) is a concept step "concept:<id>:lead" right before "concept:<id>", one line.
  const isLead = (s: AutoplayStep) => s.kind === "concept" && s.id.endsWith(":lead");
  const concepts = steps.filter((s) => s.kind === "concept" && !isLead(s)).map((s) => s.id);
  if (JSON.stringify(concepts) !== JSON.stringify(ctx.introduced.map((c) => `concept:${c.id}`))) out.push("concept steps differ from the steps the curriculum teaches here");
  const leads = steps.filter(isLead).map((s) => s.id);
  const wantLeads = zero ? ctx.introduced.filter((c) => c.lead).map((c) => `concept:${c.id}:lead`) : [];
  if (JSON.stringify(leads) !== JSON.stringify(wantLeads)) out.push(`slide steps ${JSON.stringify(leads)} are not lesson zero's slides of its steps ${JSON.stringify(wantLeads)}`);
  for (const id of leads) {
    const at = steps.findIndex((s) => s.id === id);
    const s = steps[at];
    if (steps[at + 1]?.id !== id.slice(0, -":lead".length)) out.push(`${id}: a slide is the step right before its concept's line`);
    if (s.cues.length !== 1 || s.cues[0].line !== `${seq.slug}:${seq.ayah}:${id}`) out.push(`${id}: a slide is its one line`);
  }
  const ex = steps.filter((s) => s.kind === "exercise").map((s) => s.exercise?.key);
  if (JSON.stringify(ex) !== JSON.stringify([...ctx.exercises])) out.push(`exercise steps ${JSON.stringify(ex)} differ from the page's ${JSON.stringify(ctx.exercises)}`);
  // The sentence structure (operator 2026-10-13): told item by item where the ayah has items —
  // one step per item, in order, each about its item's words — else the one step of its summary.
  const items = ctx.ayah.structure?.items ?? [];
  const told = steps.filter((s) => s.kind === "structure");
  const wantTold = items.length ? items.map((_, i) => `structure:${i + 1}`) : ctx.ayah.structure ? ["structure"] : [];
  if (JSON.stringify(told.map((s) => s.id)) !== JSON.stringify(wantTold)) {
    out.push(`structure steps ${JSON.stringify(told.map((s) => s.id))} are not ${items.length ? "the ayah's items, one step each, in order" : "the one step of its summary"} ${JSON.stringify(wantTold)}`);
  } else {
    told.forEach((s, i) => {
      const it = items[i];
      if (!it) {
        if (s.item) out.push(`${s.id}: an item on the step of a structure told from its summary`);
        return;
      }
      if (JSON.stringify(s.item) !== JSON.stringify({ n: i + 1, of: items.length, words: it.words })) out.push(`${s.id}: is not about item ${i + 1} of ${items.length} and its words ${JSON.stringify(it.words)}`);
      if (s.cues.length !== 1 || JSON.stringify(s.cues[0].highlight) !== JSON.stringify(it.words) || s.cues[0].focus !== null) out.push(`${s.id}: its one line must light the item's words ${JSON.stringify(it.words)} and show no word card`);
    });
    if (told.length && order.lastIndexOf("structure") - order.indexOf("structure") !== told.length - 1) out.push("the structure's items are not said one after another");
  }
  const structureAt = firstAfter("structure");
  const conceptAt = firstAfter("concept");
  // The lesson page's order (lessonSteps) and the narration's: the structure
  // line uses the terms the concept lines introduce.
  if (structureAt !== -1 && conceptAt !== -1 && structureAt < order.lastIndexOf("concept")) out.push("the structure comes before the new concepts");
  const firstEx = firstAfter("exercise");
  if (firstEx !== -1 && (conceptAt > firstEx || structureAt > firstEx)) out.push("an exercise comes before the explanations");
  if (!zero && order.at(-2) !== "recap") out.push("the recap is not the second-to-last step");
  const end = steps[steps.length - 1];
  if (ctx.last) {
    if (end.kind !== "done") out.push("the last ayah does not end with done");
    if (seq.nav.kind !== "surah_end") out.push("the last ayah does not lead to the surah end");
  } else {
    if (end.kind !== "next") out.push("does not end with next");
    if (seq.nav.kind !== "ayah" || seq.nav.ayah !== seq.ayah + 1) out.push("next does not lead to the following ayah");
  }

  // Captions, lines, guides.
  const own = `${seq.slug}:${seq.ayah}:`;
  const lineSeen = new Set<string>();
  // Arabic script on screen only from a manifest's display (checked against
  // the pronunciation dictionary with the manifest); the engine's own
  // captions carry none.
  const ownArabic = (c: { caption: string; display: string | null }) => hasArabicScript(c.caption) && c.display === null;
  for (const s of steps) {
    if (!s.caption.trim()) out.push(`${s.id}: empty caption`);
    if (hasArabicScript(s.caption) && !(s.cues[0] && s.cues[0].caption === s.caption && s.cues[0].display !== null)) {
      out.push(`${s.id}: Arabic script in the caption`);
    }
    if (JSON.stringify(s.lines) !== JSON.stringify(s.cues.map((c) => c.line))) out.push(`${s.id}: lines differ from cues`);
    if (s.kind !== "recite_word" && s.kind !== "example" && s.cues.length === 0) out.push(`${s.id}: no narration line`);
    // An example step is its beats; in lesson zero each beat may come with the narrator's line about it
    // ("<id>:<k>", said before its beat k; operator 2026-10-15), one line per beat.
    const explained = zero && s.cues.length > 0 && s.cues.length === (s.examples?.length ?? 0) &&
      s.cues.every((c, k) => c.line === `${seq.slug}:${seq.ayah}:${s.id}:${k + 1}` && s.examples?.[k]?.after === k);
    if (s.kind === "example" && ((s.cues.length > 0 && !explained) || !s.examples?.length)) {
      out.push(`${s.id}: an example step is its example beats (in lesson zero, each after its own line) and nothing else`);
    }
    for (const g of s.guides) if (!g.label.trim()) out.push(`${s.id}: a spotlight without a label`);
    for (const c of s.cues) {
      if (!LINE_ID_RE.test(c.line)) out.push(`${s.id}: line id "${c.line}" breaks the contract`);
      const p = parseLineId(c.line);
      if (p?.kind === "ayah" && !c.line.startsWith(own)) out.push(`${s.id}: line ${c.line} belongs to another ayah`);
      if (p?.kind === "ayah") {
        if (lineSeen.has(c.line)) out.push(`${s.id}: line ${c.line} is used twice`);
        lineSeen.add(c.line);
      }
      if (!c.caption.trim() || c.parts.length === 0) out.push(`${s.id}: ${c.line} has an empty caption`);
      for (const part of c.parts) {
        if (!part.trim()) out.push(`${s.id}: ${c.line} has an empty caption part`);
        if (part.length > MAX_CAPTION && part.includes(" ")) out.push(`${s.id}: ${c.line} has a caption part over ${MAX_CAPTION} characters`);
      }
      if (ownArabic(c)) out.push(`${s.id}: ${c.line} has Arabic script in its caption`);
      if (c.display !== null && c.display !== c.caption) out.push(`${s.id}: ${c.line} caption is not its display text`);
      if (c.parts.join(" ") !== c.caption) out.push(`${s.id}: ${c.line} caption parts do not rejoin to the caption`);
      for (const w of [...c.highlight, ...(c.focus === null ? [] : [c.focus])]) {
        if (!Number.isInteger(w) || w < 1 || w > ctx.ayah.words.length) out.push(`${s.id}: ${c.line} highlights word ${w} of ${ctx.ayah.words.length}`);
      }
      for (const g of c.guides) if (!g.label.trim()) out.push(`${s.id}: ${c.line} spotlight without a label`);
      for (const r of c.refs) {
        if (!Number.isInteger(r) || r < 1 || r > ctx.ayah.words.length) out.push(`${s.id}: ${c.line} names word ${r} of ${ctx.ayah.words.length}`);
      }
    }
    if (s.kind === "exercise") {
      const e = s.exercise;
      if (!e) {
        out.push(`${s.id}: exercise step without its exercise`);
        continue;
      }
      const lead = e.lead.map((i) => s.cues[i]?.line);
      const expectLead = [`${own}ex:${e.key}:intro`];
      if (JSON.stringify(lead) !== JSON.stringify(expectLead)) out.push(`${s.id}: opens with ${JSON.stringify(lead)}, expected ${JSON.stringify(expectLead)}`);
      if (JSON.stringify(e.parts) !== JSON.stringify(PARTS_OF[e.key])) out.push(`${s.id}: parts differ from PARTS_OF`);
      for (const part of e.parts) {
        const ci = e.promptCue[part];
        if (ci === undefined) out.push(`${s.id}: no prompt for "${part}"`);
        else if (s.cues[ci]?.line !== promptLineId(e.key, part) && s.cues[ci]?.line !== `${own}ex:${e.key}:${part}`) {
          out.push(`${s.id}: prompt for "${part}" has the wrong line`);
        }
        if (!e.guides[part]) out.push(`${s.id}: no spotlight for "${part}"`);
      }
      for (const [q, ci] of Object.entries(e.explain)) {
        if (ci === undefined || s.cues[ci]?.line !== `${own}ex:${e.key}:${q}:why`) out.push(`${s.id}: the explanation of question ${q} has the wrong line`);
      }
    }
  }
  for (const k of SHARED_KEYS) {
    const c = seq.shared[k];
    if (c.line !== `shared:${k}` || !c.caption.trim() || ownArabic(c)) out.push(`shared:${k}: bad shared cue`);
    if (c.highlight.length > 0 || c.focus !== null) out.push(`shared:${k}: a shared line highlights words`);
  }
  if (!seq.shared.skip_offer.guides.some((g) => g.target === "skip")) out.push("the skip offer does not point at Lewati latihan");
  return out;
}

// ───────────────────────────── example beats ─────────────────────────────

/** What exampleProblems checks one ayah's beats against (all of it content, none of it typed). */
export type ExampleContext = {
  ayah: Pick<Ayah, "words" | "recitation">;
  /** What the ayah's lesson teaches (curriculum.ts taughtIn): each with its examples, the one
   *  in this ayah first. */
  introduced: readonly { id: string; examples: readonly { loc: string; note: string }[] }[];
  /** content/compose/${slug}.json (raw), or null. */
  compose: ComposeLike | null;
  /** What examples.ts derived for this ayah (the sequence was built from `derived.examples`). */
  derived: { examples: readonly LessonExample[]; gaps: readonly ExampleGap[] };
  /** The narrator's recording of a form's Arabic (examples.ts `voice`). */
  voice: (ar: string) => ExampleClip | null;
  wordAt: (loc: string) => { ar: string } | undefined;
  texts: AutoplayTexts;
  /** Lesson zero (zero.ts): no ayah, so a concept's examples are clips of other ayat. */
  zero?: boolean;
};

/** A recording of content/wordvoice.json: the narrator's file of a word, from its start, whole… */
const VOICE_FILE = /^\/belajar\/media\/narration\/kang-nandar\/words\/[0-9a-f]{16}-[0-9a-f]{10}\.mp3$/;
/** …or our unaltered copy of Quran.com's word file (operator 2026-10-15), the word inside it. */
const QURAN_COM_FILE = /^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/;

/** A word recording as content/wordvoice.json hands it out (src/lib/wordvoice-core.ts voiceFrom):
 *  the narrator's whole file, or the word inside a Quran.com file; never the imam's recitation. */
export function isWordRecording(c: ExampleClip): boolean {
  if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 0 || c.end <= c.start) return false;
  if (c.source === "quran.com") return QURAN_COM_FILE.test(c.url);
  return VOICE_FILE.test(c.url) && c.start === 0;
}

/**
 * Problems of one ayah's word voices (operator 2026-10-14: "for all quran word by word should be
 * replaced by this, not using truncated voice from imam"; empty when fine): every word of the
 * ayah has its recording (Quran.com's or the narrator's; `voice`: content/wordvoice.json through
 * src/lib/wordvoice-core.ts voiceFrom) — a word without one is named, never played from the
 * imam's recitation instead — the sequence carries exactly that recording for it (wordVoices),
 * as a word recording of the narration media store (isWordRecording), and every step that plays one word plays that
 * recording (the machine reads wordVoices; transitionProblem checks each activity it issues).
 */
export function wordVoiceProblems(
  seq: AutoplaySequence,
  ctx: { ayah: { words: readonly { loc: string; ar: string; translit: string }[] }; voice: (ar: string) => ExampleClip | null },
): string[] {
  const out: string[] = [];
  const words = ctx.ayah.words;
  const voices = seq.wordVoices ?? [];
  if (voices.length !== words.length) out.push(`the sequence carries ${voices.length} word voice(s) for ${words.length} word(s)`);
  words.forEach((w, i) => {
    const where = `word ${i + 1} (${w.loc}, ${w.translit})`;
    const own = ctx.voice(w.ar);
    if (!own) {
      out.push(`${where}: has no recording in content/wordvoice.json (a word heard on its own is the narrator's recording, never the imam's recitation cut at the word)`);
      return;
    }
    if (!isWordRecording(own)) {
      out.push(`${where}: its recording ${JSON.stringify(own)} is not a word recording of the narration media store`);
    }
    if (JSON.stringify(voices[i] ?? null) !== JSON.stringify(own)) out.push(`${where}: the sequence does not carry its recording`);
  });
  for (const st of seq.steps) {
    if (st.recite?.target === "word" && !voices[st.recite.word - 1]) out.push(`${st.id}: plays word ${st.recite.word}, which has no recording`);
  }
  return out;
}

/**
 * Problems of one ayah's example beats (operator 2026-10-12, plan L20; empty when fine):
 * - COVERAGE: every concept line is followed by its example step, whose first beat is the
 *   concept's example in this ayah; every `base` frame of a composition has its beat, or is
 *   listed with a reason (`derived.gaps`); no composition step but that of the ayah's last
 *   word ends with the imam reciting its word again, and no word's own line is followed by a
 *   beat (plan L24: recited once, when its step opens);
 * - each beat is one the content gives (examples.ts), in the right step, after the right line;
 *   exactly one recording, the narrator's: this ayah's word, as the sequence's recording of it
 *   (wordVoices), or the clip of the form it shows (a whole file of content/wordvoice.json);
 * - its Arabic is the content's bytes, its caption is plain on-screen text that names it (no
 *   Arabic script, parts ≤ 180 characters) — and no narration line;
 * - HEARD: an ayah-final word whose last harakah the pause drops says so (and only such a word
 *   does); a bentuk dasar and a second example never end their ayah; a run played with the word
 *   before it says what is heard;
 * - at most MAX_EXAMPLES_PER_RULE beats per rule (MAX_EXAMPLES_ZERO in lesson zero: one per kind of word).
 */
export function exampleProblems(seq: AutoplaySequence, ctx: ExampleContext): string[] {
  const out: string[] = [];
  const words = ctx.ayah.words;
  const n = words.length;
  const derived = new Map(ctx.derived.examples.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const gapsOf = (step: string) => ctx.derived.gaps.filter((g) => g.step === step);
  for (const g of ctx.derived.gaps) if (!g.why.trim() || !g.rule.trim()) out.push(`${g.step}: a rule without an example must say which and why`);

  seq.steps.forEach((s, i) => {
    const beats = s.examples ?? [];
    if (beats.length && s.kind !== "example" && s.kind !== "compose") out.push(`${s.id}: a ${s.kind} step has example beats`);
    const cap = ctx.zero ? MAX_EXAMPLES_ZERO : MAX_EXAMPLES_PER_RULE;
    if (beats.length > cap && s.kind !== "compose") out.push(`${s.id}: ${beats.length} example beats after one rule (at most ${cap})`);
    for (const b of beats) {
      const w = `${s.id} example ${b.id}`;
      if (seen.has(b.id)) out.push(`${w}: the id is used twice`);
      seen.add(b.id);
      const d = derived.get(b.id);
      if (!d) {
        out.push(`${w}: not an example the content gives (examples.ts)`);
        continue;
      }
      if (d.of !== b.of || d.key !== b.key || d.word !== b.word || JSON.stringify(d.clip) !== JSON.stringify(b.clip) || d.frame !== b.frame) {
        out.push(`${w}: differs from the example the content gives`);
      }
      // Where it plays.
      if (b.of === "concept") {
        const before = seq.steps[i - 1];
        // after no line, or (lesson zero) after its own line: the step's cue of the same number
        const own = s.cues.length ? s.examples?.indexOf(b) : -1;
        if (s.kind !== "example" || s.id !== d.step || b.after !== own) out.push(`${w}: a concept's example plays in its own example step`);
        else if (before?.kind !== "concept" || `${before.id}:ex` !== s.id) out.push(`${w}: its example step does not follow its concept's line`);
      } else {
        const cue = s.cues[b.after];
        if (s.kind !== "compose" || s.id !== d.step || !cue) out.push(`${w}: a bentuk dasar's example plays in its word's composition step, after a line`);
        else if (cue.frame !== b.frame || s.cues.slice(b.after + 1).some((c) => c.frame === b.frame)) {
          out.push(`${w}: does not come after the last line of its base frame (${b.frame})`);
        } else if (ctx.compose?.words[s.loc ?? ""]?.frames[(b.frame ?? 0) - 1]?.stage !== "base") {
          out.push(`${w}: frame ${b.frame} of the composition is not a base frame`);
        }
      }
      // What is heard: one recording of the narrator's — a word of this ayah's own (the sequence's
      // wordVoices), or the clip of another ayah's word or of a form. Never the imam's recitation
      // cut at the word (operator 2026-10-14).
      if ((b.word === null) === (b.clip === null)) out.push(`${w}: needs exactly one of a word of this ayah and a clip`);
      const last = b.word !== null && b.word === n;
      if (b.word !== null) {
        const word = words[b.word - 1];
        if (!word || word.loc !== b.key) out.push(`${w}: word ${b.word} of this ayah is not ${b.key}`);
        const own = word ? ctx.voice(word.ar) : null;
        if (!own || JSON.stringify(seq.wordVoices?.[b.word - 1] ?? null) !== JSON.stringify(own)) {
          out.push(`${w}: word ${b.word} of this ayah has no recording of its own in the sequence (nothing would be heard)`);
        }
      } else if (b.clip) {
        const c = b.clip;
        if (!isWordRecording(c)) {
          out.push(`${w}: clip ${JSON.stringify(c)} is not a whole recording of content/wordvoice.json`);
        }
        const given = ctx.voice(d.ar);
        if (JSON.stringify(given ?? null) !== JSON.stringify(c)) out.push(`${w}: its clip is not the recording of ${d.translit}`);
      }
      // Its Arabic: the content's own bytes.
      const bytes =
        b.of === "base"
          ? ctx.compose?.words[s.loc ?? ""]?.forms[ctx.compose.examples?.[s.loc ?? ""]?.find((x) => x.frame === b.frame)?.form ?? ""]?.ar
          : b.word !== null
            ? words[b.word - 1]?.ar
            : ctx.wordAt(b.key)?.ar;
      if (!d.ar || !hasArabicScript(d.ar) || d.ar !== bytes) out.push(`${w}: its Arabic (${d.ar || "none"}) is not the content's bytes (${bytes ?? "none"})`);
      // Its caption: on-screen text that names it.
      if (!b.caption.trim() || hasArabicScript(b.caption)) out.push(`${w}: the caption is empty or carries Arabic script`);
      if (b.parts.join(" ") !== b.caption || b.parts.some((p) => !p.trim() || (p.length > MAX_CAPTION && p.includes(" ")))) out.push(`${w}: caption parts do not rejoin, or one is over ${MAX_CAPTION} characters`);
      if (!b.caption.includes(d.translit)) out.push(`${w}: the caption does not name the example (${d.translit})`);
      // What is heard.
      const drop = last ? waqfDrop(d.ar.trim().split(/\s+/u).pop() ?? "") : "none";
      const waqf = hasWaqfNote(last ? { last: true } : null, d.ar);
      if (drop === "other") out.push(`${w}: ${d.translit} ends its ayah, where the pause changes its ending in a way the caption has no wording for`);
      if (d.waqf !== waqf || b.caption.includes(ctx.texts.example.waqf) !== waqf) {
        out.push(`${w}: ${waqf ? "ends its ayah, where its last harakah is not heard, and does not say so" : "says its last harakah is not heard, which is not so here"}`);
      }
      // A recording of a form is said whole: there is no run, and no "what is heard" to add.
      if (d.washal !== null) out.push(`${w}: says what a run sounds like, but a form is recorded on its own`);
    }
  });
  for (const id of derived.keys()) if (!seen.has(id)) out.push(`example ${id}: the content gives it, and no step plays it`);

  // Coverage: every rule explained has its example, or its reason.
  for (const c of ctx.introduced) {
    const at = seq.steps.findIndex((s) => s.id === `concept:${c.id}`);
    const ex = seq.steps[at + 1];
    const first = ex?.kind === "example" && ex.id === `concept:${c.id}:ex` ? ex.examples?.[0] : undefined;
    if (at === -1) continue;
    if (!first) {
      if (!gapsOf(`concept:${c.id}:ex`).length) out.push(`concept:${c.id}: its line is followed by no example`);
    } else if (ctx.zero) {
      // Lesson zero has no ayah: the record's first example, as the narrator's recording of that word.
      if (first.key !== c.examples[0]?.loc || first.word !== null || first.clip === null) {
        out.push(`concept:${c.id}: in lesson zero its first example is the narrator's recording of the concept's first example (${c.examples[0]?.loc})`);
      }
    } else if (first.key !== c.examples[0]?.loc || first.word === null) {
      out.push(`concept:${c.id}: its first example is not the concept's example in this ayah (${c.examples[0]?.loc})`);
    }
  }
  seq.steps.forEach((s) => {
    const beats = s.examples ?? [];
    if (s.kind === "compose") {
      if (s.recite && s.word !== n) out.push(`${s.id}: ends with the imam reciting its word again (a word is recited once, when its step opens; only the ayah's last word again)`);
      const base = (ctx.compose?.words[s.loc ?? ""]?.frames ?? []).flatMap((f, k) => (f.stage === "base" ? [k + 1] : []));
      const voiced = beats.filter((b) => b.of === "base").map((b) => b.frame);
      const unvoiced = gapsOf(s.id).length;
      if (base.some((k) => !voiced.includes(k)) && voiced.length + unvoiced !== base.length) {
        out.push(`${s.id}: base frame(s) ${base.filter((k) => !voiced.includes(k)).join(", ")} have neither a recording of the bentuk dasar nor a reason`);
      }
      if (voiced.length !== new Set(voiced).size) out.push(`${s.id}: two examples for one base frame`);
    }
  });
  return out;
}

// ───────────────────────────── machine checks ─────────────────────────────

function endEventFor(a: Activity): AutoplayEvent {
  if (a.kind === "narrate") return { type: "narration_end", token: a.token };
  if (a.kind === "recite") return { type: "recite_end", token: a.token };
  return { type: "timer", token: a.token };
}

/** One transition's problem, or null. */
export function transitionProblem(seq: AutoplaySequence, b: AutoplayState, e: AutoplayEvent, a: AutoplayState): string | null {
  const last = seq.steps.length - 1;
  if (a.idx < 0 || a.idx > last) return "step index out of range";
  if (a.phase === "running" && !a.activity) return "running without an activity";
  if (a.phase !== "running" && a.activity) return `an activity while ${a.phase}`;
  const step = seq.steps[a.idx];
  if (a.phase === "waiting" && step.kind !== "exercise") return "waiting outside an exercise";
  if (a.phase === "ready" && step.kind === "exercise") return "an exercise step waiting for Lanjut";
  if (a.phase === "finished" && JSON.stringify(a.intent) !== JSON.stringify(seq.nav)) return "finished without the navigation intent";
  if (a.phase !== "finished" && a.intent !== null) return "a navigation intent before the end";
  if (a.token < b.token) return "the token went back";
  const same = JSON.stringify(a.activity) === JSON.stringify(b.activity);
  if (a.activity && !same && a.activity.token <= b.token) return "a new activity reuses an old token";
  if ("token" in e && (!b.activity || b.activity.token !== e.token) && JSON.stringify(a) !== JSON.stringify(b)) {
    return `a stale ${e.type} changed the state`;
  }
  if (e.type === "narration_end" || e.type === "recite_end" || e.type === "timer") {
    // An end event acts only on the activity it names: a recitation's end
    // never ends a narration line (or the reverse).
    const kindOk =
      !b.activity ||
      b.activity.token !== e.token ||
      (e.type === "narration_end" ? b.activity.kind === "narrate" : e.type === "recite_end" ? b.activity.kind === "recite" : b.activity.kind === "read" || b.activity.kind === "wait");
    if (!kindOk && JSON.stringify(a) !== JSON.stringify(b)) return `${e.type} ended a ${b.activity?.kind}`;
  }
  if (e.type === "recite_error" && b.activity?.kind === "recite" && b.activity.token === e.token) {
    // The ayah's own recitation failing pauses the lesson ("Bacaan imam belum bisa diputar");
    // an example beat's never does: it is shown a moment longer and the lesson goes on.
    const example = b.activity.target !== "ayah" && b.activity.example !== undefined;
    if (example && (a.error !== null || a.phase !== "running" || a.idx !== b.idx)) return "an example beat that could not be played stopped the lesson";
    const held = a.plan[a.at];
    if (example && !(a.activity?.kind === "wait" && held?.t === "example" && held.failed === true)) return "a failed example beat is not shown for its hold";
    // (Which recording failed is said: "recite", the imam's ayah; "word", a word's recording.)
    if (!example && b.activity.target === "ayah" && a.error !== "recite") return "a failed recitation of the lesson's own did not pause it";
    if (!example && b.activity.target !== "ayah" && a.error !== "word") return "a failed recording of the lesson's own word did not pause it";
  }
  // One word is played from its recording by the narrator, and from nothing else (operator 2026-10-14).
  const act = a.activity;
  if (act && act !== b.activity && act.kind === "recite" && act.target === "word" && JSON.stringify(act.clip) !== JSON.stringify(seq.wordVoices?.[act.word - 1] ?? null)) {
    return `word ${act.word} is played from ${JSON.stringify(act.clip)}, not its recording`;
  }
  const moved = a.idx > b.idx || (b.phase !== "finished" && a.phase === "finished");
  if (moved) {
    const end = a.phase === "finished" && b.phase !== "finished" ? last + 1 : a.idx;
    const startJump = e.type === "start" && (b.phase === "idle" || b.phase === "finished");
    for (let k = b.idx; k < end; k++) {
      const ex = seq.steps[k].exercise;
      if (!ex) continue;
      // Closed by exercise_done earlier (its hold just ended), or this skip.
      const closedHere = k === b.idx && b.exercise?.key === ex.key && b.exercise.closed !== null;
      const ok = startJump || a.doneKeys.includes(ex.key) || closedHere || (e.type === "skip" && k === b.idx);
      if (!ok) return `left exercise ${ex.key} (step ${k}) on "${e.type}" without exercise_done or skip`;
    }
  }
  if (a.exercise && a.exercise.reminders > MAX_REMINDERS) return "more than three reminders";
  // heldMs (the screen lock's time limit, wake.ts) is the silence of one wait for "Lanjut": it is
  // counted in "ready" only, by idle ticks only, and starts over with anything else that happens.
  if (a.heldMs !== 0 && a.phase !== "ready") return `silent time counted (${a.heldMs} ms) while ${a.phase}`;
  if (a.heldMs !== 0 && e.type !== "idle_tick" && a !== b) return `${e.type} changed the state and kept the silent time (${a.heldMs} ms)`;
  if (e.type === "idle_tick" && b.phase === "ready" && JSON.stringify({ ...a, heldMs: 0 }) !== JSON.stringify({ ...b, heldMs: 0 })) {
    return "an idle tick changed more than the silent time while a caption is held";
  }
  return null;
}

type Learner = "prompt" | "lazy" | "never";

type DriveResult = { state: AutoplayState; entered: number[]; ms: number; events: number; problems: string[]; reminders: number };

/**
 * Plays a sequence to its end as the UI would (completing each activity)
 * with a simulated learner: "prompt" answers each exercise (one miss, then
 * right); "lazy" first idles 90 s; "never" idles 10 minutes, then presses
 * "Lewati latihan".
 */
export function driveToEnd(
  seq: AutoplaySequence,
  pace: Pace,
  learner: Learner,
  reciteMs: (a: Extract<Activity, { kind: "recite" }>) => number = (a) => (a.target === "ayah" ? 6000 : a.clip ? a.clip.end - a.clip.start : 900),
): DriveResult {
  let s = createAutoplayState(seq, { pace });
  const problems: string[] = [];
  const entered: number[] = [];
  let ms = 0;
  let events = 0;
  let reminders = 0;
  const stage = new Map<number, number>();
  const send = (e: AutoplayEvent) => {
    const b = s;
    s = reduceAutoplay(seq, s, e);
    events++;
    if (entered.at(-1) !== s.idx) entered.push(s.idx);
    const p = transitionProblem(seq, b, e, s);
    if (p) problems.push(`${seq.steps[b.idx].id} ${e.type}: ${p}`);
    if (s.exercise && b.exercise && s.idx === b.idx && s.exercise.reminders > b.exercise.reminders) reminders++;
  };
  send({ type: "start", reason: "fresh" });
  const budget = 50_000;
  while (s.phase !== "finished" && events < budget && problems.length < 5) {
    const a = s.activity;
    if (a) {
      ms += a.kind === "recite" ? Math.max(a.minMs, reciteMs(a)) : a.ms;
      send(endEventFor(a));
      continue;
    }
    if (s.phase === "ready") {
      send({ type: "next" });
      continue;
    }
    if (s.phase === "waiting" && s.exercise) {
      const ex = s.exercise;
      const at = s.idx;
      const n = stage.get(at) ?? 0;
      stage.set(at, n + 1);
      if (learner === "never") {
        let idle = 0;
        const before = s.idx;
        while (idle < 600_000 && events < budget) {
          if (s.activity) {
            send(endEventFor(s.activity));
            continue;
          }
          if (!wantsIdleTicks(s) && s.phase !== "waiting") break;
          send({ type: "idle_tick", ms: IDLE_TICK_MS });
          idle += IDLE_TICK_MS;
        }
        if (s.idx !== before || s.phase !== "waiting") problems.push(`${seq.steps[before].id}: moved on without the learner`);
        if (s.exercise?.reminders !== MAX_REMINDERS) problems.push(`${seq.steps[before].id}: ${s.exercise?.reminders} reminders after 10 minutes`);
        if (!s.guides.some((g) => g.target === "skip")) problems.push(`${seq.steps[before].id}: the last reminder does not point at Lewati latihan`);
        ms += idle;
        send({ type: "skip" });
        // send() reassigns s inside a closure, so TS keeps the earlier "waiting" narrowing here;
        // read the phase without it (CI tsc TS2367).
        const phaseAfterSkip: string = s.phase;
        if (s.idx !== before + 1 && phaseAfterSkip !== "finished") problems.push(`${seq.steps[before].id}: skip did not move on`);
        continue;
      }
      if (learner === "lazy" && n === 0) {
        for (let t = 0; t < 90 && events < budget; t++) {
          while (s.activity) send(endEventFor(s.activity));
          send({ type: "idle_tick", ms: IDLE_TICK_MS });
        }
        ms += 90_000;
        continue;
      }
      // The learner: the exercise reports its controls, one miss, then right.
      const parts = PARTS_OF[ex.key];
      // Dengar dan klik reports the word its question asks about: the lesson's imam recites it.
      // A wrong pick (no voice), a right one (Benar. + the explanation of question 1), then the
      // answer of question 2 shown ("Tunjukkan jawaban": Ini jawabannya. + its explanation).
      const script: AutoplayEvent[] = [
        { type: "exercise_guide", target: `exercise:${ex.key}:${parts[0]}`, word: ex.key === "tap-word" ? 1 : undefined },
        { type: "answered", key: ex.key, correct: false, question: 1 },
        { type: "answered", key: ex.key, correct: true, question: 1 },
        { type: "revealed", key: ex.key, question: 2 },
        { type: "exercise_guide", target: `exercise:${ex.key}:${parts[parts.length - 1]}` },
        { type: "exercise_done", key: ex.key },
      ];
      const step = (learner === "lazy" ? n - 1 : n);
      if (step < script.length) {
        ms += 3000;
        send(script[step]);
      } else {
        problems.push(`${seq.steps[at].id}: still waiting after exercise_done`);
        break;
      }
      continue;
    }
    problems.push(`stuck: phase ${s.phase} at ${seq.steps[s.idx].id}`);
    break;
  }
  if (s.phase !== "finished") problems.push(`did not finish (${events} events)`);
  const inOrder = entered.every((v, i) => v === i);
  if (!inOrder || entered.length !== seq.steps.length) problems.push(`steps entered ${JSON.stringify(entered)} instead of 0..${seq.steps.length - 1}`);
  return { state: s, entered, ms, events, problems, reminders };
}

/** Did this transition start shared line `key` (not continue it)? */
function startsLine(b: AutoplayState, s: AutoplayState, key: string): boolean {
  const a = s.activity;
  if (!a || (a.kind !== "narrate" && a.kind !== "read") || s.part !== 0 || s.seg !== 0) return false;
  const action = s.plan[s.at];
  if (action?.t !== "say" || !("s" in action.ref) || action.ref.s !== key) return false;
  const same = b.activity !== null && b.idx === s.idx && b.at === s.at && JSON.stringify(b.plan) === JSON.stringify(s.plan);
  return !same;
}

/** Was shared line `key` already queued in the plan (a replay, not a new line)? */
function queued(b: AutoplayState, key: string): boolean {
  return b.plan.slice(b.at).some((a) => a.t === "say" && "s" in a.ref && a.ref.s === key);
}

function randomEvent(rng: () => number, seq: AutoplaySequence, s: AutoplayState): AutoplayEvent {
  const r = rng();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const token = () => (s.activity && rng() < 0.8 ? s.activity.token : Math.floor(rng() * (s.token + 2)));
  const key = (): ExerciseKey => (s.exercise && rng() < 0.75 ? s.exercise.key : pick(EXERCISE_KEYS));
  if (r < 0.4) {
    if (s.activity && rng() < 0.85) {
      const e = endEventFor(s.activity);
      if (rng() < 0.05) return { type: s.activity.kind === "recite" ? "recite_error" : "narration_error", token: s.activity.token };
      return rng() < 0.9 ? e : { ...e, token: token() } as AutoplayEvent;
    }
    return { type: pick(["narration_end", "timer", "recite_end", "narration_error", "recite_error"] as const), token: token() };
  }
  if (r < 0.52) return { type: "idle_tick", ms: 500 + Math.floor(rng() * 25_000) };
  if (r < 0.57) return { type: "answered", key: key(), correct: rng() < 0.6, question: 1 + Math.floor(rng() * 5) };
  if (r < 0.6) return { type: "revealed", key: key(), question: rng() < 0.9 ? 1 + Math.floor(rng() * 5) : undefined };
  if (r < 0.66) {
    const t = rng();
    const word = rng() < 0.5 ? 1 + Math.floor(rng() * 5) : undefined;
    return { type: "exercise_guide", target: t < 0.08 ? null : t < 0.12 ? "skip" : `exercise:${key()}:${pick(GUIDE_PARTS)}`, word };
  }
  if (r < 0.71) return { type: "exercise_done", key: key() };
  if (r < 0.74) return { type: "skip" };
  if (r < 0.79) return { type: "pause" };
  if (r < 0.85) return { type: "resume" };
  if (r < 0.88) return { type: "prev" };
  if (r < 0.92) return { type: "next" };
  if (r < 0.94) return { type: "replay" };
  if (r < 0.97) {
    return { type: "start", from: Math.floor(rng() * seq.steps.length), reason: pick(["fresh", "restore", "continue"] as const) };
  }
  return { type: "set_pace", pace: pick(["biasa", "pelan", "tunggu"] as const) };
}

/** Property run on one seeded random event stream; returns problems. */
export function propertyRun(seq: AutoplaySequence, seed: number, length: number, pace: Pace): { problems: string[]; events: number } {
  const rng = rngOf(seed);
  const initial = createAutoplayState(seq, { pace, idx: rng() < 0.3 ? Math.floor(rng() * seq.steps.length) : 0 });
  let s = initial;
  const events: AutoplayEvent[] = [];
  const states: string[] = [];
  const problems: string[] = [];
  let stretch = { idx: -1, count: 0 };
  for (let i = 0; i < length && problems.length < 3; i++) {
    const e = randomEvent(rng, seq, s);
    const b = s;
    s = reduceAutoplay(seq, b, e);
    events.push(e);
    const json = JSON.stringify(s);
    states.push(json);
    const p = transitionProblem(seq, b, e, s);
    if (p) problems.push(`seed ${seed} event ${i} (${JSON.stringify(e)}) at ${seq.steps[b.idx].id}: ${p}`);
    if (i % 10 === 0) {
      const again = JSON.stringify(reduceAutoplay(seq, JSON.parse(JSON.stringify(b)) as AutoplayState, e));
      if (again !== json) problems.push(`seed ${seed} event ${i}: a JSON round trip of the state changes the result`);
    }
    // Reminders: at most three per idle stretch (reset when the learner acts
    // or the step changes), and a reminder line only starts when one is due
    // (or replays after resume / failed audio).
    if (!s.exercise || s.exercise.reminders === 0 || stretch.idx !== s.idx) stretch = { idx: s.idx, count: 0 };
    const grew = !!s.exercise && !!b.exercise && b.idx === s.idx && s.exercise.reminders > b.exercise.reminders;
    if (grew) stretch.count++;
    if (startsLine(b, s, "reminder") && !grew && !queued(b, "reminder")) {
      problems.push(`seed ${seed} event ${i}: a reminder started on "${e.type}" without being due`);
    }
    if (stretch.count > MAX_REMINDERS) problems.push(`seed ${seed} event ${i}: more than ${MAX_REMINDERS} reminders in one idle stretch`);
  }
  // Determinism: the same events from the same state give the same states.
  let r = initial;
  for (let i = 0; i < events.length; i++) {
    r = reduceAutoplay(seq, r, events[i]);
    if (JSON.stringify(r) !== states[i]) {
      problems.push(`seed ${seed}: replaying the same events diverged at event ${i}`);
      break;
    }
  }
  return { problems, events: events.length };
}

// ───────────────────────────── the full run ─────────────────────────────

/** A manifest giving every line of `seq` (and the shared lines) audio —
 *  to exercise the audio paths before any real narration exists. */
function syntheticManifests(seq: AutoplaySequence): { narration: NarrationManifest; shared: NarrationManifest } {
  const voice = { id: "synthetic", name: "synthetic", model: "eleven_v3" };
  const narration: NarrationManifest = { version: 0, voice, lines: {} };
  const shared: NarrationManifest = { version: 0, voice, lines: {} };
  const captions = new Map<string, string>();
  for (const s of seq.steps) for (const c of s.cues) captions.set(c.line, c.caption);
  for (const k of SHARED_KEYS) captions.set(seq.shared[k].line, seq.shared[k].caption);
  let i = 0;
  for (const [id, caption] of captions) {
    const entry = {
      text: "synthetic",
      audio: { url: `/belajar/media/narration/synthetic/${i++}.mp3`, ms: 800 + caption.length * 60, sha256: "0".repeat(64) },
    };
    (id.startsWith("shared:") ? shared : narration).lines[id] = entry;
  }
  return { narration, shared };
}

const PACES: readonly Pace[] = ["biasa", "pelan", "tunggu"];

/** One ayah's exercises from a parsed content/quiz/${slug}.json (raw JSON: no zod here; the
 *  page's loader, src/lib/quiz-content.ts, validates the same file). */
export function quizAyahOf(raw: unknown, ayah: number): QuizAyahLike {
  const ayat = (raw as { ayat?: unknown } | null)?.ayat;
  const a = Array.isArray(ayat) ? ayat.find((x) => (x as { ayah?: unknown })?.ayah === ayah) : undefined;
  const ex = (a as { exercises?: unknown } | undefined)?.exercises;
  return { exercises: Array.isArray(ex) ? (ex as QuizAyahLike["exercises"]) : [] };
}

export function runAutoplayChecks(input: CheckInput): CheckReport {
  const texts = input.texts ?? ID_TEXTS;
  const errors: string[] = [];
  const notes: string[] = [];
  const streams = input.property?.streams ?? 2;
  const length = input.property?.length ?? 150;
  const seed = input.property?.seed ?? 20261010;
  const stats: CheckReport["stats"] = {
    surahs: input.surahs.length,
    ayat: 0,
    steps: 0,
    lines: 0,
    exerciseSteps: 0,
    simulatedEvents: 0,
    minutes: {},
    examples: {},
  };

  // Word compositions and the harakat primer: replayed against the lesson
  // words' bytes (every Arabic form from its source, the last frame = the word).
  const lessonWords = new Map(input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w.ar] as const))));
  const allWords = new Map(input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => [w.loc, w] as const))));
  const composeFiles = new Map<string, ComposeFile>();
  for (const s of input.surahs) {
    const raw = input.compose?.[s.slug];
    if (raw === null || raw === undefined) continue;
    const file = raw as ComposeFile;
    if (!file || typeof file !== "object" || file.slug !== s.slug || !file.words) {
      errors.push(`content/compose/${s.slug}.json: not a composition file of ${s.slug}`);
      continue;
    }
    try {
      for (const p of composeFileProblems(file, lessonWords)) errors.push(p);
    } catch (e) {
      errors.push(`content/compose/${s.slug}.json: ${(e as Error).message}`);
    }
    composeFiles.set(s.slug, file);
  }

  const wordAt = (loc: string) => allWords.get(loc);
  const quranTokens = quranTokenSet(
    input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => w.translit))),
    input.surahs.flatMap((s) => s.ayat.map((a) => a.words.map((w) => w.translit))),
  );

  // The pronunciation dictionary: the only Arabic the narrator may say.
  let dict: ReturnType<typeof parsePronunciation>["dict"] = null;
  if (input.pronunciation === null || input.pronunciation === undefined) {
    notes.push("pipeline/authored/pronunciation.json not present: any Arabic script in narration is an error");
  } else {
    const r = parsePronunciation(input.pronunciation);
    for (const p of r.problems) errors.push(`pipeline/authored/pronunciation.json: ${p}`);
    dict = r.dict;
  }
  // Arabic a caption may show: the dictionary's display forms and the lesson
  // words' own Arabic (content bytes).
  // … and the named forms of the compositions a caption may name with the word itself
  // (validate_narration "named words": ٱسْمِ, بِٱسْمِ — content bytes, never typed).
  const composeForms = Object.values(input.compose ?? {}).flatMap((c) => {
    const words = (c as { words?: Record<string, { forms?: Record<string, { ar?: unknown }> }> } | null)?.words ?? {};
    return Object.values(words).flatMap((w) => Object.values(w?.forms ?? {}).map((f) => (typeof f?.ar === "string" ? f.ar : "")));
  });
  const allowedArabic = [
    ...(dict?.terms.map((t) => t.display) ?? []),
    ...input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => w.ar))),
    ...composeForms.filter(Boolean),
  ].join(" | ");

  // Manifests: parse + spoken-text guard + captions + marks.
  const parsed = new Map<string, NarrationManifest | null>();
  type Owner = { why: string | null; words?: readonly { loc: string }[] };
  const checkManifest = (file: string, raw: unknown, owns: (id: string) => Owner) => {
    if (raw === null || raw === undefined) return null;
    const { manifest, problems } = parseNarrationManifest(raw);
    for (const p of problems) errors.push(`${file}: ${p}`);
    if (!manifest) return null;
    const withAudio = Object.values(manifest.lines).some((l) => l.audio);
    if (withAudio && !manifest.voice) errors.push(`${file}: lines have audio but voice is null`);
    if (withAudio && manifest.voice && manifest.voice.model !== "eleven_v3") {
      errors.push(`${file}: voice.model "${manifest.voice.model}" is not the house standard eleven_v3 (plan L5)`);
    }
    for (const [id, l] of Object.entries(manifest.lines)) {
      const { why, words } = owns(id);
      if (why) errors.push(`${file}: ${id}: ${why}`);
      // A word the caption names with its Arabic is said there in Latin on purpose (named words).
      const said = namedSaid(l.display ?? "");
      for (const p of spokenTextProblems(maskNamedSaid(l.text, said), quranTokens, dict)) errors.push(`${file}: ${id}: ${p}`);
      if (l.display !== undefined) {
        for (const p of captionArabicProblems(l.display, dict, allowedArabic)) errors.push(`${file}: ${id}: display: ${p}`);
      }
      const tokens = usableTokens(l.tokens);
      if (tokens && l.audio) {
        const bad = new Set(tokens.flatMap((k) => captionArabicProblems(k.t, dict, allowedArabic)));
        for (const p of bad) errors.push(`${file}: ${id}: tokens: ${p}`);
        // Timings come from the render of this very file (1 s of slack for
        // the duration probe).
        const end = tokens[tokens.length - 1].e;
        if (end * 1000 > l.audio.ms + 1000) errors.push(`${file}: ${id}: tokens end at ${end} s, past the audio (${l.audio.ms} ms)`);
      }
      if (words) {
        for (const w of l.highlight ?? []) {
          if (w > words.length) errors.push(`${file}: ${id}: highlight names word ${w} of ${words.length}`);
        }
        if (l.highlight && l.highlight.includes(0) && l.highlight.length > 1) {
          errors.push(`${file}: ${id}: highlight [0] (the whole ayah) mixed with word numbers`);
        }
        if (typeof l.focus === "string" && !words.some((w) => w.loc === l.focus)) {
          errors.push(`${file}: ${id}: focus ${l.focus} is not a word of this ayah`);
        }
      } else if ((l.highlight?.length ?? 0) > 0 || (l.focus ?? null) !== null) {
        notes.push(`${file}: ${id}: a shared line names words to highlight (ignored: shared lines play on every ayah)`);
      }
    }
    return manifest;
  };
  const shared = checkManifest("content/narration/shared.json", input.sharedManifest, (id) => ({
    why: parseLineId(id)?.kind === "shared" ? null : "not a shared:* line id on the contract",
  }));
  if (!shared) notes.push("content/narration/shared.json not present: shared:* lines not checked (caption-only)");
  for (const s of input.surahs) {
    const m = checkManifest(`content/narration/${s.slug}.json`, input.manifests[s.slug], (id) => {
      const p = parseLineId(id);
      if (!p || p.kind !== "ayah") return { why: "not a line id on the contract" };
      if (p.slug !== s.slug) return { why: `belongs to "${p.slug}"` };
      // Lesson zero's lines are the lines of "ayah 0" of the surah that hosts it (zero.ts).
      if (p.ayah === ZERO_AYAH && hostsZero(input.compose?.[s.slug] as Parameters<typeof hostsZero>[0])) return { why: null, words: [] };
      const a = s.ayat.find((x) => x.ayah === p.ayah);
      if (!a) return { why: `ayah ${p.ayah} is not in ${s.slug}` };
      return { why: null, words: a.words };
    });
    parsed.set(s.slug, m);
    if (!m) notes.push(`content/narration/${s.slug}.json not present: ${s.slug} line ids not checked (caption-only)`);
  }

  // The curriculum (plan L26): where each step is taught. Held to the lessons (every ayah is a
  // lesson, and the lines and lists the file gives are the ones the words give), then asked for
  // what each ayah teaches.
  const curriculum = (input.curriculum ?? null) as CurriculumFile | null;
  const curriculumOk = !!curriculum && typeof curriculum === "object" && Array.isArray(curriculum.lessons) && Array.isArray(curriculum.steps) && Array.isArray(curriculum.lanjut);
  if (!curriculumOk) errors.push("content/curriculum.json: missing, or not a curriculum (run pipeline/build_curriculum.py)");
  else {
    try {
      const zero = input.surahs.some((s) => hostsZero(input.compose?.[s.slug] as Parameters<typeof hostsZero>[0]));
      for (const p of curriculumProblems(curriculum, input.surahs, input.concepts, zero)) errors.push(p);
    } catch (e) {
      errors.push(`content/curriculum.json: ${(e as Error).message}`);
    }
  }

  // The lesson maps (plan L23, L26): each held to the curriculum (what is new, learnt so far,
  // taught later and next-level is the curriculum's, never typed), then given to its surah's
  // sequences.
  const mapFiles = new Map<string, LessonMapFile>();
  for (const s of input.surahs) {
    const raw = input.maps?.[s.slug];
    if (raw === null || raw === undefined) continue;
    const file = raw as LessonMapFile;
    if (!file || typeof file !== "object" || file.slug !== s.slug || !Array.isArray(file.ayat) || !file.steps || typeof file.steps !== "object" || !file.lanjut) {
      errors.push(`content/map/${s.slug}.json: not a lesson map of ${s.slug}`);
      continue;
    }
    if (!curriculumOk) continue;
    try {
      for (const p of lessonMapProblems(file, curriculum)) errors.push(p);
    } catch (e) {
      errors.push(`content/map/${s.slug}.json: ${(e as Error).message}`);
      continue;
    }
    mapFiles.set(s.slug, file);
  }

  const referencedShared = new Set<string>();
  for (const surah of input.surahs) {
    const manifest = parsed.get(surah.slug) ?? null;
    const referenced = new Set<string>();
    stats.minutes[surah.slug] = { biasa: 0, pelan: 0, tunggu: 0 };
    // LESSON ZERO first, in the surah that hosts it (zero.ts): the lesson with no ayah — "ayah 0",
    // no word, no recitation, no exercise — checked and driven like every ayah's lesson.
    const hosted = hostsZero(composeFiles.get(surah.slug)) && surah.ayat.length > 0;
    const zeroLesson: LessonAyah | null = hosted ? { ...zeroAyah(surah.ayat[0].surah), recitation: [] } : null;
    const lessonsOf: LessonAyah[] = [...(zeroLesson ? [zeroLesson] : []), ...surah.ayat];
    for (const ayah of lessonsOf) {
      const zero = ayah === zeroLesson;
      stats.ayat++;
      const where = `${surah.slug} ${ayah.loc}`;
      const quizAyah = quizAyahOf(input.quiz?.[surah.slug], ayah.ayah);
      const exercises = availableExercises(quizAyah);
      const introduced = curriculumOk ? taughtIn(curriculum, input.concepts, ayah) : [];
      const last = ayah.ayah >= surah.ayat.length;
      const compose = composeInputFor(composeFiles.get(surah.slug), ayah);
      // The example beats (operator 2026-10-12, plan L20): derived from the content, as the page does.
      const composeFile = (composeFiles.get(surah.slug) ?? null) as ComposeLike | null;
      const voice = (ar: string) => voiceFrom(input.voices ?? { words: {} }, ar);
      const derived = lessonExamples({ ayah, introduced, compose: composeFile, voice, wordAt, zero });
      const map = lessonMapInputOf(mapFiles.get(surah.slug), ayah.ayah);
      // A lesson map names the new steps: they are this ayah's concept steps, in that order.
      if (map && JSON.stringify(map.new.map((c) => c.id)) !== JSON.stringify(introduced.map((c) => c.step))) {
        errors.push(`${where}: the lesson map's new steps differ from the steps the curriculum teaches here`);
      }
      const base: SequenceInput = {
        slug: surah.slug,
        surahName: surah.name_id,
        ayahCount: surah.ayat.length,
        ayah,
        introduced,
        exercises,
        questions: questionNumbers(quizAyah),
        texts,
        narration: manifest,
        shared,
        compose,
        examples: derived.examples,
        map,
        zero,
        voice,
      };
      const seq = buildAutoplaySequence(base);
      if (JSON.stringify(seq) !== JSON.stringify(buildAutoplaySequence(base))) errors.push(`${where}: building the sequence twice differs`);
      stats.steps += seq.steps.length;
      stats.exerciseSteps += seq.steps.filter((x) => x.kind === "exercise").length;
      for (const p of sequenceProblems(seq, { ayah, last, exercises, introduced, compose, map, zero })) errors.push(`${where}: ${p}`);
      for (const p of exampleProblems(seq, { ayah, introduced, compose: composeFile, derived, voice, wordAt, texts, zero })) {
        errors.push(`${where}: ${p}`);
      }
      for (const p of wordVoiceProblems(seq, { ayah, voice })) errors.push(`${where}: ${p}`);

      for (const id of sequenceLineIds(seq)) {
        stats.lines++;
        if (id.startsWith("shared:")) {
          referencedShared.add(id);
          if (shared && !manifestParts(shared, id)) errors.push(`${where}: ${id} missing from content/narration/shared.json`);
        } else {
          referenced.add(id);
          if (manifest && !manifestParts(manifest, id)) errors.push(`${where}: ${id} missing from content/narration/${surah.slug}.json`);
        }
      }

      // Drive it: caption-only (as the content is today) and with audio.
      // Recitation length from the imam's word timings (estimate).
      const segments = ayah.recitation[0]?.segments ?? [];
      const reciteMs = (a: Extract<Activity, { kind: "recite" }>) => {
        if (a.target === "ayah") return segments.reduce((m, [, , end]) => Math.max(m, end), 0) || 6000;
        // One word (or an example): its recording's length.
        return a.clip ? a.clip.end - a.clip.start : 900;
      };
      const synth = syntheticManifests(seq);
      const audioSeq = buildAutoplaySequence({ ...base, narration: synth.narration, shared: synth.shared });
      if (!audioSeq.hasAudio) errors.push(`${where}: synthetic audio was not attached`);
      // What the example beats add to this ayah's lesson: the same lesson with and without them.
      const bare = buildAutoplaySequence({ ...base, narration: synth.narration, shared: synth.shared, examples: null });
      const added = (pace: Pace) => driveToEnd(audioSeq, pace, "prompt", reciteMs).ms - driveToEnd(bare, pace, "prompt", reciteMs).ms;
      stats.examples[`${surah.slug}/${ayah.ayah}`] = {
        beats: seq.steps.flatMap((s) => (s.examples ?? []).map((b) => ({ id: b.id, step: s.id, key: b.key, own: b.word !== null }))),
        addedMs: { biasa: added("biasa"), pelan: added("pelan") },
        gaps: [...derived.gaps],
      };
      for (const [label, sq] of [["caption-only", seq], ["audio", audioSeq]] as const) {
        for (const pace of PACES) {
          const learners: Learner[] = pace === "biasa" ? ["prompt", "lazy", "never"] : ["prompt"];
          for (const learner of learners) {
            const r = driveToEnd(sq, pace, learner, reciteMs);
            stats.simulatedEvents += r.events;
            for (const p of r.problems) errors.push(`${where} [${label}, ${pace}, ${learner}]: ${p}`);
            if (learner === "prompt" && r.reminders > 0) errors.push(`${where} [${label}, ${pace}]: reminded a learner who answered at once`);
            if (learner === "lazy" && r.reminders !== MAX_REMINDERS * sq.steps.filter((x) => x.kind === "exercise").length) {
              errors.push(`${where} [${label}, ${pace}, lazy]: ${r.reminders} reminders, expected ${MAX_REMINDERS} per exercise`);
            }
            if (label === "caption-only" && learner === "prompt") stats.minutes[surah.slug][pace] += r.ms / 60_000;
          }
          for (let k = 0; k < streams; k++) {
            const pr = propertyRun(sq, hashSeed(`${where}/${label}/${pace}/${k}`, seed), length, pace);
            stats.simulatedEvents += pr.events;
            for (const p of pr.problems) errors.push(`${where} [${label}, ${pace}, property]: ${p}`);
          }
        }
      }
    }
    if (manifest) {
      const orphans = Object.keys(manifest.lines).filter((id) => !referenced.has(parseLineId(id)?.base ?? id));
      if (orphans.length) notes.push(`content/narration/${surah.slug}.json: ${orphans.length} line(s) no sequence plays, e.g. ${orphans.slice(0, 5).join(", ")}`);
    }
  }
  if (shared) {
    const orphans = Object.keys(shared.lines).filter((id) => !referencedShared.has(parseLineId(id)?.base ?? id));
    if (orphans.length) notes.push(`content/narration/shared.json: ${orphans.length} line(s) no sequence plays: ${orphans.join(", ")}`);
  }
  for (const m of Object.values(stats.minutes)) for (const p of PACES) m[p] = Math.round(m[p] * 10) / 10;
  return { errors, notes, stats };
}

