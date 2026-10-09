/**
 * Where the questionnaire's answers live (plan §9.4; architecture.md §6.4). Nothing here talks to
 * a server: no fetch, no beacon, no form. Every storage access is wrapped in try/catch, and the
 * page works with storage blocked (private mode).
 *
 * | layer          | key                         | when                                          |
 * |----------------|-----------------------------|-----------------------------------------------|
 * | React state    | —                           | always (useReducer over the machine)          |
 * | sessionStorage | belajar:v1:waris:draft      | autosave on every answer; gone with the tab   |
 * | localStorage   | belajar:v1:waris:saved      | only after "Simpan di perangkat ini"; "Hapus" |
 * | URL fragment   | #j=v1.<token>               | only as the hand-off fallback when the tab     |
 * |                |                             | cannot store, or when a #j= link is opened    |
 * | URL fragment   | #baru                       | "Hitung untuk beliau" (routes.ts warisHref):   |
 * |                |                             | a fresh start, the tab's draft left alone      |
 *
 * The stored shape is the machine's QState with no cursor: { v: 1, answers, at: null }
 * (architecture.md §6.4 "JSON QState"; questionnaire/index.ts storable(): never the cursor).
 * The killer answer (A3 k6) cannot be in it: QState has no representation for it, the reducer
 * drops it and the codec has no code for it (plan §5.6).
 *
 * Read through useSyncExternalStore (server snapshot = "still loading"), like useProgress and
 * usePace: no hydration mismatch, no setState in an effect.
 */
import { decode, storable, tokenFromHash, type Answers, type QState } from "@/lib/waris/questionnaire";

export const DRAFT_KEY = "belajar:v1:waris:draft";
export const SAVED_KEY = "belajar:v1:waris:saved";

/** The JSON written under both keys. */
export function serialize(answers: Answers): string {
  const s: QState = { v: 1, answers, at: null };
  return JSON.stringify(s);
}

/** Parse a stored QState (or nothing). Never throws; the reducer's "muat" sanitises the answers. */
export function parseStored(raw: string | null): Answers | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const o = v as { v?: unknown; answers?: unknown };
    if (o.v !== 1 || typeof o.answers !== "object" || o.answers === null || Array.isArray(o.answers)) return null;
    return o.answers as Answers;
  } catch {
    return null;
  }
}

function getItem(kind: "session" | "local", key: string): string | null {
  try {
    return (kind === "session" ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return null;
  }
}

/** true when the value reads back as written. */
function setItem(kind: "session" | "local", key: string, value: string | null): boolean {
  try {
    const s = kind === "session" ? window.sessionStorage : window.localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return s.getItem(key) === value;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The working copy (sessionStorage, with an in-memory fallback for blocked storage)
// ---------------------------------------------------------------------------------------------

/**
 * Only when this tab cannot store: keeps the working copy across a client-side navigation to the
 * report and back. Never set when sessionStorage works, so a "Hapus" elsewhere (the report's
 * clearAnswers) cannot be undone by a stale copy here.
 */
let memoryDraft: string | null = null;

/** Autosave (called from an effect and before the hand-off). false = the tab cannot store. */
export function writeDraft(answers: Answers): boolean {
  const empty = Object.keys(answers).length === 0;
  const raw = empty ? null : serialize(storable({ v: 1, answers, at: null }));
  const ok = setItem("session", DRAFT_KEY, raw);
  memoryDraft = ok ? null : raw;
  return ok;
}

export function clearDraft(): void {
  memoryDraft = null;
  setItem("session", DRAFT_KEY, null);
}

// ---------------------------------------------------------------------------------------------
// Where the page starts (read once per mount)
// ---------------------------------------------------------------------------------------------

export type Boot =
  | { kind: "memuat" }
  /** A #j= link was opened: its answers (amounts are never used by the questionnaire). */
  | { kind: "tautan"; answers: Answers }
  /** This tab's working copy. */
  | { kind: "sesi"; answers: Answers }
  /** Only a copy saved on this device: ask before loading it (a shared family phone). */
  | { kind: "tersimpan"; answers: Answers }
  /** "#baru": start fresh (warisHref.hitung({ baru: true })), keeping the draft until an answer. */
  | { kind: "baru" }
  | { kind: "kosong" };

export const BOOT_LOADING: Boot = { kind: "memuat" };
const BOOT_EMPTY: Boot = { kind: "kosong" };
const BOOT_FRESH: Boot = { kind: "baru" };
/** The fragment routes.ts warisHref.hitung({ baru: true }) adds. */
export const FRESH_HASH = "#baru";

let bootCache: { key: string; boot: Boot } | null = null;

function currentHash(): string {
  try {
    return window.location.hash;
  } catch {
    return "";
  }
}

/** The questionnaire's own path (basePath and locale vary), with no trailing slash. */
const HITUNG_PATH = /\/waris\/hitung\/?$/;

function onHitungPath(): boolean {
  try {
    return HITUNG_PATH.test(window.location.pathname);
  } catch {
    return true;
  }
}

export function readBoot(): Boot {
  // During a client-side navigation into this page (from the report's "Ubah jawaban" or "Hitung
  // untuk beliau"), the first render can still see the previous page's URL: Next.js updates the
  // address in the same commit, after render. Its hash (#j= of a shared report) is not ours, so
  // wait: React re-reads this snapshot after the commit and the page starts from the right one.
  if (!onHitungPath()) return BOOT_LOADING;
  const hash = currentHash();
  const session = getItem("session", DRAFT_KEY) ?? memoryDraft;
  const saved = getItem("local", SAVED_KEY);
  const key = `${hash}\u0000${session ?? ""}\u0000${saved ?? ""}`;
  if (bootCache && bootCache.key === key) return bootCache.boot;
  let boot: Boot = BOOT_EMPTY;
  if (hash === FRESH_HASH) {
    bootCache = { key, boot: BOOT_FRESH };
    return BOOT_FRESH;
  }
  const token = tokenFromHash(hash);
  const fromLink = token ? decode(token) : null;
  const fromSession = parseStored(session);
  const fromSaved = parseStored(saved);
  if (fromLink && Object.keys(fromLink.answers).length > 0) boot = { kind: "tautan", answers: fromLink.answers };
  else if (fromSession && Object.keys(fromSession).length > 0) boot = { kind: "sesi", answers: fromSession };
  else if (fromSaved && Object.keys(fromSaved).length > 0) boot = { kind: "tersimpan", answers: fromSaved };
  bootCache = { key, boot };
  return boot;
}

/**
 * The boot decision is taken once per mount; later changes are the page's own writes. The one
 * nudge: a re-read shortly after subscribing, in case the address changed after React's own
 * post-commit check (see readBoot), so the page never stays on "Menyiapkan pertanyaan…".
 */
export function subscribeBoot(cb: () => void): () => void {
  const timer = window.setTimeout(cb, 50);
  return () => window.clearTimeout(timer);
}

export const serverBoot = (): Boot => BOOT_LOADING;

/**
 * Take a consumed fragment (#j= family data, or #baru) out of the address bar. The state passed is
 * null, Next.js's documented integration: Next then copies its own state and syncs the router, so
 * its canonical URL loses the fragment too. Passing window.history.state (marked __NA) would skip
 * that sync, and the router's next commit could write the family data back into the address bar.
 */
export function dropFragment(): void {
  try {
    const h = window.location.hash;
    if (h !== FRESH_HASH && !tokenFromHash(h)) return;
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
  } catch {
    /* no history API: the fragment stays, which is no worse than the link itself */
  }
}

// ---------------------------------------------------------------------------------------------
// "Simpan di perangkat ini" (localStorage, explicit only)
// ---------------------------------------------------------------------------------------------

const savedListeners = new Set<() => void>();

export function readSaved(): string | null {
  return getItem("local", SAVED_KEY);
}

export function subscribeSaved(cb: () => void): () => void {
  savedListeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SAVED_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    savedListeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export const serverSaved = (): string | null => null;

/** false = this browser does not allow it (the answers still hold for this page view). */
export function saveOnDevice(answers: Answers): boolean {
  const ok = setItem("local", SAVED_KEY, serialize(storable({ v: 1, answers, at: null })));
  savedListeners.forEach((l) => l());
  return ok;
}

export function removeFromDevice(): boolean {
  const ok = setItem("local", SAVED_KEY, null);
  savedListeners.forEach((l) => l());
  return ok;
}
