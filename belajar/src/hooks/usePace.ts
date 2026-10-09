"use client";

import { useSyncExternalStore } from "react";

import { PACES, type Pace } from "@/lib/lessonSteps";

export type { Pace };

/**
 * Lesson preferences kept in this browser (like useProgress: localStorage
 * read through useSyncExternalStore, so SSR and the first client render
 * agree and no effect sets state). Synced to the account later, together
 * with progress (senior-ux §3.4).
 *
 * If storage is blocked (private mode), a choice still holds for this visit
 * through the in-memory fallback, so the learner is not asked again on every
 * page.
 */
function createPref<T extends string>(key: string, valid: readonly T[]) {
  const listeners = new Set<() => void>();
  let memory: T | null = null;
  const isValid = (v: string | null): v is T => v !== null && (valid as readonly string[]).includes(v);

  const read = (): T | null => {
    try {
      const v = window.localStorage.getItem(key);
      return isValid(v) ? v : memory;
    } catch {
      return memory;
    }
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  };
  const write = (v: T) => {
    memory = v;
    try {
      window.localStorage.setItem(key, v);
    } catch {
      /* storage blocked: the in-memory value still applies for this visit */
    }
    listeners.forEach((l) => l());
  };
  const serverSnapshot = (): T | null => null;
  return { read, subscribe, write, serverSnapshot };
}

export const DEFAULT_PACE: Pace = "biasa";
const pacePref = createPref<Pace>("belajar:v1:pace", PACES);

/**
 * How the guided lesson moves on: "biasa" | "pelan" | "tunggu" (default
 * "biasa"). `chosen` is false until the learner has picked one — the lesson
 * asks once, before the first start.
 */
export function usePace(): { pace: Pace; chosen: boolean; setPace: (p: Pace) => void } {
  const stored = useSyncExternalStore(pacePref.subscribe, pacePref.read, pacePref.serverSnapshot);
  return { pace: stored ?? DEFAULT_PACE, chosen: stored !== null, setPace: pacePref.write };
}

/** The imam's playback speed: normal or slow (0.75×, pitch preserved). */
export type ImamRate = 1 | 0.75;
const ratePref = createPref<"1" | "0.75">("belajar:v1:imam-rate", ["1", "0.75"]);
const setImamRate = (r: ImamRate) => ratePref.write(r === 0.75 ? "0.75" : "1");

/** Remembered across ayat, so a learner who chose "Pelan" keeps it. */
export function useImamRate(): [ImamRate, (r: ImamRate) => void] {
  const stored = useSyncExternalStore(ratePref.subscribe, ratePref.read, ratePref.serverSnapshot);
  return [stored === "0.75" ? 0.75 : 1, setImamRate];
}
