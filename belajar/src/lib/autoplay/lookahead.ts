/**
 * The narration fetched AHEAD, across steps (operator 2026-10-12: "why not loading future voice in
 * advance? Now it download when i open the page or come to the slide? should be, for example when
 * i'm still in slide 1, it already start downloading for slide 2 or even 3").
 *
 * Before this, the page warmed only the next file of the CURRENT step (useAutoplay's preload
 * element, machine.ts upcomingAudio), so the first line of every step began downloading only when
 * that step began: the wait at each change of step. lookaheadAudio lists, in the order the lesson
 * will play them, the narration files of the rest of this step and of the next steps; the runner
 * fetches them into the browser's HTTP cache one at a time (prefetch.ts), so a step's first line
 * is usually there before the step comes.
 *
 * WHAT — machine.ts audioAhead: the lesson's own path, as the machine will play it — the rest of
 * this step after the file playing now, then the steps it moves on to by itself (past exercises
 * already done), each with the plan it gets on entry (the pace, lines whose audio failed, an
 * exercise's introduction and opening prompt; the remembered place is simply where the lesson is).
 * Caption-only lines have no file. Never another ayah's file (the walk stops at this ayah's last
 * step; the next ayah's page fetches its own) and never the imam's recitation (the stage's own
 * player fetches that, warm.ts). Each file once, in first-play order.
 *
 * HOW FAR — the rest of this step plus LOOKAHEAD_STEPS (2) steps, and never more than
 * LOOKAHEAD_MAX_BYTES (~1.5 MB) in all, counted from the manifests' durations at the 64 kbps the
 * narration is delivered at (8 KB a second, plan L15): the list stops before the first file that
 * would pass it, so it is always the start of the lesson's own order. Measured on Al-Fatihah
 * 2026-10-12 (ahead.test.ts, every moment of every lesson at every pace): the look-ahead is at
 * most ~768 KB (a composition step's narration alone is up to 515 KB), so the cap never cuts
 * today; it bounds what a learner who stops right there could have paid for in vain if the
 * narration grows. When the browser asks to save data (Data Saver, a 2G-class connection:
 * loading.ts savesData) only LOOKAHEAD_STEPS_LOW_DATA (1) step ahead.
 *
 * WHEN — nothing before the lesson has started (a page only looked at keeps today's single idle
 * warm of the first line, loading.ts idlePreloadUrl) and nothing once it has finished (the
 * hand-off). The runner starts a fetch only while the lesson runs (wake.ts screenAwake "on") and
 * no sound it plays is loading (prefetch.ts).
 *
 * Pure (no React, no DOM): unit-tested over the real lessons (src/components/autoplay/
 * ahead.test.ts) and on its own (lookahead.test.ts).
 */
import { savesData, type ConnectionHints } from "./loading";
import { audioAhead, type AutoplayState } from "./machine";
import type { AutoplaySequence } from "./types";

/** Steps fetched ahead past the current one. */
export const LOOKAHEAD_STEPS = 2;
/** …when the browser asks to save data (savesData). */
export const LOOKAHEAD_STEPS_LOW_DATA = 1;
/** Bytes per millisecond of delivered narration: 64 kbps mono (plan L15) = 8 KB a second. */
export const NARRATION_BYTES_PER_MS = 8;
/** At most this much narration listed ahead, by the manifests' durations (~1.5 MB ≈ 187 s). */
export const LOOKAHEAD_MAX_BYTES = 1_500_000;

export type LookaheadOptions = {
  /** navigator.connection, where the browser has it. */
  conn?: ConnectionHints | null;
  /** Override LOOKAHEAD_STEPS / LOOKAHEAD_STEPS_LOW_DATA. */
  steps?: number;
  /** Override LOOKAHEAD_MAX_BYTES. */
  maxBytes?: number;
};

/** The narration URLs the lesson will play next, in order, each once: rules above. The file
 *  playing now is never listed (its own element loads it). */
export function lookaheadAudio(seq: AutoplaySequence, s: AutoplayState, opts: LookaheadOptions = {}): string[] {
  if (!s.started || s.phase === "idle" || s.phase === "finished") return [];
  const steps = Math.max(0, opts.steps ?? (savesData(opts.conn) ? LOOKAHEAD_STEPS_LOW_DATA : LOOKAHEAD_STEPS));
  const maxBytes = opts.maxBytes ?? LOOKAHEAD_MAX_BYTES;
  const playing = s.activity?.kind === "narrate" ? s.activity.url : null;
  const out: string[] = [];
  let bytes = 0;
  for (const files of audioAhead(seq, s, steps)) {
    for (const f of files) {
      if (f.url === playing || out.includes(f.url)) continue;
      bytes += f.ms * NARRATION_BYTES_PER_MS;
      if (bytes > maxBytes) return out;
      out.push(f.url);
    }
  }
  return out;
}
