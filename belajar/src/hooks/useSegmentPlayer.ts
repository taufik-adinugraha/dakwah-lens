"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Segment = [word: number, startMs: number, endMs: number];
export type RecitationSource = {
  reciter: string;
  url: string;
  segments: Segment[];
};
export type PlaybackRate = 1 | 0.75;

/** play() rejects with AbortError whenever a pause or a new seek interrupts
 *  it — routine, not a failure. */
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** play() rejects with NotAllowedError when the browser wants a (new) tap
 *  before sound may play — not a broken recording. */
export const isBlocked = (e: unknown) => e instanceof DOMException && e.name === "NotAllowedError";

/** Why a recording did not play: the browser asked for a tap first
 *  ("blocked"), or the file could not be loaded or decoded ("failed"). */
export type PlayError = "blocked" | "failed";

/** Window event every player sends when its recording starts (detail: its
 *  Audio element). Every other player on the page pauses, so two
 *  recordings never play over each other (senior-ux §3.5), whichever
 *  component owns them (the lesson stage, the Dengar dan klik exercise,
 *  the autoplay narration — useNarrationPlayer sends and honours it too). */
export const AUDIO_START_EVENT = "belajar:audio-start";

/**
 * The lesson stage's Audio element, kept for the whole visit: the autoplay
 * lesson moves to the next ayah by a client-side navigation, and iOS Safari
 * lets an element play without a tap only once it has played inside a tap
 * (unlock(), on "Mulai"). A new element on every ayah would need a new tap.
 * Only one stage is mounted at a time.
 */
let keptStageAudio: HTMLAudioElement | null = null;
function stageAudio(): HTMLAudioElement {
  if (!keptStageAudio) keptStageAudio = new Audio();
  return keptStageAudio;
}

/** Elements that have played inside a tap (see unlock()). */
const unlockedAudio = new WeakSet<HTMLAudioElement>();
const isUnlocked = (a: HTMLAudioElement) => unlockedAudio.has(a);
const markUnlocked = (a: HTMLAudioElement) => {
  unlockedAudio.add(a);
};

/**
 * One streamed ayah file + its word timings (quran-align).
 *
 * - "Play a word" SEEKS within the ayah recording and stops at the word's end
 *   — no cut audio files are ever created (plan §6.1 A3: we stream, we don't
 *   re-host or splice reciters' recordings).
 * - The active word is read every animation frame (timeupdate fires only
 *   ~4×/s, too coarse for word highlighting).
 * - Slow playback keeps pitch (A5: user-controlled, pitch preserved).
 *
 * - One instance per page section: the lesson stage shares ONE player between
 *   the mushaf line and the guided lesson, so audio never overlaps and the
 *   line highlights whatever the imam is reciting.
 * - Across instances: when one starts playing, every other one pauses (and
 *   remembers its spot) and calls its `onInterrupt`, so e.g. the guided
 *   lesson stops instead of waiting on audio that was paused under it.
 *
 * The hook owns its Audio element (created after mount, never rendered), so
 * components never touch a ref during render (React Compiler rule).
 */
export function useSegmentPlayer(
  sources: RecitationSource[],
  opts: {
    /** Called when playback finishes on its own — the ayah ended or a
     *  single word's segment completed — never on a user pause. */
    onFinish?: () => void;
    /** Called when the recording cannot play: "blocked" when the browser
     *  wants a tap first (autoplay policy), "failed" for a network or
     *  decoding error. Only "failed" sets `failed`. */
    onError?: (reason: PlayError) => void;
    /** Called when another player on the page starts, which pauses this one
     *  (also when this one was silent at that moment). */
    onInterrupt?: () => void;
    /** Controlled speed (e.g. a remembered preference); when omitted the
     *  hook keeps its own, changed with setRate. */
    rate?: PlaybackRate;
    /** Use the lesson stage's element, kept across ayah pages (read once,
     *  on mount). For the stage only: at most one such player at a time. */
    keep?: boolean;
  } = {},
) {
  const onFinishRef = useRef(opts.onFinish);
  const onErrorRef = useRef(opts.onError);
  const onInterruptRef = useRef(opts.onInterrupt);
  useEffect(() => {
    onFinishRef.current = opts.onFinish;
    onErrorRef.current = opts.onError;
    onInterruptRef.current = opts.onInterrupt;
  }, [opts.onFinish, opts.onError, opts.onInterrupt]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keepRef = useRef(opts.keep === true);
  /** Non-zero while unlock()'s silent play is under way: its events are
   *  not the learner's playback. */
  const unlockingRef = useRef(0);
  const unlockSeqRef = useRef(0);
  /** Marks playback as started (state, highlight loop, the page-wide start
   *  event): what the element's "play" event does; set by the effect. */
  const beginRef = useRef<(() => void) | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const rateRef = useRef<PlaybackRate>(1);
  /** Where a paused whole-ayah playback stopped; null = start from 0. */
  const resumeAtRef = useRef<number | null>(null);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeWord, setActiveWord] = useState<number | null>(null);
  const [ownRate, setRate] = useState<PlaybackRate>(1);
  const rate = opts.rate ?? ownRate;
  /** The last attempt to play failed; cleared once audio actually plays. */
  const [failed, setFailed] = useState(false);

  const source = sources[sourceIdx] ?? sources[0];

  // Create the element once; the highlight loop lives in this closure.
  useEffect(() => {
    const keep = keepRef.current;
    const a = keep ? stageAudio() : new Audio();
    a.preload = "none";
    audioRef.current = a;
    let raf: number | null = null;

    const wordAt = (ms: number): number | null => {
      for (const [w, s, e] of segmentsRef.current) if (ms >= s && ms < e) return w;
      return null;
    };
    const loop = () => {
      // Paused since the last frame (the pause event is still on its way).
      if (a.paused) {
        raf = null;
        return;
      }
      const ms = a.currentTime * 1000;
      const stopAt = stopAtRef.current;
      if (stopAt !== null && ms >= stopAt) {
        stopAtRef.current = null;
        a.pause();
        setActiveWord(null);
        onFinishRef.current?.();
        return;
      }
      setActiveWord(wordAt(ms));
      raf = requestAnimationFrame(loop);
    };
    /** Idempotent: a second call restarts the loop and re-sends the event,
     *  which other players treat the same way. */
    const begin = () => {
      setPlaying(true);
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
      window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a }));
    };
    beginRef.current = begin;
    const onPlay = () => {
      if (unlockingRef.current) return;
      begin();
    };
    // Another player started: pause here, keeping the spot like a learner's
    // pause (a single word is a detour, not a position to resume from).
    const onOtherStart = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail === a) return;
      if (!a.paused) {
        resumeAtRef.current = stopAtRef.current === null ? a.currentTime : null;
        a.pause();
        // No word stays lit as "being recited" while another player speaks.
        setActiveWord(null);
      }
      onInterruptRef.current?.();
    };
    const onStop = () => {
      setPlaying(false);
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      if (a.ended) {
        resumeAtRef.current = null;
        setActiveWord(null);
      }
    };
    const onEnded = () => {
      onStop();
      onFinishRef.current?.();
    };
    const onPlaying = () => {
      if (!unlockingRef.current) setFailed(false);
    };
    const onError = () => {
      // A failure during unlock() surfaces at the first real play instead.
      if (unlockingRef.current) return;
      setFailed(true);
      onErrorRef.current?.("failed");
    };

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onStop);
    a.addEventListener("ended", onEnded);
    a.addEventListener("playing", onPlaying);
    a.addEventListener("error", onError);
    window.addEventListener(AUDIO_START_EVENT, onOtherStart);
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onStop);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("error", onError);
      if (raf !== null) cancelAnimationFrame(raf);
      unlockingRef.current = 0;
      beginRef.current = null;
      a.pause();
      a.muted = false;
      a.removeAttribute("src");
      audioRef.current = null;
    };
  }, []);

  // Point the element at the chosen reciter's file (fetched only on play).
  useEffect(() => {
    segmentsRef.current = source.segments;
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    stopAtRef.current = null;
    resumeAtRef.current = null;
    a.src = source.url;
    // A src swap resets the element's rate; re-apply the learner's choice.
    a.playbackRate = rateRef.current;
    a.preservesPitch = true;
  }, [source]);

  useEffect(() => {
    rateRef.current = rate;
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
    a.preservesPitch = true;
  }, [rate]);

  const start = useCallback((a: HTMLAudioElement) => {
    // A real play takes over from an unfinished unlock(). If the unlock's
    // muted play is already under way, this play() fires no new "play"
    // event (the element is not paused), and its own was ignored: start the
    // highlight loop (which enforces a word's end) and the event by hand.
    const takeover = unlockingRef.current !== 0 && !a.paused;
    unlockingRef.current = 0;
    a.muted = false;
    void a.play().catch((e: unknown) => {
      if (isAbort(e)) return;
      const blocked = isBlocked(e);
      if (!blocked) setFailed(true);
      onErrorRef.current?.(blocked ? "blocked" : "failed");
    });
    if (takeover) beginRef.current?.();
  }, []);

  /** Play the whole ayah — RESUMING where a pause left off; from the start
   *  only when nothing is mid-way (fresh, ended, or after a single-word
   *  replay, which is a detour rather than a position to resume from). */
  const playAll = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const midWord = stopAtRef.current !== null;
    stopAtRef.current = null;
    if (a.ended || midWord || resumeAtRef.current === null) a.currentTime = 0;
    else a.currentTime = resumeAtRef.current;
    start(a);
  }, [start]);

  /** Start the ayah over from the beginning. */
  const restart = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = null;
    resumeAtRef.current = null;
    a.currentTime = 0;
    start(a);
  }, [start]);

  /** Play one word (seek + stop at its end). Returns false when the word has
   *  no timing in this recording, so nothing will play or finish. */
  const playWord = useCallback(
    (word: number): boolean => {
      const a = audioRef.current;
      const seg = source.segments.find(([w]) => w === word);
      if (!a || !seg) return false;
      stopAtRef.current = seg[2];
      resumeAtRef.current = null;
      a.currentTime = seg[1] / 1000;
      start(a);
      return true;
    },
    [source, start],
  );

  /** Pause and remember the spot, so the next play resumes there. A no-op
   *  when nothing is playing (so it never invents a resume point). */
  const pause = useCallback(() => {
    const a = audioRef.current;
    if (!a || a.paused) return;
    resumeAtRef.current = stopAtRef.current === null ? a.currentTime : null;
    a.pause();
  }, []);

  /**
   * Call inside a tap (e.g. "Mulai"): plays the element silently for a
   * moment, so later plays that no tap starts (the autoplay lesson's
   * recitations) are allowed — iOS Safari's rule; other browsers allow them
   * after any tap on the page. Changes nothing the learner can see or hear.
   */
  const unlock = useCallback(() => {
    const a = audioRef.current;
    if (!a || isUnlocked(a) || !a.paused || !a.getAttribute("src")) return;
    unlockSeqRef.current += 1;
    const id = unlockSeqRef.current;
    unlockingRef.current = id;
    a.muted = true;
    const done = () => {
      if (unlockingRef.current !== id) return; // a real play took over
      unlockingRef.current = 0;
      a.pause();
      a.muted = false;
    };
    void a.play().then(() => {
      markUnlocked(a);
      done();
    }, done);
  }, []);

  const chooseSource = useCallback((i: number) => {
    audioRef.current?.pause();
    stopAtRef.current = null;
    setActiveWord(null);
    setFailed(false);
    setSourceIdx(i);
  }, []);

  const hasWord = useCallback(
    (w: number) => source.segments.some(([sw]) => sw === w),
    [source],
  );

  return {
    source,
    sourceIdx,
    chooseSource,
    playing,
    activeWord,
    rate,
    /** Changes the hook's own speed (ignored while `opts.rate` controls it). */
    setRate,
    failed,
    playAll,
    restart,
    playWord,
    pause,
    hasWord,
    unlock,
  };
}
