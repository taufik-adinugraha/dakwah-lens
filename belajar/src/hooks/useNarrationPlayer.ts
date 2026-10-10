"use client";

import { useCallback, useEffect, useRef } from "react";

import { AUDIO_START_EVENT, isBlocked } from "./useSegmentPlayer";

/** What one narration file reports back (each play() call gets its own). */
export type NarrationHandlers = {
  /** The file played to its end. */
  onEnd: () => void;
  /** The file could not be loaded or decoded. */
  onError: () => void;
  /** The browser wants a (new) tap before sound may play. */
  onBlocked: () => void;
  /** Another recording on the page started (e.g. the learner pressed
   *  "Dengarkan kata" in an exercise) and cut this file short. */
  onInterrupted: () => void;
  /** Playback position in ms (~4×/s, from timeupdate) for the caption clock. */
  onTime?: (ms: number) => void;
};

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * The narration's Audio element, kept for the whole visit (like the stage's
 * recitation element in useSegmentPlayer): the lesson moves to the next ayah
 * by a client-side navigation, and an element that once played inside a tap
 * may keep playing without one (iOS Safari). The first line after "Mulai"
 * plays inside that tap, because React runs the effects of a click's update
 * before the click handling ends.
 */
let keptNarration: HTMLAudioElement | null = null;
function narrationAudio(): HTMLAudioElement {
  if (!keptNarration) keptNarration = new Audio();
  return keptNarration;
}

/**
 * The autoplay lesson's narration voice: ONE Audio element (created after
 * mount, never rendered) that plays one same-origin file at a time.
 *
 * - `play(url, handlers)` starts a file and returns its stop function; the
 *   handlers of a stopped file are dropped, so a late "ended" can never
 *   report for it.
 * - It takes part in the page-wide "one recording at a time" rule
 *   (AUDIO_START_EVENT): starting pauses every other player, and another
 *   player starting stops the narration (onInterrupted).
 * - `preload(url)` warms the next file on a second, muted element that is
 *   never played.
 * - `owns(el)` tells whether an audio element is this narration's, for
 *   telling the lesson's own sound from the learner's.
 * - One narration at a time on a page (the lesson stage's).
 *
 * Narration audio exists only once the operator approved a voice and the
 * render; until then the lesson is caption-only and this hook stays idle.
 */
export function useNarrationPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  /** Handlers of the file playing now; null when none. */
  const handlersRef = useRef<NarrationHandlers | null>(null);

  useEffect(() => {
    const a = narrationAudio();
    a.preload = "auto";
    const pre = new Audio();
    pre.preload = "auto";
    pre.muted = true;
    audioRef.current = a;
    preloadRef.current = pre;

    const take = () => {
      const h = handlersRef.current;
      handlersRef.current = null;
      return h;
    };
    const onEnded = () => take()?.onEnd();
    const onError = () => take()?.onError();
    const onTime = () => handlersRef.current?.onTime?.(a.currentTime * 1000);
    const onPlay = () => window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a }));
    const onOtherStart = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail === a || a.paused) return;
      const h = take();
      a.pause();
      h?.onInterrupted();
    };

    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    window.addEventListener(AUDIO_START_EVENT, onOtherStart);
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      handlersRef.current = null;
      a.pause();
      a.removeAttribute("src");
      pre.removeAttribute("src");
      audioRef.current = null;
      preloadRef.current = null;
    };
  }, []);

  /** Plays `url` from its start; returns the function that stops it. */
  const play = useCallback((url: string, h: NarrationHandlers): (() => void) => {
    const a = audioRef.current;
    if (!a) {
      // Not mounted yet (cannot happen after the Mulai tap): report it as a
      // failed file, asynchronously, so the lesson falls back to captions.
      const id = window.setTimeout(h.onError, 0);
      return () => window.clearTimeout(id);
    }
    handlersRef.current = h;
    a.src = url;
    a.currentTime = 0;
    void a.play().catch((e: unknown) => {
      if (handlersRef.current !== h || isAbort(e)) return;
      handlersRef.current = null;
      if (isBlocked(e)) h.onBlocked();
      else h.onError();
    });
    return () => {
      if (handlersRef.current === h) handlersRef.current = null;
      a.pause();
    };
  }, []);

  /** Starts fetching `url` ahead of time (same-origin narration only). */
  const preload = useCallback((url: string | null) => {
    const pre = preloadRef.current;
    if (!pre || !url) return;
    if (pre.getAttribute("src") === url) return;
    pre.src = url;
  }, []);

  const owns = useCallback((el: unknown) => el !== null && el === audioRef.current, []);

  return { play, preload, owns };
}
