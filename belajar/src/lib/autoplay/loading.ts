/**
 * "The sound is loading" — what the lesson says while it waits for audio (operator 2026-10-11:
 * "sometimes it takes time for autoplay to run, i expect it's downloaded the material, the
 * problem is there is no info to user, user is confused what happen and dont know what to do";
 * narration rule 19: never a silent wait).
 *
 * - The two players (useNarrationPlayer, useSegmentPlayer) feed their Audio element's events to
 *   mediaLoading: LOADING from the moment a playback they were asked for starts ("play") until
 *   sound actually flows ("playing"), and again while a playing file stalls ("waiting" until
 *   "playing"); null while sound flows or nothing plays.
 * - useAutoplay keeps the current activity's one value (the narrator's or the imam's), and the
 *   stage's bottom panel mentions it only once it has lasted LOADING_SHOW_MS, so a fast or
 *   cached file never flickers a message; from LOADING_SLOW_MS it says what to do
 *   (loadingStage, watchLoading).
 * - Before "Mulai", the first narration file that click will play is warmed while the page is
 *   idle (machine.ts firstNarration + idlePreloadUrl): never the imam's external recitation,
 *   which is fetched ahead only once the lesson has started (warm.ts).
 *
 * Pure (no React, no DOM): unit-tested with fake timers (loading.test.ts).
 */

/** Whose sound is loading: the narrator's voice or the imam's recitation. */
export type LoadingKind = "narration" | "recitation";

/** Sound asked for and not flowing yet: whose, and since when (Date.now() milliseconds). */
export type AudioLoading = { kind: LoadingKind; sinceMs: number };

/** A load shorter than this is never mentioned: no flicker on a fast or cached file. */
export const LOADING_SHOW_MS = 600;

/** From here the status also says what to do: wait, or click "↺ Ulangi" (the step again). */
export const LOADING_SLOW_MS = 8000;

/** What the bottom panel shows for a load: nothing (yet), "Memuat …", or the slow hint. */
export type LoadingStage = "quiet" | "loading" | "slow";

export function loadingStage(l: AudioLoading | null, nowMs: number): LoadingStage {
  if (!l) return "quiet";
  const ms = nowMs - l.sinceMs;
  return ms >= LOADING_SLOW_MS ? "slow" : ms >= LOADING_SHOW_MS ? "loading" : "quiet";
}

/** The Audio element events a player passes on (HTMLMediaElement event types). */
export type MediaEventType = "play" | "waiting" | "playing" | "pause" | "ended" | "error" | "emptied";

/**
 * A player's loading value after one event of its element (`at.nowMs`: when it fired).
 * - "play": a playback was asked for. Loading, unless the element already holds data to play on
 *   (`at.ready`: readyState ≥ HAVE_FUTURE_DATA; then "playing" follows at once).
 * - "waiting": no data to play on — a fresh file, a seek, a stall mid-file. Loading; a load
 *   already under way keeps its start, so the clock is the ask's, not the stall's.
 * - "playing": sound flows. "pause", "ended", "error", "emptied" (a new file was set): nothing
 *   plays, so nothing is loading.
 */
export function mediaLoading(
  prev: AudioLoading | null,
  type: MediaEventType,
  at: { kind: LoadingKind; nowMs: number; ready?: boolean },
): AudioLoading | null {
  switch (type) {
    case "play":
      if (at.ready) return null;
      return prev?.kind === at.kind ? prev : { kind: at.kind, sinceMs: at.nowMs };
    case "waiting":
      return prev?.kind === at.kind ? prev : { kind: at.kind, sinceMs: at.nowMs };
    default:
      return null;
  }
}

/**
 * Calls `onStage` as load `l` (seen at `nowMs`) reaches each stage: "loading" LOADING_SHOW_MS
 * after its start, "slow" LOADING_SLOW_MS after it — on the next tick for a moment already
 * passed, only the later stage when both are; never synchronously, never "quiet". Returns the
 * function that stops it (the load ended, or another began).
 */
export function watchLoading(
  l: AudioLoading,
  nowMs: number,
  onStage: (stage: Exclude<LoadingStage, "quiet">) => void,
): () => void {
  const ids: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, stage: Exclude<LoadingStage, "quiet">) =>
    ids.push(setTimeout(() => onStage(stage), Math.max(0, l.sinceMs + ms - nowMs)));
  if (nowMs - l.sinceMs < LOADING_SLOW_MS) at(LOADING_SHOW_MS, "loading");
  at(LOADING_SLOW_MS, "slow");
  return () => ids.forEach((id) => clearTimeout(id));
}

/**
 * The longest first narration file warmed while the page is idle, before "Mulai" (~8 KB a second
 * at the 64 kbps the narration is delivered at since 2026-10-11, docs/belajar-plan.md L15: ≈ 240 KB;
 * twice that at the 128 kbps of the renders before). Measured 2026-10-11: "shared:start", the line
 * a fresh "Mulai" plays first, is 23.2 s (186 KB; 372 KB before) — the same file on every ayah, so
 * it is fetched once; "shared:resume" ("Lanjutkan dari langkah N") is 3 s (24 KB). A longer first
 * line is left to load on the click, with its "Menyiapkan pelajaran…".
 */
export const IDLE_PRELOAD_MAX_MS = 30_000;

/** What the browser says about the connection (navigator.connection, where it exists). */
export type ConnectionHints = { saveData?: boolean; effectiveType?: string };

/**
 * The narration file to warm while the page is idle, or null: the first one "Mulai" plays
 * (`first`, machine.ts firstNarration), unless it is longer than IDLE_PRELOAD_MAX_MS or the
 * learner's browser asks to save data (Data Saver, or a 2G-class connection) — learners on mobile
 * data pay for every byte, and a page they only look at should not spend them.
 */
export function idlePreloadUrl(first: { url: string; ms: number } | null, conn?: ConnectionHints | null): string | null {
  if (!first || first.ms > IDLE_PRELOAD_MAX_MS) return null;
  if (conn?.saveData || conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return null;
  return first.url;
}
