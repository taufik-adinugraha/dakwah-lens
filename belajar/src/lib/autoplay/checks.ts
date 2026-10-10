/**
 * Deterministic checks of the autoplay engine over EVERY ayah of every
 * surah — run by `npx --yes tsx@4.19.2 scripts/autoplay-check.ts` (no
 * node_modules needed) and in CI by autoplay.test.ts and stage.test.ts:
 *
 *  1. sequences: non-empty, in lesson order, unique step ids, every caption
 *     non-empty with no Arabic script and ≤ 180 characters per part, line
 *     ids on the contract, the right exercises, the last ayah ends "done";
 *  2. narration manifests, IF they exist: every line the sequences play is
 *     there, ids are well-formed, spoken text never carries Arabic script or
 *     a transliterated Qur'anic word (nor digits, ALL CAPS, "kamu"), audio
 *     is same-origin; missing manifests are skipped and reported as notes;
 *  3. the machine, driven to the end in every pace, caption-only and with
 *     (synthetic) audio: every step is entered once in order, exercises
 *     wait for the learner, the navigation intent is right;
 *  4. property runs on seeded random event streams: an exercise step never
 *     moves on without exercise_done/skip, stale end events change nothing,
 *     one activity at a time (narration and the imam never overlap),
 *     reminders ≤ 3 per idle stretch, states survive a JSON round trip, the
 *     same events give the same states.
 * Pure: file access is injected (loadCheckInput).
 */
import type { Ayah, Concept, Lexeme } from "@/content/schema";

import { MAX_CAPTION, type Pace } from "../lessonSteps";
import { SURAH_SLUGS } from "../routes";
import { availableExercises, orderRecitations, timedWords } from "./exercises";
import { LINE_ID_RE, manifestParts, parseLineId, promptLineId } from "./ids";
import {
  createAutoplayState,
  reduceAutoplay,
  wantsIdleTicks,
  type Activity,
  type AutoplayEvent,
  type AutoplayState,
} from "./machine";
import { hasArabicScript, parseNarrationManifest, quranTokenSet, spokenTextProblems } from "./narration";
import { buildAutoplaySequence, introducedConcepts, sequenceLineIds, type SequenceInput } from "./sequence";
import { ID_TEXTS } from "./texts";
import { IDLE_TICK_MS, MAX_REMINDERS } from "./timing";
import {
  EXERCISE_KEYS,
  GUIDE_PARTS,
  PARTS_OF,
  SHARED_KEYS,
  type AutoplaySequence,
  type AutoplayTexts,
  type ExerciseKey,
  type NarrationManifest,
} from "./types";

export type CheckSurah = { slug: string; name_id: string; ayat: readonly Ayah[] };

export type CheckInput = {
  surahs: readonly CheckSurah[];
  concepts: readonly Concept[];
  lexicon: readonly Pick<Lexeme, "id" | "tashrif">[];
  /** Parsed content/narration/${slug}.json per slug; null/absent = no file. */
  manifests: Readonly<Record<string, unknown>>;
  /** Parsed content/narration/shared.json; null = no file. */
  sharedManifest: unknown;
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
  };
};

// ───────────────────────────── loading ─────────────────────────────

/**
 * Builds the check input from files, `read(relativePath)` returning the
 * text or null when the file does not exist (paths relative to content/).
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
  for (const slug of SURAH_SLUGS) {
    const s = json(`${slug}.json`, true) as CheckSurah | null;
    if (s) surahs.push(s);
    manifests[slug] = json(`narration/${slug}.json`, false);
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
  ctx: { ayah: Pick<Ayah, "words">; last: boolean; exercises: readonly ExerciseKey[]; introduced: readonly { id: string }[] },
): string[] {
  const out: string[] = [];
  const steps = seq.steps;
  if (steps.length === 0) return ["the sequence is empty"];
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) out.push("step ids are not unique");
  if (steps[0].kind !== "intro") out.push("does not open with the intro");
  if (steps[1]?.kind !== "recite_ayah") out.push("the imam does not recite the ayah second");

  // Every word: recite_word then explain, in order.
  const wordSteps = steps.filter((s) => s.kind === "recite_word" || s.kind === "explain");
  const expected = ctx.ayah.words.flatMap((_, i) => [`w${i + 1}:recite`, `w${i + 1}`]);
  if (JSON.stringify(wordSteps.map((s) => s.id)) !== JSON.stringify(expected)) out.push("word steps are not recite+explain per word in order");
  for (const s of steps) {
    if (s.kind === "recite_word" && (s.recite?.target !== "word" || s.recite.word !== s.word)) out.push(`${s.id}: recites the wrong thing`);
    if ((s.kind === "recite_ayah" || s.kind === "recap") && s.recite?.target !== "ayah") out.push(`${s.id}: the imam does not recite the ayah`);
  }

  const order = steps.map((s) => s.kind);
  const lastWord = order.lastIndexOf("explain");
  const firstAfter = (k: string) => order.indexOf(k as (typeof order)[number]);
  for (const k of ["structure", "concept", "exercise", "recap"]) {
    const i = firstAfter(k);
    if (i !== -1 && i < lastWord) out.push(`${k} comes before the words are explained`);
  }
  const concepts = steps.filter((s) => s.kind === "concept").map((s) => s.id);
  if (JSON.stringify(concepts) !== JSON.stringify(ctx.introduced.map((c) => `concept:${c.id}`))) out.push("concept steps differ from the concepts introduced here");
  const ex = steps.filter((s) => s.kind === "exercise").map((s) => s.exercise?.key);
  if (JSON.stringify(ex) !== JSON.stringify([...ctx.exercises])) out.push(`exercise steps ${JSON.stringify(ex)} differ from the page's ${JSON.stringify(ctx.exercises)}`);
  const structureAt = firstAfter("structure");
  const conceptAt = firstAfter("concept");
  // The lesson page's order (lessonSteps) and the narration's: the structure
  // line uses the terms the concept lines introduce.
  if (structureAt !== -1 && conceptAt !== -1 && structureAt < order.lastIndexOf("concept")) out.push("the structure comes before the new concepts");
  const firstEx = firstAfter("exercise");
  if (firstEx !== -1 && (conceptAt > firstEx || structureAt > firstEx)) out.push("an exercise comes before the explanations");
  if (order.at(-2) !== "recap") out.push("the recap is not the second-to-last step");
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
  for (const s of steps) {
    if (!s.caption.trim()) out.push(`${s.id}: empty caption`);
    if (hasArabicScript(s.caption)) out.push(`${s.id}: Arabic script in the caption`);
    if (JSON.stringify(s.lines) !== JSON.stringify(s.cues.map((c) => c.line))) out.push(`${s.id}: lines differ from cues`);
    if (s.kind !== "recite_word" && s.cues.length === 0) out.push(`${s.id}: no narration line`);
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
        if (hasArabicScript(part)) out.push(`${s.id}: ${c.line} has Arabic script in its caption`);
      }
      if (c.parts.join(" ") !== c.caption) out.push(`${s.id}: ${c.line} caption parts do not rejoin to the caption`);
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
    }
  }
  for (const k of SHARED_KEYS) {
    const c = seq.shared[k];
    if (c.line !== `shared:${k}` || !c.caption.trim() || hasArabicScript(c.caption)) out.push(`shared:${k}: bad shared cue`);
  }
  if (!seq.shared.skip_offer.guides.some((g) => g.target === "skip")) out.push("the skip offer does not point at Lewati latihan");
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
  reciteMs: (a: Extract<Activity, { kind: "recite" }>) => number = (a) => (a.target === "ayah" ? 6000 : 900),
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
        if (s.idx !== before + 1 && s.phase !== "finished") problems.push(`${seq.steps[before].id}: skip did not move on`);
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
      // Dengar dan ketuk reports the word its question asks about: the lesson's imam recites it.
      const script: AutoplayEvent[] = [
        { type: "exercise_guide", target: `exercise:${ex.key}:${parts[0]}`, word: ex.key === "tap-word" ? 1 : undefined },
        { type: "answered", key: ex.key, correct: false },
        { type: "answered", key: ex.key, correct: true },
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
  if (r < 0.6) return { type: "answered", key: key(), correct: rng() < 0.6 };
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
  if (r < 0.94) return { type: "next" };
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

export function runAutoplayChecks(input: CheckInput): CheckReport {
  const texts = input.texts ?? ID_TEXTS;
  const errors: string[] = [];
  const notes: string[] = [];
  const streams = input.property?.streams ?? 2;
  const length = input.property?.length ?? 150;
  const seed = input.property?.seed ?? 20261010;
  const lexeme = new Map(input.lexicon.map((l) => [l.id, l]));
  const stats: CheckReport["stats"] = {
    surahs: input.surahs.length,
    ayat: 0,
    steps: 0,
    lines: 0,
    exerciseSteps: 0,
    simulatedEvents: 0,
    minutes: {},
  };

  const quranTokens = quranTokenSet(
    input.surahs.flatMap((s) => s.ayat.flatMap((a) => a.words.map((w) => w.translit))),
    input.surahs.flatMap((s) => s.ayat.map((a) => a.words.map((w) => w.translit))),
  );

  // Manifests: parse + spoken-text guard.
  const parsed = new Map<string, NarrationManifest | null>();
  const checkManifest = (file: string, raw: unknown, owns: (id: string) => string | null) => {
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
      const why = owns(id);
      if (why) errors.push(`${file}: ${id}: ${why}`);
      for (const p of spokenTextProblems(l.text, quranTokens)) errors.push(`${file}: ${id}: ${p}`);
    }
    return manifest;
  };
  const shared = checkManifest("content/narration/shared.json", input.sharedManifest, (id) =>
    parseLineId(id)?.kind === "shared" ? null : "not a shared:* line id on the contract",
  );
  if (!shared) notes.push("content/narration/shared.json not present: shared:* lines not checked (caption-only)");
  for (const s of input.surahs) {
    const m = checkManifest(`content/narration/${s.slug}.json`, input.manifests[s.slug], (id) => {
      const p = parseLineId(id);
      if (!p || p.kind !== "ayah") return "not a line id on the contract";
      if (p.slug !== s.slug) return `belongs to "${p.slug}"`;
      if (!s.ayat.some((a) => a.ayah === p.ayah)) return `ayah ${p.ayah} is not in ${s.slug}`;
      return null;
    });
    parsed.set(s.slug, m);
    if (!m) notes.push(`content/narration/${s.slug}.json not present: ${s.slug} line ids not checked (caption-only)`);
  }

  const referencedShared = new Set<string>();
  for (const surah of input.surahs) {
    const manifest = parsed.get(surah.slug) ?? null;
    const referenced = new Set<string>();
    stats.minutes[surah.slug] = { biasa: 0, pelan: 0, tunggu: 0 };
    for (const ayah of surah.ayat) {
      stats.ayat++;
      const where = `${surah.slug} ${ayah.loc}`;
      const exercises = availableExercises({ words: ayah.words, timed: timedWords(ayah), lexeme: (id) => lexeme.get(id) });
      const introduced = introducedConcepts(input.concepts, ayah.loc);
      const last = ayah.ayah >= surah.ayat.length;
      const base: SequenceInput = {
        slug: surah.slug,
        surahName: surah.name_id,
        ayahCount: surah.ayat.length,
        ayah,
        introduced,
        exercises,
        texts,
        narration: manifest,
        shared,
      };
      const seq = buildAutoplaySequence(base);
      if (JSON.stringify(seq) !== JSON.stringify(buildAutoplaySequence(base))) errors.push(`${where}: building the sequence twice differs`);
      stats.steps += seq.steps.length;
      stats.exerciseSteps += seq.steps.filter((x) => x.kind === "exercise").length;
      for (const p of sequenceProblems(seq, { ayah, last, exercises, introduced })) errors.push(`${where}: ${p}`);

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
      // Recitation length from the default reciter's word timings (estimate).
      const segments = orderRecitations(ayah.recitation)[0]?.segments ?? [];
      const reciteMs = (a: Extract<Activity, { kind: "recite" }>) => {
        if (a.target === "ayah") return segments.reduce((m, [, , end]) => Math.max(m, end), 0) || 6000;
        const seg = segments.find(([w]) => w === a.word);
        return seg ? seg[2] - seg[1] : 900;
      };
      const synth = syntheticManifests(seq);
      const audioSeq = buildAutoplaySequence({ ...base, narration: synth.narration, shared: synth.shared });
      if (!audioSeq.hasAudio) errors.push(`${where}: synthetic audio was not attached`);
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

