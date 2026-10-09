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
 */
export function useSegmentPlayer(sources: RecitationSource[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeWord, setActiveWord] = useState<number | null>(null);
  const [rate, setRate] = useState<1 | 0.75>(1);

  const source = sources[sourceIdx] ?? sources[0];

  const wordAt = useCallback(
    (ms: number): number | null => {
      for (const [w, s, e] of source.segments) if (ms >= s && ms < e) return w;
      return null;
    },
    [source],
  );

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const ms = a.currentTime * 1000;
    if (stopAtRef.current !== null && ms >= stopAtRef.current) {
      a.pause();
      stopAtRef.current = null;
      setActiveWord(null);
      return;
    }
    setActiveWord(wordAt(ms));
    rafRef.current = requestAnimationFrame(tick);
  }, [wordAt]);

  // Wire element events once per source.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => {
      setPlaying(true);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    const onStop = () => {
      setPlaying(false);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (a.ended) setActiveWord(null);
    };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onStop);
    a.addEventListener("ended", onStop);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onStop);
      a.removeEventListener("ended", onStop);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [tick, source.url]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = rate;
    a.preservesPitch = true;
  }, [rate, source.url]);

  const playAll = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    stopAtRef.current = null;
    if (a.ended || a.currentTime > 0) a.currentTime = 0;
    void a.play().catch(() => {});
  }, []);

  const playWord = useCallback(
    (word: number) => {
      const a = audioRef.current;
      const seg = source.segments.find(([w]) => w === word);
      if (!a || !seg) return;
      stopAtRef.current = seg[2];
      a.currentTime = seg[1] / 1000;
      void a.play().catch(() => {});
    },
    [source],
  );

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const chooseSource = useCallback((i: number) => {
    audioRef.current?.pause();
    stopAtRef.current = null;
    setActiveWord(null);
    setSourceIdx(i);
  }, []);

  return {
    audioRef,
    source,
    sourceIdx,
    chooseSource,
    playing,
    activeWord,
    rate,
    setRate,
    playAll,
    playWord,
    pause,
    hasWord: (w: number) => source.segments.some(([sw]) => sw === w),
  };
}
