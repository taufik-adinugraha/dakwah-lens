/**
 * Remembering where the learner is, per ayah, so a reload resumes
 * ("Lanjutkan dari langkah N"). House pattern: localStorage, every access in
 * try/catch (private mode, blocked storage), read through
 * useSyncExternalStore by the UI. The STEP ID is stored, not the index, so
 * a content change never resumes at the wrong step.
 *
 * Also the hand-off to the next ayah: the runner marks "continue" before it
 * navigates, and the next ayah's page starts by itself (start, reason
 * "continue") if the mark is fresh. A client-side navigation keeps the
 * page's one user gesture, so its audio may play without a new tap. The
 * mark is also kept in this module's memory, which survives exactly that
 * client-side navigation (not a reload), so blocked sessionStorage does not
 * break the chain.
 */
import type { AutoplayState } from "./machine";
import type { AutoplaySequence, NavIntent } from "./types";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage key of one ayah's autoplay position. */
export const autoplayStorageKey = (lessonKey: string) => `belajar:v1:autoplay:${lessonKey}`;

/** sessionStorage key of the hand-off to the next ayah. */
export const AUTOPLAY_CONTINUE_KEY = "belajar:v1:autoplay:continue";

/** A mark older than this is ignored (the learner came back later). */
export const CONTINUE_MAX_AGE_MS = 120_000;

/** window.localStorage / sessionStorage, or null where there is none. */
export function browserStorage(kind: "local" | "session" = "local"): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The value to store for this state: the current step while a lesson is
 * under way past its first step; null to forget it (finished); undefined to
 * leave storage alone (not started yet, or still on the first step — so one
 * habitual tap on "Mulai dari awal" does not erase a remembered place until
 * the new run actually moves on).
 */
export function positionToSave(seq: AutoplaySequence, s: AutoplayState): string | null | undefined {
  if (!s.started) return undefined;
  if (s.phase === "finished") return null;
  if (s.idx === 0) return undefined;
  return JSON.stringify({ v: 1, step: seq.steps[s.idx].id });
}

/** Index of a stored position in this sequence, or null (none, unknown
 *  step, the first step, or a corrupt value). */
export function restoreIndex(seq: AutoplaySequence, raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; step?: unknown };
    if (v?.v !== 1 || typeof v.step !== "string") return null;
    const i = seq.steps.findIndex((x) => x.id === v.step);
    return i > 0 ? i : null;
  } catch {
    return null;
  }
}

/** For useSyncExternalStore's getSnapshot: a number or null (stable). */
export function readSavedIndex(storage: StorageLike | null | undefined, seq: AutoplaySequence): number | null {
  if (!storage) return null;
  try {
    return restoreIndex(seq, storage.getItem(autoplayStorageKey(seq.lessonKey)));
  } catch {
    return null;
  }
}

export function savePosition(storage: StorageLike | null | undefined, seq: AutoplaySequence, s: AutoplayState): void {
  if (!storage) return;
  const value = positionToSave(seq, s);
  if (value === undefined) return;
  const key = autoplayStorageKey(seq.lessonKey);
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    /* storage blocked: the position just isn't remembered */
  }
}

/** The hand-off mark in memory: survives a client-side navigation (the
 *  JS context stays), not a reload — exactly the hand-off's lifetime. */
let memoryMark: string | null = null;

/** Before navigating to the next ayah: let its page start by itself. */
export function markContinue(storage: StorageLike | null | undefined, intent: NavIntent, now: number): void {
  if (intent.kind !== "ayah") return;
  const mark = JSON.stringify({ to: `${intent.slug}/${intent.ayah}`, at: now });
  memoryMark = mark;
  if (!storage) return;
  try {
    storage.setItem(AUTOPLAY_CONTINUE_KEY, mark);
  } catch {
    /* blocked: the memory mark still carries the hand-off */
  }
}

/** On the next ayah's page: was it reached by the autoplay hand-off? The
 *  mark is consumed (a reload does not start by itself again). */
export function takeContinue(storage: StorageLike | null | undefined, lessonKey: string, now: number): boolean {
  let raw: string | null = null;
  if (storage) {
    try {
      raw = storage.getItem(AUTOPLAY_CONTINUE_KEY);
      if (raw) storage.removeItem(AUTOPLAY_CONTINUE_KEY);
    } catch {
      raw = null;
    }
  }
  raw = raw ?? memoryMark;
  memoryMark = null;
  if (!raw) return false;
  try {
    const v = JSON.parse(raw) as { to?: unknown; at?: unknown };
    return v?.to === lessonKey && typeof v.at === "number" && now - v.at >= 0 && now - v.at <= CONTINUE_MAX_AGE_MS;
  } catch {
    return false;
  }
}
