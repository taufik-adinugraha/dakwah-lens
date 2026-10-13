/**
 * The runner's part of the look-ahead (operator 2026-10-12; plan L18): what the lesson in state
 * `s` tells the prefetcher (prefetch.ts), and what the next-line preload element is given. Pure,
 * so the wiring is tested by what it does over the real lessons (src/components/autoplay/
 * ahead.test.ts), not by the runner's source text.
 */
import type { ConnectionHints } from "./loading";
import { lookaheadAudio } from "./lookahead";
import { audioAhead, lessonRuns, type AutoplayState } from "./machine";
import type { Prefetcher, PrefetchUpdate } from "./prefetch";
import type { AutoplaySequence } from "./types";

/** What the browser side knows that the state does not. */
export type AheadEnv = {
  /** navigator.connection, where the browser has it. */
  conn?: ConnectionHints | null;
  /** A sound the lesson asked for is loading or stalled: the narrator's or the imam's (the
   *  players' `loading`, loading.ts). */
  soundLoading: boolean;
  /** Token of the last narration file heard (the element's "playing"); null: none yet. */
  heardFor: number | null;
};

/**
 * The prefetcher's update for the lesson in state `s`:
 * - `wanted`: the narration ahead as far as the connection allows (one step with Save-Data / 2G),
 *   the next line of this step included — the page fetches it like the rest, so its fetch is
 *   never cut short for becoming "next" (review 2026-10-12);
 * - `path`: the narration ahead at its full distance — what stays kept;
 * - `playing`: the file playing now (its copy is kept while it plays);
 * - `open`: a NEW fetch may start — the lesson runs, no sound it asked for is loading or stalled,
 *   and the narration file just started has been heard (the line asked for gets the link first);
 * - `key`: the current activity, so a new one starts the prefetcher's settle time over.
 * Nothing before "Mulai" and nothing once the lesson has finished: both lists are empty then
 * (lookaheadAudio), which also lets go of everything held.
 */
export function aheadUpdate(seq: AutoplaySequence, s: AutoplayState, env: AheadEnv): Required<PrefetchUpdate> {
  const a = s.activity;
  const lineHeard = a?.kind !== "narrate" || env.heardFor === a.token;
  return {
    wanted: lookaheadAudio(seq, s, { conn: env.conn }),
    path: lookaheadAudio(seq, s),
    playing: a?.kind === "narrate" ? a.url : null,
    open: lessonRuns(s) && !env.soundLoading && lineHeard,
    key: a?.token ?? null,
  };
}

/**
 * The narration file this step plays next after the one playing now, or null when the step has
 * no more: the next line's (first) file, or the next part of a split line. Taken from the
 * lesson's own path (machine.ts audioAhead), so it is never a part ALREADY played: the runner
 * used to take the first file of the step's remaining lines that is not the one playing (the
 * engine's upcomingAudio, removed with this), which during the second part of a split line is
 * its first part — warmed, i.e. downloaded, a second time for nothing (found by the simulated
 * lessons of ahead.test.ts, 2026-10-13).
 */
export function nextNarration(seq: AutoplaySequence, s: AutoplayState): string | null {
  const playing = s.activity?.kind === "narrate" ? s.activity.url : null;
  return audioAhead(seq, s, 0)[0].find((f) => f.url !== playing)?.url ?? null;
}

/**
 * What the narration player's preload element is asked to warm for the next line of this step,
 * `nextUrl` (nextNarration): the line itself — the player points the element at the
 * copy held when there is one, else at the network URL, exactly as before the look-ahead — or
 * null (the element is left alone) while the page's own fetch of that file is under way or due:
 * a second download of the same file is the waste the review found. So the network URL is
 * preloaded only for a file the page will not fetch: its fetch failed, or it is not on the list.
 */
export function nextLinePreload(nextUrl: string | null, p: Pick<Prefetcher, "held" | "pending"> | null): string | null {
  if (!nextUrl || !p) return nextUrl;
  if (p.held(nextUrl) !== null) return nextUrl;
  return p.pending(nextUrl) ? null : nextUrl;
}
