"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { type AudioLoading, mediaLoading, type MediaEventType } from "@/lib/autoplay/loading";
import { atClipEnd, type Clip, CLIP_IDLE, clipReducer, clipStartSeconds, endTimerMs, needsSeek, pressAction } from "@/lib/clips";

import { useRecitationNotice } from "./useAyahRecitation";
import { AUDIO_START_EVENT, isBlocked } from "./useSegmentPlayer";

/** play() rejects with AbortError when a new file or a pause interrupts it: routine. */
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * The static pages' example voices (operator 2026-10-12: "each explanation should be followed by
 * examples (visual + voice)"): ONE Audio element for the page (created after mount, never
 * rendered), which plays one example's clip — [start, end) of one word in an ayah's streamed
 * EveryAyah recording (src/lib/clips.ts) — and stops there, the way the lesson plays one word
 * (useSegmentPlayer.playWord: seek, play, stop at the word's end).
 *
 * - The stop (review 2026-10-12): checked every animation frame, and once the end is within
 *   END_TIMER_WINDOW_MS a timer is set for the predicted end itself, so the stop does not wait up
 *   to a frame inside the next word. Whichever comes first stops the element only when its
 *   currentTime has reached the end, never before. Frames do not run in a hidden tab, where the
 *   rest of the ayah would play on: `timeupdate` (about four a second, hidden or not) is the
 *   backstop, and a tab that becomes hidden stops the clip at once.
 * - Nothing reaches the reciter's host before a press: `preload` is "none" and the element has no
 *   `src` until a press sets it (privacy, mobile data). Nothing is cut or stored here.
 * - One clip at a time: pressing another example plays that one (the element moves to its file
 *   or its place), so the first stops; pressing the playing one stops it.
 * - Never over another player, both ways, through the module's audio-start event
 *   (AUDIO_START_EVENT): starting here pauses the lesson's players, the ayah popup and the
 *   narration; any of them starting stops this one.
 * - `notice`: the loading line ("Memuat bacaan imam…" after LOADING_SHOW_MS, what to do after
 *   LOADING_SLOW_MS; src/lib/autoplay/loading.ts), from the element's events as the ayah popup's.
 * - A failed file is loaded anew on the next press (the button says "Coba lagi").
 */
export function useClipPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The clip asked for: the loop stops the element at its end. */
  const clipRef = useRef<Clip | null>(null);
  /** A play the learner asked for is under way: only its errors are a failed clip. */
  const askedRef = useRef(false);
  const [state, dispatch] = useReducer(clipReducer, CLIP_IDLE);
  const [loading, setLoading] = useState<AudioLoading | null>(null);
  const notice = useRecitationNotice(loading);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    audioRef.current = a;
    let raf: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const halt = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      if (timer !== null) clearTimeout(timer);
      raf = null;
      timer = null;
    };
    const load = (type: MediaEventType) => {
      const at = { kind: "narration" as const, nowMs: Date.now(), ready: a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA };
      setLoading((prev) => mediaLoading(prev, type, at));
    };
    /** Stops the element once it has reached the clip's end. True when there is nothing more to
     *  watch: it stopped now, or nothing plays. */
    const stopAtEnd = (): boolean => {
      const c = clipRef.current;
      if (a.paused || !c) return true;
      if (!atClipEnd(c, a.currentTime * 1000)) return false;
      halt();
      askedRef.current = false;
      a.pause();
      dispatch({ type: "end" });
      return true;
    };
    /** Near the end: a timer for the predicted end itself (a frame may come up to 16.7 ms late).
     *  It stops only at the real end, and waits again while the element has not reached it. */
    const armEnd = () => {
      const c = clipRef.current;
      if (!c || timer !== null || a.paused) return;
      const wait = endTimerMs(c, a.currentTime * 1000, a.playbackRate);
      if (wait === null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!stopAtEnd()) armEnd();
      }, wait);
    };
    // Every frame (timeupdate fires only ~4×/s, too coarse for one word): stop at the clip's end.
    const loop = () => {
      raf = null;
      if (stopAtEnd()) return;
      armEnd();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      load("play");
      halt();
      raf = requestAnimationFrame(loop);
      window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a }));
    };
    const onPlaying = () => load("playing");
    const onWaiting = () => load("waiting");
    const onPause = () => {
      load("pause");
      halt();
    };
    // The backstop where no frame runs (a hidden tab, a throttled page): the element's own clock.
    const onTimeUpdate = () => {
      if (!stopAtEnd()) armEnd();
    };
    // A hidden tab never plays on: timers and frames are throttled there, the audio is not.
    const onVisibility = () => {
      if (!document.hidden || a.paused) return;
      askedRef.current = false;
      a.pause();
      dispatch({ type: "interrupt" });
    };
    const onEnded = () => {
      askedRef.current = false;
      load("ended");
      halt();
      dispatch({ type: "end" });
    };
    const onEmptied = () => load("emptied");
    const onError = () => {
      load("error");
      if (!askedRef.current) return;
      askedRef.current = false;
      dispatch({ type: "error" });
    };
    // A browser that set no position before the file's metadata arrived: set it now, before any
    // sound (playback needs more data than the metadata).
    const onMetadata = () => {
      const c = clipRef.current;
      if (c && askedRef.current && needsSeek(c, a.currentTime * 1000)) a.currentTime = clipStartSeconds(c);
    };
    // Another player started (the lesson stage, an exercise, the narration, the ayah popup).
    const onOtherStart = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail === a || a.paused) return;
      askedRef.current = false;
      a.pause();
      dispatch({ type: "interrupt" });
    };
    const events: [string, () => void][] = [
      ["play", onPlay],
      ["playing", onPlaying],
      ["waiting", onWaiting],
      ["pause", onPause],
      ["timeupdate", onTimeUpdate],
      ["ended", onEnded],
      ["emptied", onEmptied],
      ["error", onError],
      ["loadedmetadata", onMetadata],
    ];
    for (const [type, fn] of events) a.addEventListener(type, fn);
    window.addEventListener(AUDIO_START_EVENT, onOtherStart);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      for (const [type, fn] of events) a.removeEventListener(type, fn);
      halt();
      askedRef.current = false;
      clipRef.current = null;
      a.pause();
      // Nothing more fetched once the page is gone.
      if (a.getAttribute("src") !== null) {
        a.removeAttribute("src");
        a.load();
      }
      audioRef.current = null;
    };
  }, []);

  /** Play `clip` (the example `key`) from its start: the first press of a file is the first
   *  request to the reciter's host. Inside the click, so every browser lets it sound. */
  const play = useCallback((key: string, clip: Clip) => {
    const a = audioRef.current;
    if (!a) return;
    clipRef.current = clip;
    if (a.getAttribute("src") !== clip.url) a.src = clip.url;
    else if (a.error) a.load(); // a file that failed is loaded anew (useSegmentPlayer revive)
    if (needsSeek(clip, a.currentTime * 1000)) a.currentTime = clipStartSeconds(clip);
    askedRef.current = true;
    dispatch({ type: "start", key });
    void a.play().catch((e: unknown) => {
      if (isAbort(e)) return;
      askedRef.current = false;
      // A browser that still wants a tap (cannot happen inside the click): back to play, no error.
      dispatch(isBlocked(e) ? { type: "stop" } : { type: "error" });
    });
  }, []);

  const stop = useCallback(() => {
    askedRef.current = false;
    audioRef.current?.pause();
    dispatch({ type: "stop" });
  }, []);

  /** A press on the button of `key`: stops it while it plays, else plays it (a retry after a
   *  failure; another clip that plays stops, the page has one element). */
  const press = useCallback(
    (key: string, clip: Clip) => (pressAction(state, key) === "stop" ? stop() : play(key, clip)),
    [state, play, stop],
  );

  return { state, notice, press, stop };
}
