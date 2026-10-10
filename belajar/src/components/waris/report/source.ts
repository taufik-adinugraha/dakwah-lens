/**
 * Where the report's answers come from (plan D9, §9.4; architecture.md §6.4), read through
 * useSyncExternalStore (no setState in an effect, no storage read during render):
 *
 *  1. the URL fragment "#j=v1.<token>" (a shared link; may carry rupiah when the sender ticked it);
 *  2. memory: handOffToReport(), for a questionnaire that navigates here client-side;
 *  3. sessionStorage "belajar:v1:waris:draft" (the questionnaire's autosave; gone with the tab);
 *  4. localStorage "belajar:v1:waris:saved" (only after "Simpan di perangkat ini").
 *
 * Storage holds the answers object, or a QState ({ v, answers, at }); either is accepted, and the
 * reducer's "muat" action drops unknown keys and invalid values. Rupiah amounts are never read
 * from or written to storage (personal financial data, UU 27/2022 Pasal 4(2)(f)).
 *
 * The killer answer (A3 k6) cannot be here: no QState holds it and the codec has no code for it.
 * No network: nothing in this module (or anywhere under components/waris) sends a request.
 */
import { useMemo, useSyncExternalStore } from "react";

import { decode, initialState, reduce, tokenFromHash, type Amounts, type Answers } from "@/lib/waris/questionnaire";

export const DRAFT_KEY = "belajar:v1:waris:draft";
export const SAVED_KEY = "belajar:v1:waris:saved";

export type SourceFrom = "tautan" | "memori" | "sesi" | "perangkat";

export type AnswerSource =
  | { status: "memuat" }
  | { status: "kosong" }
  | { status: "rusak" }
  | { status: "ada"; from: SourceFrom; answers: Answers; amounts?: Amounts; key: string; token?: string };

const listeners = new Set<() => void>();
let memory: { answers: Answers; amounts?: Amounts } | null = null;
let memoryVersion = 0;
/**
 * The last share token seen in the fragment. Kept for the page's life, so that a jump that
 * rewrites the hash (the layout's "Langsung ke isi halaman" link sets "#isi") does not drop a
 * report opened from a link.
 */
let latchedToken: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function hashToken(): string | null {
  try {
    return tokenFromHash(window.location.hash);
  } catch {
    return null;
  }
}

function readStorage(kind: "session" | "local", key: string): string {
  try {
    const s = kind === "session" ? window.sessionStorage : window.localStorage;
    return s.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const t = hashToken();
  if (t) latchedToken = t;
  const onHash = () => {
    const next = hashToken();
    if (next) latchedToken = next;
    cb();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === DRAFT_KEY || e.key === SAVED_KEY) cb();
  };
  window.addEventListener("hashchange", onHash);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("hashchange", onHash);
    window.removeEventListener("storage", onStorage);
  };
}

/** A primitive snapshot (React compares it with Object.is), parsed below in useMemo. */
function snapshot(): string {
  const token = hashToken() ?? latchedToken ?? "";
  return JSON.stringify([token, memoryVersion, readStorage("session", DRAFT_KEY), readStorage("local", SAVED_KEY)]);
}

const SERVER_SNAPSHOT = "";

function sanitize(raw: unknown): Answers | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const inner = obj.answers;
  const answers = typeof inner === "object" && inner !== null && !Array.isArray(inner) ? inner : obj;
  const s = reduce(initialState(), { type: "muat", answers: answers as Answers });
  return Object.keys(s.answers).length > 0 ? s.answers : null;
}

function fromStorageText(text: string): Answers | null {
  if (!text) return null;
  try {
    return sanitize(JSON.parse(text));
  } catch {
    return null;
  }
}

function parse(snap: string): AnswerSource {
  if (snap === SERVER_SNAPSHOT) return { status: "memuat" };
  let parts: unknown;
  try {
    parts = JSON.parse(snap);
  } catch {
    return { status: "kosong" };
  }
  if (!Array.isArray(parts)) return { status: "kosong" };
  const [token, version, session, local] = parts as [string, number, string, string];
  if (token) {
    const d = decode(token);
    if (!d) return { status: "rusak" };
    const answers = sanitize(d.answers);
    if (!answers) return { status: "rusak" };
    return d.amounts
      ? { status: "ada", from: "tautan", answers, amounts: d.amounts, key: `tautan:${token}`, token }
      : { status: "ada", from: "tautan", answers, key: `tautan:${token}`, token };
  }
  if (memory && version > 0) {
    const answers = sanitize(memory.answers);
    if (answers) {
      return memory.amounts
        ? { status: "ada", from: "memori", answers, amounts: memory.amounts, key: `memori:${version}` }
        : { status: "ada", from: "memori", answers, key: `memori:${version}` };
    }
  }
  const s = fromStorageText(session);
  if (s) return { status: "ada", from: "sesi", answers: s, key: `sesi:${session}` };
  const l = fromStorageText(local);
  if (l) return { status: "ada", from: "perangkat", answers: l, key: `perangkat:${local}` };
  return { status: "kosong" };
}

/** The answers the report should show, or why there are none. */
export function useAnswerSource(): AnswerSource {
  const snap = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  return useMemo(() => parse(snap), [snap]);
}

/**
 * For the questionnaire page: hand the answers (and any rupiah) to the report in memory before a
 * client-side navigation to /waris/laporan. Optional: the session autosave works without it.
 * A hand-off is always newer than a link seen earlier on this page (the questionnaire calls it on
 * mount, including when it loads a #j= link), so it releases the latched link token: otherwise a
 * report opened from a link, then "Ubah jawaban", an edit and "Lihat rekomendasi" (no fragment)
 * would show the link's old family again.
 */
export function handOffToReport(answers: Answers, amounts?: Amounts) {
  memory = amounts ? { answers, amounts } : { answers };
  memoryVersion += 1;
  latchedToken = null;
  emit();
}

/** Internals for the unit test (source.test.ts) only. */
export const __sourceInternals = { subscribe, snapshot, parse };

/**
 * "Hapus jawaban dari perangkat ini": the autosave, the saved copy, the memory hand-off and the
 * link fragment. The fragment is removed with history.replaceState, so no request is made.
 */
export function clearAnswers() {
  memory = null;
  memoryVersion += 1;
  latchedToken = null;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* blocked storage: nothing was stored */
  }
  try {
    window.localStorage.removeItem(SAVED_KEY);
  } catch {
    /* blocked storage: nothing was stored */
  }
  try {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* no history API: the hash stays, the memory copy is gone */
  }
  emit();
}

const noopSubscribe = () => () => {};

/** Today's date as "YYYY-MM-DD" (local time), read outside render. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** The report date (plan §6 row 0). null during the static render; today's date in the browser. */
export function useReportDate(): string | null {
  return useSyncExternalStore(noopSubscribe, todayIso, () => null);
}
