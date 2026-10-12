/**
 * The screen kept awake while a lesson RUNS (operator 2026-10-12: "why my phone goes inactive while
 * opening the app and listening to the lesson? it's like it's considered idle so the screen is
 * lock"). A phone dims and locks after its idle timeout when nobody touches it — and a learner
 * listening to the lesson does not touch it, and sound playing in a page does not hold that timer
 * off. So the page holds a Screen Wake Lock (navigator.wakeLock.request("screen"); the browser
 * side: src/hooks/useWakeLock.ts) for exactly as long as these rules say.
 *
 * WHEN (screenAwake, pure) —
 * - "on": the lesson runs (machine.ts lessonRuns: started — "Mulai", "Lanjutkan dari langkah N",
 *   or the hand-off from the previous ayah — and neither paused nor finished): the narrator
 *   speaking, the imam reciting, a caption-only line read, a silent pause between lines
 *   ("running"); "Tunggu saya" holding a caption for "Lanjut" ("ready"); an exercise waiting for
 *   the learner ("waiting") — the learner is reading or thinking, and the screen must stay on for
 *   that. WITH A TIME LIMIT where the lesson waits for the learner and nothing moves it on (review
 *   2026-10-12: with none, a phone left at an exercise kept its screen on until the battery
 *   died) — waitedTooLong:
 *   · an exercise waiting: its reminders are through (the third, at 60 s of silence) and the
 *     silence has reached SCREEN_IDLE_LIMIT_MS (timing.ts: 60 s after that reminder, 120 s in
 *     all) — the exercise's own `idleMs`, which starts over when the learner acts (an answer,
 *     right or wrong; "Tunjukkan jawaban"; another control), so any answer takes the lock again;
 *   · "Tunggu saya" holding a caption: the same SCREEN_IDLE_LIMIT_MS of silence (`heldMs`, the
 *     idle ticks of this one wait; it has no reminders), starting over with every "Lanjut".
 *   Then the lock is "off" and NOTHING ELSE CHANGES: the lesson waits where it is, as long as the
 *   learner likes (the phone's own sleep timer applies again); their next action takes the lock
 *   back. The silent time is counted by the machine's idle ticks (one a second, not while the
 *   page is hidden or the learner listens to a word of their own: useAutoplay), so the rule
 *   stays a pure function of the state.
 * - "hand-off": the ayah is through and the lesson goes on to the next ayah by itself (finished,
 *   intent "ayah"; useAutoplay continueToAyah). The lock is KEPT across that page change: it is a
 *   client-side navigation, the document stays, and the next ayah's page adopts the lock its
 *   lesson then needs. Releasing it for even a moment on a phone left untouched for minutes can
 *   let the system turn the screen off right there — the very problem reported (review
 *   2026-10-12).
 * - "off": a page only looked at ("idle": never asked for on a page view alone), paused ("Jeda",
 *   the learner's own "Dengar", the browser blocking sound, the imam's recording failing: each
 *   pauses the lesson), the end of the surah (finished, no next ayah).
 *
 * HOW LONG A HANDED-OVER LOCK WAITS (createWakeLockHolder) — one holder per document (module
 * level in the hook), so it outlives the page change. The page that hands off keeps the lock for
 * WAKE_HANDOFF_GRACE_MS; the next page restarts that grace when it mounts, and its lesson running
 * ("on") adopts the lock — no new request, no gap. If that lesson is not running within the
 * grace (the learner landed there and stopped, or it did not start by itself), the lock is
 * released then: a page never keeps the screen on for a lesson that is not running. A page left
 * mid-lesson by any other client-side navigation lets go at once; a real page leave (reload, hard
 * navigation, tab closed) ends the document and the browser releases the lock itself. Browsers
 * drop the lock when the page is hidden; it is asked for again once it is visible and a lesson
 * runs. Every request may be refused (no support, battery saver, a policy, the page hidden): then
 * nothing happens and nothing is shown.
 *
 * DROPPED WHILE VISIBLE (review 2026-10-12) — a browser may also take the lock back while the page
 * is still on screen (the sentinel's "release" event: a power-saving mode coming on, the system's
 * own reasons). While a lesson holds it and the page is visible, it is asked for again at once —
 * but only when the lock dropped had been kept at least WAKE_REASK_MIN_HELD_MS: a browser that
 * grants a lock and drops it straight away would otherwise be asked in a loop. A request refused
 * is not repeated either way. What was not asked again is asked again at the next occasion the
 * page has anyway: visible again, or the lesson holding it anew ("Lanjutkan" after a pause).
 *
 * No DOM here: the holder is handed the browser's wakeLock and visibility (useWakeLock), so it is
 * unit-tested with a stub (wake.test.ts); the rule over every step of every lesson, and the
 * page's own part (followScreenAwake / leaveScreenAwake, what useWakeLock runs), in
 * src/components/autoplay/ahead.test.ts.
 */
import { lessonRuns, type AutoplayState } from "./machine";
import { MAX_REMINDERS, SCREEN_IDLE_LIMIT_MS } from "./timing";

/** What the lesson in state `s` wants of the screen: rules above. */
export type ScreenAwake = "on" | "hand-off" | "off";

/** The part of the state the screen rule reads. */
export type ScreenState = Pick<AutoplayState, "started" | "phase" | "intent" | "exercise" | "heldMs">;

/**
 * The lesson has waited for the learner past the screen lock's time limit (rules above): an
 * exercise waiting whose reminders are through, or a caption "Tunggu saya" holds, in silence for
 * SCREEN_IDLE_LIMIT_MS. Never while the lesson itself is doing something (a line, the imam, a
 * reminder being said).
 */
export function waitedTooLong(s: Pick<AutoplayState, "phase" | "exercise" | "heldMs">): boolean {
  if (s.phase === "ready") return s.heldMs >= SCREEN_IDLE_LIMIT_MS;
  if (s.phase !== "waiting") return false;
  const ex = s.exercise;
  return !!ex && ex.reminders >= MAX_REMINDERS && ex.idleMs >= SCREEN_IDLE_LIMIT_MS;
}

export function screenAwake(s: ScreenState): ScreenAwake {
  if (s.phase === "finished") return s.started && s.intent?.kind === "ayah" ? "hand-off" : "off";
  return lessonRuns(s) && !waitedTooLong(s) ? "on" : "off";
}

/** The screen is kept on in state `s` (running, or handing off to the next ayah). */
export function keepsScreenAwake(s: ScreenState): boolean {
  return screenAwake(s) !== "off";
}

/** How long a lock handed over to the next ayah's page waits for that page's lesson to run. */
export const WAKE_HANDOFF_GRACE_MS = 10_000;

/** A lock the browser drops while the page is visible is asked for again only if it had been
 *  kept at least this long (no loop with a browser that grants and drops at once). */
export const WAKE_REASK_MIN_HELD_MS = 5_000;

/** The parts of the Screen Wake Lock API the holder uses (navigator.wakeLock, its sentinels). */
export type WakeSentinelLike = {
  readonly released: boolean;
  release(): Promise<void>;
  /** WakeLockSentinel is an EventTarget: "release" fires when the lock ends, by the page's own
   *  release() or by the browser. Optional: a holder without it only loses the re-ask. */
  addEventListener?(type: "release", listener: () => void): void;
};
export type WakeLockLike = { request(type: "screen"): Promise<WakeSentinelLike> };

export type WakeLockHolder = {
  /** A lesson runs: keep the screen on — the lock held (or handed over) if it is still active,
   *  else asked for (when the page is visible). Ends a hand-off's grace. */
  hold(): void;
  /** Let go now (pause, the end of the surah, the page left mid-lesson). */
  release(): void;
  /** The lesson goes on to the next ayah: keep the lock, and release it after the grace unless
   *  hold() comes first. Nothing to do when nothing is held. */
  handOff(): void;
  /** A lesson page mounted: a handed-over lock's grace starts again from now. */
  arrived(): void;
  /** The page became visible: a lesson that runs asks for the lock again (browsers drop it on
   *  hiding). */
  visible(): void;
  /** A lock is held right now. */
  holding(): boolean;
};

export function createWakeLockHolder(env: {
  /** navigator.wakeLock, where the browser has it. */
  wakeLock: () => WakeLockLike | null | undefined;
  /** document.visibilityState === "visible". */
  visible: () => boolean;
  graceMs?: number;
  /** Override WAKE_REASK_MIN_HELD_MS. */
  minHeldMs?: number;
  /** The clock (Date.now). */
  now?: () => number;
}): WakeLockHolder {
  const graceMs = env.graceMs ?? WAKE_HANDOFF_GRACE_MS;
  const minHeldMs = env.minHeldMs ?? WAKE_REASK_MIN_HELD_MS;
  const now = env.now ?? (() => Date.now());
  /** What the pages want: nothing, a lesson running, or a hand-off waiting for the next one. */
  let want: "none" | "hold" | "grace" = "none";
  let sentinel: WakeSentinelLike | null = null;
  /** When the lock held now was granted. */
  let since = 0;
  let asking = false;
  /** The page came back while a request was out: check again once it is answered. */
  let recheck = false;
  let grace: ReturnType<typeof setTimeout> | null = null;

  const active = () => sentinel !== null && !sentinel.released;
  const clearGrace = () => {
    if (grace !== null) clearTimeout(grace);
    grace = null;
  };
  const acquire = () => {
    if (want === "none" || active() || !env.visible()) return;
    const wl = env.wakeLock();
    if (!wl || typeof wl.request !== "function") return;
    if (asking) {
      recheck = true;
      return;
    }
    asking = true;
    recheck = false;
    let p: Promise<WakeSentinelLike>;
    try {
      p = wl.request("screen");
    } catch {
      asking = false;
      return;
    }
    p.then(
      (s) => {
        asking = false;
        if (want === "none") {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
        since = now();
        s.addEventListener?.("release", () => dropped(s));
        // Hidden and shown again while the request was out: the browser may have dropped it.
        if (recheck && s.released) acquire();
      },
      () => {
        asking = false; // refused: no lock, no message
      },
    );
  };
  /** Sentinel `s` ended (its "release" event). The page's own release() has let go of it before
   *  (`sentinel` is no longer `s`): nothing to do. Otherwise the browser dropped it — rules above
   *  (DROPPED WHILE VISIBLE). */
  const dropped = (s: WakeSentinelLike) => {
    if (sentinel !== s) return;
    sentinel = null;
    // Hidden: visible() asks again. A hand-off's grace: the next lesson's hold() does.
    if (want !== "hold" || !env.visible()) return;
    // Granted and dropped straight away: not asked again here (no loop).
    if (now() - since < minHeldMs) return;
    acquire();
  };
  const release = () => {
    want = "none";
    clearGrace();
    const s = sentinel;
    sentinel = null;
    if (s && !s.released) void s.release().catch(() => {});
  };
  const startGrace = () => {
    clearGrace();
    grace = setTimeout(() => {
      grace = null;
      if (want === "grace") release();
    }, graceMs);
  };

  return {
    hold() {
      want = "hold";
      clearGrace();
      acquire();
    },
    release,
    handOff() {
      if (want === "none") return;
      want = "grace";
      startGrace();
    },
    arrived() {
      if (want === "grace") startGrace();
    },
    visible() {
      if (want === "hold") acquire();
    },
    holding: active,
  };
}

/**
 * What a lesson page does with the document's holder when its lesson's mode becomes `mode` (it
 * was `was`; "off" on mount) — useWakeLock's effect: "on" and "hand-off" hold the lock (asked
 * for, or adopted from the previous ayah's page; a lock already held is kept, never asked for
 * twice); turning "off" lets go; "off" from the start lets nothing go, so a lock handed over
 * waits out its grace for this page's lesson.
 */
export function followScreenAwake(h: WakeLockHolder, was: ScreenAwake, mode: ScreenAwake): void {
  if (mode !== "off") h.hold();
  else if (was !== "off") h.release();
}

/**
 * …and when the page goes away with its lesson in `mode` (useWakeLock's unmount): the hand-off
 * keeps the lock for the next ayah's page (its grace); a page left mid-lesson lets go; a lesson
 * that held nothing leaves the holder alone (a hand-off's grace may be running for it).
 */
export function leaveScreenAwake(h: WakeLockHolder, mode: ScreenAwake): void {
  if (mode === "hand-off") h.handOff();
  else if (mode === "on") h.release();
}
