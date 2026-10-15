/**
 * The autoplay state machine: a PURE reducer over a serialisable state.
 *
 *   state = reduceAutoplay(seq, state, event)
 *
 * The UI executes `state.activity` — exactly ONE thing at a time — and
 * reports its end with the activity's token:
 *   narrate → narration_end | narration_error   (play activity.url)
 *   recite  → recite_end    | recite_error      (the imam: the whole ayah; or ONE
 *             word — word n of this ayah, or an example beat's word or form
 *             of another ayah — as the narrator's recording of it (`clip`;
 *             operator 2026-10-14, never a cut of the imam's recitation);
 *             end only when the audio has ended AND activity.minMs passed)
 *   read    → timer   (caption-only: show the caption for activity.ms)
 *   wait    → timer   (silent pause for activity.ms)
 * When `activity` changes (new token, or null) the UI stops whatever it was
 * doing first. Because there is a single activity, narration, the imam's
 * recitation and a word's recording never overlap; an end event with a stale token is ignored, so
 * a late "ended" from a cancelled clip can never move the lesson on.
 *
 * Rules:
 *  - With narration audio a line advances on narration_end, plus a short
 *    settle pause; without audio, after captionMs(part, pace) per caption
 *    part. "Tunggu saya" (pace "tunggu") holds every narration caption and
 *    the end of every step until `next` (the "Lanjut" button).
 *  - A WORD IS RECITED ONCE, when its part of the lesson opens ("w${n}:recite";
 *    "Pelan": twice there, with a gap), and the lesson then explains it and
 *    goes straight on to the next word (operator 2026-10-13: "when transation
 *    from word X to X+1, i think we dont need to recite the X, just directly to
 *    X+1"; plan L24). The word is the narrator's recording of it (the
 *    sequence's wordVoices; operator 2026-10-14), and its step ends with that
 *    recording and the pause after it when the narrator's voice explains the
 *    word next (wordVoiced); only where that line is caption-only does its
 *    caption keep a reading time (timing.ts: what the word waits for). EXCEPT
 *    THE AYAH'S LAST WORD: the last line of its composition says the
 *    recitation stops on it and what is not heard there, and no next word
 *    follows — so it is heard once more right after that line (its step
 *    carries `recite`; sequence.ts), the line still the caption and the joined
 *    word still on screen, for as long as the word and the pause after it
 *    ("Pelan": twice). No reading time there in any lesson: no new caption appears.
 *  - Exercise steps NEVER advance by themselves: only `exercise_done` (the
 *    line playing ends, then a short hold so the learner sees the result)
 *    or `skip` ("Lewati latihan", at once) moves past them; `next` is
 *    ignored there until then (map the forward control to `skip`). The
 *    exercise reports its controls (exercise_guide): each control's prompt
 *    (shared:ex:${key}:${part}, or the ayah's own) is spoken the first time
 *    it comes up, and shown silently after that; the spotlight follows it.
 *    Feedback is voiced for the CORRECT answer only (operator 2026-10-10:
 *    "give narration/voice only for the correct answer, to give auditory
 *    explanation"): a right answer says shared:correct and then the
 *    explanation of that question's answer (the step's
 *    "${slug}:${ayah}:ex:${key}:${n}:why" cue); "Tunjukkan jawaban"
 *    (`revealed`) says shared:revealed and the same explanation; a wrong pick
 *    says nothing and changes nothing that plays (the exercise shows its
 *    "Belum tepat" note) — it only counts as the learner acting. While waiting,
 *    `idle_tick`s add up silent time and fire a gentle reminder at 20 s,
 *    40 s and 60 s (at most 3 between two actions of the learner):
 *    shared:reminder + the current prompt; the third also offers "Lewati
 *    latihan" (shared:skip_offer, spotlight "skip"). After the third the
 *    ticks are only counted, up to SCREEN_IDLE_LIMIT_MS: nothing more is
 *    said or shown; the screen lock is let go there (wake.ts).
 *  - While "Tunggu saya" holds a caption for "Lanjut" (phase "ready"),
 *    `idle_tick`s add up `heldMs`, to the same limit and for the same lock
 *    only: the lesson never reads it, and waits for "Lanjut" as long as the
 *    learner likes. Any other event that changes the state starts it over.
 *  - Inside an exercise the learner only ANSWERS (operator, 2026-10-10):
 *    · Dengar dan klik reports the word its question asks about with
 *      "play"; the lesson plays that word's recording by the narrator (a
 *      recite activity on the lesson's example player, unlocked in the
 *      "Mulai" tap), then `exercise.heard` says so and the exercise offers
 *      its words;
 *    · a settled question ("next": answered right, or its answer shown) stays,
 *      after its feedback and explanation, for advanceHoldMs and then
 *      `exercise.advance` counts up: the exercise moves to its next
 *      question (or finishes) by itself. Its own "Lanjut" stays as a way to
 *      go sooner. "Tunggu saya" keeps the old way: the "next" prompt and
 *      spotlight, and the learner taps Lanjut.
 *    Every action that belongs to one control carries its `part`; when the
 *    exercise reports another control, those still queued are dropped and
 *    the one playing is cut short.
 *  - pause/resume: resume says shared:resume and replays the interrupted
 *    line from its start (a caption-only line keeps its caption part; the
 *    imam's whole-ayah recitation continues where it stopped). A recording
 *    that failed pauses the lesson (`error`: "recite", the imam's ayah;
 *    "word", a word's recording); resume tries it again.
 *  - prev/next jump steps (keeping play/pause); after the last step the
 *    state is "finished" and `intent` says where to go (next ayah | end of
 *    the surah). ON A STEP WITH ANIMATION FRAMES (the harakat primer, a
 *    word's composition; operator report 2026-10-15: on the kasrah frame of
 *    the primer, "‹ Sebelumnya" went back to the first page and "Berikutnya ›"
 *    left the primer) they jump FRAMES: a frame is the run of the step's plan
 *    said or heard over one frame (its lines, then their example beats and
 *    pauses: frameRuns), the current frame the one the stage shows (frameNow,
 *    caption.ts stageFrame's rule). "Berikutnya" starts the next frame from its
 *    first line, "Sebelumnya" the previous one; only on the first frame does
 *    "Sebelumnya" go to the previous step, and only on the last does
 *    "Berikutnya" go to the next. In "Tunggu saya"'s held caption plain `next`
 *    stays "Lanjut" (the next caption); the "Berikutnya ›" control sends
 *    `next` with `jump`, which moves by frame there too.
 *  - replay ("↺ Ulangi langkah ini", operator 2026-10-10) plays the current
 *    step again from its start — also from a pause, and from "Tunggu saya"'s
 *    Lanjut — and plays on from there; on a step with frames, from its first
 *    frame (the button says "langkah ini", the step). An exercise starts over
 *    at its first control (the stage remounts the exercise itself).
 *  - EXAMPLE BEATS (operator 2026-10-12: "each explanation should be followed
 *    by examples (visual + voice)"; plan L20; types.ts ExampleBeat): a step's
 *    beat comes right after the line it follows — the stage shows the example
 *    with the beat's caption and its recording is heard (a recite activity that
 *    names the beat: a word of this ayah, its wordVoices recording, or `clip`,
 *    another ayah's word or a form; both on the example player), then the usual
 *    pause after it. It lasts at least its caption's reading time, the reading alone
 *    (timing.ts exampleReadMs: text the narrator does not say); "Pelan" hears it
 *    twice, as it hears every word twice. A beat is NEVER a dead stop: if its
 *    recording cannot be played (recite_error: it failed, or did not start
 *    within EXAMPLE_LOAD_LIMIT_MS, which the runner times), the example stays
 *    on screen with its caption for EXAMPLE_FAILED_HOLD_MS and the lesson goes
 *    on — unlike the ayah's own recitation, without which there is no lesson.
 *    A beat is part of its step: "↺ Ulangi" and ‹ › reach it with the step
 *    (a concept's examples are a step of their own), pause / resume play it
 *    from its start, and it is neither narration (never in the look-ahead)
 *    nor silent waiting (the screen stays on: the lesson runs).
 * No clocks, no randomness: the same events give the same states.
 */
import type { Pace } from "../lessonSteps";
import {
  advanceHoldMs,
  EXAMPLE_FAILED_HOLD_MS,
  MAX_REMINDERS,
  REMINDER_AT_MS,
  SCREEN_IDLE_LIMIT_MS,
  WORD_REPEAT_GAP_MS,
  exampleReadMs,
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
  type ExampleClip,
  type ExerciseKey,
  type Guide,
  type GuidePart,
  type NarrationSegment,
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
      /** What is played: the narrator's recording of word `word` (AutoplaySequence.wordVoices),
       *  on the example player — never the imam's recitation cut at the word. null: the word has
       *  no recording (the checks refuse that); the runner reports it failed. */
      clip: ExampleClip | null;
      minMs: number;
      /** The question of an exercise (Dengar dan klik): another recording
       *  starting (the learner's own replay) ends it, rather than pausing
       *  the lesson. */
      inExercise?: boolean;
      /** An example beat (its id): this ayah's own word as the example of a rule. */
      example?: string;
    }
  /** An example beat whose word (or form) is not this ayah's: `clip`, its recording by the
   *  narrator, on the example player. */
  | { kind: "recite"; token: number; target: "clip"; clip: ExampleClip; key: string; minMs: number; example: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A step's cue (by index) or a shared line. */
export type CueRef = { c: number } | { s: SharedKey };
/** Which caption the stage shows: a cue, an example beat's (by index in the step's examples),
 *  or the step's own caption. */
export type CaptionRef = CueRef | { x: number } | "step";

/** One thing a step does; a step's plan is a list of these, run in order. */
export type Action =
  | { t: "say"; ref: CueRef; from?: number; part?: GuidePart }
  /** `after: "example"`: the pause after an example beat (as long as after any recitation). */
  | { t: "settle"; after: "narration" | "recite" | "example"; part?: GuidePart }
  | { t: "gap" }
  /** A silent pause: EXERCISE_DONE_HOLD_MS, or `ms`. */
  | { t: "hold"; ms?: number; part?: GuidePart }
  /** Word `word` (its recording), or (null) the whole ayah (the imam). `hold`: it lasts at least the reading time
   *  of the caption shown with it — only where no voice follows to say what that caption says
   *  (a caption-only lesson; never in "Tunggu saya", which waits for Lanjut instead). */
  | { t: "recite"; word: number | null; show: CaptionRef | null; hold: boolean; resume: boolean; part?: GuidePart }
  /** Shows a caption without saying it (a control's prompt met again). */
  | { t: "show"; ref: CueRef; part: GuidePart }
  /** The exercise's word has been played to its end: exercise.heard. */
  | { t: "heard"; word: number; part: GuidePart }
  /** The settled question moves on: exercise.advance + 1. */
  | { t: "advance"; part: GuidePart }
  /** Example beat `x` of the step (step.examples[x]): shown with its caption, its recording
   *  heard. `again`: the second hearing of "Pelan" (no reading time of its own); `failed`: its
   *  recording could not be played — shown for EXAMPLE_FAILED_HOLD_MS, then on. */
  | { t: "example"; x: number; again?: boolean; failed?: boolean }
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
  /** The word the lesson last played to its end in this step (the
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
  /** A recording failed: paused; resume retries. "recite": the imam's recitation of the ayah;
   *  "word": a word's recording (the narrator's). */
  error: ReciteError | null;
  intent: NavIntent | null;
  /** "Tunggu saya": silent time the caption on screen has been held for "Lanjut" (idle_ticks in
   *  the "ready" phase; 0 in every other phase, and again after any other event that changes the
   *  state). Read by the screen lock's time limit only (wake.ts): the lesson never acts on it. */
  heldMs: number;
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
  /** guided.onAnswer of the exercise `key`; `question`: the number of the
   *  question answered (content/quiz), whose explanation a right answer gets. */
  | { type: "answered"; key: ExerciseKey; correct: boolean; question?: number }
  /** guided.onReveal: "Tunjukkan jawaban" on question `question`. */
  | { type: "revealed"; key: ExerciseKey; question?: number }
  /** guided.onGuide: the control to use next, "exercise:${key}:${part}";
   *  with "play", the word (1-based) the question asks about. */
  | { type: "exercise_guide"; target: string | null; word?: number }
  /** guided.onDone of the exercise `key`. */
  | { type: "exercise_done"; key: ExerciseKey }
  /** "Lewati latihan". */
  | { type: "skip" }
  | { type: "pause" }
  | { type: "resume" }
  /** While wantsIdleTicks(state): silent time passed, in ms (an exercise waiting: its reminders,
   *  then the screen lock's limit; "Tunggu saya" holding a caption: that limit only). */
  | { type: "idle_tick"; ms: number }
  /** "‹ Sebelumnya": the previous frame of a step with frames, else the previous step. */
  | { type: "prev" }
  /** "Berikutnya" (the next frame of a step with frames, else the next step), and "Lanjut" in the
   *  "Tunggu saya" mode. `jump`: sent by the "Berikutnya ›" control (the button, Media Session's
   *  next track) — while "Tunggu saya" holds a caption it moves on by frame on a step with frames,
   *  where Lanjut (no `jump`) moves on by caption. Elsewhere the two are the same. */
  | { type: "next"; jump?: boolean }
  /** "↺ Ulangi langkah ini": the current step again, from its start. */
  | { type: "replay" }
  | { type: "set_pace"; pace: Pace };

// ───────────────────────────── helpers ─────────────────────────────

/** Which recording failed (AutoplayState.error). */
export type ReciteError = "recite" | "word";

const lastIdx = (seq: AutoplaySequence) => seq.steps.length - 1;
/** The narrator's recording of word `word` of the ayah (sequence.ts wordVoices), or null. */
const voiceOf = (seq: AutoplaySequence, word: number): ExampleClip | null => seq.wordVoices?.[word - 1] ?? null;
const clampIdx = (seq: AutoplaySequence, i: number) =>
  Math.max(0, Math.min(lastIdx(seq), Number.isFinite(i) ? Math.trunc(i) : 0));
const stepOf = (seq: AutoplaySequence, s: AutoplayState): AutoplayStep => seq.steps[s.idx];

function cueOf(seq: AutoplaySequence, step: AutoplayStep, ref: CueRef): Cue {
  return "c" in ref ? step.cues[ref.c] : seq.shared[ref.s];
}

const audible = (s: AutoplayState, cue: Cue) => cue.audio.length > 0 && !s.noAudio.includes(cue.line);

/**
 * Does the narrator's VOICE explain word `word` right after the word is heard — is the word's own
 * line (its "explain" step's) narration audio that has not failed this visit? Then the word's
 * opening step need not wait for its caption to be read (planFor). Asked of that one line, not of
 * the sequence (`hasAudio` is true as soon as any line has a voice, the shared "Kita lanjutkan."
 * included): a lesson whose own lines are caption-only keeps its reading pace.
 */
function wordVoiced(seq: AutoplaySequence, s: AutoplayState, word: number): boolean {
  const line = seq.steps.find((x) => x.kind === "explain" && x.word === word)?.cues[0];
  return line !== undefined && audible(s, line);
}

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

/** The explanation of question `question`'s answer (its cue in an exercise step), as a plan;
 *  [] when the step has none for it (no narration, or no question number). */
function explainPlan(s: AutoplayState, step: AutoplayStep, seq: AutoplaySequence, question: number | undefined): Action[] {
  const c = question === undefined ? undefined : step.exercise?.explain[question];
  return c === undefined ? [] : sayPlan(s, step, seq, { c });
}

function captionParts(seq: AutoplaySequence, step: AutoplayStep, ref: CaptionRef): { parts: string[]; line: string | null } {
  // A step's own caption: its first line's (a step shown before any line plays), or — a word's
  // opening step, which has no line — the imam's word ("Kata ke-1: bismi. Dengarkan imam
  // membacanya.").
  if (ref === "step") {
    return step.cues.length ? { parts: step.cues[0].parts, line: null } : { parts: [step.caption], line: null };
  }
  // An example beat's caption ("Contoh: …"): on-screen text only, no narration line.
  if ("x" in ref) return { parts: step.examples?.[ref.x]?.parts ?? [step.caption], line: null };
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
 * tagged with `part`: its prompt (by `mode`); for "play", the lesson plays
 * the question's word (once per word), then `heard`; for a settled
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

/** The example beats of `step` that come after cue `after` (-1: before any line), as a plan: each
 *  heard ("Pelan": twice, as every word is), then the pause after it. */
function beatsPlan(s: AutoplayState, step: AutoplayStep, after: number): Action[] {
  const out: Action[] = [];
  (step.examples ?? []).forEach((b, x) => {
    if (b.after !== after) return;
    out.push({ t: "example", x });
    if (s.pace === "pelan") out.push({ t: "hold", ms: WORD_REPEAT_GAP_MS }, { t: "example", x, again: true });
    out.push({ t: "settle", after: "example" });
  });
  return out;
}

function planFor(seq: AutoplaySequence, s: AutoplayState, step: AutoplayStep): Action[] {
  const plan: Action[] = [];
  // A line, then the examples that follow it (operator 2026-10-12, plan L20).
  const say = (c: number) => plan.push(...sayPlan(s, step, seq, { c }), ...beatsPlan(s, step, c));
  if (step.kind === "exercise" && step.exercise && s.exercise) {
    step.exercise.lead.forEach(say);
    plan.push(...partPlan(seq, s, step, s.exercise, s.exercise.part, "say"));
    plan.push({ t: "await" });
    return plan;
  }
  if (step.recite?.target === "word") {
    // A word's opening step, the one time the word is heard (plan L24): the narrator's recording
    // of it. Its caption names the word the card shows; it is held for its reading time only
    // where the word's explanation has no voice — there the caption is all the learner has.
    // Or the composition of the ayah's last word: its lines, then the word once more — the last
    // line (what is not heard where the recitation stops) stays the caption, so nothing waits.
    const word = step.recite.word;
    const opening = step.kind === "recite_word";
    const show: CaptionRef | null = opening ? "step" : null;
    step.cues.forEach((_, i) => say(i));
    plan.push({ t: "recite", word, show, hold: opening && !wordVoiced(seq, s, word), resume: false });
    if (s.pace === "pelan") {
      plan.push({ t: "gap" }, { t: "recite", word, show, hold: false, resume: false });
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
  // An example step has no line: its beats open it.
  plan.push(...beatsPlan(s, step, -1));
  step.cues.forEach((_, i) => say(i));
  return plan;
}

// ───────────────────────────── frames ─────────────────────────────

/** Does `step` play over animation frames (the harakat primer, a word's composition)? */
const hasFrames = (step: AutoplayStep) => (step.kind === "primer" || step.kind === "compose") && (step.frames ?? 0) > 1;

/** The frame (1-based) action `a` of `step`'s plan is said or heard over: a line's (its cue's
 *  `frame`), or an example beat's own (a `base` frame's bentuk dasar); null for anything else (a
 *  pause, a shared line, the word recited at the end of an ayah's last word). */
function actionFrame(step: AutoplayStep, a: Action | undefined): number | null {
  if (a?.t === "example") return step.examples?.[a.x]?.frame ?? null;
  return a?.t === "say" && "c" in a.ref ? (step.cues[a.ref.c]?.frame ?? null) : null;
}

/**
 * The frames of a plan of a step with frames, in play order: each frame's number and the index of
 * its first action — the first line said over it. A frame runs from there to the next frame's first
 * action: its lines, the example beats that follow them, the pauses after them (and, on the
 * composition of an ayah's last word, the word recited after its last line). Empty on any other
 * step.
 */
export function frameRuns(step: AutoplayStep, plan: readonly Action[]): { frame: number; at: number }[] {
  if (!hasFrames(step)) return [];
  const out: { frame: number; at: number }[] = [];
  plan.forEach((a, at) => {
    const f = actionFrame(step, a);
    if (f !== null && f !== out.at(-1)?.frame) out.push({ frame: f, at });
  });
  return out;
}

/**
 * The frame on screen at plan[at] of a step with frames — the rule of caption.ts stageFrame (the
 * stage draws what this says; ahead.test / frames.test hold the two equal): the frame of the
 * action there; while the word is recited, or once the plan is through, the last frame; in a
 * pause, or a shared line, the frame of the action before it, else the one after it.
 */
function frameAtPlan(step: AutoplayStep, plan: readonly Action[], at: number): number {
  const last = step.frames ?? 1;
  const reciting = (i: number) => {
    const a = plan[i];
    return a?.t === "recite" || a?.t === "gap" || (a?.t === "settle" && a.after === "recite");
  };
  if (at >= plan.length || reciting(at)) return last;
  const here = actionFrame(step, plan[at]);
  if (here !== null) return here;
  for (let i = at - 1; i >= 0; i--) {
    const f = actionFrame(step, plan[i]);
    if (f !== null) return f;
    if (reciting(i)) return last;
  }
  for (let i = at + 1; i < plan.length; i++) {
    const f = actionFrame(step, plan[i]);
    if (f !== null) return f;
    if (reciting(i)) return last;
  }
  return 1;
}

/** The frame the lesson is on (the one the stage shows), or null: not a step with frames, or not
 *  started / finished. */
export function frameNow(seq: AutoplaySequence, s: AutoplayState): number | null {
  if (!s.started || s.phase === "idle" || s.phase === "finished") return null;
  const step = stepOf(seq, s);
  return hasFrames(step) ? frameAtPlan(step, s.plan, s.at) : null;
}

/**
 * Where "‹ Sebelumnya" (`by` −1) or "Berikutnya ›" (+1) goes inside the current step: the frame
 * before or after the current one, by the frames of the plan the step gets on entry; null when
 * there is none — not a step with frames, its first frame going back, its last going on — and the
 * move is a step's.
 */
function frameHop(seq: AutoplaySequence, s: AutoplayState, by: -1 | 1): number | null {
  const now = frameNow(seq, s);
  if (now === null) return null;
  const step = stepOf(seq, s);
  const runs = frameRuns(step, planFor(seq, entered(seq, s, s.idx), step));
  const k = runs.findIndex((r) => r.frame === now);
  if (k === -1) return null;
  return runs[k + by]?.frame ?? null;
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
        ms: a.after === "narration" ? settleAfterNarrationMs(s.pace) : settleAfterReciteMs(s.pace),
      });
    case "example": {
      const b = step.examples?.[a.x];
      if (!b) return run(seq, { ...s, at: s.at + 1 }, viaNext);
      const shown: AutoplayState = { ...s, caption: { x: a.x }, part: 0, guides: step.guides };
      // Its recording could not be played: the example stays on screen a moment, then on.
      if (a.failed) return issue(shown, { kind: "wait", ms: EXAMPLE_FAILED_HOLD_MS });
      // At least its caption's reading time, the reading alone (timing.ts exampleReadMs; not
      // "Tunggu saya", which waits for Lanjut at the step's end; not the second hearing of "Pelan").
      const minMs = a.again || s.pace === "tunggu" ? 0 : exampleReadMs(b.parts.join(" "), s.pace);
      if (b.word !== null) return issue(shown, { kind: "recite", target: "word", word: b.word, clip: voiceOf(seq, b.word), minMs, example: b.id });
      if (b.clip) return issue(shown, { kind: "recite", target: "clip", clip: b.clip, key: b.key, minMs, example: b.id });
      return run(seq, { ...s, at: s.at + 1 }, viaNext);
    }
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
      // One word: the narrator's recording of it, never the imam's recitation cut at the word.
      const clip = voiceOf(seq, a.word);
      return step.kind === "exercise"
        ? issue(shown, { kind: "recite", target: "word", word: a.word, clip, minMs, inExercise: true })
        : issue(shown, { kind: "recite", target: "word", word: a.word, clip, minMs });
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
 * exercises that already reported done (moving forward only). `fromFrame`
 * (a step with frames: "‹ Sebelumnya" / "Berikutnya ›" between its frames):
 * the step's plan as on any entry, started at that frame's first action
 * (frameRuns) instead of its first — the plan whole, so what the rest of
 * the step plays, and the look-ahead lists, is the plan from there; shown
 * paused, the caption is that action's.
 */
function enter(
  seq: AutoplaySequence,
  s: AutoplayState,
  idx: number,
  opts: { run: boolean; skipDone: boolean; prefix?: Action[]; fromFrame?: number },
): AutoplayState {
  const i = entryIndex(seq, s, idx, opts.run && opts.skipDone);
  const base = entered(seq, s, i);
  const plan = [...(opts.prefix ?? []), ...planFor(seq, base, seq.steps[i])];
  const at = opts.fromFrame === undefined ? 0 : (frameRuns(seq.steps[i], plan).find((r) => r.frame === opts.fromFrame)?.at ?? 0);
  if (!opts.run) {
    const a = plan[at];
    const caption: CaptionRef = at > 0 && a?.t === "say" ? a.ref : at > 0 && a?.t === "example" ? { x: a.x } : base.caption;
    return { ...base, plan, at, caption, phase: "paused", pausedFrom: "running" };
  }
  return run(seq, { ...base, plan, at }, false);
}

/** The step `enter` lands on for `idx`: `skipDone` passes the exercises that already reported
 *  done (never past the last step). */
function entryIndex(seq: AutoplaySequence, s: AutoplayState, idx: number, skipDone: boolean): number {
  let i = clampIdx(seq, idx);
  if (skipDone) {
    while (i < lastIdx(seq)) {
      const key = seq.steps[i].exercise?.key;
      if (!key || !s.doneKeys.includes(key)) break;
      i++;
    }
  }
  return i;
}

/** The state on step `i` just entered, before its plan (enter's, and the look-ahead's). */
function entered(seq: AutoplaySequence, s: AutoplayState, i: number): AutoplayState {
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
  return {
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
    heldMs: 0,
  };
}

export function reduceAutoplay(seq: AutoplaySequence, s: AutoplayState, e: AutoplayEvent): AutoplayState {
  const next = reduce(seq, s, e);
  // `heldMs` is the silent time of ONE wait for "Lanjut": idle_ticks add to it, and anything else
  // that changes the state (the learner acting, the lesson moving) starts it over.
  return next === s || e.type === "idle_tick" || next.heldMs === 0 ? next : { ...next, heldMs: 0 };
}

function reduce(seq: AutoplaySequence, s: AutoplayState, e: AutoplayEvent): AutoplayState {
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
      const here = s.plan[s.at];
      if (a.target !== "ayah" && a.example !== undefined && here?.t === "example") {
        // An example beat is never a dead stop: it stays on screen with its caption for a
        // moment, and the lesson goes on. Its second hearing ("Pelan") would fail the same way.
        const rest = s.plan.slice(s.at + 1);
        const twice = rest[0]?.t === "hold" && rest[1]?.t === "example" && rest[1].x === here.x;
        const plan: Action[] = [...s.plan.slice(0, s.at), { t: "example", x: here.x, failed: true }, ...(twice ? rest.slice(2) : rest)];
        return run(seq, { ...s, plan, activity: null }, false);
      }
      return { ...s, phase: "paused", pausedFrom: "running", activity: null, resumeRecite: false, error: a.target === "ayah" ? "recite" : "word" };
    }

    case "answered":
    case "revealed": {
      const step = stepOf(seq, s);
      const ex = s.exercise;
      if (!isOpen(ex) || step.exercise?.key !== e.key) return s;
      const right = e.type === "answered" && e.correct;
      const ex2: ExerciseState = { ...ex, reminders: 0, idleMs: 0, skipOffered: false, right: ex.right || right };
      // A wrong pick: no voice (operator 2026-10-10), nothing that plays is cut — the learner
      // acted, so the reminders start over and the spotlight drops "Lewati latihan".
      if (e.type === "answered" && !e.correct) {
        return { ...s, exercise: ex2, guides: s.phase === "waiting" ? exerciseGuides(seq, step, ex2, s.pace) : s.guides };
      }
      if (s.phase !== "running" && s.phase !== "waiting") return { ...s, exercise: ex2 };
      // "Benar." (or "Ini jawabannya.") and the explanation of that question's answer, then the
      // imam's word still to come for this control (a pick before he finished); a settled
      // question moves the exercise to "next", which drops that word.
      const rest = s.plan.slice(s.at);
      const from = rest.findIndex((a) => a.t === "recite" && partOf(a) === ex.part);
      const keep = from === -1 ? [] : rest.slice(from).filter((a) => a.t !== "await" && partOf(a) === ex.part);
      const plan: Action[] = [
        ...sayPlan(s, step, seq, { s: right ? "correct" : "revealed" }),
        ...explainPlan(s, step, seq, e.question),
        ...keep,
        { t: "await" },
      ];
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
      // (A settled question whose answer was SHOWN said so on `revealed`, with its explanation:
      // untagged feedback, which finishes even if the learner moves on at once.)
      const lines = partPlan(seq, base, step, ex2, g.part, samePart ? "none" : first ? "say" : "show");
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
      if (s.phase === "running" && s.activity && (current?.t === "say" || current?.t === "settle") && partOf(current) === undefined) {
        // Let the feedback that is playing ("Benar." and the explanation after it, untagged)
        // finish first: the last answer of a sort ends the exercise as it is said.
        const chain: Action[] = [current];
        for (const a of s.plan.slice(s.at + 1)) {
          if ((a.t !== "say" && a.t !== "settle") || partOf(a) !== undefined) break;
          chain.push(a);
        }
        return { ...base, plan: [...chain, { t: "hold" }], at: 0 };
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
      if (s.phase === "ready") {
        // "Tunggu saya" holds a caption: the silent time is counted (the screen lock's time
        // limit, wake.ts) and nothing else changes — the lesson waits for "Lanjut" as before.
        if (s.activity || !(e.ms > 0) || !Number.isFinite(e.ms)) return s;
        return { ...s, heldMs: s.heldMs + e.ms };
      }
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
      // A step with frames: the frame before this one, from its first line (playing, or shown
      // paused); its first frame goes back a step.
      const back = frameHop(seq, s, -1);
      if (back !== null) return enter(seq, s, s.idx, { run: s.phase !== "paused", skipDone: false, fromFrame: back });
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
      // "Lanjut" (a held caption, no `jump`): the next caption — and so on any step without frames.
      if (s.phase === "ready" && (!e.jump || !hasFrames(step))) return proceed(seq, s);
      const play = s.phase !== "paused";
      // A step with frames: the frame after this one, from its first line; its last frame goes
      // on to the next step.
      const on = frameHop(seq, s, 1);
      if (on !== null) return enter(seq, s, s.idx, { run: play, skipDone: false, fromFrame: on });
      if (s.idx >= lastIdx(seq)) return finish(seq, s);
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

/**
 * Should the UI send `idle_tick`s now? While the lesson waits for the learner in silence: an
 * exercise waiting — until its reminders are through, and after them until the silence reaches
 * SCREEN_IDLE_LIMIT_MS (nothing more is said then: the ticks are only counted, for the screen
 * lock's time limit, wake.ts) — and "Tunggu saya" holding a caption for "Lanjut", up to that same
 * limit. Past the limit there is nothing left to count: no ticks.
 */
export function wantsIdleTicks(s: AutoplayState): boolean {
  if (s.activity !== null) return false;
  if (s.phase === "ready") return s.heldMs < SCREEN_IDLE_LIMIT_MS;
  return (
    s.phase === "waiting" &&
    isOpen(s.exercise) &&
    (s.exercise.reminders < MAX_REMINDERS || s.exercise.idleMs < SCREEN_IDLE_LIMIT_MS)
  );
}

/**
 * The lesson runs: started ("Mulai", "Lanjutkan dari langkah N", or the hand-off from the previous
 * ayah) and neither paused nor finished — the narrator speaking, the imam reciting, a caption
 * read, a pause between lines, "Tunggu saya" holding a caption, an exercise waiting. The look-ahead
 * fetches only then (lookahead.ts); the screen is kept on then, up to its time limit (wake.ts).
 */
export function lessonRuns(s: Pick<AutoplayState, "started" | "phase">): boolean {
  return s.started && (s.phase === "running" || s.phase === "ready" || s.phase === "waiting");
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
  /** "‹ Sebelumnya" goes somewhere: a step before this one, or a frame before the current one (on
   *  the first step too: its second frame goes back to its first). False on the very first frame
   *  of the lesson — the button is shown unavailable there. */
  hasPrev: boolean;
  /** False on an exercise step: forward there is "Lewati latihan". */
  canNext: boolean;
  showSkip: boolean;
  /** "Tunggu saya": show "Lanjut" (dispatch `next`). */
  showLanjut: boolean;
  error: ReciteError | null;
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
    hasPrev: s.idx > 0 || frameHop(seq, s, -1) !== null,
    canNext: live && !openExercise,
    showSkip: live && openExercise,
    showLanjut: s.phase === "ready",
    error: s.error,
    intent: s.intent,
  };
}

/**
 * The narration file the lesson plays first when the learner clicks "Mulai" (`from` 0, or
 * null) or "Lanjutkan dari langkah N" (`from` N − 1): exactly what that click's `start` issues
 * — "shared:start" or "shared:resume" with their audio — or null when it starts caption-only.
 * For the UI to warm it while the page is idle (operator 2026-10-11, narration rule 19).
 */
export function firstNarration(
  seq: AutoplaySequence,
  from: number | null,
  pace?: Pace,
): { url: string; ms: number } | null {
  const at = from ?? 0;
  const s = reduceAutoplay(seq, createAutoplayState(seq, { pace }), {
    type: "start",
    pace,
    from: at,
    reason: at > 0 ? "restore" : "fresh",
  });
  const a = s.activity;
  return a?.kind === "narrate" ? { url: a.url, ms: a.ms } : null;
}

/** The narration files a plan says, in order (lines without audio give none). */
function planAudio(seq: AutoplaySequence, s: AutoplayState, step: AutoplayStep, plan: readonly Action[]): NarrationSegment[] {
  const out: NarrationSegment[] = [];
  for (const a of plan) {
    if (a.t !== "say") continue;
    const cue = cueOf(seq, step, a.ref);
    if (audible(s, cue)) out.push(...cue.audio);
  }
  return out;
}

/** The recording an action of `step`'s plan plays on the example player (a word's or an example
 *  beat's), or null: anything else (a line, the imam's ayah, a pause), or a beat that failed. */
function clipOf(seq: AutoplaySequence, step: AutoplayStep, a: Action): ExampleClip | null {
  if (a.t === "recite") return a.word === null ? null : voiceOf(seq, a.word);
  if (a.t !== "example" || a.failed) return null;
  const b = step.examples?.[a.x];
  if (!b) return null;
  return b.word !== null ? voiceOf(seq, b.word) : b.clip;
}

/**
 * The recordings the example player will play next along the lesson's own path (for warm.ts
 * clipsToWarm): a word's or an example's, in play order, each once — the rest of the current step,
 * then the step the lesson moves on to by itself, with the plan it gets on entry. So the word that
 * OPENS the next step ("w${n}:recite" plays it at once) is known while the narrator still speaks
 * this step's lines. Never past the last step; a recording playing now is listed too (the
 * player itself refuses to warm while one plays).
 */
export function clipsAhead(seq: AutoplaySequence, s: AutoplayState): ExampleClip[] {
  const out: ExampleClip[] = [];
  const add = (step: AutoplayStep, plan: readonly Action[]) => {
    for (const a of plan) {
      const c = clipOf(seq, step, a);
      if (c && !out.some((x) => x.url === c.url)) out.push(c);
    }
  };
  add(stepOf(seq, s), s.plan.slice(s.at));
  if (s.idx < lastIdx(seq)) {
    const idx = entryIndex(seq, s, s.idx + 1, true);
    const base = entered(seq, s, idx);
    add(seq.steps[idx], planFor(seq, base, seq.steps[idx]));
  }
  return out;
}

/**
 * The narration files the lesson will play from now on, along its own path, step by step (for
 * the look-ahead, lookahead.ts): [0] the rest of the current step — after the file playing now
 * (a paused or not yet started line plays again from its start: all its files) — then one entry
 * for each of the next `steps` steps the lesson moves on to by itself (`advance`: past the
 * exercises already done), with the plan it gets on entry: the pace, the lines whose audio failed
 * this visit (caption-only from then on) and an exercise's remembered control taken into account.
 * An exercise gives the lines it says by itself (its introduction, the prompt of the control it
 * opens on); what it says once the learner answers depends on the learner, and is not listed.
 * Never past the last step: what follows is another ayah, whose page plays its own. Only the
 * narrator's files: the imam's recitation is the stage player's own (warm.ts).
 */
export function audioAhead(seq: AutoplaySequence, s: AutoplayState, steps: number): NarrationSegment[][] {
  const step = stepOf(seq, s);
  const rest = s.plan.slice(s.at);
  const head = rest[0];
  const out: NarrationSegment[][] = [];
  if (head?.t === "say" && s.activity?.kind === "narrate") {
    const cue = cueOf(seq, step, head.ref);
    out.push([...(audible(s, cue) ? cue.audio.slice(s.seg + 1) : []), ...planAudio(seq, s, step, rest.slice(1))]);
  } else {
    out.push(planAudio(seq, s, step, rest));
  }
  let idx = s.idx;
  for (let n = 0; n < steps && idx < lastIdx(seq); n++) {
    idx = entryIndex(seq, s, idx + 1, true);
    const next = seq.steps[idx];
    const base = entered(seq, s, idx);
    out.push(planAudio(seq, base, next, planFor(seq, base, next)));
  }
  return out;
}
