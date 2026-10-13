"use client";

import { useEffect, useRef } from "react";

import {
  createWakeLockHolder,
  followScreenAwake,
  leaveScreenAwake,
  type ScreenAwake,
  type WakeLockHolder,
} from "@/lib/autoplay/wake";

/**
 * The document's one Screen Wake Lock holder (src/lib/autoplay/wake.ts), kept at module level so
 * it outlives the client-side page change of the hand-off to the next ayah: that page's lesson
 * adopts the lock instead of asking anew (no moment without it).
 */
let documentHolder: WakeLockHolder | null = null;
function holder(): WakeLockHolder {
  documentHolder ??= createWakeLockHolder({
    wakeLock: () => ("wakeLock" in navigator ? navigator.wakeLock : null),
    visible: () => document.visibilityState === "visible",
  });
  return documentHolder;
}

/**
 * Keeps the screen on as the lesson's `mode` says (operator 2026-10-12; the rules of when:
 * src/lib/autoplay/wake.ts screenAwake). The Screen Wake Lock API: "on" or "hand-off" holds it
 * (asked for with navigator.wakeLock.request("screen"), or adopted when the previous ayah's page
 * handed it over); turning "off" releases it. On unmount: a page handing off keeps it for the next
 * ayah's page (WAKE_HANDOFF_GRACE_MS, then released unless that page's lesson runs); a page left
 * mid-lesson releases it. A mode that starts "off" on mount releases nothing: a lock handed over
 * waits out its grace for this page's lesson (followScreenAwake / leaveScreenAwake: the page's
 * part, pure and tested with the holder). Browsers drop the lock when the page is hidden; once
 * visible again while the lesson runs, it is asked for again — and at once when the browser takes
 * it back while the page is still visible (the holder watches the sentinel's "release"). `mode`
 * turns "off" by itself when the lesson has waited for the learner past the lock's time limit
 * (wake.ts waitedTooLong), and "on" again with their next action.
 *
 * Supported by Chrome / Edge / Chrome for Android 84+, Safari 16.4+ (iOS and macOS) and Firefox
 * 126+. Elsewhere (or when the browser refuses: battery saver, a permission policy, the page
 * hidden at that moment) nothing happens, silently — the phone's own sleep timer applies as it did
 * before; no error is shown. No fallback trick (no invisible looping video, "NoSleep"): it costs
 * battery and data and fights the browser.
 */
export function useWakeLock(mode: ScreenAwake): void {
  /** This page's mode as the effects last saw it (read by the unmount below). */
  const seen = useRef<{ mode: ScreenAwake }>({ mode: "off" });

  useEffect(() => {
    const box = seen.current;
    const h = holder();
    h.arrived();
    return () => leaveScreenAwake(h, box.mode);
  }, []);

  useEffect(() => {
    const box = seen.current;
    const h = holder();
    const was = box.mode;
    box.mode = mode;
    followScreenAwake(h, was, mode);
    if (mode === "off") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") h.visible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [mode]);
}
