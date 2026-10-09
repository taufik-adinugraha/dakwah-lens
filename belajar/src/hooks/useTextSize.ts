"use client";

import { useSyncExternalStore } from "react";

/**
 * "Ukuran huruf" (docs/belajar-research/senior-ux.md §3.4): the learner's
 * text size, kept in localStorage and applied as html[data-text-size] (see
 * globals.css: a percentage of the browser default, so the learner's own
 * OS/browser setting is still respected). The inline script in
 * app/[locale]/layout.tsx applies the stored value before first paint; this
 * hook keeps the switch in step with it. Same pattern as useProgress:
 * useSyncExternalStore keeps SSR and the first client render equal
 * ("normal"), then reads storage, with no setState in an effect.
 *
 * Keep the two storage keys below in sync with the pre-paint script in
 * app/[locale]/layout.tsx.
 */
export type TextSize = "normal" | "besar" | "sangat-besar";

export const TEXT_SIZES: readonly TextSize[] = ["normal", "besar", "sangat-besar"];

const KEY = "belajar:v1:text-size";
/** Set once the Home hint card ("Tulisan kurang jelas?") is dismissed. */
const HINT_KEY = "belajar:v1:text-size-hint";

const listeners = new Set<() => void>();
// Fallback when storage is blocked (private mode): the choice still applies
// for this page view, it just isn't remembered.
let memory: TextSize = "normal";

function isTextSize(v: unknown): v is TextSize {
  return v === "normal" || v === "besar" || v === "sangat-besar";
}

function read(): TextSize {
  try {
    const raw = window.localStorage.getItem(KEY);
    return isTextSize(raw) ? raw : memory;
  } catch {
    return memory;
  }
}

function applyToDocument(size: TextSize) {
  try {
    const root = document.documentElement;
    if (size === "normal") delete root.dataset.textSize;
    else root.dataset.textSize = size;
  } catch {
    // no document (never on the client) — nothing to apply
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Another tab changed the size: follow it here too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    applyToDocument(isTextSize(e.newValue) ? e.newValue : "normal");
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function setTextSize(size: TextSize) {
  memory = size;
  try {
    window.localStorage.setItem(KEY, size);
  } catch {
    // blocked storage: keep the in-memory choice
  }
  applyToDocument(size);
  listeners.forEach((l) => l());
}

export function useTextSize(): [TextSize, (s: TextSize) => void] {
  const size = useSyncExternalStore(subscribe, read, () => "normal" as const);
  return [size, setTextSize];
}

/**
 * Hide the one-time Home hint card for good. Hidden through CSS
 * (html[data-text-hint="off"] .text-size-hint), the same attribute the
 * pre-paint script sets, so a returning learner never sees it flash.
 */
export function dismissTextSizeHint() {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // blocked storage: hidden for this page view only
  }
  try {
    document.documentElement.dataset.textHint = "off";
  } catch {
    // no document
  }
}
