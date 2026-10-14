"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type AudioLoading, mediaLoading, type MediaEventType } from "@/lib/autoplay/loading";
import { atClipEnd, clipStartSeconds, endTimerMs, needsSeek } from "@/lib/clips";
import type { ExampleClip } from "@/lib/autoplay/types";

import { AUDIO_START_EVENT, isBlocked, type PlaybackRate, type PlayError } from "./useSegmentPlayer";

/** play() rejects with AbortError when a new file or a pause interrupts it: routine. */
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * The lesson's example player element, kept for the whole visit — like the stage's recitation
 * element (useSegmentPlayer) and the narration's (useNarrationPlayer): the lesson moves to the
 * next ayah by a client-side navigation, and iOS Safari lets an element play without a tap only
 * once it has played inside one (unlock(), in the "Mulai" tap). A new element on every ayah
 * would need a new tap. One lesson stage is mounted at a time.
 */
let keptExampleAudio: HTMLAudioElement | null = null;
function exampleAudio(): HTMLAudioElement {
  if (!keptExampleAudio) keptExampleAudio = new Audio();
  return keptExampleAudio;
}

/** Elements that have played inside a tap (see unlock()). */
const unlockedAudio = new WeakSet<HTMLAudioElement>();

/**
 * A quarter of a second of silence (8-bit mono PCM at 8 kHz in a WAV header), as an object URL
 * made once per document: what unlock() plays inside the "Mulai" tap. Not a recording — at that
 * moment the lesson has asked for no example yet, and nothing may reach the reciters' host for one
 * the learner may never come to (warm.ts) — and not a request at all (the module's CSP lets media
 * come from blob:, as the narration's copies do).
 */
let silence: string | null = null;
function silentUrl(): string | null {
  if (silence) return silence;
  try {
    const samples = 2000;
    const bytes = new Uint8Array(44 + samples);
    const view = new DataView(bytes.buffer);
    const ascii = (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + samples, true);
    ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); // the format block's length
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, 8000, true); // samples a second
    view.setUint32(28, 8000, true); // bytes a second
    view.setUint16(32, 1, true); // bytes a sample frame
    view.setUint16(34, 8, true); // bits a sample
    ascii(36, "data");
    view.setUint32(40, samples, true);
    bytes.fill(128, 44); // 8-bit PCM silence
    silence = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  } catch {
    silence = null;
  }
  return silence;
}

/** What one example clip reports back (each play() call gets its own). */
export type ExampleHandlers = {
  /** The clip played to its end (or its file ended first). */
  onEnd: () => void;
  /** It could not play: "blocked" when the browser wants a tap first, "failed" otherwise. */
  onError: (reason: PlayError) => void;
  /** Another recording on the page started and cut it short. */
  onInterrupted: () => void;
};

/**
 * The imam's voice of a lesson's EXAMPLE from another ayah (operator 2026-10-12: "each explanation
 * should be followed by examples (visual + voice)"; plan L20): ONE Audio element (never rendered)
 * that plays [start, end) of one word, or one run, of that ayah's streamed EveryAyah recording
 * and stops there — the way the Konsep pages' example buttons do (useClipPlayer; the same pure
 * rules, src/lib/clips.ts), but driven by the lesson instead of a press: the lesson's state
 * machine asks for one clip at a time (a recite activity, target "clip") and waits for its end.
 * The stage's own recitation player cannot play it: its element holds THIS ayah's recording.
 *
 * - `play(clip, handlers)` plays the clip from its start and returns its stop function; the
 *   handlers of a stopped clip are dropped, so a late event can never report for it.
 * - The stop at the clip's end: checked every animation frame, with a timer for the predicted end
 *   once it is near (clips.ts endTimerMs), and on `timeupdate` where no frame runs (a hidden tab:
 *   the lesson plays on there, and the clip must not run into the rest of its ayah).
 * - `unlock()`, inside the "Mulai" tap (useAutoplay `tapped`): the element plays a moment of
 *   silence, muted, so the clips the lesson plays later — with no tap — are allowed (iOS Safari).
 *   The element is kept across ayah pages, so the hand-off needs no new tap.
 * - `warm(url)`: fetches a recording ahead of its clip, into this very element (when: warm.ts
 *   exampleToWarm). Nothing plays, nothing is reported.
 * - `loading`: from the moment a clip is asked for until the imam is heard, and while it stalls
 *   (loading.ts): the stage says "Memuat bacaan imam…" once it lasts. `flowing()`: the clip is
 *   sounding right now (the lesson gives up on an example that does not start,
 *   timing.ts EXAMPLE_LOAD_LIMIT_MS).
 * - One recording at a time on the page (AUDIO_START_EVENT): starting pauses every other player,
 *   and another player starting stops the clip (`onInterrupted`).
 * - `rate`: the learner's speed for the imam ("Kecepatan imam"), pitch preserved.
 * - Nothing is cut, copied or stored: the recording streams from the reciter's host, and when the
 *   page goes the element lets go of it (no further fetch).
 */
export function useExamplePlayer(opts: { rate?: PlaybackRate } = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The clip asked for and its handlers; null when none plays. */
  const currentRef = useRef<{ clip: ExampleClip; h: ExampleHandlers } | null>(null);
  /** Non-zero while unlock()'s silent play is under way: its events are not a clip's. */
  const unlockingRef = useRef(0);
  const unlockSeqRef = useRef(0);
  /** A recording asked for by warm() while the silent play was under way: fetched once it ends. */
  const pendingWarmRef = useRef<string | null>(null);
  const rateRef = useRef<PlaybackRate>(opts.rate ?? 1);
  const [loading, setLoading] = useState<AudioLoading | null>(null);

  useEffect(() => {
    const a = exampleAudio();
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
    /** Ends the clip playing now: its handlers are dropped first, so nothing reports twice. */
    const finish = (how: (h: ExampleHandlers) => void) => {
      const cur = currentRef.current;
      currentRef.current = null;
      halt();
      if (!a.paused) a.pause();
      if (cur) how(cur.h);
    };
    /** Stops the element once it has reached the clip's end. True when there is nothing more to
     *  watch: it stopped now, or nothing plays. */
    const stopAtEnd = (): boolean => {
      const cur = currentRef.current;
      if (a.paused || !cur) return true;
      if (!atClipEnd(cur.clip, a.currentTime * 1000)) return false;
      finish((h) => h.onEnd());
      return true;
    };
    const armEnd = () => {
      const cur = currentRef.current;
      if (!cur || timer !== null || a.paused) return;
      const wait = endTimerMs(cur.clip, a.currentTime * 1000, a.playbackRate);
      if (wait === null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!stopAtEnd()) armEnd();
      }, wait);
    };
    const loop = () => {
      raf = null;
      if (stopAtEnd()) return;
      armEnd();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      if (unlockingRef.current) return;
      load("play");
      halt();
      raf = requestAnimationFrame(loop);
      window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a }));
    };
    const onPlaying = () => {
      if (!unlockingRef.current) load("playing");
    };
    const onWaiting = () => {
      if (!unlockingRef.current) load("waiting");
    };
    const onPause = () => {
      load("pause");
      halt();
    };
    // Where no frame runs (a hidden tab, a throttled page): the element's own clock.
    const onTimeUpdate = () => {
      if (!stopAtEnd()) armEnd();
    };
    // The file ended before the clip's end was seen (a clip that ends its ayah): it was heard.
    const onEnded = () => {
      load("ended");
      if (unlockingRef.current) return;
      finish((h) => h.onEnd());
    };
    const onEmptied = () => load("emptied");
    const onError = () => {
      load("error");
      // A failure of the silent play or of a fetch ahead is nobody's failed clip.
      if (unlockingRef.current || !currentRef.current) return;
      finish((h) => h.onError("failed"));
    };
    // A browser that set no position before the file's metadata arrived: set it now.
    const onMetadata = () => {
      const cur = currentRef.current;
      if (cur && needsSeek(cur.clip, a.currentTime * 1000)) a.currentTime = clipStartSeconds(cur.clip);
    };
    // Another player started (the stage's imam, an exercise, the narration, a word the learner
    // clicked): one recording at a time.
    const onOtherStart = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail === a || !currentRef.current) return;
      finish((h) => h.onInterrupted());
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
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      for (const [type, fn] of events) a.removeEventListener(type, fn);
      halt();
      currentRef.current = null;
      unlockingRef.current = 0;
      pendingWarmRef.current = null;
      a.pause();
      a.muted = false;
      // Nothing more fetched once the page is gone; the element itself is kept (its unlock).
      if (a.getAttribute("src") !== null) {
        a.removeAttribute("src");
        a.load();
      }
      a.preload = "none";
      audioRef.current = null;
    };
  }, []);

  const rate = opts.rate ?? 1;
  useEffect(() => {
    rateRef.current = rate;
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
    a.preservesPitch = true;
  }, [rate]);

  /** Points the element at `url` (a new file resets the speed: put back). */
  const point = useCallback((a: HTMLAudioElement, url: string) => {
    if (a.getAttribute("src") !== url) a.src = url;
    else if (a.error) a.load(); // a file that failed is loaded anew (useSegmentPlayer revive)
    a.playbackRate = rateRef.current;
    a.preservesPitch = true;
  }, []);

  /** Plays `clip` from its start; returns the function that stops it. */
  const play = useCallback(
    (clip: ExampleClip, h: ExampleHandlers): (() => void) => {
      const a = audioRef.current;
      if (!a) {
        // Not mounted (cannot happen after the Mulai tap): a failed clip, asynchronously, so the
        // lesson shows the example without its sound and goes on.
        const id = window.setTimeout(() => h.onError("failed"), 0);
        return () => window.clearTimeout(id);
      }
      const mine = { clip, h };
      currentRef.current = mine;
      // A real play takes over from an unfinished unlock().
      unlockingRef.current = 0;
      pendingWarmRef.current = null;
      a.muted = false;
      point(a, clip.url);
      if (needsSeek(clip, a.currentTime * 1000)) a.currentTime = clipStartSeconds(clip);
      void a.play().catch((e: unknown) => {
        if (isAbort(e) || currentRef.current !== mine) return;
        currentRef.current = null;
        h.onError(isBlocked(e) ? "blocked" : "failed");
      });
      return () => {
        if (currentRef.current !== mine) return;
        currentRef.current = null;
        a.pause();
      };
    },
    [point],
  );

  /**
   * Call inside a tap ("Mulai", "Lanjutkan"): plays a moment of silence on the element, muted, so
   * that the clips the lesson plays later without a tap are allowed (iOS Safari; other browsers
   * allow them after any tap on the page). Nothing is heard, nothing is fetched.
   */
  const unlock = useCallback(() => {
    const a = audioRef.current;
    const url = silentUrl();
    if (!a || !url || unlockedAudio.has(a) || !a.paused || currentRef.current) return;
    unlockSeqRef.current += 1;
    const id = unlockSeqRef.current;
    unlockingRef.current = id;
    const before = a.getAttribute("src");
    a.muted = true;
    a.src = url;
    const done = () => {
      if (unlockingRef.current !== id) return; // a clip took over
      unlockingRef.current = 0;
      a.pause();
      a.muted = false;
      // Back to what it pointed at (a recording fetched ahead), or to nothing.
      const next = pendingWarmRef.current ?? before;
      pendingWarmRef.current = null;
      if (next) {
        a.preload = "auto";
        point(a, next);
      } else {
        a.removeAttribute("src");
        a.load();
      }
    };
    void a.play().then(() => {
      unlockedAudio.add(a);
      done();
    }, done);
  }, [point]);

  /**
   * Fetch the recording `url` ahead of its clip (when: src/lib/autoplay/warm.ts exampleToWarm):
   * the element is pointed at it with preload "auto", so the clip later starts from the element's
   * own buffer. The element's own load, not fetch(): the module's CSP lets only media reach the
   * reciters' hosts. Never while a clip plays; put off while unlock()'s silent play is under way.
   */
  const warm = useCallback(
    (url: string) => {
      const a = audioRef.current;
      if (!a || currentRef.current) return;
      if (unlockingRef.current) {
        pendingWarmRef.current = url;
        return;
      }
      if (a.getAttribute("src") === url && !a.error) {
        a.preload = "auto";
        return;
      }
      a.preload = "auto";
      point(a, url);
    },
    [point],
  );

  /** The clip asked for is sounding right now (not loading, not stalled). */
  const flowing = useCallback((): boolean => {
    const a = audioRef.current;
    return !!a && !!currentRef.current && !a.paused && !a.seeking && a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  }, []);

  /** `el` is this player's element (the lesson's own sound, not the learner's). */
  const owns = useCallback((el: unknown) => el !== null && el === audioRef.current, []);

  return { play, unlock, warm, flowing, owns, loading };
}
