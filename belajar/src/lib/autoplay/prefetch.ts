/**
 * Fetching the look-ahead's narration files (lookahead.ts) into the browser's HTTP cache: ONE AT
 * A TIME, out of the way of the sound the lesson plays (operator 2026-10-12; plan L18).
 *
 * - One fetch in flight at most; the next starts only once the previous one has ended (its body
 *   read to the end, or it failed), never two in parallel.
 * - A new fetch starts only while `open` — the runner's gate: the lesson runs (wake.ts) and
 *   neither the narrator's nor the imam's sound it asked for is loading or stalled (loading.ts:
 *   the players' `loading`), and the narration file just started has been heard — and only once
 *   the gate has stayed open PREFETCH_SETTLE_MS for the current activity (`key`), so a line that
 *   has just been asked for gets the connection to itself first. A fetch already under way is
 *   left to finish when the gate closes: cutting it would throw away what it has loaded, and on a
 *   slow link (where stalls repeat) the same file would be started over and over.
 * - A fetch is aborted (AbortController) when its file is no longer wanted — the lesson moved so
 *   far that the file is no longer ahead (it is playing now, or the learner jumped elsewhere), or
 *   the lesson finished (the hand-off: nothing is wanted) — and on `stop()` (unmount).
 * - Each file once per page (`done`, a module-level Set by default: kept across the client-side
 *   hand-off to the next ayah, so a shared line is not fetched again there). A file that failed
 *   (an HTTP error, the network) is not tried again on this page; an aborted one is, once it is
 *   wanted again.
 * - Same-origin narration only: isNarrationUrl, and `mode: "same-origin"` (the CSP's connect-src
 *   is 'self' anyway). `cache: "force-cache"`: a copy the browser already keeps is used as is (the
 *   files are content-hashed and served `immutable`, plan L15).
 *
 * WHAT IS NOT GUARANTEED: that the audio element's own requests (byte ranges, "bytes=0-") are
 * answered from the copy fetch() left in the HTTP cache. Chromium serves a range from a complete
 * cached 200 response. WebKit (iOS Safari) loads media through its network process too, but
 * whether it reuses that copy is unmeasured on iOS. And production answers narration with `Vary:
 * Accept-Encoding` (Caddy's site-wide `encode`, measured 2026-10-12, though the MP3s are never
 * compressed), while a media request sends its own Accept-Encoding ("identity"): a cache that
 * honours Vary may then revalidate the copy (Chromium: a conditional request, a 304, the body from
 * the cache) or skip it. Dropping that Vary for /belajar/media/* is a Caddy change, not made here.
 * Where the copy is not reused, the cost is the file fetched twice; the step still plays.
 *
 * No React here: the runner (useAutoplay) feeds it; unit-tested with a stubbed fetch and fake
 * timers (prefetch.test.ts).
 */
import { isNarrationUrl } from "./narration";

/** A new fetch waits this long after the current activity began (or the gate opened). */
export const PREFETCH_SETTLE_MS = 500;

/** Narration files fetched ahead on this page (until a reload). */
export const prefetched: Set<string> = new Set();

export type PrefetchFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PrefetchUpdate = {
  /** What to fetch, in order (lookaheadAudio, without what the players load themselves). */
  wanted: readonly string[];
  /** A new fetch may start (the runner's gate, above). */
  open: boolean;
  /** The current activity (its token); when it changes, a new fetch waits PREFETCH_SETTLE_MS. */
  key: number | null;
};

export type Prefetcher = {
  update(u: PrefetchUpdate): void;
  /** Aborts the fetch in flight and starts no other. */
  stop(): void;
};

export function createPrefetcher(deps: {
  fetch: PrefetchFetch;
  done?: Set<string>;
  settleMs?: number;
}): Prefetcher {
  const done = deps.done ?? prefetched;
  const settleMs = deps.settleMs ?? PREFETCH_SETTLE_MS;
  let wanted: readonly string[] = [];
  let open = false;
  let key: number | null = null;
  /** The gate has stayed open settleMs for this key. */
  let settled = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let flight: { url: string; ctl: AbortController } | null = null;
  let stopped = false;

  const clearSettle = () => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
  };

  const start = (url: string) => {
    const ctl = new AbortController();
    const mine = { url, ctl };
    flight = mine;
    void (async () => {
      let ended = false;
      try {
        const res = await deps.fetch(url, {
          cache: "force-cache",
          mode: "same-origin",
          credentials: "same-origin",
          priority: "low",
          signal: ctl.signal,
        });
        if (res.ok && res.body) {
          // Read to the end: a body left unread may not be stored whole.
          const reader = res.body.getReader();
          for (;;) if ((await reader.read()).done) break;
        } else if (res.ok) {
          await res.arrayBuffer();
        } else {
          await res.body?.cancel().catch(() => {});
        }
        ended = true;
      } catch {
        // Aborted: tried again once wanted again. Failed: not again on this page.
        ended = !ctl.signal.aborted;
      }
      if (ended) done.add(url);
      if (flight === mine) flight = null;
      pump();
    })();
  };

  const pump = () => {
    if (stopped) return;
    if (flight && !wanted.includes(flight.url)) {
      flight.ctl.abort();
      flight = null;
    }
    if (flight || !open || !settled) return;
    const url = wanted.find((u) => !done.has(u) && isNarrationUrl(u));
    if (url) start(url);
  };

  return {
    update(u) {
      if (stopped) return;
      const reopened = u.open && (!open || u.key !== key);
      wanted = u.wanted;
      open = u.open;
      key = u.key;
      if (!open || reopened) {
        settled = false;
        clearSettle();
      }
      if (open && !settled && settle === null) {
        settle = setTimeout(() => {
          settle = null;
          settled = true;
          pump();
        }, settleMs);
      }
      pump();
    },
    stop() {
      stopped = true;
      clearSettle();
      flight?.ctl.abort();
      flight = null;
    },
  };
}
