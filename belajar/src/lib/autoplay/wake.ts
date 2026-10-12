/**
 * The screen kept awake while a lesson RUNS (operator 2026-10-12: "why my phone goes inactive while
 * opening the app and listening to the lesson? it's like it's considered idle so the screen is
 * lock"). A phone dims and locks after its idle timeout when nobody touches it — and a learner
 * listening to the lesson does not touch it, and sound playing in a page does not hold that timer
 * off. So the page holds a Screen Wake Lock (navigator.wakeLock.request("screen"); the browser
 * side: src/hooks/useWakeLock.ts) for exactly as long as these rules say.
 *
 * WHEN (screenAwake, pure) —
 * - "on": the lesson has started ("Mulai", "Lanjutkan dari langkah N", or the hand-off from the
 *   previous ayah) and is neither paused nor finished (machine.ts phases): the narrator speaking,
 *   the imam reciting, a caption-only line read, a silent pause between lines ("running"); "Tunggu
 *   saya" holding a caption for "Lanjut" ("ready"); an exercise waiting for the learner
 *   ("waiting") — the learner is reading or thinking, and the screen must stay on for that.
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
 * No DOM here: the holder is handed the browser's wakeLock and visibility (useWakeLock), so it is
 * unit-tested with a stub (wake.test.ts); the rule over every step of every lesson in
 * src/components/autoplay/ahead.test.ts.
 */
import type { AutoplayState } from "./machine";

/** What the lesson in state `s` wants of the screen: rules above. */
export type ScreenAwake = "on" | "hand-off" | "off";

export function screenAwake(s: Pick<AutoplayState, "started" | "phase" | "intent">): ScreenAwake {
  if (!s.started) return "off";
  if (s.phase === "finished") return s.intent?.kind === "ayah" ? "hand-off" : "off";
  return s.phase === "idle" || s.phase === "paused" ? "off" : "on";
}

/** The screen is kept on in state `s` (running, or handing off to the next ayah). */
export function keepsScreenAwake(s: Pick<AutoplayState, "started" | "phase" | "intent">): boolean {
  return screenAwake(s) !== "off";
}

/** How long a lock handed over to the next ayah's page waits for that page's lesson to run. */
export const WAKE_HANDOFF_GRACE_MS = 10_000;

/** The parts of the Screen Wake Lock API the holder uses (navigator.wakeLock, its sentinels). */
export type WakeSentinelLike = { readonly released: boolean; release(): Promise<void> };
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
}): WakeLockHolder {
  const graceMs = env.graceMs ?? WAKE_HANDOFF_GRACE_MS;
  /** What the pages want: nothing, a lesson running, or a hand-off waiting for the next one. */
  let want: "none" | "hold" | "grace" = "none";
  let sentinel: WakeSentinelLike | null = null;
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
        // Hidden and shown again while the request was out: the browser may have dropped it.
        if (recheck && s.released) acquire();
      },
      () => {
        asking = false; // refused: no lock, no message
      },
    );
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
