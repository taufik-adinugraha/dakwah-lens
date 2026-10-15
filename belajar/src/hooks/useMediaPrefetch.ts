"use client";

import { useEffect, useState } from "react";

import type { ConnectionHints } from "@/lib/autoplay/loading";
import { createMediaStore, type MediaStore, planFor } from "@/lib/media-prefetch";

/**
 * The page's one store of recordings fetched ahead (src/lib/media-prefetch.ts: what, when, how
 * much), shared by every player of the page and kept across the lesson's client-side hand-off to
 * the next ayah — so the next ayah's files, fetched near the end of this one, are still held when
 * its page opens.
 *
 * - `useMediaPrefetch(plans, open)`: the page's plans by name — "ayah" (this lesson's recordings),
 *   "next" (the next ayah's, once due), "page" (a Konsep / Harakat / Kosakata page's examples).
 *   Set at mount (a plan the page does not name is emptied, so what the previous page held and
 *   this one does not need is revoked); fetching starts at the first idle moment after load, and
 *   from then on only while `open` (the lesson's gate). Nothing at all with Save-Data / 2G.
 * - `mediaSrc(url)`: what a player sets as its source — the held copy's object URL, or `url`.
 * - `discardMedia(url)`: a copy that did not play (its element failed on it): revoked; the
 *   player tries the network URL. `subscribeMedia(fn)`: told when a fetch ends (the stage points
 *   its idle element at the ayah's copy once it is held).
 */
let store: MediaStore | null = null;
const listeners = new Set<() => void>();

function mediaStore(): MediaStore | null {
  if (typeof window === "undefined" || typeof window.fetch !== "function" || typeof URL.createObjectURL !== "function") return null;
  store ??= createMediaStore({
    fetch: (url, init) => window.fetch(url, init),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    onChange: () => listeners.forEach((fn) => fn()),
  });
  return store;
}

/** The source a player should use for `url`: the copy held, or the URL itself. */
export function mediaSrc(url: string): string {
  return store?.held(url) ?? url;
}

/** Calls `fn` whenever a fetch ends (a copy is held now, or one failed); returns the unsubscribe. */
export function subscribeMedia(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `src` (an object URL handed out by mediaSrc for `url`) did not play: let it go. */
export function discardMedia(url: string): void {
  store?.discard(url);
}

const PLAN_NAMES = ["ayah", "next", "page"] as const;
export type MediaPlans = Partial<Record<(typeof PLAN_NAMES)[number], readonly string[]>>;

/** How long after load the page waits for an idle moment before it starts fetching. */
const IDLE_TIMEOUT_MS = 2000;

const connection = () => (navigator as Navigator & { connection?: ConnectionHints }).connection;

export function useMediaPrefetch(plans: MediaPlans, open = true): void {
  const [idle, setIdle] = useState(false);
  const key = PLAN_NAMES.map((n) => (plans[n] ?? []).join("|")).join("#");

  // At mount, and whenever the plans change: the store holds exactly this page's plans ("ayah"
  // first: on the hand-off, the files the previous page fetched as "next" are this page's "ayah"
  // before "next" is emptied, so none is revoked in between).
  useEffect(() => {
    const s = mediaStore();
    if (!s) return;
    const conn = connection();
    for (const n of PLAN_NAMES) s.want(n, planFor(plans[n] ?? [], conn));
    // `key` stands for `plans` (a new array each render with the same files).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let done = false;
    const go = () => {
      if (!done) setIdle(true);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let id: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (typeof w.requestIdleCallback === "function") id = w.requestIdleCallback(go, { timeout: IDLE_TIMEOUT_MS });
      else timer = setTimeout(go, 200);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      done = true;
      window.removeEventListener("load", arm);
      if (id !== null) w.cancelIdleCallback?.(id);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    mediaStore()?.setOpen(idle && open);
  }, [idle, open]);
}
