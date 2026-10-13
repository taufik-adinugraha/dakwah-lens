/**
 * The look-ahead's narration files (lookahead.ts) FETCHED INTO THE PAGE, one at a time, and
 * played from there (operator 2026-10-12; plan L18; review 2026-10-12).
 *
 * WHY THE PAGE HOLDS THE BYTES — the first version filled the browser's HTTP cache with fetch()
 * and hoped the audio element's own request would be answered from it. That is not measured on
 * iOS (WebKit's media loads; and production answers narration with `Vary: Accept-Encoding`, which
 * a media request's own Accept-Encoding does not match), and iOS does not preload a media element
 * that has not been played at all. So each file is read into a Blob and the page keeps
 * url → object URL (URL.createObjectURL; the CSP's media-src allows blob:, next.config.ts). The
 * narration player (src/lib/autoplay/voice.ts) plays the object URL when one is held for the
 * line's URL — the same bytes, on every browser, with no request at all — and the network URL
 * exactly as before when none is.
 *
 * WHAT IS FETCHED, AND WHEN
 * - `wanted`: the lesson's path from here, in play order (lookaheadAudio: the rest of this step,
 *   then the next steps; one step with Save-Data / 2G). The first of them not held yet is
 *   fetched: always the file the lesson needs soonest.
 * - ONE fetch in flight at most; the next starts only once the previous one has ended (its body
 *   read to the end, or it failed), never two in parallel.
 * - A new fetch starts only while `open` — the runner's gate (ahead.ts aheadUpdate): the lesson
 *   runs and neither the narrator's nor the imam's sound it asked for is loading or stalled
 *   (loading.ts: the players' `loading`), and the narration file just started has been heard — and
 *   only once the gate has stayed open PREFETCH_SETTLE_MS for the current activity (`key`), so a
 *   line that has just been asked for gets the connection to itself first. A fetch already under
 *   way is left to finish when the gate closes: cutting it would throw away what it has loaded,
 *   and on a slow link (where stalls repeat) the same file would be started over and over.
 * - Same-origin narration only: isNarrationUrl, and `mode: "same-origin"` (the CSP's connect-src
 *   is 'self' anyway). `cache: "force-cache"`: a copy the browser's HTTP cache already keeps is
 *   used as is, without the network (the files are content-hashed and served `immutable`, plan
 *   L15). A copy is kept only when it is whole: HTTP 200, not empty, as long as Content-Length
 *   says (where the header is there and the body is not encoded).
 *
 * WHAT IS KEPT, AND UNTIL WHEN
 * - A copy is kept while its file is still ON THE LESSON'S PATH (`path`: the look-ahead at its
 *   full distance, of which `wanted` is the start; a connection that turns to Save-Data / 2G
 *   stops new fetches past one step, and takes back nothing already fetched) and while it is
 *   PLAYING (`playing`: an object URL is never revoked under the element that plays it).
 * - It is REVOKED (URL.revokeObjectURL: the bytes are freed) as soon as it is neither: the file
 *   has been played and the lesson has moved on, or the learner jumped and it is no longer
 *   ahead. A step played again ("↺ Ulangi", "‹ Sebelumnya") fetches its files again — from the
 *   HTTP cache where the browser kept them.
 * - ALL are revoked on `stop()` (the page unmounts: the hand-off to the next ayah, or the learner
 *   leaving), and when the lesson finishes (nothing is on the path then).
 * - BOUND: what is held is at most the look-ahead's list — LOOKAHEAD_MAX_BYTES by the manifests'
 *   durations (lookahead.ts) — plus the one file playing. And a hard stop on the real sizes: no
 *   new fetch starts while the copies held already reach `maxBytes` (the same number), so at
 *   worst that plus one file is held.
 *
 * WHEN A FETCH IS CANCELLED (AbortController)
 * - Only when its file has LEFT THE PATH: the learner jumped elsewhere, the lesson finished, the
 *   page unmounts (`stop()`). Never because its file became the next line (review 2026-10-12: the
 *   first version cancelled it there, and the preload element then downloaded the same file again
 *   from its first byte): the next line is on the path like any other, and its fetch goes on.
 * - And when ITS OWN FILE STARTS PLAYING before the fetch has ended (a slow link, a jump): the
 *   player cannot wait for the whole file, so it streams the line from the network URL, as
 *   before the look-ahead. The fetch is then cancelled rather than left to finish (the choice
 *   asked for in the review): the stream plays from its first bytes while a copy is of use only
 *   once whole; two downloads of one file would share a link that is already too slow for one;
 *   and a copy that arrived mid-line would be revoked when the line ends anyway. (The file
 *   playing is not on the path, lookaheadAudio: this is the first rule again.)
 * - A cancelled fetch keeps nothing and is tried again once its file is wanted again. A file that
 *   FAILED (an HTTP error, the network, an incomplete body) is not tried again by this page: its
 *   line plays from the network URL, as before the look-ahead — never silence. The same for a
 *   copy the player could not play (`discard`).
 *
 * No React, no DOM: the runner (useAutoplay) feeds it and hands it the browser's fetch and URL
 * functions; unit-tested with stubs and fake timers (prefetch.test.ts), and over the real lessons
 * (src/components/autoplay/ahead.test.ts).
 */
import { LOOKAHEAD_MAX_BYTES } from "./lookahead";
import { isNarrationUrl } from "./narration";

/** A new fetch waits this long after the current activity began (or the gate opened). */
export const PREFETCH_SETTLE_MS = 500;

export type PrefetchFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PrefetchUpdate = {
  /** What to fetch, in order (lookaheadAudio with the connection's hints). */
  wanted: readonly string[];
  /** The lesson's path from here at its full distance (lookaheadAudio without hints): what is
   *  kept. Left out: `wanted`. */
  path?: readonly string[];
  /** The narration file playing now (its copy is kept while it plays). */
  playing?: string | null;
  /** A new fetch may start (the runner's gate, above). */
  open: boolean;
  /** The current activity (its token); when it changes, a new fetch waits PREFETCH_SETTLE_MS. */
  key: number | null;
};

export type Prefetcher = {
  update(u: PrefetchUpdate): void;
  /** The object URL of the copy held of narration file `url`, whole and ready to play; null when
   *  none is (not fetched, still coming, failed, revoked). */
  held(url: string): string | null;
  /** `url` is being fetched, or will be in its turn: nothing else should download it. */
  pending(url: string): boolean;
  /** The copy of `url` did not play (the player's report): revoked, and not fetched again by
   *  this page — the network URL from now on. */
  discard(url: string): void;
  /** Bytes held now (the copies' real sizes). */
  heldBytes(): number;
  /** Cancels the fetch in flight, revokes every copy, starts nothing after. */
  stop(): void;
};

/** The media type of a narration file by its name, for a copy the server did not label as audio
 *  (an object URL has no name to tell by). */
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

function asAudio(url: string, blob: Blob): Blob {
  if (blob.type.startsWith("audio/")) return blob;
  const type = AUDIO_TYPES[url.slice(url.lastIndexOf(".") + 1).toLowerCase()];
  return type ? new Blob([blob], { type }) : blob;
}

/** The body read is the whole file: not empty, and as long as Content-Length says (where the
 *  header is there and counts the bytes read, i.e. no Content-Encoding). */
function whole(res: Response, blob: Blob): boolean {
  if (blob.size === 0) return false;
  const length = res.headers.get("content-length");
  const encoding = res.headers.get("content-encoding");
  if (length === null || (encoding !== null && encoding !== "identity")) return true;
  return Number(length) === blob.size;
}

export function createPrefetcher(deps: {
  fetch: PrefetchFetch;
  /** URL.createObjectURL / URL.revokeObjectURL. */
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  settleMs?: number;
  /** No new fetch while the copies held reach this (LOOKAHEAD_MAX_BYTES). */
  maxBytes?: number;
  /** A fetch ended: its copy is held now, or it failed (never during update() or stop()). */
  onChange?: () => void;
}): Prefetcher {
  const settleMs = deps.settleMs ?? PREFETCH_SETTLE_MS;
  const maxBytes = deps.maxBytes ?? LOOKAHEAD_MAX_BYTES;
  let wanted: readonly string[] = [];
  let path: readonly string[] = [];
  let playing: string | null = null;
  let open = false;
  let key: number | null = null;
  /** The gate has stayed open settleMs for this key. */
  let settled = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let flight: { url: string; ctl: AbortController } | null = null;
  /** The copies held: narration URL → its object URL and size. */
  const copies = new Map<string, { src: string; bytes: number }>();
  /** Files this page does not fetch (again): the fetch failed, or the copy did not play. */
  const failed = new Set<string>();
  let stopped = false;

  const clearSettle = () => {
    if (settle !== null) clearTimeout(settle);
    settle = null;
  };
  const heldBytes = () => {
    let n = 0;
    for (const c of copies.values()) n += c.bytes;
    return n;
  };
  /** Still ahead of the lesson (`wanted` is the start of `path`; both, should a caller's differ). */
  const onPath = (url: string) => path.includes(url) || wanted.includes(url);

  /** Lets go of what has left the path: the fetch in flight (cancelled), the copies (revoked) —
   *  but never the copy of the file playing. */
  const sweep = () => {
    if (flight && !onPath(flight.url)) {
      flight.ctl.abort();
      flight = null;
    }
    for (const [url, copy] of copies) {
      if (url === playing || onPath(url)) continue;
      copies.delete(url);
      deps.revokeObjectURL(copy.src);
    }
  };

  const start = (url: string) => {
    const ctl = new AbortController();
    const mine = { url, ctl };
    flight = mine;
    void (async () => {
      let blob: Blob | null = null;
      try {
        const res = await deps.fetch(url, {
          cache: "force-cache",
          mode: "same-origin",
          credentials: "same-origin",
          priority: "low",
          signal: ctl.signal,
        });
        if (res.status === 200) {
          // The whole body, into the page's memory.
          const body = await res.blob();
          if (whole(res, body)) blob = asAudio(url, body);
        } else {
          await res.body?.cancel().catch(() => {});
        }
      } catch {
        blob = null;
      }
      if (flight === mine) flight = null;
      if (stopped) return;
      // Cancelled (its file left the path): nothing kept, tried again once wanted again.
      if (ctl.signal.aborted) return pump();
      let src: string | null = null;
      if (blob) {
        try {
          src = deps.createObjectURL(blob);
        } catch {
          src = null; // no object URL to be had: as a failed fetch
        }
      }
      if (blob && src !== null) copies.set(url, { src, bytes: blob.size });
      else failed.add(url); // not again on this page: its line plays from the network URL
      deps.onChange?.();
      pump();
    })();
  };

  const pump = () => {
    if (stopped || flight || !open || !settled) return;
    if (heldBytes() >= maxBytes) return;
    const url = wanted.find((u) => u !== playing && !copies.has(u) && !failed.has(u) && isNarrationUrl(u));
    if (url) start(url);
  };

  return {
    update(u) {
      if (stopped) return;
      const reopened = u.open && (!open || u.key !== key);
      wanted = u.wanted;
      path = u.path ?? u.wanted;
      playing = u.playing ?? null;
      open = u.open;
      key = u.key;
      sweep();
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
    held(url) {
      return copies.get(url)?.src ?? null;
    },
    pending(url) {
      if (stopped || copies.has(url) || failed.has(url) || !isNarrationUrl(url)) return false;
      return flight?.url === url || wanted.includes(url);
    },
    discard(url) {
      failed.add(url);
      const copy = copies.get(url);
      if (!copy) return;
      copies.delete(url);
      deps.revokeObjectURL(copy.src);
    },
    heldBytes,
    stop() {
      stopped = true;
      clearSettle();
      flight?.ctl.abort();
      flight = null;
      for (const copy of copies.values()) deps.revokeObjectURL(copy.src);
      copies.clear();
    },
  };
}
