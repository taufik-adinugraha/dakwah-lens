import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createAutoplayState,
  isNarrationUrl,
  keepsScreenAwake,
  LOOKAHEAD_MAX_BYTES,
  LOOKAHEAD_STEPS,
  lookaheadAudio,
  NARRATION_BYTES_PER_MS,
  NARRATION_MEDIA_PREFIX,
  reduceAutoplay,
  screenAwake,
  WAKE_HANDOFF_GRACE_MS,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type ScreenAwake,
} from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";
import { PACES, type Pace } from "@/lib/lessonSteps";

import { stageSequence } from "./build";

// The two behaviours of operator 2026-10-12 (docs/belajar-plan.md L18), over the lessons the page
// ships: the screen kept on exactly while a lesson runs (src/lib/autoplay/wake.ts), and the
// narration of the next steps listed ahead along the lesson's own path (lookahead.ts).

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
  /** The rule, spelled out: on while started and neither paused nor finished; kept while the
   *  finished lesson hands off to the next ayah; off otherwise. */
  const rule = (s: AutoplayState): ScreenAwake =>
    !s.started ? "off" : s.phase === "finished" ? (s.intent?.kind === "ayah" ? "hand-off" : "off") : s.phase === "paused" || s.phase === "idle" ? "off" : "on";

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
      for (const from of [1, 4, seq.steps.length - 2]) {
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
      const exIdx = seq.steps.findIndex((st) => st.exercise);
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

describe("wiring (operator 2026-10-12)", () => {
  it("the runner holds the wake lock by the rule and feeds the look-ahead to one prefetcher", () => {
    const runner = read("src/components/autoplay/useAutoplay.ts");
    expect(runner).toContain("const awake = screenAwake(state);");
    expect(runner).toContain('const running = awake === "on";');
    expect(runner).toContain("useWakeLock(awake);");
    expect(runner).toContain("lookaheadAudio(seq, state, { conn }).filter((u) => u !== nextUrl)");
    expect(runner).toContain("const aheadOpen = running && !soundLoading && lineHeard;");
    expect(runner.match(/createPrefetcher\(/g)).toHaveLength(1);
    // Kept: the next-line preload element fills the narration player itself.
    expect(runner).toContain("preload(nextUrl);");
  });

  it("the wake lock is the browser's API only, one holder per document that outlives the hand-off — no video trick", () => {
    const hook = read("src/hooks/useWakeLock.ts");
    const holder = read("src/lib/autoplay/wake.ts");
    expect(holder).toContain('wl.request("screen")');
    expect(holder).toContain("s.release()");
    expect(hook).toContain('"wakeLock" in navigator ? navigator.wakeLock : null');
    // Module level: kept across the client-side page change; one per document.
    expect(hook).toContain("let documentHolder: WakeLockHolder | null = null;");
    expect(hook.match(/createWakeLockHolder\(/g)).toHaveLength(1);
    // On unmount a hand-off keeps the lock (grace), a page left mid-lesson lets go.
    expect(hook).toContain('if (box.mode === "hand-off") h.handOff();');
    expect(hook).toContain('else if (box.mode === "on") h.release();');
    expect(hook).toContain("h.arrived();");
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisibility)');
    for (const src of [hook, holder]) expect(src).not.toMatch(/createElement\(["']video|<video|\.mp4|webm/);
  });

  it("prefetches into the HTTP cache, same-origin, and the CI browser check exists", () => {
    const pre = read("src/lib/autoplay/prefetch.ts");
    expect(pre).toContain('cache: "force-cache"');
    expect(pre).toContain('mode: "same-origin"');
    const ci = read("scripts/ci/screenshots.mjs");
    expect(ci).toContain("async function aheadChecks(");
    expect(ci).toContain("await aheadChecks(page, vp, narration)");
    expect(ci).toContain("addInitScript");
    // The CI's grace is the app's.
    expect(ci).toContain(`const WAKE_GRACE_MS = ${WAKE_HANDOFF_GRACE_MS};`);
  });
});
