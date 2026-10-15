/**
 * The recordings a page will play, fetched BEFORE they are asked for (operator 2026-10-15: "just
 * make sure no latency (preload before page is opened)"; "we copy to our server so latency is
 * minimum"). Since that day every recording a lesson or a Konsep page plays is a same-origin file
 * under /belajar/media/narration/: the imam's ayah (our copy of EveryAyah's file), Quran.com's word
 * files (our unaltered copies) and the narrator's word files. So they are fetched like the
 * narration look-ahead (prefetch.ts): read into a Blob, kept as an object URL, and played from
 * there by the players (src/hooks/useMediaPrefetch.ts mediaSrc) — the same bytes, no request at
 * the press, on every browser.
 *
 * WHAT (the plan, pure and tested over every ayah: media-prefetch.test.ts)
 * - A lesson ayah (lessonMediaPlan): its recitation, then every recording its sequence can play,
 *   in the order the lesson first plays them — each step's word (recite_word, the composition of
 *   the ayah's last word), each example beat's clip or word — then every other word of the ayah
 *   (Dengar dan klik, a word card's "Dengar", a word clicked on the mushaf line play any word).
 *   Each file once. mediaPlanProblems is the independent check: a recording the sequence plays
 *   that the plan leaves out is named (a missing file is a wait at the press).
 * - The NEXT ayah's plan, from the moment the lesson has played two thirds of its steps (or has
 *   finished): the hand-off to it then has nothing to fetch (nextAyahDue).
 * - A Konsep / Harakat / Kosakata page (pageMediaPlan): its example buttons' files in the order the
 *   page shows them, at most PAGE_PREFETCH_MAX_FILES.
 * - Nothing when the browser asks to save data (Data Saver, a 2G-class connection: loading.ts
 *   savesData) — a recording then loads when it is played, as before.
 *
 * WHEN (the store's gate, `setOpen`): on a page that only looks (before "Mulai"), at the first
 * idle moment after load; once the lesson runs, only while the lesson's own sound flows (no sound
 * it asked for is loading, and the narration line just started has been heard: ahead.ts
 * aheadUpdate `open`), so a fetch never competes with what is about to play. A fetch already
 * under way is left to finish.
 *
 * HOW MUCH: at most PREFETCH_CONCURRENCY fetches at a time; a copy is kept while its file is on
 * a plan the page holds (this ayah's, the next ayah's, the page's), and revoked when it leaves
 * every plan; no new fetch while the copies held reach MEDIA_PREFETCH_MAX_BYTES. A file already
 * held, or being fetched, is not fetched again (dedupe by URL); a file that failed is not tried
 * again by this page (it plays from its URL, as before). No cache-busting query string is ever
 * added: the files are served `immutable`, and the browser's HTTP cache answers a second visit.
 *
 * No React, no DOM: the hook (src/hooks/useMediaPrefetch.ts) hands it fetch and the object-URL
 * functions; unit-tested with stubs (media-prefetch.test.ts).
 */
import { savesData, type ConnectionHints } from "./autoplay/loading";
import { isNarrationUrl } from "./autoplay/narration";
import type { AutoplaySequence } from "./autoplay/types";

/** Fetches in flight at once, at most. */
export const PREFETCH_CONCURRENCY = 3;
/** At most this many example files fetched ahead on a Konsep / Harakat / Kosakata page. */
export const PAGE_PREFETCH_MAX_FILES = 12;
/** No new fetch while the copies held reach this many bytes (two ayat's plans: measured
 *  2026-10-15, the largest ayah's plan is about 1.2 MB). */
export const MEDIA_PREFETCH_MAX_BYTES = 6_000_000;
/** The share of the lesson's steps after which the next ayah is fetched ahead. */
export const NEXT_AYAH_AT = 2 / 3;

/** A recording the page may fetch ahead: same-origin, under the narration media prefix. */
export const isPrefetchable = (url: string | null | undefined): url is string => typeof url === "string" && isNarrationUrl(url);

const push = (out: string[], url: string | null | undefined) => {
  if (isPrefetchable(url) && !out.includes(url)) out.push(url);
};

/**
 * Every recording the lesson of `seq` can play, its recitation (`recitationUrl`) first, in the
 * order the lesson first plays them, each once (the rules: the head of this file).
 */
export function lessonMediaPlan(seq: AutoplaySequence, recitationUrl: string | null): string[] {
  const out: string[] = [];
  push(out, recitationUrl);
  for (const st of seq.steps) {
    if (st.recite?.target === "word") push(out, seq.wordVoices[st.recite.word - 1]?.url);
    for (const b of st.examples ?? []) push(out, b.clip ? b.clip.url : b.word !== null ? seq.wordVoices[b.word - 1]?.url : null);
  }
  for (const v of seq.wordVoices) push(out, v?.url);
  return out;
}

/**
 * The recordings the lesson of `seq` plays that `plan` leaves out (empty when none): walked
 * independently of lessonMediaPlan, from what each activity of the machine plays — the ayah's
 * recitation, every word recording (every word can be played: its step, the exercise, the word
 * card, the mushaf line), every example beat's clip.
 */
export function mediaPlanProblems(seq: AutoplaySequence, recitationUrl: string | null, plan: readonly string[]): string[] {
  const want = new Map<string, string>();
  const note = (url: string | null | undefined, why: string) => {
    if (isPrefetchable(url) && !want.has(url)) want.set(url, why);
  };
  note(recitationUrl, "the recitation of the ayah");
  seq.wordVoices.forEach((v, i) => note(v?.url, `word ${i + 1}`));
  for (const st of seq.steps) for (const b of st.examples ?? []) note(b.clip?.url, `${st.id}: example ${b.id}`);
  const out: string[] = [];
  for (const [url, why] of want) if (!plan.includes(url)) out.push(`${seq.lessonKey}: ${why} (${url}) is not fetched ahead`);
  const dup = plan.filter((u, i) => plan.indexOf(u) !== i);
  if (dup.length) out.push(`${seq.lessonKey}: listed twice: ${[...new Set(dup)].join(", ")}`);
  for (const u of plan) if (!isPrefetchable(u)) out.push(`${seq.lessonKey}: ${u} is not a same-origin recording`);
  return out;
}

/** The example files of a static page, in the order it shows them, at most `max`. */
export function pageMediaPlan(urls: readonly (string | null | undefined)[], max = PAGE_PREFETCH_MAX_FILES): string[] {
  const out: string[] = [];
  for (const u of urls) {
    if (out.length >= max) break;
    push(out, u);
  }
  return out;
}

/** What may be fetched ahead with the browser's connection hints: nothing when it asks to save data. */
export function planFor(plan: readonly string[], conn?: ConnectionHints | null): string[] {
  return savesData(conn) ? [] : [...plan];
}

/** The lesson has come far enough (or finished) to fetch the next ayah's recordings. */
export function nextAyahDue(s: { started: boolean; phase: string; idx: number }, steps: number): boolean {
  if (!s.started) return false;
  if (s.phase === "finished") return true;
  return steps > 0 && s.idx + 1 >= Math.ceil(steps * NEXT_AYAH_AT);
}

// ───────────────────────── the store

export type MediaFetch = (url: string, init: RequestInit) => Promise<Response>;

export type MediaStore = {
  /** The plans the page holds now, by name ("ayah", "next", "page"): fetched in order, the first
   *  plan first; a copy is kept while it is on any of them. */
  want(name: string, urls: readonly string[]): void;
  /** A new fetch may start (the gate above). */
  setOpen(open: boolean): void;
  /** The object URL of the copy held of `url`, or null. */
  held(url: string): string | null;
  /** `url` is held, being fetched, or queued. */
  pending(url: string): boolean;
  /** The copy of `url` did not play: revoked, and not fetched again by this page. */
  discard(url: string): void;
  heldBytes(): number;
  /** Fetches in flight now. */
  inFlight(): number;
  stop(): void;
};

function whole(res: Response, blob: Blob): boolean {
  if (blob.size === 0) return false;
  const length = res.headers.get("content-length");
  const encoding = res.headers.get("content-encoding");
  if (length === null || (encoding !== null && encoding !== "identity")) return true;
  return Number(length) === blob.size;
}

export function createMediaStore(deps: {
  fetch: MediaFetch;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  concurrency?: number;
  maxBytes?: number;
  onChange?: () => void;
}): MediaStore {
  const concurrency = Math.max(1, Math.min(PREFETCH_CONCURRENCY, deps.concurrency ?? PREFETCH_CONCURRENCY));
  const maxBytes = deps.maxBytes ?? MEDIA_PREFETCH_MAX_BYTES;
  const plans = new Map<string, readonly string[]>();
  const copies = new Map<string, { src: string; bytes: number }>();
  const flights = new Map<string, AbortController>();
  const failed = new Set<string>();
  let open = false;
  let stopped = false;

  const order = () => {
    const out: string[] = [];
    for (const urls of plans.values()) for (const u of urls) if (!out.includes(u)) out.push(u);
    return out;
  };
  const heldBytes = () => [...copies.values()].reduce((n, c) => n + c.bytes, 0);

  const sweep = () => {
    const keep = new Set(order());
    for (const [url, ctl] of flights) {
      if (keep.has(url)) continue;
      ctl.abort();
      flights.delete(url);
    }
    for (const [url, c] of copies) {
      if (keep.has(url)) continue;
      copies.delete(url);
      deps.revokeObjectURL(c.src);
    }
  };

  const start = (url: string) => {
    const ctl = new AbortController();
    flights.set(url, ctl);
    void (async () => {
      let blob: Blob | null = null;
      try {
        const res = await deps.fetch(url, { cache: "force-cache", mode: "same-origin", credentials: "same-origin", priority: "low", signal: ctl.signal });
        if (res.status === 200) {
          const body = await res.blob();
          if (whole(res, body)) blob = body.type.startsWith("audio/") ? body : new Blob([body], { type: "audio/mpeg" });
        } else {
          await res.body?.cancel().catch(() => {});
        }
      } catch {
        blob = null;
      }
      if (flights.get(url) === ctl) flights.delete(url);
      if (stopped || ctl.signal.aborted) return pump();
      let src: string | null = null;
      if (blob) {
        try {
          src = deps.createObjectURL(blob);
        } catch {
          src = null;
        }
      }
      if (blob && src !== null) copies.set(url, { src, bytes: blob.size });
      else failed.add(url);
      deps.onChange?.();
      pump();
    })();
  };

  const pump = () => {
    if (stopped || !open) return;
    for (const url of order()) {
      if (flights.size >= concurrency || heldBytes() >= maxBytes) return;
      if (copies.has(url) || flights.has(url) || failed.has(url) || !isPrefetchable(url)) continue;
      start(url);
    }
  };

  return {
    want(name, urls) {
      if (stopped) return;
      plans.set(name, [...urls]);
      sweep();
      pump();
    },
    setOpen(o) {
      open = o;
      pump();
    },
    held: (url) => copies.get(url)?.src ?? null,
    pending: (url) => copies.has(url) || flights.has(url) || (!failed.has(url) && order().includes(url)),
    discard(url) {
      failed.add(url);
      const c = copies.get(url);
      if (!c) return;
      copies.delete(url);
      deps.revokeObjectURL(c.src);
    },
    heldBytes,
    inFlight: () => flights.size,
    stop() {
      stopped = true;
      for (const ctl of flights.values()) ctl.abort();
      flights.clear();
      for (const c of copies.values()) deps.revokeObjectURL(c.src);
      copies.clear();
      plans.clear();
    },
  };
}
