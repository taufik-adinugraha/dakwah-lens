import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createAutoplayState,
  frameNow,
  frameRuns,
  positionToSave,
  reduceAutoplay,
  viewAutoplay,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type AutoplayStep,
} from "@/lib/autoplay";
import { SURAHS } from "@/lib/content";
import { PACES, type Pace } from "@/lib/lessonSteps";

import { stageSequence, zeroSequence } from "./build";
import { stageFrame } from "./caption";

// "‹ Sebelumnya" / "Berikutnya ›" move FRAME BY FRAME on a step with animation frames (operator
// report 2026-10-15: in the Pengantar, on the kasrah frame of the harakat primer, Sebelumnya went
// back to the very first page and Berikutnya jumped to "Konsep baru: tiga jenis kalimah" — the
// machine moved by step only). The rule (machine.ts, prev / next): a frame is the run of the step's
// plan said or heard over one frame (frameRuns); the current frame is the one the stage shows
// (frameNow = caption.ts stageFrame). Berikutnya starts the next frame from its first line,
// Sebelumnya the previous one; on the first frame Sebelumnya goes to the previous step and on the
// last Berikutnya to the next, as before. In every phase: running (plays from there), paused
// (lands paused there), "Tunggu saya"'s held caption (the Berikutnya control sends `jump`; Lanjut,
// without it, still moves by caption), after an example beat. Ulangi still starts the whole step.
// Over every step with frames the pages ship: lesson zero's primer and every word composition of
// every lesson ayah, in both locales (the English page is caption-only), in every pace.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const FATIHAH = SURAHS.find((s) => s.slug === "al-fatihah")!;

type Lesson = { name: string; seq: AutoplaySequence };
const LESSONS: Lesson[] = ["id", "en"].flatMap((locale) => [
  { name: `pengantar ${locale}`, seq: zeroSequence(FATIHAH, locale) },
  ...SURAHS.flatMap((s) => s.ayat.map((a) => ({ name: `${s.slug} ${a.ayah} ${locale}`, seq: stageSequence(s, a, locale) }))),
]);

const framed = (st: AutoplayStep) => (st.kind === "primer" || st.kind === "compose") && (st.frames ?? 0) > 1;

/** The same lesson with no frames: what ‹ › did before 2026-10-15 (by step only). */
function stepOnly(seq: AutoplaySequence): AutoplaySequence {
  return { ...seq, steps: seq.steps.map((st) => ({ ...st, frames: undefined, cues: st.cues.map((c) => ({ ...c, frame: null })) })) };
}

const endOf = (s: AutoplayState): AutoplayEvent | null => {
  const a = s.activity;
  if (!a) return s.phase === "ready" ? { type: "next" } : null; // "Lanjut"
  return a.kind === "narrate" ? { type: "narration_end", token: a.token } : a.kind === "recite" ? { type: "recite_end", token: a.token } : { type: "timer", token: a.token };
};

/** The step `idx` entered as the lesson reaches it, and every state the lesson passes through on
 *  it, left to run ("Lanjut" at a held caption). */
function statesOn(seq: AutoplaySequence, idx: number, pace: Pace): { entry: AutoplayState; states: AutoplayState[] } {
  let s = reduceAutoplay(seq, createAutoplayState(seq, { pace, idx }), { type: "start", pace, from: idx, reason: "continue" });
  const entry = s;
  const states: AutoplayState[] = [];
  for (let i = 0; i < 2000 && s.idx === idx && s.phase !== "finished"; i++) {
    states.push(s);
    const e = endOf(s);
    if (!e) break;
    s = reduceAutoplay(seq, s, e);
  }
  return { entry, states };
}

type Reduce = (seq: AutoplaySequence, s: AutoplayState, e: AutoplayEvent) => AutoplayState;

/**
 * Every problem of ‹ › on the steps with frames of `seq`, with `reduce` as the machine: from every
 * state the lesson passes through on such a step — running, after an example beat, "Tunggu saya"
 * holding a caption, the same paused, and resumed ("Kita lanjutkan." first) — "‹ Sebelumnya" and
 * "Berikutnya ›" land where the rule says, and the stage, the step counter and the saved place
 * follow.
 */
function frameNavProblems(
  name: string,
  seq: AutoplaySequence,
  reduce: Reduce,
  paces: readonly Pace[] = PACES,
): { problems: string[]; checked: number; hops: number; met: Set<string> } {
  const problems: string[] = [];
  /** The kinds of moment checked: the phase, and "example" (at or right after an example beat),
   *  "resumed" (the resume line first). */
  const met = new Set<string>();
  let checked = 0;
  let hops = 0;
  const old = stepOnly(seq);
  const last = seq.steps.length - 1;
  seq.steps.forEach((step, idx) => {
    if (!framed(step)) return;
    for (const pace of paces) {
      const { entry, states } = statesOn(seq, idx, pace);
      // The plan the step gets on entry, and its frames in play order: each once, the last the
      // step's last (its joined word), every frame of the step there.
      const plan = entry.plan;
      const runs = frameRuns(step, plan);
      const where0 = `${name} ${step.id} ${pace}`;
      if (JSON.stringify(runs.map((r) => r.frame)) !== JSON.stringify(Array.from({ length: step.frames ?? 0 }, (_, i) => i + 1))) {
        problems.push(`${where0}: frames in play order ${JSON.stringify(runs.map((r) => r.frame))}, not 1..${step.frames}`);
        continue;
      }
      if (runs[0].at !== 0) problems.push(`${where0}: the first frame does not open the step`);
      const sources: { s: AutoplayState; how: string }[] = [];
      states.forEach((s, n) => {
        sources.push({ s, how: `#${n} ${s.phase}` });
        if (s.phase === "running" || s.phase === "ready") {
          const paused = reduce(seq, s, { type: "pause" });
          sources.push({ s: paused, how: `#${n} paused` });
          if (n % 3 === 0) sources.push({ s: reduce(seq, paused, { type: "resume" }), how: `#${n} resumed` });
        }
      });
      for (const { s, how } of sources) {
        const where = `${where0} ${how} (at ${s.at} of ${s.plan.length})`;
        const now = frameNow(seq, s);
        const shown = stageFrame(seq, s)?.frame ?? null;
        if (now === null || now !== shown) {
          problems.push(`${where}: on frame ${now}, the stage shows ${shown}`);
          continue;
        }
        const k = runs.findIndex((r) => r.frame === now);
        const view = viewAutoplay(seq, s);
        if (view.hasPrev !== (idx > 0 || k > 0)) problems.push(`${where}: Sebelumnya ${view.hasPrev ? "available" : "unavailable"} on frame ${now} of step ${idx}`);
        const playing = s.phase !== "paused";
        // Lands on frame `r` of this step, from its first action, playing or paused as before.
        const landed = (r: number, a: AutoplayState, what: string) => {
          hops++;
          const target = runs[r];
          const got = `${what}: idx ${a.idx} at ${a.at} phase ${a.phase} frame ${frameNow(seq, a)} (stage ${stageFrame(seq, a)?.frame})`;
          if (a.idx !== idx || a.at !== target.at || frameNow(seq, a) !== target.frame || stageFrame(seq, a)?.frame !== target.frame) {
            problems.push(`${where}: ${got}, not frame ${target.frame} from its first action (at ${target.at})`);
            return;
          }
          if (JSON.stringify(a.plan) !== JSON.stringify(plan)) problems.push(`${where}: ${what} did not keep the step's plan`);
          if ((a.phase === "paused") === playing) problems.push(`${where}: ${got}, from a ${playing ? "lesson playing" : "pause"}`);
          const first = plan[target.at];
          // (The first frame shown paused keeps the step's own caption, its first line's, as a step
          // entered paused always has.)
          const caption = JSON.stringify(a.caption) === JSON.stringify(first?.t === "say" ? first.ref : null) || (target.at === 0 && a.caption === "step");
          if (first?.t !== "say" || !caption) problems.push(`${where}: ${what} shows caption ${JSON.stringify(a.caption)}, not its first line's`);
          if (a.error !== null || a.exercise !== null || a.intent !== null) problems.push(`${where}: ${what} left state behind`);
          if (playing && first?.t === "say" && "c" in first.ref) {
            const cue = step.cues[first.ref.c];
            const act = a.activity;
            const ok = act?.kind === "narrate" ? act.line === cue.line && act.offsetMs === 0 : act?.kind === "read" ? a.part === 0 : a.phase === "ready" && a.part === 0;
            if (!ok) problems.push(`${where}: ${what} plays ${JSON.stringify(act)}, not the frame's first line from its start`);
          }
          // "Langkah n dari N" and "Lanjutkan dari langkah N" are the step's: unchanged.
          if (viewAutoplay(seq, a).index !== idx || positionToSave(seq, a) !== positionToSave(seq, s)) problems.push(`${where}: ${what} moved the step counter or the saved place`);
        };
        // Left the step, exactly as ‹ › always did (the same state as without frames).
        const stepped = (a: AutoplayState, e: AutoplayEvent, what: string, to: number) => {
          hops++;
          const before = reduce(old, s, e);
          if (JSON.stringify(a) !== JSON.stringify(before) || (a.phase !== "finished" && a.idx !== to)) {
            problems.push(`${where}: ${what} gave idx ${a.idx} at ${a.at} phase ${a.phase}, not step ${to} as before`);
          }
        };
        const prev = reduce(seq, s, { type: "prev" });
        if (k > 0) landed(k - 1, prev, "Sebelumnya");
        else stepped(prev, { type: "prev" }, "Sebelumnya on the first frame", Math.max(0, idx - 1));
        // The Berikutnya control (button, Media Session): `jump`. Outside a held caption plain
        // `next` is the same event.
        const nextE: AutoplayEvent = s.phase === "ready" ? { type: "next", jump: true } : { type: "next" };
        const next = reduce(seq, s, nextE);
        if (k < runs.length - 1) landed(k + 1, next, "Berikutnya");
        else if (s.phase === "ready") {
          // A held caption on the last frame: on to the next step, playing (as Lanjut gets there).
          hops++;
          if (next.idx !== Math.min(idx + 1, last) || (idx < last && next.at !== 0) || next.phase === "paused") problems.push(`${where}: Berikutnya on the last frame gave idx ${next.idx} phase ${next.phase}`);
        } else stepped(next, nextE, "Berikutnya on the last frame", Math.min(idx + 1, last));
        if (s.phase !== "ready" && JSON.stringify(reduce(seq, s, { type: "next", jump: true })) !== JSON.stringify(next)) problems.push(`${where}: next with and without jump differ outside a held caption`);
        // "Lanjut" at a held caption (plain next): the next caption, as before — not a frame's jump.
        if (s.phase === "ready" && JSON.stringify(reduce(seq, s, { type: "next" })) !== JSON.stringify(reduce(old, s, { type: "next" }))) problems.push(`${where}: Lanjut no longer moves on by caption`);
        // ↺ Ulangi langkah ini: the whole step, from its first frame (unchanged).
        const again = reduce(seq, s, { type: "replay" });
        if (again.idx !== idx || again.at !== 0 || frameNow(seq, again) !== runs[0].frame) problems.push(`${where}: Ulangi gave at ${again.at} frame ${frameNow(seq, again)}`);
        met.add(s.phase);
        const here = s.plan[s.at];
        if (here?.t === "example" || (here?.t === "settle" && here.after === "example")) met.add("example");
        if (how.endsWith("resumed")) met.add("resumed");
        checked++;
      }
    }
  });
  return { problems, checked, hops, met };
}

describe("‹ Sebelumnya / Berikutnya › move frame by frame on a step with frames (operator 2026-10-15)", () => {
  it("the operator's case: the Pengantar's harakat primer, on the kasrah frame (the letter with its mark)", () => {
    const seq = zeroSequence(FATIHAH, "id");
    const idx = seq.steps.findIndex((s) => s.id === "primer");
    const step = seq.steps[idx];
    // Since the bare-then-marked examples (2026-10-15) the kalimah record opens with its own lead
    // slide; the primer's next step is that.
    expect([idx, step.kind, seq.steps[idx + 1].id]).toEqual([1, "primer", "concept:kalimah-isim-fiil-huruf:lead"]);
    // overview, then per mark its bare letter and its marked letter: fathah (2, 3), kasrah (4, 5),
    // dhammah (6, 7), sukun (8, 9), shaddah (10, 11), small alif (12, 13).
    const KASRAH = 5;
    expect(step.frames).toBe(13);
    for (const pace of PACES) {
      const { entry } = statesOn(seq, idx, pace);
      const runs = frameRuns(step, entry.plan);
      expect(runs.map((r) => r.frame), pace).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      const lineOf = (f: number) => step.cues.find((c) => c.frame === f)!.line;
      // Played to the kasrah frame's first line by Berikutnya, four times, from the step's start.
      let s = entry;
      for (let i = 1; i < KASRAH; i++) s = reduceAutoplay(seq, s, { type: "next", jump: true });
      expect([s.idx, frameNow(seq, s), stageFrame(seq, s)?.frame], pace).toEqual([idx, KASRAH, KASRAH]);
      expect(viewAutoplay(seq, s).caption.line, pace).toBe(lineOf(KASRAH));
      // Sebelumnya: the frame before it from its first line (the bare letter of the same mark) —
      // not the first page.
      const back = reduceAutoplay(seq, s, { type: "prev" });
      expect([back.idx, frameNow(seq, back), viewAutoplay(seq, back).caption.line], pace).toEqual([idx, KASRAH - 1, lineOf(KASRAH - 1)]);
      // Berikutnya: the next frame (dhammah's bare letter) — not "Konsep baru: tiga jenis kalimah".
      const on = reduceAutoplay(seq, s, { type: "next", jump: true });
      expect([on.idx, frameNow(seq, on), viewAutoplay(seq, on).caption.line], pace).toEqual([idx, KASRAH + 1, lineOf(KASRAH + 1)]);
      // The same paused: it lands paused on that frame, the stage showing it.
      const paused = reduceAutoplay(seq, s, { type: "pause" });
      const pBack = reduceAutoplay(seq, paused, { type: "prev" });
      const pOn = reduceAutoplay(seq, paused, { type: "next" });
      expect([pBack.phase, pBack.idx, stageFrame(seq, pBack)?.frame, pOn.phase, pOn.idx, stageFrame(seq, pOn)?.frame], pace).toEqual(["paused", idx, KASRAH - 1, "paused", idx, KASRAH + 1]);
      // From the overview Sebelumnya goes to the opening line; from the small alif Berikutnya to
      // the slide that opens the three kinds of word.
      expect(reduceAutoplay(seq, entry, { type: "prev" }).idx, pace).toBe(idx - 1);
      let lastFrame = s;
      for (let i = KASRAH; i < 13; i++) lastFrame = reduceAutoplay(seq, lastFrame, { type: "next", jump: true });
      expect(frameNow(seq, lastFrame), pace).toBe(13);
      expect(seq.steps[reduceAutoplay(seq, lastFrame, { type: "next", jump: true }).idx].id, pace).toBe("concept:kalimah-isim-fiil-huruf:lead");
      // The step counter stays "Langkah 2" throughout.
      for (const x of [s, back, on, pBack, pOn, lastFrame]) expect(viewAutoplay(seq, x).index, pace).toBe(idx);
    }
  });

  it("every primer and composition step of lesson zero and of every lesson ayah, every pace, every phase: frame k−1 / k+1 from its first line, the step's neighbour from its first / last frame", () => {
    let checked = 0;
    let hops = 0;
    let steps = 0;
    const all: string[] = [];
    const met = new Set<string>();
    for (const { name, seq } of LESSONS) {
      steps += seq.steps.filter(framed).length;
      const r = frameNavProblems(name, seq, reduceAutoplay);
      all.push(...r.problems.slice(0, 5));
      checked += r.checked;
      hops += r.hops;
      for (const m of r.met) met.add(m);
    }
    expect(all).toEqual([]);
    // Not vacuous: the primer, and Al-Fatihah's compositions (only it has them today), on both
    // locales; thousands of states.
    expect(steps).toBeGreaterThanOrEqual(2 * 21);
    expect(checked).toBeGreaterThan(4000);
    expect([...met].sort()).toEqual(["example", "paused", "ready", "resumed", "running"]);
    // Both moves checked from every one of them.
    expect(hops).toBe(2 * checked);
  }, 120_000);

  it("planted: a machine whose Berikutnya, or Sebelumnya, ignores the frames (by step only, as before) fails", () => {
    const seq = zeroSequence(FATIHAH, "id");
    const comp = LESSONS.find((l) => l.name === "al-fatihah 1 id")!.seq;
    expect(frameNavProblems("pengantar", seq, reduceAutoplay).problems).toEqual([]);
    const nextByStep: Reduce = (q, s, e) => reduceAutoplay(e.type === "next" ? stepOnly(q) : q, s, e);
    const prevByStep: Reduce = (q, s, e) => reduceAutoplay(e.type === "prev" ? stepOnly(q) : q, s, e);
    for (const [what, bad] of [["next", nextByStep], ["prev", prevByStep]] as const) {
      for (const [name, q] of [["pengantar", seq], ["al-fatihah 1", comp]] as const) {
        const p = frameNavProblems(name, q, bad, ["biasa"]).problems;
        expect(p.length, `${what} ${name}`).toBeGreaterThan(0);
        expect(p.some((x) => x.includes(what === "next" ? "Berikutnya" : "Sebelumnya")), `${what} ${name}`).toBe(true);
      }
    }
    // … and one that jumps to the right frame but loses its first line (lands one action on).
    const offByOne: Reduce = (q, s, e) => {
      const a = reduceAutoplay(q, s, e);
      return (e.type === "next" || e.type === "prev") && a.idx === s.idx && a.phase === "paused" ? { ...a, at: a.at + 1 } : a;
    };
    expect(frameNavProblems("pengantar", seq, offByOne, ["biasa"]).problems.length).toBeGreaterThan(0);
  });

  it("‹ Sebelumnya is available on the lesson's first step when it has frames: frame 2 on goes back to frame 1; only its first frame is the start", () => {
    // Lesson zero opens with its line, then the primer: a lesson that OPENS with a step with
    // frames is this one without that line.
    const full = zeroSequence(FATIHAH, "id");
    const seq: AutoplaySequence = { ...full, steps: full.steps.slice(1) };
    expect(seq.steps[0].kind).toBe("primer");
    const { entry } = statesOn(seq, 0, "biasa");
    expect(viewAutoplay(seq, entry).hasPrev).toBe(false);
    const f2 = reduceAutoplay(seq, entry, { type: "next", jump: true });
    expect([f2.idx, frameNow(seq, f2), viewAutoplay(seq, f2).hasPrev]).toEqual([0, 2, true]);
    const back = reduceAutoplay(seq, f2, { type: "prev" });
    expect([back.idx, back.at, frameNow(seq, back), viewAutoplay(seq, back).hasPrev]).toEqual([0, 0, 1, false]);
    expect(frameNavProblems("primer first", seq, reduceAutoplay).problems).toEqual([]);
    // The page: the button is unavailable by that, and by nothing that counts steps only.
    const stage = read("src/components/lesson/LessonStage.tsx");
    const button = stage.slice(stage.indexOf('data-autoplay="prev"') - 400, stage.indexOf('data-autoplay="prev"') + 400);
    expect(button).toContain("aria-disabled={!view.hasPrev}");
    expect(button).toContain("if (view.hasPrev) actions.prev()");
    expect(stage).not.toMatch(/view\.index\s*(===|>|<|!==)\s*0/);
  });

  it("the runner: the Berikutnya button and Media Session's next track send `jump`; Lanjut does not", () => {
    const src = read("src/components/autoplay/useAutoplay.ts");
    expect(src).toContain('set("nexttrack", () => dispatch(forwardIsSkip ? { type: "skip" } : { type: "next", jump: true }));');
    expect(src).toContain('dispatch(view.showSkip ? { type: "skip" } : { type: "next", jump: true });');
    const lanjut = src.slice(src.indexOf("lanjut() {"), src.indexOf("lanjut() {") + 120);
    expect(lanjut).toContain('dispatch({ type: "next" });');
  });

  it("the CI browser walks press Berikutnya until the STEP changes, never one press per step", () => {
    // linebreaks.mjs measures every step: one press per step would measure a composition once per
    // frame and, replaying it narrated, never leave it (↺ restarts the step at its first frame).
    const walk = read("scripts/ci/linebreaks.mjs");
    expect(walk).toMatch(/async function leaveStep\(page, n\) \{[\s\S]{0,400}?if \(!at \|\| at\[0\] !== n\) return;/);
    expect(walk).toContain("await leaveStep(page, at[0]);");
    // toStep (screenshots.mjs) looks for the step by its name after every press, with room for the
    // frames: the deepest target, Al-Fatihah 7's "learned", by pressing from the start.
    const shots = read("scripts/ci/screenshots.mjs");
    const toStep = /async function toStep\(page, vp, id\) \{[\s\S]*?\n\}/.exec(shots)?.[0] ?? "";
    expect(toStep).toMatch(/if \(at === id\) return;/);
    const cap = Number(/for \(let i = 0; i < (\d+); i\+\+\)/.exec(toStep)?.[1]);
    const seq = stageSequence(FATIHAH, FATIHAH.ayat[6], "id");
    let s = reduceAutoplay(seq, reduceAutoplay(seq, createAutoplayState(seq), { type: "start", reason: "fresh" }), { type: "pause" });
    let presses = 0;
    while (seq.steps[s.idx].id !== "learned" && presses < 500) {
      s = reduceAutoplay(seq, s, viewAutoplay(seq, s).showSkip ? { type: "skip" } : { type: "next", jump: true });
      presses++;
    }
    expect(seq.steps[s.idx].id).toBe("learned");
    expect(cap).toBeGreaterThan(presses + 10);
    // … and every ayah of Al-Ikhlas, whose "learned" and "structure" the `--surahs` pass walks to
    // (2026-10-19: lessonMapChecks, reminderChecks).
    const ikhlas = SURAHS.find((x) => x.slug === "al-ikhlas")!;
    for (const a of ikhlas.ayat) {
      const sq = stageSequence(ikhlas, a, "id");
      let t = reduceAutoplay(sq, reduceAutoplay(sq, createAutoplayState(sq), { type: "start", reason: "fresh" }), { type: "pause" });
      let n = 0;
      while (sq.steps[t.idx].id !== "learned" && n < 500) {
        t = reduceAutoplay(sq, t, viewAutoplay(sq, t).showSkip ? { type: "skip" } : { type: "next", jump: true });
        n++;
      }
      expect(sq.steps[t.idx].id, `Al-Ikhlas ${a.ayah}`).toBe("learned");
      expect(cap, `Al-Ikhlas ${a.ayah}`).toBeGreaterThan(n + 10);
    }
  });
});
