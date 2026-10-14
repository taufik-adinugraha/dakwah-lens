import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  aheadUpdate,
  createAutoplayState,
  createPrefetcher,
  createWakeLockHolder,
  followScreenAwake,
  isNarrationUrl,
  keepsScreenAwake,
  leaveScreenAwake,
  lessonRuns,
  LOOKAHEAD_MAX_BYTES,
  LOOKAHEAD_STEPS,
  lookaheadAudio,
  MAX_REMINDERS,
  NARRATION_BYTES_PER_MS,
  NARRATION_MEDIA_PREFIX,
  nextLinePreload,
  nextNarration,
  PREFETCH_SETTLE_MS,
  reduceAutoplay,
  REMINDER_AT_MS,
  SCREEN_IDLE_AFTER_REMINDERS_MS,
  SCREEN_IDLE_LIMIT_MS,
  screenAwake,
  viewAutoplay,
  waitedTooLong,
  WAKE_HANDOFF_GRACE_MS,
  WAKE_REASK_MIN_HELD_MS,
  wantsIdleTicks,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type ConnectionHints,
  type PrefetchFetch,
  type ScreenAwake,
  type WakeLockLike,
} from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";
import { PACES, type Pace } from "@/lib/lessonSteps";

import { stageSequence } from "./build";

// The two behaviours of operator 2026-10-12 (docs/belajar-plan.md L18), over the lessons the page
// ships: the screen kept on exactly while a lesson runs, up to its time limit where the lesson
// waits for the learner (src/lib/autoplay/wake.ts); and the narration of the next steps listed
// ahead along the lesson's own path (lookahead.ts), fetched into the page and played from there
// (prefetch.ts, ahead.ts) — the runner's wiring checked by what it does over the real lessons.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

// Every lesson walked many times over (paces, starts, exercises): well past vitest's 5 s.
const WALK_TIMEOUT_MS = 120_000;

const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah");
if (!FATIHAH) throw new Error("no Al-Fatihah");
const fatihah = FATIHAH.ayat.map((a) => ({ ayah: a.ayah, seq: stageSequence(FATIHAH, a, "id") }));

/** What the stage answers to `s`, as a learner who lets the lesson run would have it: each
 *  activity's end, "Lewati latihan" (or the exercise done) at an exercise waiting, "Lanjut" at a
 *  held caption. Null when nothing is due (finished, paused, idle). */
function answer(seq: AutoplaySequence, s: AutoplayState, exercise: "skip" | "done"): AutoplayEvent | null {
  if (s.phase === "finished" || s.phase === "paused" || s.phase === "idle") return null;
  const a = s.activity;
  if (a?.kind === "narrate") return { type: "narration_end", token: a.token };
  if (a?.kind === "read" || a?.kind === "wait") return { type: "timer", token: a.token };
  if (a?.kind === "recite") return { type: "recite_end", token: a.token };
  if (s.phase === "waiting") {
    const key = seq.steps[s.idx].exercise?.key;
    return exercise === "done" && key ? { type: "exercise_done", key } : { type: "skip" };
  }
  if (s.phase === "ready") return { type: "next" };
  return null;
}

type Start = { type: "start"; reason: "fresh" | "restore" | "continue"; from?: number };

/** Every state of one lesson played through, from `start` to its end. */
function walk(seq: AutoplaySequence, start: Start, pace: Pace, exercise: "skip" | "done", before: AutoplayEvent[] = []): AutoplayState[] {
  let s = createAutoplayState(seq, { pace });
  for (const e of before) s = reduceAutoplay(seq, s, e);
  s = reduceAutoplay(seq, s, { ...start, pace });
  const states = [s];
  for (let i = 0; i < 5000; i++) {
    const e = answer(seq, s, exercise);
    if (!e) break;
    s = reduceAutoplay(seq, s, e);
    states.push(s);
  }
  if (s.phase !== "finished") throw new Error(`${seq.lessonKey}: the walk did not finish (phase ${s.phase})`);
  return states;
}

/** The narration files actually played after state k (each new narrate activity), with its step. */
function playedAfter(states: AutoplayState[], k: number): { url: string; idx: number }[] {
  const out: { url: string; idx: number }[] = [];
  let token = states[k].activity?.token ?? -1;
  for (let j = k + 1; j < states.length; j++) {
    const a = states[j].activity;
    if (a?.kind === "narrate" && a.token !== token) out.push({ url: a.url, idx: states[j].idx });
    if (a) token = a.token;
  }
  return out;
}

/** What the look-ahead of state k must be, from what the lesson really played after it: the
 *  files of this step's rest and of the next `steps` steps it went to, each once, in play order,
 *  never the file playing at k. */
function expectedAhead(states: AutoplayState[], k: number, steps: number): string[] {
  const s = states[k];
  if (!s.started || s.phase === "finished") return [];
  const playing = s.activity?.kind === "narrate" ? s.activity.url : null;
  const later = playedAfter(states, k);
  // A step with no narration of its own still counts as a step (the imam's word, a caption-only
  // line): take the steps from the states, not from the files.
  const visited: number[] = [];
  for (let j = k + 1; j < states.length; j++) {
    const i = states[j].idx;
    if (i !== s.idx && !visited.includes(i) && states[j].phase !== "finished") visited.push(i);
  }
  const within = new Set([s.idx, ...visited.slice(0, steps)]);
  const out: string[] = [];
  for (const p of later) if (within.has(p.idx) && p.url !== playing && !out.includes(p.url)) out.push(p.url);
  return out;
}

/** Durations of every narration file a sequence can play (its steps and its shared lines). */
function durations(seq: AutoplaySequence): Map<string, number> {
  const m = new Map<string, number>();
  for (const st of seq.steps) for (const c of st.cues) for (const f of c.audio) m.set(f.url, f.ms);
  for (const c of Object.values(seq.shared)) for (const f of c.audio) m.set(f.url, f.ms);
  return m;
}

/** The manifest ids each narration file was rendered for, over every lesson ("al-fatihah:2:w1",
 *  "shared:start", a split part "…:a"). Two lines with the same text share one file (its name
 *  hashes the text, plan L15), so a file can have several. */
const owners = new Map<string, Set<string>>();
for (const s of SURAHS) {
  for (const a of s.ayat) {
    const seq = stageSequence(s, a, "id");
    const files = [...seq.steps.flatMap((st) => st.cues), ...Object.values(seq.shared)].flatMap((c) => c.audio);
    for (const f of files) owners.set(f.url, (owners.get(f.url) ?? new Set()).add(f.id));
  }
}
const fileOwner = (url: string) => [...(owners.get(url) ?? [])].join(" | ");
/** Every narration file a sequence can play: its steps' lines and the shared lines. */
const ownFiles = (seq: AutoplaySequence) =>
  new Set([...seq.steps.flatMap((st) => st.cues), ...Object.values(seq.shared)].flatMap((c) => c.audio.map((f) => f.url)));
const recordings = new Set(SURAHS.flatMap((s) => s.ayat.flatMap((a) => a.recitation.map((r) => r.url))));

const STARTS = (seq: AutoplaySequence): Start[] => [
  { type: "start", reason: "fresh" },
  // "Lanjutkan dari langkah N": the remembered place, here the middle of the lesson.
  { type: "start", reason: "restore", from: Math.floor(seq.steps.length / 2) },
  // The hand-off from the previous ayah (no opening line).
  { type: "start", reason: "continue" },
];

describe("the screen stays on while a lesson runs, and across the hand-off (operator 2026-10-12, wake.ts)", () => {
  /** The lesson has waited for the learner past the lock's time limit: an exercise whose three
   *  reminders are through, or a caption "Tunggu saya" holds, 120 s in silence. */
  const tooLong = (s: AutoplayState) =>
    (s.phase === "waiting" && !!s.exercise && s.exercise.reminders >= 3 && s.exercise.idleMs >= 120_000) ||
    (s.phase === "ready" && s.heldMs >= 120_000);
  /** The rule, spelled out: on while started and neither paused nor finished — unless the lesson
   *  has waited for the learner too long; kept while the finished lesson hands off to the next
   *  ayah; off otherwise. */
  const rule = (s: AutoplayState): ScreenAwake =>
    !s.started
      ? "off"
      : s.phase === "finished"
        ? s.intent?.kind === "ayah"
          ? "hand-off"
          : "off"
        : s.phase === "paused" || s.phase === "idle" || tooLong(s)
          ? "off"
          : "on";

  it(
    "every step of every Al-Fatihah lesson, at every pace and start: on ⇔ started, not paused, not finished; the hand-off keeps it",
    () => {
      const phasesOn = new Set<string>();
      let states = 0;
      for (const { ayah, seq } of fatihah) {
        const where = `al-fatihah ${ayah}`;
        // A page only looked at — also with a remembered place: never.
        expect(screenAwake(createAutoplayState(seq)), where).toBe("off");
        expect(screenAwake(createAutoplayState(seq, { idx: 3 })), where).toBe("off");
        for (const pace of PACES) {
          for (const start of STARTS(seq)) {
            for (const exercise of ["skip", "done"] as const) {
              const run = walk(seq, start, pace, exercise);
              run.forEach((s, k) => {
                const at = `${where} ${pace} ${start.reason} ${exercise} #${k} ${seq.steps[s.idx].id} (${s.phase})`;
                expect(screenAwake(s), at).toBe(rule(s));
                expect(keepsScreenAwake(s), at).toBe(rule(s) !== "off");
                if (s.phase !== "finished") {
                  // Running from the start on, through every step: the narrator, the imam, a
                  // caption read, a pause between lines, "Tunggu saya", an exercise waiting.
                  expect(screenAwake(s), at).toBe("on");
                  phasesOn.add(s.phase);
                  // "Jeda" lets go; "Lanjutkan" takes it again.
                  const paused = reduceAutoplay(seq, s, { type: "pause" });
                  expect(paused.phase, at).toBe("paused");
                  expect(screenAwake(paused), at).toBe("off");
                  // "Berikutnya ›" while paused enters the next step paused: still off.
                  if (paused.idx < seq.steps.length - 1 && !seq.steps[paused.idx].exercise) {
                    expect(screenAwake(reduceAutoplay(seq, paused, { type: "next" })), at).toBe("off");
                  }
                  expect(screenAwake(reduceAutoplay(seq, paused, { type: "resume" })), at).toBe("on");
                }
                states++;
              });
              const end = run[run.length - 1];
              expect(end.phase, where).toBe("finished");
              if (ayah < fatihah.length) {
                // The hand-off to the next ayah KEEPS the screen on (the lock is not released
                // across the page change) …
                expect(end.intent?.kind, where).toBe("ayah");
                expect(screenAwake(end), where).toBe("hand-off");
                // … the next page starts "off" (its holder keeps the lock handed over through the
                // grace; nothing new is asked for on mount) and adopts it once its lesson runs.
                const nextSeq = fatihah[ayah].seq;
                const there = createAutoplayState(nextSeq, { pace });
                expect(screenAwake(there), where).toBe("off");
                expect(screenAwake(reduceAutoplay(nextSeq, there, { type: "start", pace, reason: "continue" })), where).toBe("on");
              } else {
                // The end of the surah: no next ayah, let go.
                expect(end.intent?.kind, where).toBe("surah_end");
                expect(screenAwake(end), where).toBe("off");
              }
            }
          }
        }
        // The last step's "Berikutnya ›" while paused also hands off (the lesson goes on there).
        const last = reduceAutoplay(seq, reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "restore", from: seq.steps.length - 1 }), { type: "pause" });
        expect(screenAwake(last), where).toBe("off");
        expect(screenAwake(reduceAutoplay(seq, last, { type: "next" })), where).toBe(ayah < fatihah.length ? "hand-off" : "off");
        // The browser refusing sound, or the imam's recording failing, pauses the lesson: off.
        let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
        for (let i = 0; i < 400 && s.activity?.kind !== "recite"; i++) s = reduceAutoplay(seq, s, answer(seq, s, "skip")!);
        expect(s.activity?.kind, where).toBe("recite");
        const failed = reduceAutoplay(seq, s, { type: "recite_error", token: s.activity!.token });
        expect([failed.phase, failed.error, screenAwake(failed)], where).toEqual(["paused", "recite", "off"]);
      }
      // The walk met every phase the rule keeps the screen on for.
      expect([...phasesOn].sort()).toEqual(["ready", "running", "waiting"]);
      expect(states).toBeGreaterThan(5000);
    },
    WALK_TIMEOUT_MS,
  );

  it("the time limit is the last reminder's 60 s plus 60 s more: 120 s of silence", () => {
    expect(REMINDER_AT_MS.at(-1)).toBe(60_000);
    expect(SCREEN_IDLE_AFTER_REMINDERS_MS).toBe(60_000);
    expect(SCREEN_IDLE_LIMIT_MS).toBe(120_000);
    expect(MAX_REMINDERS).toBe(3);
  });

  /** The end of the activity `s` runs (the lesson's own line, pause or recitation). */
  const endOf = (s: AutoplayState): AutoplayEvent => {
    const a = s.activity;
    if (a?.kind === "narrate") return { type: "narration_end", token: a.token };
    if (a?.kind === "recite") return { type: "recite_end", token: a.token };
    return { type: "timer", token: a?.token ?? -1 };
  };

  it(
    "an exercise left waiting, on every exercise of Al-Fatihah at every pace: the lock is let go 60 s after the last reminder — only the lock; any answer takes it back",
    () => {
      let exercises = 0;
      for (const { ayah, seq } of fatihah) {
        for (const pace of PACES) {
          seq.steps.forEach((step, exIdx) => {
            const spec = step.exercise;
            if (!spec) return;
            const where = `al-fatihah ${ayah} ${pace} ${step.id}`;
            let s = reduceAutoplay(seq, createAutoplayState(seq, { pace }), { type: "start", pace, from: exIdx, reason: "restore" });
            // Nobody touches the phone: the lesson says its own lines (the introduction, each
            // reminder), and one idle tick a second passes while it waits — as useAutoplay sends
            // them, for as long as wantsIdleTicks.
            let silent = 0;
            let offAt: number | null = null;
            const remindedAt: number[] = [];
            let afterLast: AutoplayState | null = null;
            for (let i = 0; i < 2000; i++) {
              while (s.activity) {
                // The lesson is doing something: always on, however long the silence before.
                expect(screenAwake(s), `${where} at ${silent} ms, ${s.activity.kind}`).toBe("on");
                s = reduceAutoplay(seq, s, endOf(s));
              }
              expect([s.phase, s.idx], where).toEqual(["waiting", exIdx]);
              const ex = s.exercise!;
              if (ex.reminders === MAX_REMINDERS && afterLast === null) afterLast = s;
              const off = ex.reminders >= MAX_REMINDERS && silent >= SCREEN_IDLE_LIMIT_MS;
              expect(screenAwake(s), `${where} after ${silent} ms of silence`).toBe(off ? "off" : "on");
              expect(screenAwake(s), where).toBe(rule(s));
              expect(waitedTooLong(s), where).toBe(off);
              if (off && offAt === null) offAt = silent;
              // The ticks go on past the last reminder, and stop at the limit.
              expect(wantsIdleTicks(s), `${where} after ${silent} ms`).toBe(!off);
              if (off) break;
              const before = ex.reminders;
              s = reduceAutoplay(seq, s, { type: "idle_tick", ms: 1000 });
              silent += 1000;
              if ((s.exercise?.reminders ?? 0) > before) remindedAt.push(silent);
            }
            // The reminders as before (20 s, 40 s, 60 s), then the lock let go at 120 s: 60 s
            // after the last one.
            expect(remindedAt, where).toEqual([...REMINDER_AT_MS]);
            expect(offAt, where).toBe(REMINDER_AT_MS[2] + SCREEN_IDLE_AFTER_REMINDERS_MS);
            // ONLY THE LOCK: the lesson is where the last reminder left it — the same step, phase,
            // caption, marks ("Lewati latihan" offered), look-ahead; it still runs. Nothing but
            // the silence counted has changed in the state.
            expect(afterLast, where).not.toBeNull();
            const then = afterLast!;
            expect({ ...s, exercise: { ...s.exercise!, idleMs: then.exercise!.idleMs } }, where).toEqual(then);
            expect(viewAutoplay(seq, s), where).toEqual(viewAutoplay(seq, then));
            expect(lessonRuns(s), where).toBe(true);
            expect(lookaheadAudio(seq, s), where).toEqual(lookaheadAudio(seq, then));
            expect(aheadUpdate(seq, s, { soundLoading: false, heardFor: null }), where).toEqual(aheadUpdate(seq, then, { soundLoading: false, heardFor: null }));
            expect(aheadUpdate(seq, s, { soundLoading: false, heardFor: null }).open, where).toBe(true);
            // More time changes nothing (were a tick still sent): off, the lesson waiting.
            const later = reduceAutoplay(seq, s, { type: "idle_tick", ms: 600_000 });
            expect([screenAwake(later), later.phase, later.idx, later.exercise?.reminders], where).toEqual(["off", "waiting", exIdx, 3]);
            // ANY ANSWER TAKES THE LOCK BACK: a wrong pick, a right one, "Tunjukkan jawaban",
            // another control of the exercise, "Lewati latihan".
            const other = spec.parts.find((part) => part !== s.exercise?.part);
            const acts: AutoplayEvent[] = [
              { type: "answered", key: spec.key, correct: false, question: 1 },
              { type: "answered", key: spec.key, correct: true, question: 1 },
              { type: "revealed", key: spec.key, question: 1 },
              ...(other ? [{ type: "exercise_guide", target: `exercise:${spec.key}:${other}` } as AutoplayEvent] : []),
              { type: "skip" },
            ];
            for (const e of acts) {
              const acted = reduceAutoplay(seq, s, e);
              expect(screenAwake(acted), `${where} after ${JSON.stringify(e)}`).toBe(acted.phase === "finished" ? rule(acted) : "on");
              if (acted.idx === exIdx && acted.exercise) expect(acted.exercise.idleMs, where).toBe(0);
            }
            // After a wrong pick the wait starts over: the lock is kept through the reminders
            // again, and let go again 120 s on.
            let again = reduceAutoplay(seq, s, { type: "answered", key: spec.key, correct: false, question: 1 });
            for (let t = 0; t < 119; t++) {
              while (again.activity) again = reduceAutoplay(seq, again, endOf(again));
              expect(screenAwake(again), `${where}: ${t} s after a wrong pick`).toBe("on");
              again = reduceAutoplay(seq, again, { type: "idle_tick", ms: 1000 });
            }
            while (again.activity) again = reduceAutoplay(seq, again, endOf(again));
            expect(screenAwake(again), where).toBe("on");
            again = reduceAutoplay(seq, again, { type: "idle_tick", ms: 1000 });
            expect(screenAwake(again), where).toBe("off");
            // "Jeda" is off whatever the silence; a pause is not the lock's limit.
            expect(screenAwake(reduceAutoplay(seq, s, { type: "pause" })), where).toBe("off");
            exercises++;
          });
        }
      }
      expect(exercises).toBeGreaterThanOrEqual(fatihah.length * PACES.length);
    },
    WALK_TIMEOUT_MS,
  );

  it("a long tick (a throttled timer) never lets the lock go before the reminders are through", () => {
    const { seq } = fatihah[0];
    const exIdx = seq.steps.findIndex((st) => st.exercise);
    let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", from: exIdx, reason: "restore" });
    while (s.activity) s = reduceAutoplay(seq, s, endOf(s));
    // Ten minutes in one tick: the first reminder is due, and said.
    s = reduceAutoplay(seq, s, { type: "idle_tick", ms: 600_000 });
    expect([s.exercise?.reminders, s.exercise?.idleMs, screenAwake(s)]).toEqual([1, 600_000, "on"]);
    for (const n of [2, 3]) {
      while (s.activity) s = reduceAutoplay(seq, s, endOf(s));
      expect(screenAwake(s)).toBe("on");
      s = reduceAutoplay(seq, s, { type: "idle_tick", ms: 1000 });
      expect(s.exercise?.reminders).toBe(n);
    }
    // The third is being said: on. Once it is through and the exercise waits again: off.
    expect(screenAwake(s)).toBe("on");
    while (s.activity) s = reduceAutoplay(seq, s, endOf(s));
    expect([s.phase, screenAwake(s), wantsIdleTicks(s)]).toEqual(["waiting", "off", false]);
  });

  it(
    '"Tunggu saya" holding a caption, at every held caption of every Al-Fatihah lesson: the same 120 s, only the lock, and every "Lanjut" starts it over',
    () => {
      let held = 0;
      for (const { ayah, seq } of fatihah) {
        const run = walk(seq, { type: "start", reason: "fresh" }, "tunggu", "skip");
        for (const r of run) {
          if (r.phase !== "ready") continue;
          const where = `al-fatihah ${ayah} ${seq.steps[r.idx].id} #${held}`;
          expect(r.heldMs, where).toBe(0);
          let s = r;
          for (let t = 0; t < SCREEN_IDLE_LIMIT_MS / 1000; t++) {
            expect([screenAwake(s), wantsIdleTicks(s)], `${where} after ${t} s`).toEqual(["on", true]);
            s = reduceAutoplay(seq, s, { type: "idle_tick", ms: 1000 });
          }
          expect([s.heldMs, screenAwake(s), waitedTooLong(s), wantsIdleTicks(s)], where).toEqual([SCREEN_IDLE_LIMIT_MS, "off", true, false]);
          expect(screenAwake(s), where).toBe(rule(s));
          // ONLY THE LOCK: nothing but the silence counted has changed; the caption is held, the
          // "Lanjut" button shown, the lesson running, the look-ahead the same.
          expect({ ...s, heldMs: 0 }, where).toEqual(r);
          expect(viewAutoplay(seq, s), where).toEqual(viewAutoplay(seq, r));
          expect([lessonRuns(s), viewAutoplay(seq, s).showLanjut], where).toEqual([true, true]);
          expect(lookaheadAudio(seq, s), where).toEqual(lookaheadAudio(seq, r));
          // "Lanjut" (also to the caption's next part): on again, counted from zero.
          const next = reduceAutoplay(seq, s, { type: "next" });
          expect([screenAwake(next), next.heldMs], where).toEqual([next.phase === "finished" ? rule(next) : "on", 0]);
          // "Jeda" then "Lanjutkan": the caption is held again, from zero.
          const paused = reduceAutoplay(seq, s, { type: "pause" });
          const back = reduceAutoplay(seq, paused, { type: "resume" });
          expect([screenAwake(paused), paused.heldMs, back.phase, back.heldMs, screenAwake(back)], where).toEqual(["off", 0, "ready", 0, "on"]);
          // Leaving "Tunggu saya" reads on: on.
          const biasa = reduceAutoplay(seq, s, { type: "set_pace", pace: "biasa" });
          expect([screenAwake(biasa), biasa.heldMs], where).toEqual([biasa.phase === "finished" ? rule(biasa) : "on", 0]);
          held++;
        }
        // The silence is counted in "ready" only: a tick while the lesson runs changes nothing.
        for (const r of run) if (r.phase === "running") expect(reduceAutoplay(seq, r, { type: "idle_tick", ms: 1000 })).toBe(r);
      }
      expect(held).toBeGreaterThan(100);
    },
    WALK_TIMEOUT_MS,
  );
});

/** navigator.wakeLock, recorded (as in src/lib/autoplay/wake.test.ts): each request, each release. */
function stubWakeLock() {
  const log: string[] = [];
  const wakeLock: WakeLockLike = {
    request(type) {
      log.push(`request:${type}`);
      const listeners: (() => void)[] = [];
      const s = {
        released: false,
        release() {
          if (!s.released) {
            s.released = true;
            log.push("release");
            listeners.forEach((cb) => cb());
          }
          return Promise.resolve();
        },
        addEventListener: (_type: "release", cb: () => void) => void listeners.push(cb),
      };
      return Promise.resolve(s);
    },
  };
  return { wakeLock, log };
}

describe("a lesson page and the document's wake-lock holder (what useWakeLock runs: followScreenAwake / leaveScreenAwake)", () => {
  /** A lesson page, as useWakeLock drives the holder: arrived() on mount with the mode "off", the
   *  holder following the lesson's mode whenever it changes, leaveScreenAwake on unmount. */
  function page(h: ReturnType<typeof createWakeLockHolder>) {
    let mode: ScreenAwake = "off";
    h.arrived();
    followScreenAwake(h, "off", "off");
    return {
      see(s: AutoplayState) {
        const next = screenAwake(s);
        if (next === mode) return;
        followScreenAwake(h, mode, next);
        mode = next;
      },
      unmount: () => leaveScreenAwake(h, mode),
      mode: () => mode,
    };
  }

  it(
    "Al-Fatihah played through, ayah after ayah: asked for once at \"Mulai\", kept across every hand-off, released at the end of the surah",
    async () => {
      vi.useFakeTimers();
      try {
        const lock = stubWakeLock();
        const h = createWakeLockHolder({ wakeLock: () => lock.wakeLock, visible: () => true });
        for (const { ayah, seq } of fatihah) {
          const pg = page(h);
          pg.see(createAutoplayState(seq));
          await vi.advanceTimersByTimeAsync(300); // the page shown; then "Mulai", or the hand-off's start
          expect(lock.log, `al-fatihah ${ayah}: on arrival`).toEqual(ayah === 1 ? [] : ["request:screen"]);
          for (const s of walk(seq, { type: "start", reason: ayah === 1 ? "fresh" : "continue" }, "biasa", "skip")) {
            pg.see(s);
            await vi.advanceTimersByTimeAsync(50);
            if (s.phase !== "finished") expect([lock.log, h.holding()], `al-fatihah ${ayah}`).toEqual([["request:screen"], true]);
          }
          pg.unmount();
          await vi.advanceTimersByTimeAsync(800); // the page change
        }
        // The last ayah's end is the end of the surah: let go.
        expect(lock.log).toEqual(["request:screen", "release"]);
        await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS * 2);
        expect(lock.log).toEqual(["request:screen", "release"]);
      } finally {
        vi.useRealTimers();
      }
    },
    WALK_TIMEOUT_MS,
  );

  it("a lesson's life: Jeda lets go, Lanjutkan asks again; an exercise left two minutes lets go, an answer asks again; leaving mid-lesson lets go", async () => {
    vi.useFakeTimers();
    try {
      const lock = stubWakeLock();
      const h = createWakeLockHolder({ wakeLock: () => lock.wakeLock, visible: () => true });
      const { seq } = fatihah[1];
      const exIdx = seq.steps.findIndex((st) => st.exercise);
      const key = seq.steps[exIdx].exercise!.key;
      const pg = page(h);
      let s = createAutoplayState(seq);
      const send = async (e: AutoplayEvent) => {
        s = reduceAutoplay(seq, s, e);
        pg.see(s);
        await vi.advanceTimersByTimeAsync(0);
      };
      pg.see(s);
      await vi.advanceTimersByTimeAsync(5000);
      expect(lock.log).toEqual([]); // a page only looked at
      await send({ type: "start", from: exIdx, reason: "restore" });
      expect(lock.log).toEqual(["request:screen"]);
      await send({ type: "pause" });
      await send({ type: "resume" });
      expect(lock.log).toEqual(["request:screen", "release", "request:screen"]);
      // The exercise is left alone: its lines, its three reminders, then two minutes of silence.
      for (let i = 0; i < 400 && screenAwake(s) === "on"; i++) {
        const a = s.activity;
        await send(a ? (a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token }) : { type: "idle_tick", ms: 1000 });
      }
      expect([s.phase, s.exercise?.reminders, s.exercise?.idleMs]).toEqual(["waiting", 3, SCREEN_IDLE_LIMIT_MS]);
      expect(lock.log).toEqual(["request:screen", "release", "request:screen", "release"]);
      // The learner answers (wrongly): the lock is taken again; the lesson went nowhere.
      await send({ type: "answered", key, correct: false, question: 1 });
      expect(lock.log).toEqual(["request:screen", "release", "request:screen", "release", "request:screen"]);
      expect([s.phase, s.idx]).toEqual(["waiting", exIdx]);
      // The page left mid-lesson (a link elsewhere): let go at once.
      pg.unmount();
      expect(lock.log).toEqual(["request:screen", "release", "request:screen", "release", "request:screen", "release"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hand-off the next page does not take up (its lesson does not start): that page releases nothing on mount, the holder lets go after the grace", async () => {
    vi.useFakeTimers();
    try {
      const lock = stubWakeLock();
      const h = createWakeLockHolder({ wakeLock: () => lock.wakeLock, visible: () => true });
      const first = page(h);
      const run = walk(fatihah[0].seq, { type: "start", reason: "fresh" }, "biasa", "skip");
      for (const s of run) first.see(s);
      await vi.advanceTimersByTimeAsync(0);
      expect(first.mode()).toBe("hand-off");
      first.unmount();
      const second = page(h);
      second.see(createAutoplayState(fatihah[1].seq)); // "Mulai" shown: off from the start
      await vi.advanceTimersByTimeAsync(WAKE_HANDOFF_GRACE_MS - 1);
      expect(lock.log).toEqual(["request:screen"]);
      await vi.advanceTimersByTimeAsync(1);
      expect(lock.log).toEqual(["request:screen", "release"]);
      // Left without a lesson: nothing more.
      second.unmount();
      expect(lock.log).toEqual(["request:screen", "release"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the narration listed ahead, across steps (operator 2026-10-12, lookahead.ts)", () => {
  it("nothing on a page view, nothing once the lesson has finished", () => {
    for (const { seq } of fatihah) {
      expect(lookaheadAudio(seq, createAutoplayState(seq))).toEqual([]);
      expect(lookaheadAudio(seq, createAutoplayState(seq, { idx: 5 }))).toEqual([]);
      const run = walk(seq, { type: "start", reason: "fresh" }, "biasa", "skip");
      expect(lookaheadAudio(seq, run[run.length - 1])).toEqual([]);
    }
  });

  it(
    "follows the lesson's own path: exactly what it then plays — this step's rest and the next steps, in order, each once",
    () => {
      let checked = 0;
      let maxBytes = 0;
      for (const { ayah, seq } of fatihah) {
        const ms = durations(seq);
        const bytes = (urls: string[]) => urls.reduce((n, u) => n + (ms.get(u) ?? 0) * NARRATION_BYTES_PER_MS, 0);
        const exKey = seq.steps.find((st) => st.exercise)?.exercise?.key;
        // Done before its step is reached (the learner did it below the stage): the lesson
        // passes it, and so does the look-ahead.
        const befores: AutoplayEvent[][] = [[], ...(exKey ? [[{ type: "exercise_done", key: exKey } as AutoplayEvent]] : [])];
        for (const pace of PACES) {
          for (const start of STARTS(seq)) {
            for (const exercise of ["skip", "done"] as const) {
              for (const before of befores) {
                const run = walk(seq, start, pace, exercise, before);
                run.forEach((s, k) => {
                  const at = `al-fatihah ${ayah} ${pace} ${start.reason} ${exercise}${before.length ? " (exercise done before)" : ""} #${k} ${seq.steps[s.idx].id}`;
                  const unlimited = lookaheadAudio(seq, s, { maxBytes: Infinity });
                  const list = lookaheadAudio(seq, s);
                  // The order the lesson really plays them, over the rest of this step + 2 steps.
                  expect(unlimited, at).toEqual(expectedAhead(run, k, LOOKAHEAD_STEPS));
                  for (const n of [0, 1, 3]) expect(lookaheadAudio(seq, s, { steps: n, maxBytes: Infinity }), `${at} steps ${n}`).toEqual(expectedAhead(run, k, n));
                  // Each file once, and never the one playing now.
                  expect(new Set(list).size, at).toBe(list.length);
                  if (s.activity?.kind === "narrate") expect(list, at).not.toContain(s.activity.url);
                  // The byte cap: the start of that order, cut before the first file past ~1.5 MB.
                  expect(unlimited.slice(0, list.length), at).toEqual(list);
                  expect(bytes(list), at).toBeLessThanOrEqual(LOOKAHEAD_MAX_BYTES);
                  if (list.length < unlimited.length) {
                    expect(bytes(unlimited.slice(0, list.length + 1)), at).toBeGreaterThan(LOOKAHEAD_MAX_BYTES);
                  }
                  maxBytes = Math.max(maxBytes, bytes(list));
                  // The exercise done before is never listed (its introduction is its own file).
                  if (before.length && exKey) {
                    const lead = seq.steps.find((st) => st.exercise?.key === exKey)?.exercise?.lead ?? [];
                    const st = seq.steps.find((x) => x.exercise?.key === exKey);
                    for (const c of lead) for (const f of st?.cues[c].audio ?? []) expect(list, at).not.toContain(f.url);
                  }
                  checked++;
                });
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(20_000);
      // Measured 2026-10-12 (lookahead.ts): the largest look-ahead of any Al-Fatihah moment is
      // ~768 KB and the cap never cuts — a bound for longer narration, not today's limit. The cut
      // itself is checked with smaller caps below.
      expect(maxBytes).toBeLessThanOrEqual(LOOKAHEAD_MAX_BYTES);
    },
    WALK_TIMEOUT_MS,
  );

  it("a line whose audio failed this visit is caption-only from then on: its files are not listed", () => {
    for (const { ayah, seq } of fatihah) {
      const start = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
      const ahead = lookaheadAudio(seq, start, { steps: 3, maxBytes: Infinity });
      // Every step line the look-ahead lists right after "Mulai", failed in turn.
      const lineOf = new Map(seq.steps.flatMap((st) => st.cues.flatMap((c) => c.audio.map((f) => [f.url, c.line] as const))));
      for (const line of [...new Set(ahead.map((u) => lineOf.get(u)).filter((l): l is string => !!l))]) {
        const failed: AutoplayState = { ...start, noAudio: [...start.noAudio, line] };
        const list = lookaheadAudio(seq, failed, { steps: 3, maxBytes: Infinity });
        const files = seq.steps.flatMap((st) => st.cues.filter((c) => c.line === line).flatMap((c) => c.audio.map((f) => f.url)));
        for (const f of files) expect(list, `al-fatihah ${ayah}: ${line}`).not.toContain(f);
        // …and the rest is what the lesson then plays.
        const run = [failed];
        for (let i = 0; i < 5000; i++) {
          const e = answer(seq, run[run.length - 1], "skip");
          if (!e) break;
          run.push(reduceAutoplay(seq, run[run.length - 1], e));
        }
        expect(list, `al-fatihah ${ayah}: ${line}`).toEqual(expectedAhead(run, 0, 3));
      }
    }
  });

  it("cuts at the byte cap: the start of the order, never a file skipped for a smaller one after it", () => {
    for (const { seq } of fatihah) {
      const ms = durations(seq);
      const run = walk(seq, { type: "start", reason: "fresh" }, "biasa", "skip");
      for (const s of run) {
        const unlimited = lookaheadAudio(seq, s, { maxBytes: Infinity });
        for (const cap of [0, 50_000, 200_000, 400_000]) {
          const list = lookaheadAudio(seq, s, { maxBytes: cap });
          expect(unlimited.slice(0, list.length)).toEqual(list);
          const used = list.reduce((n, u) => n + (ms.get(u) ?? 0) * NARRATION_BYTES_PER_MS, 0);
          expect(used).toBeLessThanOrEqual(cap);
          if (list.length < unlimited.length) expect(used + (ms.get(unlimited[list.length]) ?? 0) * NARRATION_BYTES_PER_MS).toBeGreaterThan(cap);
        }
      }
    }
  });

  it("with Save-Data or a 2G connection: the rest of this step and one step ahead", () => {
    for (const { seq } of fatihah) {
      for (const s of walk(seq, { type: "start", reason: "fresh" }, "biasa", "skip")) {
        const one = lookaheadAudio(seq, s, { steps: 1 });
        const two = lookaheadAudio(seq, s, { steps: 2 });
        for (const conn of [{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }, { saveData: true, effectiveType: "4g" }]) {
          expect(lookaheadAudio(seq, s, { conn })).toEqual(one);
        }
        for (const conn of [null, {}, { effectiveType: "3g" }, { effectiveType: "4g" }, { saveData: false }]) {
          expect(lookaheadAudio(seq, s, { conn })).toEqual(two);
        }
      }
    }
  });

  it("the remembered place: from step N on, nothing of the steps before it", () => {
    for (const { ayah, seq } of fatihah) {
      // A place early in the lesson whose own line is rendered: found, not numbered (step 4 was
      // one until the lines of the lesson map and of the warm-up, 2026-10-13, which have no file
      // until they are rendered — a place with nothing to fetch has nothing to check).
      const early = seq.steps.findIndex((st, i) => i >= 4 && st.cues.some((c) => c.audio.length > 0));
      expect(early, `al-fatihah ${ayah}`).toBeGreaterThanOrEqual(4);
      for (const from of [1, early, seq.steps.length - 2]) {
        const s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "restore", from });
        expect(s.idx).toBe(from);
        const before = new Set(seq.steps.slice(0, from).flatMap((st) => st.cues.flatMap((c) => c.audio.map((f) => f.url))));
        const after = new Set(seq.steps.slice(from).flatMap((st) => st.cues.flatMap((c) => c.audio.map((f) => f.url))));
        const list = lookaheadAudio(seq, s);
        expect(list.length, `al-fatihah ${ayah} from ${from}`).toBeGreaterThan(0);
        for (const u of list) expect(!before.has(u) || after.has(u), `al-fatihah ${ayah} from ${from}: ${fileOwner(u)}`).toBe(true);
        // The resume line plays now ("Lanjutkan dari langkah N"); the first listed is the step's.
        expect(s.activity?.kind).toBe("narrate");
        expect(fileOwner(list[0])).toMatch(new RegExp(`(^| )al-fatihah:${ayah}:`));
      }
    }
  });

  it("at an exercise: what it says by itself ahead of it; while it waits, nothing of its feedback, the steps after it", () => {
    for (const { ayah, seq } of fatihah) {
      // The first exercise whose introduction is rendered (the warm-up that opens the lesson,
      // 2026-10-13, is caption-only until its lines are; then it is the one found here).
      const exIdx = seq.steps.findIndex((st) => st.exercise && st.exercise.lead.some((c) => st.cues[c].audio.length > 0));
      expect(exIdx, `al-fatihah ${ayah}`).toBeGreaterThan(0);
      const ex = seq.steps[exIdx];
      const spec = ex.exercise!;
      const own = [...spec.lead, spec.promptCue[spec.parts[0]]].filter((c): c is number => c !== undefined).flatMap((c) => ex.cues[c].audio.map((f) => f.url));
      expect(own.length, `al-fatihah ${ayah} ${ex.id}`).toBeGreaterThan(0);
      // Two steps before: the exercise's introduction and opening prompt are listed, in order.
      let s = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "restore", from: exIdx - 1 });
      const list = lookaheadAudio(seq, s, { maxBytes: Infinity });
      const at = list.indexOf(own[0]);
      expect(at, `al-fatihah ${ayah}: ${ex.id}'s introduction not listed`).toBeGreaterThanOrEqual(0);
      expect(list.slice(at, at + own.length)).toEqual(own);
      // Its feedback ("Benar.", the explanations) depends on the learner: never listed ahead.
      const feedback = new Set([...Object.values(spec.explain)].flatMap((c) => (c === undefined ? [] : ex.cues[c].audio.map((f) => f.url))));
      for (const f of seq.shared.correct.audio) feedback.add(f.url);
      for (const u of list) expect(feedback.has(u), `al-fatihah ${ayah}: ${fileOwner(u)}`).toBe(false);
      // Waiting for the learner: nothing more of this step (no feedback); the steps after it,
      // starting with the next one's first line.
      for (let i = 0; i < 400 && !(s.phase === "waiting" && s.idx === exIdx); i++) s = reduceAutoplay(seq, s, answer(seq, s, "skip")!);
      expect([s.phase, s.idx]).toEqual(["waiting", exIdx]);
      const waiting = lookaheadAudio(seq, s, { maxBytes: Infinity });
      const later = new Set(seq.steps.slice(exIdx + 1).flatMap((st) => st.cues.flatMap((c) => c.audio.map((f) => f.url))));
      for (const u of waiting) expect(later.has(u), `al-fatihah ${ayah} waiting at ${ex.id}: ${fileOwner(u)}`).toBe(true);
      const nextFirst = seq.steps[exIdx + 1].cues.find((c) => c.audio.length)?.audio[0]?.url;
      if (nextFirst) expect(waiting[0], `al-fatihah ${ayah} after ${ex.id}`).toBe(nextFirst);
    }
  });

  it("never another ayah's file, never the imam's recitation: this ayah's narration and the shared lines only", () => {
    let lists = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const seq = stageSequence(s, a, "id");
        const mine = ownFiles(seq);
        for (const pace of PACES) {
          for (const st of walk(seq, { type: "start", reason: "fresh" }, pace, "skip")) {
            for (const u of lookaheadAudio(seq, st, { steps: 99, maxBytes: Infinity })) {
              // A file of this ayah's own lines or of the shared ones (a line of another ayah with
              // the very same text is the same file, and is this ayah's too).
              expect(mine.has(u), `${s.slug} ${a.ayah}: ${u} (${fileOwner(u)})`).toBe(true);
              expect([...(owners.get(u) ?? [])].some((id) => id.startsWith(`${s.slug}:${a.ayah}:`) || id.startsWith("shared:")), u).toBe(true);
              expect(u.startsWith(NARRATION_MEDIA_PREFIX) && isNarrationUrl(u), u).toBe(true);
              expect(recordings.has(u), u).toBe(false);
            }
            lists++;
          }
        }
        // The last step lists nothing past itself: the next ayah's page fetches its own.
        const last = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "restore", from: seq.steps.length - 1 });
        const own = new Set(seq.steps[seq.steps.length - 1].cues.flatMap((c) => c.audio.map((f) => f.url)));
        for (const u of lookaheadAudio(seq, last, { steps: 99, maxBytes: Infinity })) expect(own.has(u), u).toBe(true);
        // An English page is caption-only: nothing to fetch.
        const en = stageSequence(s, a, "en");
        expect(lookaheadAudio(en, reduceAutoplay(en, createAutoplayState(en), { type: "start", reason: "fresh" }))).toEqual([]);
      }
    }
    expect(lists).toBeGreaterThan(1000);
  }, WALK_TIMEOUT_MS);
});

/**
 * A lesson played in (fake) time with the page's prefetcher, as useAutoplay runs it — the same
 * pure parts (aheadUpdate → createPrefetcher.update, nextLinePreload), a stubbed fetch that
 * delivers each file at `bytesPerMs` (its size from the manifest's duration, 8 bytes a
 * millisecond), stubbed object URLs. Each activity lasts as long as the lesson says (a narration
 * file its manifest duration); the learner taps "Lewati latihan" / "Lanjut" a moment after the
 * lesson waits. `drive(s, time)` may return an event of the learner's (a jump) at any state.
 */
async function playLesson(
  seq: AutoplaySequence,
  start: Start,
  pace: Pace,
  opts: {
    bytesPerMs: number;
    conn?: ConnectionHints;
    /** The learner's own event at this state (asked once per state), or null. */
    drive?: (s: AutoplayState, n: number) => AutoplayEvent | null;
    maxStates?: number;
  },
) {
  const ms = durations(seq);
  const sizeOf = (url: string) => (ms.get(url) ?? 0) * NARRATION_BYTES_PER_MS;
  type Call = { url: string; start: number; end: number | null; aborted: boolean };
  const calls: Call[] = [];
  let live = 0;
  let maxLive = 0;
  const fetch: PrefetchFetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const call: Call = { url, start: Date.now(), end: null, aborted: false };
      calls.push(call);
      maxLive = Math.max(maxLive, ++live);
      const timer = setTimeout(() => {
        live--;
        call.end = Date.now();
        // A small body stands for the file (its real size is counted from the manifest).
        resolve(new Response(new Uint8Array(16), { status: 200, headers: { "content-type": "audio/mpeg" } }));
      }, Math.ceil(sizeOf(url) / opts.bytesPerMs));
      init.signal?.addEventListener("abort", () => {
        if (call.end !== null) return;
        clearTimeout(timer);
        live--;
        call.end = Date.now();
        call.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  const alive = new Set<string>();
  let made = 0;
  const p = createPrefetcher({
    fetch,
    createObjectURL: () => {
      const u = `blob:test/${++made}`;
      alive.add(u);
      return u;
    },
    revokeObjectURL: (u) => {
      if (!alive.delete(u)) throw new Error(`revoked ${u} twice`);
    },
  });
  const files = [...ownFiles(seq)];
  /** The lines played: where from, and what happened to the fetch of that file at that moment. */
  const lines: { url: string; idx: number; at: number; fromCopy: boolean; cancelledItsFetch: boolean }[] = [];
  const problems: string[] = [];
  let maxHeld = 0;
  let preloadedFromNetwork = 0;
  let s = createAutoplayState(seq, { pace });
  let heardFor: number | null = null;
  /** The runner's effect: the prefetcher told, the next-line preload decided. */
  const push = () => {
    const u = aheadUpdate(seq, s, { conn: opts.conn, soundLoading: false, heardFor });
    const flying = calls.filter((c) => c.end === null);
    p.update(u);
    // A fetch is cancelled only when its file has left the path.
    for (const c of flying) if (c.aborted && (u.path.includes(c.url) || u.wanted.includes(c.url))) problems.push(`the fetch of ${c.url} was cancelled while its file was still ahead`);
    // Kept: only what is ahead or playing; never more than the look-ahead's cap plus the file playing.
    const heldNow = files.filter((f) => p.held(f) !== null);
    for (const f of heldNow) if (f !== u.playing && !u.path.includes(f)) problems.push(`a copy of ${f} is kept though it is neither ahead nor playing`);
    const bytes = heldNow.reduce((n, f) => n + sizeOf(f), 0);
    maxHeld = Math.max(maxHeld, bytes);
    if (bytes > LOOKAHEAD_MAX_BYTES + (u.playing ? sizeOf(u.playing) : 0)) problems.push(`${bytes} bytes held`);
    if (alive.size !== heldNow.length) problems.push(`${alive.size} object URLs alive for ${heldNow.length} copies held`);
    // The next line of this step (as the runner finds it): the preload element downloads it only
    // if the page will not.
    const target = nextLinePreload(nextNarration(seq, s), p);
    if (target !== null && p.held(target) === null) preloadedFromNetwork++;
    return u;
  };
  const wait = (n: number) => vi.advanceTimersByTimeAsync(Math.max(0, n));

  push();
  await wait(5000);
  const beforeStart = calls.length;
  s = reduceAutoplay(seq, s, { ...start, pace });
  let n = 0;
  for (; n < (opts.maxStates ?? 5000) && s.phase !== "finished"; n++) {
    const a = s.activity;
    let ends: AutoplayEvent;
    let lasts: number;
    if (a?.kind === "narrate") {
      // The executor first (as the runner's effects are ordered): where the line plays from.
      const copy = p.held(a.url);
      const flying = calls.find((c) => c.end === null && c.url === a.url);
      push(); // the line asked for, not heard yet: no new fetch
      lines.push({ url: a.url, idx: s.idx, at: Date.now(), fromCopy: copy !== null, cancelledItsFetch: !!flying?.aborted });
      if (flying && !flying.aborted) problems.push(`${a.url} plays from the network while its fetch goes on: two downloads of one file`);
      // A copy is heard within a moment; a network line once its first bytes are there.
      const heardAfter = Math.min(copy ? 20 : 300, a.ms);
      const stillHeld = () => {
        if (copy !== null && p.held(a.url) !== copy) problems.push(`the copy of ${a.url} was let go while it plays`);
      };
      stillHeld();
      await wait(heardAfter);
      heardFor = a.token;
      push();
      stillHeld();
      ends = { type: "narration_end", token: a.token };
      lasts = a.ms - heardAfter;
    } else if (a?.kind === "read" || a?.kind === "wait") {
      push();
      ends = { type: "timer", token: a.token };
      lasts = a.ms;
    } else if (a?.kind === "recite") {
      push();
      ends = { type: "recite_end", token: a.token };
      // The imam, and at least the reading time the lesson gives the caption beside him (the
      // runner ends a recitation only when both are through): a word, an example beat.
      lasts = Math.max(a.target === "ayah" ? 6000 : a.target === "clip" ? a.clip.end - a.clip.start : 1200, a.minMs);
    } else if (s.phase === "waiting") {
      push();
      ends = { type: "skip" };
      lasts = 1500;
    } else if (s.phase === "ready") {
      push();
      ends = { type: "next" };
      lasts = 1000;
    } else {
      break; // paused: nothing moves the lesson
    }
    const own = opts.drive?.(s, n) ?? null;
    if (own) {
      // The learner acts part-way through.
      await wait(Math.min(lasts, 700));
      s = reduceAutoplay(seq, s, own);
    } else {
      await wait(lasts);
      s = reduceAutoplay(seq, s, ends);
    }
  }
  // Finished (the hand-off) — or stopped where the test said: the runner's last update.
  push();
  const aliveAtEnd = alive.size;
  const flyingAtEnd = calls.filter((c) => c.end === null).length;
  p.stop();
  await wait(0);
  return { s, calls, lines, problems, maxLive, maxHeld, made, beforeStart, aliveAtEnd, flyingAtEnd, aliveAfterStop: alive.size, preloadedFromNetwork, files: new Set(files), sizeOf };
}

describe("the lesson played with the page's prefetcher (ahead.ts aheadUpdate + prefetch.ts, as useAutoplay runs them)", () => {
  /** 800 kbps: any phone connection that is not struggling. */
  const FAST = 100;
  /** 40 kbps: slower than the narration itself (64 kbps) — nothing can be fetched in time. */
  const SLOW = 5;

  it(
    "every Al-Fatihah lesson, every pace and start: after the line playing at the start, EVERY line plays from the copy the page fetched — each file fetched once, one at a time, none cancelled, all let go at the end",
    async () => {
      vi.useFakeTimers();
      try {
        let lines = 0;
        let refetched = 0;
        for (const { ayah, seq } of fatihah) {
          for (const pace of PACES) {
            for (const start of STARTS(seq)) {
              const where = `al-fatihah ${ayah} ${pace} ${start.reason}`;
              const r = await playLesson(seq, start, pace, { bytesPerMs: FAST });
              expect(r.s.phase, where).toBe("finished");
              expect(r.problems, where).toEqual([]);
              // Nothing before "Mulai".
              expect(r.beforeStart, where).toBe(0);
              // The first line is asked for by the click itself; every later one was fetched ahead.
              expect(r.lines.length, where).toBeGreaterThan(5);
              const fromNetwork = r.lines.filter((l) => !l.fromCopy);
              expect(fromNetwork.map((l) => l.url), where).toEqual([r.lines[0].url]);
              // One fetch at a time; none cancelled (a file that becomes the next line keeps its
              // fetch); the file playing at the start never fetched.
              expect(r.maxLive, where).toBe(1);
              const fetched = r.calls.map((c) => c.url);
              expect(r.calls.filter((c) => c.aborted), where).toEqual([]);
              expect(fetched, where).not.toContain(r.lines[0].url);
              // Exactly the lines the lesson then played, in the order it played them: one fetch
              // for each — a file fetched twice only where two lines far apart are the same file
              // (the same words: its copy was let go after the first, measured on ayat 3, 6, 7).
              const played = r.lines.slice(1).map((l) => l.url);
              expect(fetched.length, where).toBeLessThanOrEqual(played.length);
              expect(fetched.filter((u, k) => fetched.indexOf(u) === k), where).toEqual(played.filter((u, k) => played.indexOf(u) === k));
              for (const u of new Set(fetched)) expect(fetched.filter((x) => x === u).length, `${where}: ${fileOwner(u)}`).toBeLessThanOrEqual(played.filter((x) => x === u).length);
              refetched += fetched.length - new Set(fetched).size;
              // Never another ayah's file (nor the imam's): this lesson's narration only.
              for (const u of fetched) expect(r.files.has(u), `${where}: ${u}`).toBe(true);
              // The preload element downloaded nothing: the page fetched every next line itself.
              expect(r.preloadedFromNetwork, where).toBe(0);
              // Bounded, and everything let go when the lesson has finished — before the unmount.
              expect(r.maxHeld, where).toBeLessThanOrEqual(LOOKAHEAD_MAX_BYTES);
              expect([r.aliveAtEnd, r.flyingAtEnd, r.aliveAfterStop], where).toEqual([0, 0, 0]);
              expect(r.made, where).toBe(fetched.length);
              lines += r.lines.length;
            }
          }
        }
        // Not vacuous. The number follows what is rendered: 2,244 lines played from a copy when
        // every Al-Fatihah line had its voice; 1,896 on 2026-10-13, with the lines whose text is
        // new (the lesson map's, the structure told item by item) waiting for their render.
        expect(lines).toBeGreaterThan(1500);
        // A second fetch of a file is rare: only those few repeated lines (24 of 2,244 lines played,
        // 2026-10-13) — and `force-cache` answers it from the browser's HTTP cache.
        expect(refetched).toBeLessThan(lines / 50);
      } finally {
        vi.useRealTimers();
      }
    },
    WALK_TIMEOUT_MS,
  );

  it(
    "a link slower than the narration: a line whose copy is not whole yet streams from the network and its own fetch is cancelled — never two downloads of one file, never two fetches at once, nothing fetched twice",
    async () => {
      vi.useFakeTimers();
      try {
        let streamed = 0;
        let cancelled = 0;
        for (const { ayah, seq } of fatihah) {
          const where = `al-fatihah ${ayah}`;
          const r = await playLesson(seq, { type: "start", reason: "fresh" }, "biasa", { bytesPerMs: SLOW });
          expect(r.s.phase, where).toBe("finished");
          // (problems: a fetch cancelled while its file was still ahead; a line streaming while
          // its fetch went on; a copy kept that is neither ahead nor playing.)
          expect(r.problems, where).toEqual([]);
          expect(r.maxLive, where).toBe(1);
          // A fetch is cancelled only because its own file started playing (the stream was chosen).
          const cancelledUrls = r.calls.filter((c) => c.aborted).map((c) => c.url);
          expect(cancelledUrls, where).toEqual(r.lines.filter((l) => l.cancelledItsFetch).map((l) => l.url));
          // Nothing is downloaded twice for one line: a cancelled file is playing, not ahead
          // (a file is fetched again only for another line that is the same file).
          const fetched = r.calls.map((c) => c.url);
          for (const u of new Set(fetched)) expect(fetched.filter((x) => x === u).length, `${where}: ${fileOwner(u)}`).toBeLessThanOrEqual(r.lines.filter((l) => l.url === u).length);
          // A line streams from the network only when no whole copy of it was there: a fetch of
          // it that ended in time is always the one played.
          for (const l of r.lines) {
            const whole = r.calls.some((c) => c.url === l.url && !c.aborted && c.end !== null && c.end <= l.at);
            expect(l.fromCopy, `${where}: ${fileOwner(l.url)}`).toBe(whole);
          }
          expect([r.aliveAtEnd, r.flyingAtEnd, r.aliveAfterStop], where).toEqual([0, 0, 0]);
          streamed += r.lines.filter((l) => !l.fromCopy).length;
          cancelled += cancelledUrls.length;
        }
        // The case is really met: lines streamed, fetches cancelled for it.
        expect(streamed).toBeGreaterThan(50);
        expect(cancelled).toBeGreaterThan(20);
      } finally {
        vi.useRealTimers();
      }
    },
    WALK_TIMEOUT_MS,
  );

  it("Save-Data / 2G: nothing is fetched further than one step ahead, and the lines still play from their copies", async () => {
    vi.useFakeTimers();
    try {
      for (const conn of [{ saveData: true }, { effectiveType: "2g" }]) {
        const { seq } = fatihah[0];
        const seen: string[] = [];
        const r = await playLesson(seq, { type: "start", reason: "fresh" }, "biasa", {
          bytesPerMs: FAST,
          conn,
          drive: (s) => {
            // What may be fetched at this moment: one step ahead.
            for (const u of lookaheadAudio(seq, s, { steps: 1 })) if (!seen.includes(u)) seen.push(u);
            return null;
          },
        });
        expect(r.problems).toEqual([]);
        const fetched = r.calls.map((c) => c.url);
        for (const u of fetched) expect(seen, u).toContain(u);
        expect(r.lines.filter((l) => !l.fromCopy).map((l) => l.url)).toEqual([r.lines[0].url]);
        // At the start: the intro line and the next step's, not the step two steps on — the
        // lesson map's first line (plan L23, L26; the primer's before those steps existed). That
        // line has a file only once it is rendered: until then nothing lies two steps ahead of the
        // start.
        const first = reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" });
        const u = aheadUpdate(seq, first, { conn, soundLoading: false, heardFor: null });
        expect(u.wanted).toEqual(lookaheadAudio(seq, first, { steps: 1 }));
        expect(u.path).toEqual(lookaheadAudio(seq, first, { steps: LOOKAHEAD_STEPS }));
        const twoOn = seq.steps[2].cues.flatMap((c) => c.audio.map((f) => f.url));
        expect(u.path).toEqual([...u.wanted, ...twoOn]);
        // … and from a step whose step two ahead IS rendered: strictly further. Found, not named
        // (until 2026-10-13 it was the imam's step, then the harakat primer's — which is lesson
        // zero's now; a step named here would be the next to move): the first one after the start
        // whose step two on has a file. A bounded walk: a step that is gone must fail, not spin.
        // "Has a file" as the list itself counts it (an exercise two steps on is listed with
        // what it says by itself, its introduction and first prompt — not with its other prompts).
        const further = (st: AutoplayState) => lookaheadAudio(seq, st, { steps: LOOKAHEAD_STEPS }).length > lookaheadAudio(seq, st, { steps: 1 }).length;
        let onPrimer = reduceAutoplay(seq, first, { type: "next" });
        for (let k = 0; k < seq.steps.length && !further(onPrimer); k++) onPrimer = reduceAutoplay(seq, onPrimer, { type: "next" });
        const at = onPrimer.idx;
        expect(at).toBeGreaterThan(0);
        expect(further(onPrimer)).toBe(true);
        const v = aheadUpdate(seq, onPrimer, { conn, soundLoading: false, heardFor: null });
        expect(v.wanted).toEqual(lookaheadAudio(seq, onPrimer, { steps: 1 }));
        expect(v.path.length).toBeGreaterThan(v.wanted.length);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("the learner jumps (Berikutnya ×3, Sebelumnya, Ulangi) mid-lesson: copies and a fetch that left the path are let go, those still ahead are kept; everything is let go at the end", async () => {
    vi.useFakeTimers();
    try {
      for (const { ayah, seq } of fatihah) {
        const where = `al-fatihah ${ayah}`;
        const jumps: Record<number, AutoplayEvent> = { 6: { type: "next" }, 7: { type: "next" }, 8: { type: "next" }, 20: { type: "prev" }, 30: { type: "replay" }, 31: { type: "replay" } };
        const r = await playLesson(seq, { type: "start", reason: "fresh" }, "biasa", {
          bytesPerMs: 20, // 160 kbps: fetches are often under way when the learner jumps
          drive: (s, n) => (seq.steps[s.idx].exercise ? null : (jumps[n] ?? null)),
        });
        expect(r.s.phase, where).toBe("finished");
        expect(r.problems, where).toEqual([]);
        expect(r.maxLive, where).toBe(1);
        expect([r.aliveAtEnd, r.flyingAtEnd, r.aliveAfterStop], where).toEqual([0, 0, 0]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("the gate: no new fetch before \"Mulai\", while paused, while a sound is loading or stalled, or before the line just started is heard", () => {
    const { seq } = fatihah[0];
    const idle = createAutoplayState(seq);
    const env = { soundLoading: false, heardFor: null as number | null };
    expect(aheadUpdate(seq, idle, env)).toEqual({ wanted: [], path: [], playing: null, open: false, key: null });
    const s = reduceAutoplay(seq, idle, { type: "start", reason: "fresh" });
    const a = s.activity;
    if (a?.kind !== "narrate") throw new Error("the lesson does not start with a narration line");
    // The opening line was asked for and is not heard yet: closed; it is the file playing.
    expect(aheadUpdate(seq, s, env)).toMatchObject({ open: false, playing: a.url, key: a.token });
    expect(aheadUpdate(seq, s, env).wanted).toEqual(lookaheadAudio(seq, s));
    expect(aheadUpdate(seq, s, env).wanted).not.toContain(a.url);
    // Heard: open — unless the narrator's or the imam's sound is loading or stalled.
    expect(aheadUpdate(seq, s, { soundLoading: false, heardFor: a.token }).open).toBe(true);
    expect(aheadUpdate(seq, s, { soundLoading: true, heardFor: a.token }).open).toBe(false);
    // Another line's token is not this line heard.
    expect(aheadUpdate(seq, s, { soundLoading: false, heardFor: a.token - 1 }).open).toBe(false);
    // A pause between lines (no narration playing): open while the lesson runs.
    const between = reduceAutoplay(seq, s, { type: "narration_end", token: a.token });
    expect(between.activity?.kind).toBe("wait");
    expect(aheadUpdate(seq, between, env)).toMatchObject({ open: true, playing: null });
    // Paused: closed, and what was ahead stays on the path (kept).
    const paused = reduceAutoplay(seq, s, { type: "pause" });
    const u = aheadUpdate(seq, paused, { soundLoading: false, heardFor: a.token });
    expect([u.open, u.playing, u.key]).toEqual([false, null, null]);
    expect(u.path).toContain(a.url);
    // Finished: nothing wanted, nothing kept.
    const run = walk(seq, { type: "start", reason: "fresh" }, "biasa", "skip");
    expect(aheadUpdate(seq, run[run.length - 1], env)).toEqual({ wanted: [], path: [], playing: null, open: false, key: null });
  });

  it("the next file of this step is what the lesson plays next in it — never a part of a split line already played", () => {
    let split = 0;
    // PLANTED: a voiced line in two files. No line of Al-Fatihah is split any more (its only
    // long lines were the structure paragraphs, told item by item since 2026-10-13), and the rule
    // must hold for the surahs whose long lines will be: ayah 2 with its first voiced concept
    // line cut in two.
    const two = fatihah[1];
    const cut = two.seq.steps.findIndex((st) => st.kind === "concept" && st.cues[0]?.audio.length === 1);
    expect(cut).toBeGreaterThan(-1);
    const planted = {
      ayah: two.ayah,
      seq: {
        ...two.seq,
        steps: two.seq.steps.map((st, i) => {
          if (i !== cut) return st;
          const [whole] = st.cues[0].audio;
          const half = Math.floor(whole.ms / 2);
          const parts = [
            { ...whole, id: `${whole.id}:a`, url: whole.url.replace(/\.mp3$/, "-a.mp3"), ms: half, words: undefined },
            { ...whole, id: `${whole.id}:b`, url: whole.url.replace(/\.mp3$/, "-b.mp3"), ms: whole.ms - half, words: undefined },
          ];
          return { ...st, cues: [{ ...st.cues[0], audio: parts }, ...st.cues.slice(1)] };
        }),
      },
    };
    for (const { ayah, seq } of [...fatihah, planted]) {
      for (const pace of PACES) {
        const run = walk(seq, { type: "start", reason: "fresh" }, pace, "skip");
        run.forEach((s, k) => {
          const at = `al-fatihah ${ayah} ${pace} #${k} ${seq.steps[s.idx].id}`;
          // The first narration file the lesson then plays while still on this step.
          expect(nextNarration(seq, s), at).toBe(expectedAhead(run, k, 0)[0] ?? null);
          const a = s.activity;
          if (a?.kind === "narrate" && a.offsetMs > 0) {
            // The second part of a split line: its first part is not "next".
            const parts = seq.steps[s.idx].cues.find((c) => c.line === a.line)?.audio.map((f) => f.url) ?? [];
            expect(parts.length, at).toBeGreaterThan(1);
            expect(nextNarration(seq, s), at).not.toBe(parts[0]);
            split++;
          }
        });
      }
      expect(nextNarration(seq, createAutoplayState(seq))).toBeNull();
    }
    expect(split).toBeGreaterThan(0);
  });

  it("the next-line preload: the element is left alone while the page fetches that file, given the line once its copy is held, and the network URL only for a file the page will not fetch", () => {
    const A = "/belajar/media/narration/kang-nandar/al-fatihah/aaaaaaaaaaaaaaaa.mp3";
    const state = (held: string | null, pending: boolean) => ({ held: () => held, pending: () => pending });
    expect(nextLinePreload(null, state(null, false))).toBeNull();
    // Being fetched, or due: nothing for the preload element (no second download).
    expect(nextLinePreload(A, state(null, true))).toBeNull();
    // Held: the line (the player points the element at the copy).
    expect(nextLinePreload(A, state("blob:x", false))).toBe(A);
    // Not fetched by the page (failed, or not on its list): the network URL, as before.
    expect(nextLinePreload(A, state(null, false))).toBe(A);
    // No prefetcher (not mounted): as before the look-ahead.
    expect(nextLinePreload(A, null)).toBe(A);
  });
});

describe("wiring that only the source can show (operator 2026-10-12)", () => {
  it("the runner: one prefetcher fed by aheadUpdate, the player given its copies, the wake lock by the rule", () => {
    const runner = read("src/components/autoplay/useAutoplay.ts");
    expect(runner).toContain("const awake = screenAwake(state);");
    expect(runner).toContain("useWakeLock(awake);");
    expect(runner.match(/createPrefetcher\(/g)).toHaveLength(1);
    expect(runner).toContain("p?.update(aheadUpdate(seq, state, { conn, soundLoading, heardFor }));");
    expect(runner).toContain("preload(nextLinePreload(nextUrl, p));");
    expect(runner).toContain("useNarrationPlayer(heldNarration, dropNarration)");
    expect(runner).toContain("prefetchRef.current?.held(url) ?? null");
    expect(runner).toContain("prefetchRef.current?.discard(url)");
    // The browser's own functions, and everything let go on unmount.
    expect(runner).toContain("URL.createObjectURL(blob)");
    expect(runner).toContain("URL.revokeObjectURL(url)");
    expect(runner).toContain("p.stop();");
    // The executor (which asks the player where a line plays from) runs before the update that
    // may revoke: effects run in source order.
    expect(runner.indexOf("stop = playNarration(url, {")).toBeLessThan(runner.indexOf("p?.update(aheadUpdate("));
  });

  it("the player's hook runs voice.ts on its elements, and nothing compares an element's src with a manifest URL", () => {
    const hook = read("src/hooks/useNarrationPlayer.ts");
    const voice = read("src/lib/autoplay/voice.ts");
    expect(hook.match(/createNarrationVoice\(/g)).toHaveLength(1);
    expect(hook).toContain("held: (url) => heldRef.current?.(url) ?? null");
    expect(hook).toContain("onHeldFailed: (url) => failedRef.current?.(url)");
    for (const src of [hook, voice, read("src/components/autoplay/useAutoplay.ts")]) {
      expect(src).not.toMatch(/currentSrc/);
      // No element's src compared with anything (the attempt's own `at.src !== at.url` is not one).
      expect(src).not.toMatch(/\b(?:a|audio|pre|el|element)\.src\s*[!=]==?/);
    }
    // The one src read: the preload element's, against what it is about to be set to.
    expect(voice.match(/getAttribute\("src"\)/g)).toHaveLength(1);
    expect(voice).toContain('if (pre.getAttribute("src") === src) return;');
    // The CSP lets media play from blob: (next.config.ts).
    expect(read("next.config.ts")).toContain("`media-src 'self' blob: ${RECITATION_HOSTS.join(\" \")}`");
  });

  it("the wake lock is the browser's API only, one holder per document that outlives the hand-off — no video trick", () => {
    const hook = read("src/hooks/useWakeLock.ts");
    const holder = read("src/lib/autoplay/wake.ts");
    expect(holder).toContain('wl.request("screen")');
    expect(hook).toContain('"wakeLock" in navigator ? navigator.wakeLock : null');
    // Module level: kept across the client-side page change; one per document.
    expect(hook).toContain("let documentHolder: WakeLockHolder | null = null;");
    expect(hook.match(/createWakeLockHolder\(/g)).toHaveLength(1);
    // The page's part is the tested one (above).
    expect(hook).toContain("followScreenAwake(h, was, mode);");
    expect(hook).toContain("return () => leaveScreenAwake(h, box.mode);");
    expect(hook).toContain("h.arrived();");
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisibility)');
    for (const src of [hook, holder]) expect(src).not.toMatch(/createElement\(["']video|<video|\.mp4|webm/);
  });

  it("the CI browser check exists, and its constants are the app's", () => {
    const ci = read("scripts/ci/screenshots.mjs");
    expect(ci).toContain("async function aheadChecks(");
    expect(ci).toContain("await aheadChecks(page, vp, narration)");
    expect(ci).toContain("addInitScript");
    expect(ci).toContain(`const WAKE_GRACE_MS = ${WAKE_HANDOFF_GRACE_MS};`);
    expect(ci).toContain(`const AHEAD_SETTLE_MS = ${PREFETCH_SETTLE_MS};`);
    expect(ci).toContain(`const WAKE_REASK_MIN_HELD_MS = ${WAKE_REASK_MIN_HELD_MS};`);
    // It holds the players' own loads back, makes one fetch() fail, and counts each file's requests.
    expect(ci).toContain("narrationRoute(index, served, { delays, timeline, holdFetchMs: AHEAD_HOLD_MS, failFetch })");
    expect(read("scripts/ci/narration-route.mjs")).toContain("export function narrationRoute(index, served, { delays, timeline, holdFetchMs = 0, failFetch } = {})");
    // The CSP refuses eval: no waitForFunction call in the CI scripts.
    for (const f of ["scripts/ci/screenshots.mjs", "scripts/ci/narration-route.mjs"]) expect(read(f)).not.toMatch(/\.waitForFunction\(/);
  });
});
