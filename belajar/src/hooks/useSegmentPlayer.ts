"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Segment = [word: number, startMs: number, endMs: number];
export type RecitationSource = {
  reciter: string;
  url: string;
  segments: Segment[];
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
 * The hook owns its Audio element (created after mount, never rendered), so
 * components never touch a ref during render (React Compiler rule).
 */
export function useSegmentPlayer(sources: RecitationSource[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const rateRef = useRef<1 | 0.75>(1);
  /** Where a paused whole-ayah playback stopped; null = start from 0. */
  const resumeAtRef = useRef<number | null>(null);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeWord, setActiveWord] = useState<number | null>(null);
  const [rate, setRate] = useState<1 | 0.75>(1);

  const source = sources[sourceIdx] ?? sources[0];

  // Create the element once; the highlight loop lives in this closure.
  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    audioRef.current = a;
    let raf: number | null = null;

    const wordAt = (ms: number): number | null => {
      for (const [w, s, e] of segmentsRef.current) if (ms >= s && ms < e) return w;
      return null;
    };
    const loop = () => {
      const ms = a.currentTime * 1000;
      const stopAt = stopAtRef.current;
      if (stopAt !== null && ms >= stopAt) {
        stopAtRef.current = null;
        a.pause();
        setActiveWord(null);
        return;
      }
      setActiveWord(wordAt(ms));
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
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

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onStop);
    a.addEventListener("ended", onStop);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onStop);
      a.removeEventListener("ended", onStop);
      if (raf !== null) cancelAnimationFrame(raf);
      a.pause();
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
    void a.play().catch(() => {});
  }, []);

  /** Start the ayah over from the beginning. */
  const restart = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = null;
    resumeAtRef.current = null;
    a.currentTime = 0;
    void a.play().catch(() => {});
  }, []);

  const playWord = useCallback(
    (word: number) => {
      const a = audioRef.current;
      const seg = source.segments.find(([w]) => w === word);
      if (!a || !seg) return;
      stopAtRef.current = seg[2];
      resumeAtRef.current = null;
      a.currentTime = seg[1] / 1000;
      void a.play().catch(() => {});
    },
    [source],
  );

  /** Pause and remember the spot, so the next play resumes there. */
  const pause = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    resumeAtRef.current = stopAtRef.current === null ? a.currentTime : null;
    a.pause();
  }, []);

  const chooseSource = useCallback((i: number) => {
    audioRef.current?.pause();
    stopAtRef.current = null;
    setActiveWord(null);
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
    setRate,
    playAll,
    restart,
    playWord,
    pause,
    hasWord,
  };
}
