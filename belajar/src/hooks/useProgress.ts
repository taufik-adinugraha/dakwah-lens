"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Anonymous-first progress (plan §7.3): kept in localStorage; merged into
 * the learner's account on sign-in (server sync lands with the FSRS review
 * queue). useSyncExternalStore keeps SSR and the first client render equal
 * (empty) and then reads storage — no hydration mismatch, no setState in an
 * effect.
 */
export type ProgressEntry = { score: number; at: number };
export type Progress = Record<string, ProgressEntry>;

const KEY = "belajar:v1:progress";
const EMPTY: Progress = {};
const listeners = new Set<() => void>();
let cacheRaw: string | null = null;
let cache: Progress = EMPTY;

function read(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== cacheRaw) {
      cacheRaw = raw;
      cache = raw ? (JSON.parse(raw) as Progress) : EMPTY;
    }
    return cache;
  } catch {
    return EMPTY; // private mode, blocked storage, corrupt JSON
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useProgress() {
  const progress = useSyncExternalStore(subscribe, read, () => EMPTY);
  const markDone = useCallback((id: string, score: number) => {
    try {
      const next: Progress = { ...read(), [id]: { score, at: Date.now() } };
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return;
    }
    listeners.forEach((l) => l());
  }, []);
  return { progress, markDone };
}
