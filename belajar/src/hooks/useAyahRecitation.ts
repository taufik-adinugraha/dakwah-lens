"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AudioLoading,
  type LoadingStage,
  mediaLoading,
  type MediaEventType,
  watchLoading,
} from "@/lib/autoplay/loading";

import { AUDIO_START_EVENT, isBlocked } from "./useSegmentPlayer";

/** Where the popup's recitation stands: nothing asked yet (or it ended), playing (or asked to and
 *  loading), paused by the learner, or it could not be loaded or decoded. */
export type RecitationStatus = "idle" | "playing" | "paused" | "failed";

/** What the popup says about a load (as the lesson stage does): nothing for its first
 *  LOADING_SHOW_MS, then "Memuat bacaan imam…", from LOADING_SLOW_MS what to do. */
export type RecitationNotice = "loading" | "slow" | null;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * The fact cards' ayah popup recitation (src/components/surah/AyahDialog.tsx): ONE Audio element
 * (created after mount, never rendered) that streams one ayah file from EveryAyah.
 *
 * - Nothing reaches the reciter's host until the learner presses play: `preload` is "none" and
 *   the element has no `src` until play(url) sets it (the Kredit page's streaming note: the
 *   browser fetches the recording from the provider, nothing is stored on our server).
 * - One recording at a time, both ways, through the window event every player of the module uses
 *   (AUDIO_START_EVENT, useSegmentPlayer): starting here pauses the lesson's players, and any of
 *   them starting pauses this one.
 * - `notice`: the loading line (src/lib/autoplay/loading.ts, narration rule 19: never a silent
 *   wait), from the element's events exactly as the lesson's players feed it.
 * - `stop()` when the popup closes: paused, its file dropped, back to "idle".
 */
export function useAyahRecitation() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** A play the learner asked for is under way: only its errors are a failed recitation. */
  const askedRef = useRef(false);
  const [status, setStatus] = useState<RecitationStatus>("idle");
  const [loading, setLoading] = useState<AudioLoading | null>(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    audioRef.current = a;
    const load = (type: MediaEventType) => {
      const at = { kind: "recitation" as const, nowMs: Date.now(), ready: a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA };
      setLoading((prev) => mediaLoading(prev, type, at));
    };
    const onPlay = () => {
      load("play");
      setStatus("playing");
      window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a }));
    };
    const onPlaying = () => {
      load("playing");
      setStatus("playing");
    };
    const onWaiting = () => load("waiting");
    // The event arrives after the call: a pause from stop() (its file already dropped) stays idle.
    const onPause = () => {
      load("pause");
      setStatus((s) => (s === "failed" ? s : a.ended || a.getAttribute("src") === null ? "idle" : "paused"));
    };
    const onEnded = () => {
      askedRef.current = false;
      load("ended");
      setStatus("idle");
    };
    const onEmptied = () => load("emptied");
    const onError = () => {
      load("error");
      if (!askedRef.current) return;
      askedRef.current = false;
      setStatus("failed");
    };
    // Another player started (the lesson stage, an exercise, the narration): pause here.
    const onOtherStart = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail === a || a.paused) return;
      askedRef.current = false;
      a.pause();
    };
    const events: [string, () => void][] = [
      ["play", onPlay],
      ["playing", onPlaying],
      ["waiting", onWaiting],
      ["pause", onPause],
      ["ended", onEnded],
      ["emptied", onEmptied],
      ["error", onError],
    ];
    for (const [type, fn] of events) a.addEventListener(type, fn);
    window.addEventListener(AUDIO_START_EVENT, onOtherStart);
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      for (const [type, fn] of events) a.removeEventListener(type, fn);
      askedRef.current = false;
      a.pause();
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    };
  }, []);

  /** Play `url` (from where a pause left it; from the start once it ended). The first call for a
   *  file is the first request to the reciter's host. A file that failed is loaded anew. */
  const play = useCallback((url: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (a.getAttribute("src") !== url) a.src = url;
    else if (a.error) a.load();
    if (a.ended) a.currentTime = 0;
    askedRef.current = true;
    setStatus("playing");
    void a.play().catch((e: unknown) => {
      if (isAbort(e)) return;
      askedRef.current = false;
      // A browser that still wants a tap (cannot happen inside the click, but say nothing wrong).
      setStatus(isBlocked(e) ? "paused" : "failed");
    });
  }, []);

  const pause = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    askedRef.current = false;
    a.pause();
    setStatus((s) => (s === "playing" ? "paused" : s));
  }, []);

  /** The popup closed (or shows another ayah): silence, and nothing more fetched. */
  const stop = useCallback(() => {
    const a = audioRef.current;
    askedRef.current = false;
    if (a) {
      a.pause();
      if (a.getAttribute("src") !== null) {
        a.removeAttribute("src");
        a.load();
      }
    }
    setStatus("idle");
    setLoading(null);
  }, []);

  return { status, notice: useRecitationNotice(loading), play, pause, stop };
}

/** The loading line's stage for `loading` (as useAutoplay's useLoadingNotice): timers only, the
 *  stage a timer reported kept with the load it belongs to, so a new load starts quiet. Shared
 *  with the Konsep examples' clip player (src/hooks/useClipPlayer.ts). */
export function useRecitationNotice(loading: AudioLoading | null): RecitationNotice {
  const [seen, setSeen] = useState<{ of: AudioLoading; stage: LoadingStage } | null>(null);
  useEffect(() => {
    if (!loading) return;
    return watchLoading(loading, Date.now(), (stage) => setSeen({ of: loading, stage }));
  }, [loading]);
  if (!loading || seen?.of !== loading || seen.stage === "quiet") return null;
  return seen.stage;
}
