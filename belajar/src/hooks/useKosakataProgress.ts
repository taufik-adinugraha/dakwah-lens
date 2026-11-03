"use client";

import { useCallback, useSyncExternalStore } from "react";

import { NO_PROGRESS, parseProgress, type PathProgress } from "@/lib/kosakata-path-core";

/**
 * The learning path's progress, kept in this browser only: the module has no sign-in (plan L16). As
 * useProgress: useSyncExternalStore keeps the server's render and the first client render equal, and
 * `null` until then means "not known yet", so a page does not call a batch locked before it has looked.
 */
const KEY = "belajar:v1:kosakata-bertahap";
const listeners = new Set<() => void>();
let cacheRaw: string | null = null;
let cache: PathProgress = NO_PROGRESS;

function read(): PathProgress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== cacheRaw) {
      cacheRaw = raw;
      cache = parseProgress(raw);
    }
    return cache;
  } catch {
    return NO_PROGRESS; // private mode, blocked storage
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useKosakataProgress() {
  const progress = useSyncExternalStore<PathProgress | null>(subscribe, read, () => null);
  const save = useCallback((next: PathProgress) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      return; // the test still shows its result; it just cannot be remembered
    }
    listeners.forEach((l) => l());
  }, []);
  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      return;
    }
    listeners.forEach((l) => l());
  }, []);
  return { progress, save, clear };
}
