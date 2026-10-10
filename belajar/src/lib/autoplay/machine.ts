/**
 * The autoplay state machine: a PURE reducer over a serialisable state.
 *
 *   state = reduceAutoplay(seq, state, event)
 *
 * The UI executes `state.activity` — exactly ONE thing at a time — and
 * reports its end with the activity's token:
 *   narrate → narration_end | narration_error   (play activity.url)
 *   recite  → recite_end    | recite_error      (imam: whole ayah or word n;
 *             end only when the audio has ended AND activity.minMs passed)
 *   read    → timer   (caption-only: show the caption for activity.ms)
 *   wait    → timer   (silent pause for activity.ms)
 * When `activity` changes (new token, or null) the UI stops whatever it was
 * doing first. Because there is a single activity, narration and the imam's
 * recitation never overlap; an end event with a stale token is ignored, so
 * a late "ended" from a cancelled clip can never move the lesson on.
 *
 * Rules:
 *  - With narration audio a line advances on narration_end, plus a short
 *    settle pause; without audio, after captionMs(part, pace) per caption
 *    part. "Tunggu saya" (pace "tunggu") holds every narration caption and
 *    the end of every step until `next` (the "Lanjut" button).
 *  - Exercise steps NEVER advance by themselves: only `exercise_done` (the
 *    line playing ends, then a short hold so the learner sees the result)
 *    or `skip` ("Lewati latihan", at once) moves past them; `next` is
 *    ignored there until then (map the forward control to `skip`). The
 *    exercise reports its controls (exercise_guide): each control's prompt
 *    (shared:ex:${key}:${part}, or the ayah's own) is spoken the first time
 *    it comes up, and shown silently after that; the spotlight follows it;
 *    answers get shared:correct / shared:try_again. While waiting,
 *    `idle_tick`s add up silent time and fire a gentle reminder at 20 s,
 *    40 s and 60 s (at most 3 between two actions of the learner):
 *    shared:reminder + the current prompt; the third also offers "Lewati
 *    latihan" (shared:skip_offer, spotlight "skip").
 *  - Inside an exercise the learner only ANSWERS (operator, 2026-10-10):
 *    · Dengar dan klik reports the word its question asks about with
 *      "play"; the lesson's imam recites it (a recite activity on the
 *      stage's one, already unlocked player), then `exercise.heard` says
 *      so and the exercise offers its words;
 *    · a settled question ("next": answered right, or its answer shown —
 *      then shared:revealed is said) stays for advanceHoldMs and then
 *      `exercise.advance` counts up: the exercise moves to its next
 *      question (or finishes) by itself. Its own "Lanjut" stays as a way to
 *      go sooner. "Tunggu saya" keeps the old way: the "next" prompt and
 *      spotlight, and the learner taps Lanjut.
 *    Every action that belongs to one control carries its `part`; when the
 *    exercise reports another control, those still queued are dropped and
 *    the one playing is cut short.
 *  - pause/resume: resume says shared:resume and replays the interrupted
 *    line from its start (a caption-only line keeps its caption part; the
 *    imam's whole-ayah recitation continues where it stopped).
 *  - prev/next jump steps (keeping play/pause); after the last step the
 *    state is "finished" and `intent` says where to go (next ayah | end of
 *    the surah).
 *  - replay ("↺ Ulangi langkah ini", operator 2026-10-10) plays the current
 *    step again from its start — also from a pause, and from "Tunggu saya"'s
 *    Lanjut — and plays on from there. An exercise starts over at its first
 *    control (the stage remounts the exercise itself).
 * No clocks, no randomness: the same events give the same states.
 */
import type { Pace } from "../lessonSteps";
import {
  advanceHoldMs,
  MAX_REMINDERS,
  REMINDER_AT_MS,
  WORD_REPEAT_GAP_MS,
  readMs,
  settleAfterNarrationMs,
  settleAfterReciteMs,
} from "./timing";
import {
  EXERCISE_KEYS,
  GUIDE_PARTS,
  type AutoplaySequence,
  type AutoplayStep,
  type Cue,
  type ExerciseKey,
  type Guide,
  type GuidePart,
  type NavIntent,
  type SharedKey,
} from "./types";

/** After `exercise_done`, how long the result stays before the lesson moves on. */
export const EXERCISE_DONE_HOLD_MS = 1500;

export type Phase =
  /** Before the one "Mulai" tap (browsers allow audio only after a gesture). */
  | "idle"
  /** Executing `activity`. */
  | "running"
  /** "Tunggu saya": waiting for `next` (the "Lanjut" button). */
  | "ready"
  /** An exercise step waiting for the learner (exercise_done / skip). */
  | "waiting"
  | "paused"
  /** Past the last step; `intent` says where to go. */
  | "finished";

/** What the UI does right now — exactly one at a time. */
export type Activity =
  /** One audio file of narration line `line`: `file` is its manifest id
   *  (the line, or one of its split parts); `offsetMs` / `totalMs` place it
   *  in the whole line, for the caption clock (timing.partAt). */
  | {
      kind: "narrate";
      token: number;
      line: string;
      file: string;
      url: string;
      ms: number;
      offsetMs: number;
      totalMs: number;
    }
  | { kind: "read"; token: number; ms: number }
  | { kind: "wait"; token: number; ms: number }
  | { kind: "recite"; token: number; target: "ayah"; resume: boolean; minMs: number }
  | {
      kind: "recite";
      token: number;
      target: "word";
      word: number;
      minMs: number;
      /** The question of an exercise (Dengar dan klik): another recording
       *  starting (the learner's own replay) ends it, rather than pausing
       *  the lesson. */
      inExercise?: boolean;
    };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A step's cue (by index) or a shared line. */
export type CueRef = { c: number } | { s: SharedKey };
/** Which caption the stage shows: a cue, or the step's own caption. */
export type CaptionRef = CueRef | "step";

/** One thing a step does; a step's plan is a list of these, run in order. */
export type Action =
  | { t: "say"; ref: CueRef; from?: number; part?: GuidePart }
  | { t: "settle"; after: "narration" | "recite"; part?: GuidePart }
  | { t: "gap" }
  /** A silent pause: EXERCISE_DONE_HOLD_MS, or `ms`. */
  | { t: "hold"; ms?: number; part?: GuidePart }
  | { t: "recite"; word: number | null; show: CaptionRef | null; hold: boolean; resume: boolean; part?: GuidePart }
  /** Shows a caption without saying it (a control's prompt met again). */
  | { t: "show"; ref: CueRef; part: GuidePart }
  /** The lesson's imam has recited the exercise's word: exercise.heard. */
  | { t: "heard"; word: number; part: GuidePart }
  /** The settled question moves on: exercise.advance + 1. */
  | { t: "advance"; part: GuidePart }
  | { t: "await" };

/** The control an action belongs to, if any. */
const partOf = (a: Action | undefined): GuidePart | undefined =>
  a && "part" in a ? (a as { part?: GuidePart }).part : undefined;

export type ExerciseState = {
  key: ExerciseKey;
  /** The control the learner should use next (from exercise_guide). */
  part: GuidePart;
  /** Parts whose prompt was already spoken in this step (spoken once;
   *  reminders repeat the current one). */
  voiced: GuidePart[];
  /** Reminders since the learner last acted. */
  reminders: number;
  /** Silent waiting time since the learner last acted. */
  idleMs: number;
  /** exercise_done arrived: the step moves on after its hold. */
  closed: null | "done";
  /** The last reminder offered "Lewati latihan" (spotlight on it). */
  skipOffered: boolean;
  /** Dengar dan klik: the word (1-based) the current question asks about,
   *  as the exercise reported it with "play". */
  word: number | null;
  /** The word the lesson's imam last recited to its end in this step (the
   *  exercise offers its words once this is its question's word). */
  heard: number | null;
  /** How many times the lesson moved a settled question on (the exercise
   *  calls its own next() each time this counts up). */
  advance: number;
  /** The current question was answered right (else a settled question had
   *  its answer shown). */
  right: boolean;
};

export type AutoplayState = {
  v: 1;
  idx: number;
  phase: Phase;
  /** Phase before `pause` (resume returns to it). */
  pausedFrom: Phase | null;
  pace: Pace;
  started: boolean;
  plan: Action[];
  /** Index of the current action in `plan`. */
  at: number;
  /** Caption part shown (caption-only reading, or held in "Tunggu saya"). */
  part: number;
  /** Audio file of the current line being played (a split line has several). */
  seg: number;
  activity: Activity | null;
  /** Last token issued. */
  token: number;
  caption: CaptionRef;
  guides: Guide[];
  exercise: ExerciseState | null;
  /** Last control each exercise reported, also before its step is reached. */
  lastPart: Partial<Record<ExerciseKey, GuidePart>>;
  /** Exercises that reported done (passed when the lesson reaches them). */
  doneKeys: ExerciseKey[];
  /** Lines whose audio failed this visit: caption-only from now on. */
  noAudio: string[];
  /** Paused during the whole-ayah recitation: resume continues it. */
  resumeRecite: boolean;
  /** The imam's recording failed: paused; resume retries. */
  error: "recite" | null;
  intent: NavIntent | null;
};

export type AutoplayEvent =
  /** The one "Mulai" tap (or the automatic start after the previous ayah:
   *  reason "continue"). Honoured in "idle" and "finished" only. */
  | { type: "start"; pace?: Pace; from?: number; reason?: "fresh" | "restore" | "continue" }
  | { type: "narration_end"; token: number }
  | { type: "narration_error"; token: number }
  | { type: "recite_end"; token: number }
  | { type: "recite_error"; token: number }
  | { type: "timer"; token: number }
  /** guided.onAnswer of the exercise `key`. */
  | { type: "answered"; key: ExerciseKey; correct: boolean }
  /** guided.onGuide: the control to use next, "exercise:${key}:${part}";
   *  with "play", the word (1-based) the question asks about. */
  | { type: "exercise_guide"; target: string | null; word?: number }
  /** guided.onDone of the exercise `key`. */
  | { type: "exercise_done"; key: ExerciseKey }
  /** "Lewati latihan". */
  | { type: "skip" }
  | { type: "pause" }
  | { type: "resume" }
  /** While wantsIdleTicks(state): silent time passed, in ms. */
  | { type: "idle_tick"; ms: number }
  | { type: "prev" }
  /** "Berikutnya", and "Lanjut" in the "Tunggu saya" mode. */
  | { type: "next" }
  /** "↺ Ulangi langkah ini": the current step again, from its start. */
  | { type: "replay" }
  | { type: "set_pace"; pace: Pace };

// ───────────────────────────── helpers ─────────────────────────────

const lastIdx = (seq: AutoplaySequence) => seq.steps.length - 1;
const clampIdx = (seq: AutoplaySequence, i: number) =>
  Math.max(0, Math.min(lastIdx(seq), Number.isFinite(i) ? Math.trunc(i) : 0));
const stepOf = (seq: AutoplaySequence, s: AutoplayState): AutoplayStep => seq.steps[s.idx];

function cueOf(seq: AutoplaySequence, step: AutoplayStep, ref: CueRef): Cue {
  return "c" in ref ? step.cues[ref.c] : seq.shared[ref.s];
}

const audible = (s: AutoplayState, cue: Cue) => cue.audio.length > 0 && !s.noAudio.includes(cue.line);

const isOpen = (ex: ExerciseState | null): ex is ExerciseState => !!ex && ex.closed === null;

function narrate(s: AutoplayState, cue: Cue, seg: number): AutoplayState {
  const file = cue.audio[seg];
  const offsetMs = cue.audio.slice(0, seg).reduce((n, a) => n + a.ms, 0);
  const totalMs = cue.audio.reduce((n, a) => n + a.ms, 0);
  return issue(
    { ...s, seg },
    { kind: "narrate", line: cue.line, file: file.id, url: file.url, ms: file.ms, offsetMs, totalMs },
  );
}

/** "Tunggu saya" holds a step's own narration captions (not shared lines,
 *  and nothing inside an exercise, where the learner acts anyway). */
const holds = (s: AutoplayState, step: AutoplayStep, ref: CueRef) =>
  s.pace === "tunggu" && step.kind !== "exercise" && "c" in ref;

/** Biasa / Pelan: a settled exercise question moves on by itself. "Tunggu
 *  saya": it waits for the exercise's own Lanjut. */
const autoAdvance = (pace: Pace) => pace !== "tunggu";

function issue(s: AutoplayState, a: DistributiveOmit<Activity, "token">): AutoplayState {
  const token = s.token + 1;
  return { ...s, token, activity: { ...a, token } as Activity, phase: "running", pausedFrom: null };
}

/** say + (with audio) the settle pause after it; `part`: the exercise
 *  control both belong to (dropped when the learner moves to another). */
function sayPlan(s: AutoplayState, step: AutoplayStep, seq: AutoplaySequence, ref: CueRef, part?: GuidePart): Action[] {
  const say: Action = part ? { t: "say", ref, part } : { t: "say", ref };
  if (!audible(s, cueOf(seq, step, ref))) return [say];
  return [say, part ? { t: "settle", after: "narration", part } : { t: "settle", after: "narration" }];
}

function captionParts(seq: AutoplaySequence, step: AutoplayStep, ref: CaptionRef): { parts: string[]; line: string | null } {
  if (ref === "step") return step.cues.length ? { parts: step.cues[0].parts, line: null } : { parts: [step.caption], line: null };
  const cue = cueOf(seq, step, ref);
  return { parts: cue.parts, line: cue.line };
}

function exerciseGuides(seq: AutoplaySequence, step: AutoplayStep, ex: ExerciseState | null, pace: Pace): Guide[] {
  if (!step.exercise || !ex) return step.guides;
  if (ex.closed) return [];
  // A settled question that moves on by itself asks for no tap: nothing is
  // marked (its "Lanjut" stays usable, unmarked).
  const g = ex.part === "next" && autoAdvance(pace) ? undefined : step.exercise.guides[ex.part];
  const out: Guide[] = g ? [g] : [];
  if (ex.skipOffered) out.push(seq.skipGuide);
  return out;
}

/** How a control's prompt comes with it: said, shown silently (met again),
 *  or not at all (already queued). */
type PromptMode = "say" | "show" | "none";

/**
 * What meeting control `part` of the open exercise does, every action
 * tagged with `part`: its prompt (by `mode`); for "play", the lesson's imam
 * recites the question's word (once per word), then `heard`; for a settled
 * question ("next") in Biasa / Pelan, the hold and the move on — in
 * "Tunggu saya" its prompt, and the learner taps Lanjut.
 */
function partPlan(
  seq: AutoplaySequence,
  s: AutoplayState,
  step: AutoplayStep,
  ex: ExerciseState,
  part: GuidePart,
  mode: PromptMode,
): Action[] {
  const spec = step.exercise;
  if (!spec) return [];
  if (part === "next" && autoAdvance(s.pace)) {
    return [
      { t: "hold", ms: advanceHoldMs(s.pace, ex.right), part },
      { t: "advance", part },
    ];
  }
  const out: Action[] = [];
  const pc = spec.promptCue[part];
  if (pc !== undefined && mode === "say") out.push(...sayPlan(s, step, seq, { c: pc }, part));
  else if (pc !== undefined && mode === "show") out.push({ t: "show", ref: { c: pc }, part });
  if (part === "play" && ex.word !== null && ex.heard !== ex.word) {
    out.push(
      { t: "recite", word: ex.word, show: null, hold: false, resume: false, part },
      { t: "settle", after: "recite", part },
      { t: "heard", word: ex.word, part },
    );
  }
  return out;
}

const withLanjut = (seq: AutoplaySequence, guides: Guide[]) =>
  guides.some((g) => g.target === "lanjut") ? guides : [...guides, seq.lanjutGuide];

function planFor(seq: AutoplaySequence, s: AutoplayState, step: AutoplayStep): Action[] {
  const plan: Action[] = [];
  const say = (c: number) => plan.push(...sayPlan(s, step, seq, { c }));
  if (step.kind === "exercise" && step.exercise && s.exercise) {
    step.exercise.lead.forEach(say);
    plan.push(...partPlan(seq, s, step, s.exercise, s.exercise.part, "say"));
    plan.push({ t: "await" });
    return plan;
  }
  if (step.recite?.target === "word") {
    const word = step.recite.word;
    step.cues.forEach((_, i) => say(i));
    plan.push({ t: "recite", word, show: "step", hold: true, resume: false });
    if (s.pace === "pelan") {
      plan.push({ t: "gap" }, { t: "recite", word, show: "step", hold: false, resume: false });
    }
    plan.push({ t: "settle", after: "recite" });
    return plan;
  }
  if (step.recite?.target === "ayah") {
    const lead = step.cues[0];
    if (lead && audible(s, lead)) {
      say(0);
      plan.push({ t: "recite", word: null, show: { c: 0 }, hold: false, resume: false });
    } else {
      // Caption-only: the caption shows while the imam recites (reading is
      // not audio, so nothing overlaps), and the step lasts at least its
      // reading time.
      plan.push({ t: "recite", word: null, show: lead ? { c: 0 } : "step", hold: true, resume: false });
    }
    for (let i = 1; i < step.cues.length; i++) say(i);
    plan.push({ t: "settle", after: "recite" });
    return plan;
  }
  step.cues.forEach((_, i) => say(i));
  return plan;
}

// ───────────────────────────── transitions ─────────────────────────────

/** Starts plan[at] (or completes the step when the plan is through). */
function run(seq: AutoplaySequence, s: AutoplayState, viaNext: boolean): AutoplayState {
  const step = stepOf(seq, s);
  if (s.at >= s.plan.length) return complete(seq, s, viaNext);
  const a = s.plan[s.at];
  switch (a.t) {
    case "await":
      return { ...s, phase: "waiting", pausedFrom: null, activity: null, guides: exerciseGuides(seq, step, s.exercise, s.pace) };
    case "say": {
      const cue = cueOf(seq, step, a.ref);
      const part = Math.max(0, Math.min(a.from ?? 0, cue.parts.length - 1));
      let ex = s.exercise;
      if (ex && "s" in a.ref && a.ref.s === "skip_offer") ex = { ...ex, skipOffered: true };
      const guides =
        step.kind === "exercise" ? exerciseGuides(seq, step, ex, s.pace) : cue.guides.length ? cue.guides : step.guides;
      const base: AutoplayState = { ...s, exercise: ex, caption: a.ref, part, guides };
      if (audible(s, cue)) return narrate(base, cue, 0);
      if (holds(s, step, a.ref)) {
        return { ...base, phase: "ready", pausedFrom: null, activity: null, guides: withLanjut(seq, guides) };
      }
      return issue(base, { kind: "read", ms: readMs(cue.parts[part], s.pace) });
    }
    case "settle":
      return issue(s, {
        kind: "wait",
        ms: a.after === "recite" ? settleAfterReciteMs(s.pace) : settleAfterNarrationMs(s.pace),
      });
    case "gap":
      return issue(s, { kind: "wait", ms: WORD_REPEAT_GAP_MS });
    case "hold":
      return issue(s, { kind: "wait", ms: a.ms ?? EXERCISE_DONE_HOLD_MS });
    case "show":
      return run(seq, { ...s, caption: a.ref, part: 0, at: s.at + 1 }, viaNext);
    case "heard":
      return run(seq, { ...s, exercise: s.exercise && { ...s.exercise, heard: a.word }, at: s.at + 1 }, viaNext);
    case "advance":
      return run(
        seq,
        { ...s, exercise: s.exercise && { ...s.exercise, advance: s.exercise.advance + 1 }, at: s.at + 1 },
        viaNext,
      );
    case "recite": {
      const shown: AutoplayState = a.show === null ? s : { ...s, caption: a.show, part: 0 };
      const text = captionParts(seq, step, shown.caption).parts.join(" ");
      const minMs = a.hold && s.pace !== "tunggu" ? readMs(text, s.pace) : 0;
      if (a.word === null) return issue(shown, { kind: "recite", target: "ayah", resume: a.resume, minMs });
      return step.kind === "exercise"
        ? issue(shown, { kind: "recite", target: "word", word: a.word, minMs, inExercise: true })
        : issue(shown, { kind: "recite", target: "word", word: a.word, minMs });
    }
  }
}

/** The step's plan is through. */
function complete(seq: AutoplaySequence, s: AutoplayState, viaNext: boolean): AutoplayState {
  const step = stepOf(seq, s);
  if (step.kind === "exercise") {
    // An exercise step moves on only once exercise_done closed it (an open
    // exercise's plan ends in "await", so this is a guard; skip leaves at
    // once). The learner has just acted, so no "Lanjut" is asked for.
    return isOpen(s.exercise) ? { ...s, phase: "waiting", pausedFrom: null, activity: null } : advance(seq, s);
  }
  if (s.pace === "tunggu" && !viaNext) {
    return { ...s, phase: "ready", pausedFrom: null, activity: null, guides: withLanjut(seq, s.guides) };
  }
  return advance(seq, s);
}

function advance(seq: AutoplaySequence, s: AutoplayState): AutoplayState {
  if (s.idx >= lastIdx(seq)) return finish(seq, s);
  return enter(seq, s, s.idx + 1, { run: true, skipDone: true });
}

function finish(seq: AutoplaySequence, s: AutoplayState): AutoplayState {
  return {
    ...s,
    phase: "finished",
    pausedFrom: null,
    activity: null,
    plan: [],
    at: 0,
    part: 0,
    seg: 0,
    exercise: null,
    resumeRecite: false,
    error: null,
    intent: seq.nav,
  };
}

/**
 * Goes to step `idx`. `run` false: shows it paused. `skipDone`: pass
 * exercises that already reported done (moving forward only).
 */
function enter(
  seq: AutoplaySequence,
  s: AutoplayState,
  idx: number,
  opts: { run: boolean; skipDone: boolean; prefix?: Action[] },
): AutoplayState {
  let i = clampIdx(seq, idx);
  if (opts.run && opts.skipDone) {
    while (i < lastIdx(seq)) {
      const key = seq.steps[i].exercise?.key;
      if (!key || !s.doneKeys.includes(key)) break;
      i++;
    }
  }
  const step = seq.steps[i];
  const ex: ExerciseState | null = step.exercise
    ? {
        key: step.exercise.key,
        part: s.lastPart[step.exercise.key] ?? step.exercise.parts[0],
        voiced: [],
        reminders: 0,
        idleMs: 0,
        closed: null,
        skipOffered: false,
        word: null,
        heard: null,
        advance: 0,
        right: false,
      }
    : null;
  if (ex && step.exercise?.promptCue[ex.part] !== undefined && !(ex.part === "next" && autoAdvance(s.pace))) {
    ex.voiced = [ex.part];
  }
  const base: AutoplayState = {
    ...s,
    idx: i,
    plan: [],
    at: 0,
    part: 0,
    seg: 0,
    activity: null,
    caption: "step",
    guides: exerciseGuides(seq, step, ex, s.pace),
    exercise: ex,
    resumeRecite: false,
    error: null,
    intent: null,
  };
  const plan = [...(opts.prefix ?? []), ...planFor(seq, base, step)];
  if (!opts.run) return { ...base, plan, phase: "paused", pausedFrom: "running" };
  return run(seq, { ...base, plan }, false);
}

/** End of the current activity (its token matched). */
function onEnd(seq: AutoplaySequence, s: AutoplayState): AutoplayState {
  const a = s.plan[s.at];
  if (a?.t === "say") {
    const cue = cueOf(seq, stepOf(seq, s), a.ref);
    if (s.activity?.kind === "read" && s.part < cue.parts.length - 1) {
      const part = s.part + 1;
      return issue({ ...s, part }, { kind: "read", ms: readMs(cue.parts[part], s.pace) });
    }
    if (s.activity?.kind === "narrate" && s.seg < cue.audio.length - 1) return narrate(s, cue, s.seg + 1);
  }
  return run(seq, { ...s, at: s.at + 1, part: 0, seg: 0, activity: null }, false);
}

/** "Lanjut" in the ready phase: the next caption part, the rest of the
 *  plan, or the next step. */
function proceed(seq: AutoplaySequence, s: AutoplayState): AutoplayState {
  if (s.at < s.plan.length) {
    const a = s.plan[s.at];
    if (a.t === "say") {
      const cue = cueOf(seq, stepOf(seq, s), a.ref);
      if (s.part < cue.parts.length - 1) return { ...s, part: s.part + 1 };
    }
    return run(seq, { ...s, at: s.at + 1, part: 0, seg: 0 }, true);
  }
  return advance(seq, s);
}

function parseGuide(target: string | null): { key: ExerciseKey; part: GuidePart } | null {
  if (!target) return null;
  const m = /^exercise:([a-z-]+):([a-z]+)$/.exec(target);
  if (!m) return null;
  const key = EXERCISE_KEYS.find((k) => k === m[1]);
  const part = GUIDE_PARTS.find((p) => p === m[2]);
  return key && part ? { key, part } : null;
}

// ───────────────────────────── public API ─────────────────────────────

/** A lesson before "Mulai", optionally at a restored step. */
export function createAutoplayState(
  seq: AutoplaySequence,
  opts: { pace?: Pace; idx?: number | null } = {},
): AutoplayState {
  const idx = clampIdx(seq, opts.idx ?? 0);
  const step = seq.steps[idx];
  return {
    v: 1,
    idx,
    phase: "idle",
    pausedFrom: null,
    pace: opts.pace ?? "biasa",
    started: false,
    plan: [],
    at: 0,
    part: 0,
    seg: 0,
    activity: null,
    token: 0,
    caption: "step",
    guides: step.guides,
    exercise: null,
    lastPart: {},
    doneKeys: [],
    noAudio: [],
    resumeRecite: false,
    error: null,
    intent: null,
  };
}

export function reduceAutoplay(seq: AutoplaySequence, s: AutoplayState, e: AutoplayEvent): AutoplayState {
  switch (e.type) {
    case "start": {
      if (s.phase !== "idle" && s.phase !== "finished") return s;
      const again = s.phase === "finished";
      const from = again ? 0 : clampIdx(seq, e.from ?? s.idx);
      const reason = e.reason ?? (from > 0 ? "restore" : "fresh");
      const pace = e.pace ?? s.pace;
      const next: AutoplayState = { ...s, pace, started: true, doneKeys: again ? [] : s.doneKeys };
      const prefix =
        reason === "continue"
          ? []
          : sayPlan(next, seq.steps[from], seq, { s: reason === "restore" ? "resume" : "start" });
      return enter(seq, next, from, { run: true, skipDone: false, prefix });
    }

    case "narration_end":
    case "timer":
    case "recite_end": {
      const a = s.activity;
      if (!a || a.token !== e.token) return s;
      if (e.type === "narration_end" && a.kind !== "narrate") return s;
      if (e.type === "timer" && a.kind !== "read" && a.kind !== "wait") return s;
      if (e.type === "recite_end" && a.kind !== "recite") return s;
      return onEnd(seq, s);
    }

    case "narration_error": {
      const a = s.activity;
      if (!a || a.token !== e.token || a.kind !== "narrate") return s;
      // Missing or broken audio: this line becomes caption-only (from its start).
      return run(seq, { ...s, activity: null, part: 0, seg: 0, noAudio: [...s.noAudio, a.line] }, false);
    }

    case "recite_error": {
      const a = s.activity;
      if (!a || a.token !== e.token || a.kind !== "recite") return s;
      return { ...s, phase: "paused", pausedFrom: "running", activity: null, resumeRecite: false, error: "recite" };
    }

    case "answered": {
      const step = stepOf(seq, s);
      const ex = s.exercise;
      if (!isOpen(ex) || step.exercise?.key !== e.key) return s;
      const ex2: ExerciseState = { ...ex, reminders: 0, idleMs: 0, skipOffered: false, right: ex.right || e.correct };
      if (s.phase !== "running" && s.phase !== "waiting") return { ...s, exercise: ex2 };
      // The imam's word still to come for this control (a pick before he
      // finished) plays after the feedback line; a right answer moves the
      // exercise to "next", which drops it.
      const rest = s.plan.slice(s.at);
      const from = rest.findIndex((a) => a.t === "recite" && partOf(a) === ex.part);
      const keep = from === -1 ? [] : rest.slice(from).filter((a) => a.t !== "await" && partOf(a) === ex.part);
      const plan: Action[] = [...sayPlan(s, step, seq, { s: e.correct ? "correct" : "try_again" }), ...keep, { t: "await" }];
      return run(seq, { ...s, exercise: ex2, plan, at: 0, part: 0, seg: 0, activity: null }, false);
    }

    case "exercise_guide": {
      const g = parseGuide(e.target);
      if (!g) return s;
      const lastPart = s.lastPart[g.key] === g.part ? s.lastPart : { ...s.lastPart, [g.key]: g.part };
      const unchanged = lastPart === s.lastPart ? s : { ...s, lastPart };
      const step = stepOf(seq, s);
      const ex = s.exercise;
      const spec = step.exercise;
      if (!isOpen(ex) || !spec || spec.key !== g.key) return unchanged;
      const word =
        g.part === "play" && typeof e.word === "number" && Number.isInteger(e.word) && e.word > 0 ? e.word : null;
      const samePart = ex.part === g.part;
      // The same control again: only a new question's word changes anything.
      if (samePart && (word === null || word === ex.word)) return unchanged;
      const first =
        !samePart &&
        !ex.voiced.includes(g.part) &&
        spec.promptCue[g.part] !== undefined &&
        !(g.part === "next" && autoAdvance(s.pace));
      const ex2: ExerciseState = {
        ...ex,
        part: g.part,
        word: g.part === "play" ? (word ?? (samePart ? ex.word : null)) : ex.word,
        reminders: samePart ? ex.reminders : 0,
        idleMs: samePart ? ex.idleMs : 0,
        skipOffered: samePart ? ex.skipOffered : false,
        // A new question (or two misses) starts unanswered.
        right: samePart || g.part === "next" ? ex.right : false,
        voiced: first ? [...ex.voiced, g.part] : ex.voiced,
      };
      const base: AutoplayState = { ...s, lastPart, exercise: ex2, guides: exerciseGuides(seq, step, ex2, s.pace) };
      // A settled question whose answer was SHOWN (not answered right) says
      // so, like "Benar." (untagged feedback: it finishes even if the
      // learner moves on at once).
      const revealed: Action[] = g.part === "next" && !samePart && !ex.right ? sayPlan(s, step, seq, { s: "revealed" }) : [];
      const lines = [...revealed, ...partPlan(seq, base, step, ex2, g.part, samePart ? "none" : first ? "say" : "show")];
      const stale = (a: Action | undefined) => {
        const p = partOf(a);
        return p !== undefined && p !== g.part;
      };
      if (s.phase === "waiting") {
        return run(seq, { ...base, plan: [...lines, { t: "await" }], at: 0, part: 0, seg: 0 }, false);
      }
      if (s.phase !== "running") {
        // Paused: note it, and plan the new control after what was left
        // (resume replays from there).
        const kept = s.plan.slice(s.at).filter((a) => !stale(a) && a.t !== "await");
        return { ...base, plan: [...s.plan.slice(0, s.at), ...kept, ...lines, { t: "await" }] };
      }
      // Speaking or reciting. What belongs to an older control is stale: the
      // one playing is cut short, the queued ones dropped; anything else (the
      // introduction, a feedback line) finishes first, then these lines.
      const queued = s.plan.slice(s.at + 1).filter((a) => !stale(a) && a.t !== "await");
      if (stale(s.plan[s.at])) {
        const plan: Action[] = [...s.plan.slice(0, s.at), ...queued, ...lines, { t: "await" }];
        return run(seq, { ...base, plan, part: 0, seg: 0, activity: null }, false);
      }
      return { ...base, plan: [...s.plan.slice(0, s.at + 1), ...queued, ...lines, { t: "await" }] };
    }

    case "exercise_done": {
      const doneKeys = s.doneKeys.includes(e.key) ? s.doneKeys : [...s.doneKeys, e.key];
      const step = stepOf(seq, s);
      const ex = s.exercise;
      if (!isOpen(ex) || step.exercise?.key !== e.key || s.phase === "idle" || s.phase === "finished") {
        return doneKeys === s.doneKeys ? s : { ...s, doneKeys };
      }
      const base: AutoplayState = { ...s, doneKeys, exercise: { ...ex, closed: "done", skipOffered: false }, guides: [] };
      if (s.phase === "paused") return { ...base, plan: [{ t: "hold" }], at: 0, part: 0, seg: 0, resumeRecite: false };
      const current = s.plan[s.at];
      if (s.phase === "running" && s.activity && current?.t === "say" && partOf(current) === undefined) {
        // Let the line that is playing (e.g. "Benar.") finish first.
        return { ...base, plan: [current, { t: "hold" }], at: 0 };
      }
      return run(seq, { ...base, plan: [{ t: "hold" }], at: 0, part: 0, seg: 0, activity: null }, false);
    }

    case "skip": {
      if (s.phase === "idle" || s.phase === "finished") return s;
      if (stepOf(seq, s).kind !== "exercise") return s;
      return advance(seq, s);
    }

    case "pause": {
      if (s.phase !== "running" && s.phase !== "ready" && s.phase !== "waiting") return s;
      const a = s.activity;
      return {
        ...s,
        phase: "paused",
        pausedFrom: s.phase,
        activity: null,
        resumeRecite: a?.kind === "recite" && a.target === "ayah",
      };
    }

    case "resume": {
      if (s.phase !== "paused") return s;
      const step = stepOf(seq, s);
      if (s.error === null && s.pausedFrom === "ready") {
        return { ...s, phase: "ready", pausedFrom: null, guides: withLanjut(seq, s.guides) };
      }
      let rest = s.plan.slice(s.at);
      const head = rest[0];
      const ex = s.exercise;
      if (step.kind === "exercise" && isOpen(ex) && (head === undefined || head.t === "await")) {
        // Waiting in an exercise: say where we are again (and recite the
        // question's word if it has not been heard).
        rest = [...partPlan(seq, s, step, ex, ex.part, "say"), { t: "await" }];
      } else if (head?.t === "say" && !audible(s, cueOf(seq, step, head.ref))) {
        rest = [{ ...head, from: s.part }, ...rest.slice(1)]; // caption-only: keep the part
      } else if (head?.t === "recite" && head.word === null && s.resumeRecite) {
        rest = [{ ...head, resume: true }, ...rest.slice(1)]; // the imam continues
      }
      const plan = [...sayPlan(s, step, seq, { s: "resume" }), ...rest];
      return run(seq, { ...s, plan, at: 0, part: 0, seg: 0, activity: null, error: null, resumeRecite: false }, false);
    }

    case "idle_tick": {
      const ex = s.exercise;
      if (s.phase !== "waiting" || s.activity || !isOpen(ex)) return s;
      if (!(e.ms > 0) || !Number.isFinite(e.ms)) return s;
      const idleMs = ex.idleMs + e.ms;
      if (ex.reminders >= MAX_REMINDERS || idleMs < REMINDER_AT_MS[ex.reminders]) {
        return { ...s, exercise: { ...ex, idleMs } };
      }
      const reminders = ex.reminders + 1;
      const step = stepOf(seq, s);
      const s2: AutoplayState = { ...s, exercise: { ...ex, idleMs, reminders } };
      const plan: Action[] = [
        ...sayPlan(s2, step, seq, { s: "reminder" }),
        ...partPlan(seq, s2, step, ex, ex.part, "say"),
        ...(reminders === MAX_REMINDERS ? sayPlan(s2, step, seq, { s: "skip_offer" }) : []),
        { t: "await" },
      ];
      return run(seq, { ...s2, plan, at: 0, part: 0, seg: 0 }, false);
    }

    case "prev": {
      if (s.phase === "idle") return s;
      const to = s.phase === "finished" ? s.idx : Math.max(0, s.idx - 1);
      return enter(seq, s, to, { run: s.phase !== "paused", skipDone: false });
    }

    case "replay": {
      if (s.phase === "idle" || s.phase === "finished") return s;
      // An exercise starts over at its first control: forget the one it last
      // reported (the remounted exercise reports its first control again).
      const key = stepOf(seq, s).exercise?.key;
      let lastPart = s.lastPart;
      if (key && lastPart[key] !== undefined) {
        lastPart = {};
        for (const k of EXERCISE_KEYS) {
          const part = s.lastPart[k];
          if (k !== key && part !== undefined) lastPart[k] = part;
        }
      }
      return enter(seq, { ...s, lastPart }, s.idx, { run: true, skipDone: false });
    }

    case "next": {
      if (s.phase === "idle" || s.phase === "finished") return s;
      const step = stepOf(seq, s);
      // Forward from an open exercise is "Lewati latihan" (skip), never next.
      if (step.kind === "exercise" && isOpen(s.exercise)) return s;
      if (s.phase === "ready") return proceed(seq, s);
      if (s.idx >= lastIdx(seq)) return finish(seq, s);
      const play = s.phase !== "paused";
      return enter(seq, s, s.idx + 1, { run: play, skipDone: play });
    }

    case "set_pace": {
      if (e.pace === s.pace) return s;
      const next: AutoplayState = { ...s, pace: e.pace };
      const step = stepOf(seq, s);
      const ex = s.exercise;
      if (step.kind === "exercise" && isOpen(ex) && ex.part === "next" && autoAdvance(s.pace) !== autoAdvance(e.pace)) {
        // A settled question: Biasa / Pelan move it on by themselves, "Tunggu
        // saya" asks for its Lanjut. Replace what was planned for it.
        const guides = exerciseGuides(seq, step, ex, e.pace);
        const lines = partPlan(seq, next, step, ex, "next", "say");
        const isNext = (a: Action | undefined) => partOf(a) === "next";
        if (s.phase === "waiting") {
          return run(seq, { ...next, guides, plan: [...lines, { t: "await" }], at: 0, part: 0, seg: 0 }, false);
        }
        const queued = s.plan.slice(s.at + 1).filter((a) => !isNext(a) && a.t !== "await");
        if (s.phase === "running" && isNext(s.plan[s.at])) {
          const plan: Action[] = [...s.plan.slice(0, s.at), ...queued, ...lines, { t: "await" }];
          return run(seq, { ...next, guides, plan, part: 0, seg: 0, activity: null }, false);
        }
        if (s.phase === "running") {
          return { ...next, guides, plan: [...s.plan.slice(0, s.at + 1), ...queued, ...lines, { t: "await" }] };
        }
        const kept = s.plan.slice(s.at).filter((a) => !isNext(a) && a.t !== "await");
        return { ...next, guides, plan: [...s.plan.slice(0, s.at), ...kept, ...lines, { t: "await" }] };
      }
      if (s.phase !== "ready" || e.pace === "tunggu") return next;
      // Leaving "Tunggu saya" while a caption is held: read it on.
      if (s.at < s.plan.length) {
        const a = s.plan[s.at];
        if (a.t === "say") {
          const plan = [...s.plan];
          plan[s.at] = { ...a, from: s.part };
          return run(seq, { ...next, plan }, false);
        }
        return run(seq, next, false);
      }
      return advance(seq, next);
    }
  }
}

// ───────────────────────────── selectors ─────────────────────────────

/** Should the UI send `idle_tick`s now? (An exercise waits in silence.) */
export function wantsIdleTicks(s: AutoplayState): boolean {
  return (
    s.phase === "waiting" &&
    s.activity === null &&
    isOpen(s.exercise) &&
    s.exercise.reminders < MAX_REMINDERS
  );
}

export const isAudioActivity = (a: Activity | null): boolean => a?.kind === "narrate" || a?.kind === "recite";

export type AutoplayView = {
  step: AutoplayStep;
  /** 0-based index and count, for "Langkah n dari N". */
  index: number;
  total: number;
  phase: Phase;
  started: boolean;
  /** The caption to show: with narration audio pick the part by the audio
   *  clock (timing.partAt); otherwise `part`. */
  caption: { parts: string[]; part: number; line: string | null };
  guides: Guide[];
  /** Word the stage shows and marks on the mushaf line (1-based). */
  focusWord: number | null;
  /** Other words the line on screen names by their place ("kata kedua").
   *  The stage marks the line's Cue.highlight instead (which defaults to
   *  these for lines without a kind of their own). */
  refWords: number[];
  activity: Activity | null;
  canPrev: boolean;
  /** False on an exercise step: forward there is "Lewati latihan". */
  canNext: boolean;
  showSkip: boolean;
  /** "Tunggu saya": show "Lanjut" (dispatch `next`). */
  showLanjut: boolean;
  error: "recite" | null;
  intent: NavIntent | null;
};

export function viewAutoplay(seq: AutoplaySequence, s: AutoplayState): AutoplayView {
  const step = stepOf(seq, s);
  const { parts, line } = captionParts(seq, step, s.caption);
  const live = s.started && s.phase !== "idle" && s.phase !== "finished";
  const openExercise = step.kind === "exercise" && isOpen(s.exercise);
  return {
    step,
    index: s.idx,
    total: seq.steps.length,
    phase: s.phase,
    started: s.started,
    caption: { parts, part: Math.min(s.part, parts.length - 1), line },
    guides: s.guides,
    focusWord: step.word ?? null,
    refWords: s.caption !== "step" && "c" in s.caption ? (step.cues[s.caption.c]?.refs ?? []) : [],
    activity: s.activity,
    canPrev: live,
    canNext: live && !openExercise,
    showSkip: live && openExercise,
    showLanjut: s.phase === "ready",
    error: s.error,
    intent: s.intent,
  };
}

/** URLs of the narration audio this step can still play, in order — for
 *  the UI to preload the next files (same-origin only). */
export function upcomingAudio(seq: AutoplaySequence, s: AutoplayState): string[] {
  const step = stepOf(seq, s);
  const out: string[] = [];
  for (const a of s.plan.slice(s.at)) {
    if (a.t !== "say") continue;
    const cue = cueOf(seq, step, a.ref);
    if (audible(s, cue)) for (const f of cue.audio) if (!out.includes(f.url)) out.push(f.url);
  }
  return out;
}
