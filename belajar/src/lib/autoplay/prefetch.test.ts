import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrefetcher, PREFETCH_SETTLE_MS, type PrefetchFetch } from "./prefetch";

// The narration fetched ahead INTO THE PAGE, one file at a time (operator 2026-10-12, plan L18;
// review 2026-10-12): the prefetcher the lesson runner feeds, driven here with a stubbed fetch
// whose bodies arrive when the test says, stubbed URL.createObjectURL / revokeObjectURL, and fake
// timers.

const A = "/belajar/media/narration/kang-nandar/al-fatihah/aaaaaaaaaaaaaaaa.mp3";
const B = "/belajar/media/narration/kang-nandar/al-fatihah/bbbbbbbbbbbbbbbb.mp3";
const C = "/belajar/media/narration/kang-nandar/shared/cccccccccccccccc.mp3";
const D = "/belajar/media/narration/kang-nandar/al-fatihah/dddddddddddddddd.mp3";

/** Bytes of one stubbed file: two chunks. */
const CHUNK = 4096;
const SIZE = 2 * CHUNK;

type Call = {
  url: string;
  init: RequestInit;
  /** The response arrives; its body is two chunks, the second when `end()` is called. */
  respond: (opts?: { status?: number; type?: string; length?: number; encoding?: string }) => void;
  /** The body ends (the last chunk, then done); `empty`: with no bytes at all. */
  end: () => void;
  fail: () => void;
  aborted: boolean;
  /** The prefetcher has read the body to its end. */
  read: boolean;
};

/** A fetch whose answers the test drives; `live()`: the calls not ended, failed or aborted.
 *  `deaf(true)`: a cancelled fetch's body arrives all the same (the cancel came as it ended). */
function stubFetch() {
  const calls: Call[] = [];
  const failed = new Set<Call>();
  let maxLive = 0;
  let deaf = false;
  const live = () => calls.filter((c) => !c.read && !c.aborted && !failed.has(c));
  const fetch: PrefetchFetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
      const call: Call = {
        url,
        init,
        aborted: false,
        read: false,
        respond: ({ status = 200, type = "audio/mpeg", length, encoding } = {}) => {
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              stream = c;
              c.enqueue(new Uint8Array(CHUNK));
            },
            pull() {},
          });
          // Read to its end: the done read after the last chunk.
          const tracked = body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              flush() {
                call.read = true;
              },
            }),
          );
          const headers = new Headers({ "content-type": type });
          if (length !== undefined) headers.set("content-length", String(length));
          if (encoding !== undefined) headers.set("content-encoding", encoding);
          resolve(new Response(tracked, { status, headers }));
        },
        end: () => {
          stream?.enqueue(new Uint8Array(CHUNK));
          stream?.close();
        },
        fail: () => {
          failed.add(call);
          reject(new TypeError("network"));
        },
      };
      init.signal?.addEventListener("abort", () => {
        call.aborted = true;
        if (deaf) return;
        const e = new DOMException("aborted", "AbortError");
        reject(e);
        try {
          stream?.error(e);
        } catch {
          /* already closed */
        }
      });
      calls.push(call);
      maxLive = Math.max(maxLive, live().length);
    });
  return {
    fetch,
    calls,
    live,
    maxLive: () => maxLive,
    deaf: (v: boolean) => {
      deaf = v;
    },
  };
}

/** URL.createObjectURL / revokeObjectURL, recorded: what is alive, what each object URL holds. */
function stubUrls() {
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  let n = 0;
  return {
    createObjectURL: (blob: Blob) => {
      const u = `blob:https://dakwah-lens.id/${++n}`;
      blobs.set(u, blob);
      return u;
    },
    revokeObjectURL: (u: string) => {
      if (!blobs.has(u)) throw new Error(`revoked ${u}, which is not alive`);
      blobs.delete(u);
      revoked.push(u);
    },
    /** Object URLs made and not revoked. */
    alive: () => [...blobs.keys()],
    blob: (u: string | null) => (u === null ? undefined : blobs.get(u)),
    made: () => n,
    revoked,
  };
}

function setup(opts: { maxBytes?: number } = {}) {
  const f = stubFetch();
  const urls = stubUrls();
  const changes: number[] = [];
  const p = createPrefetcher({
    fetch: f.fetch,
    createObjectURL: urls.createObjectURL,
    revokeObjectURL: urls.revokeObjectURL,
    onChange: () => changes.push(f.calls.length),
    ...opts,
  });
  /** The call for `url` answered whole. */
  const serve = async (url: string) => {
    const c = [...f.calls].reverse().find((x) => x.url === url);
    if (!c) throw new Error(`no fetch of ${url}`);
    c.respond();
    c.end();
    await flush();
  };
  return { f, urls, p, changes, serve };
}

const settle = () => vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("the narration prefetcher (prefetch.ts)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts nothing while closed; once open, waits PREFETCH_SETTLE_MS, then fetches the first file — same-origin, a cached copy used as is", async () => {
    const { f, p } = setup();
    p.update({ wanted: [A, B], open: false, key: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.calls).toHaveLength(0);
    p.update({ wanted: [A, B], open: true, key: 1 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 1);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.map((c) => c.url)).toEqual([A]);
    const init = f.calls[0].init;
    expect(init.cache).toBe("force-cache");
    expect(init.mode).toBe("same-origin");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    p.stop();
  });

  it("the page holds the bytes: a file read to its end becomes an object URL of the whole file, and only then", async () => {
    const { f, urls, p, changes } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    expect([p.held(A), p.pending(A), p.pending(B)]).toEqual([null, true, true]);
    f.calls[0].respond();
    await flush();
    // Headers and a first chunk: not a copy yet (a line that starts now plays from the network).
    expect(p.held(A)).toBeNull();
    expect(urls.made()).toBe(0);
    expect(changes).toEqual([]);
    f.calls[0].end();
    await flush();
    const src = p.held(A);
    expect(src).toMatch(/^blob:/);
    expect(urls.blob(src)?.size).toBe(SIZE);
    expect(urls.blob(src)?.type).toBe("audio/mpeg");
    expect(p.heldBytes()).toBe(SIZE);
    expect([p.pending(A), p.pending(B)]).toEqual([false, true]);
    // The runner is told once the copy is there (it then looks at the next-line preload again).
    expect(changes).toHaveLength(1);
    p.stop();
  });

  it("one at a time, in order: the next starts only once the previous body was read to its end", async () => {
    const { f, p, serve } = setup();
    p.update({ wanted: [A, B, C], open: true, key: 1 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A]);
    // The lesson moves on to its next lines while A is still coming: still only A.
    for (const key of [2, 3]) {
      p.update({ wanted: [A, B, C], open: true, key });
      await settle();
    }
    expect(f.calls.map((c) => c.url)).toEqual([A]);
    f.calls[0].respond();
    await flush();
    // Headers and a first chunk: not ended yet, so B waits.
    p.update({ wanted: [A, B, C], open: true, key: 4 });
    await settle();
    expect(f.calls).toHaveLength(1);
    f.calls[0].end();
    await flush();
    expect(f.calls[0].read).toBe(true);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    await serve(B);
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    await serve(C);
    expect([A, B, C].map((u) => p.held(u) !== null)).toEqual([true, true, true]);
    expect(f.maxLive()).toBe(1);
    p.stop();
  });

  it("the gate closing (a line loading or stalled, a pause) lets the file under way finish and starts no other until it reopens and settles", async () => {
    const { f, p, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    expect(f.calls).toHaveLength(1);
    p.update({ wanted: [A, B], open: false, key: 1 });
    await serve(A);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls[0].aborted).toBe(false);
    expect(p.held(A)).not.toBeNull();
    expect(f.calls).toHaveLength(1);
    p.update({ wanted: [A, B], open: true, key: 1 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 1);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    p.stop();
  });

  it("a new activity starts the settle over: a line just asked for has the connection first", async () => {
    const { f, p } = setup();
    p.update({ wanted: [A], open: true, key: 1 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 100);
    p.update({ wanted: [A], open: true, key: 2 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 1);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(1);
    p.stop();
  });

  it("a fetch whose file becomes the NEXT LINE is not cancelled (review 2026-10-12): it is still on the path, and its copy is what the line plays", async () => {
    const { f, urls, p, serve } = setup();
    // On line 1: A (line 3) is being fetched; B and C come after it.
    p.update({ wanted: [D, A, B, C], open: true, key: 1 });
    await settle();
    await serve(D);
    expect(f.calls.map((c) => c.url)).toEqual([D, A]);
    f.calls[1].respond();
    await flush();
    // Line 2 (D) starts: A is now the next line of this step.
    p.update({ wanted: [A, B, C], playing: D, open: false, key: 2 });
    await flush();
    p.update({ wanted: [A, B, C], playing: D, open: true, key: 2 });
    await settle();
    expect(f.calls[1].aborted).toBe(false);
    expect(f.calls).toHaveLength(2);
    f.calls[1].end();
    await flush();
    expect(p.held(A)).toMatch(/^blob:/);
    // A plays: from its copy; the copy stays while it plays, and A was fetched once.
    const src = p.held(A);
    p.update({ wanted: [B, C], playing: A, open: true, key: 3 });
    await settle();
    expect(p.held(A)).toBe(src);
    expect(urls.alive()).toContain(src);
    expect(f.calls.filter((c) => c.url === A)).toHaveLength(1);
    p.stop();
  });

  it("a fetch is cancelled only when its file has left the path — a jump, the lesson finished — and is made again once the file is wanted again", async () => {
    const { f, urls, p } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond();
    await flush();
    // The learner jumped to another step: A is no longer ahead.
    p.update({ wanted: [C], open: true, key: 2 });
    await flush();
    expect(f.calls[0].aborted).toBe(true);
    expect([p.held(A), p.pending(A)]).toEqual([null, false]);
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, C]);
    // The lesson finished (the hand-off to the next ayah): nothing on the path, C cancelled.
    p.update({ wanted: [], open: false, key: null });
    await flush();
    expect(f.calls[1].aborted).toBe(true);
    // Wanted again later: fetched again (a cancelled file is not a failed one).
    p.update({ wanted: [A], open: true, key: 3 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, C, A]);
    // Nothing of a cancelled fetch is kept.
    expect(urls.made()).toBe(0);
    p.stop();
  });

  it("a line that starts before its own fetch has ended streams from the network: that fetch is cancelled (two downloads of one file never share the link), the others go on", async () => {
    const { f, p, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond();
    await flush();
    // A must play now: no copy yet, so the player takes the network URL …
    expect(p.held(A)).toBeNull();
    p.update({ wanted: [B], playing: A, open: false, key: 2 });
    await flush();
    // … and the fetch of A is cancelled.
    expect(f.calls[0].aborted).toBe(true);
    // Once A is heard, the look-ahead goes on with B; A is not fetched a second time.
    p.update({ wanted: [B], playing: A, open: true, key: 2 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    await serve(B);
    expect(p.held(B)).not.toBeNull();
    expect(f.calls).toHaveLength(2);
    p.stop();
  });

  it("a copy is kept while its file is ahead or playing, and revoked once it has been played and the lesson has moved on", async () => {
    const { urls, p, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    await serve(A);
    await serve(B);
    const [a, b] = [p.held(A), p.held(B)];
    expect(urls.alive()).toEqual([a, b]);
    // A plays (it is no longer ahead): kept — never revoked under the element playing it.
    p.update({ wanted: [B], playing: A, open: true, key: 2 });
    expect(p.held(A)).toBe(a);
    expect(urls.revoked).toEqual([]);
    // A paused mid-line: it plays again from its start, so it is ahead again. Kept.
    p.update({ wanted: [A, B], playing: null, open: false, key: null });
    expect(p.held(A)).toBe(a);
    p.update({ wanted: [B], playing: A, open: true, key: 3 });
    // A has ended (the pause after it): played, not ahead. Revoked; B stays.
    p.update({ wanted: [B], playing: null, open: true, key: 4 });
    expect(urls.revoked).toEqual([a]);
    expect([p.held(A), p.held(B)]).toEqual([null, b]);
    expect(p.heldBytes()).toBe(SIZE);
    // B plays, then the lesson moves on: nothing held.
    p.update({ wanted: [], playing: B, open: true, key: 5 });
    expect(urls.alive()).toEqual([b]);
    p.update({ wanted: [], playing: null, open: true, key: 6 });
    expect(urls.alive()).toEqual([]);
    expect(p.heldBytes()).toBe(0);
    p.stop();
  });

  it("a copy whose file left the path (a jump) is revoked; played again later, the file is fetched again", async () => {
    const { f, urls, p, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    await serve(A);
    await serve(B);
    p.update({ wanted: [C], open: true, key: 2 });
    expect(urls.alive()).toEqual([]);
    expect(urls.revoked).toHaveLength(2);
    await settle();
    await serve(C);
    // "‹ Sebelumnya": A and B are ahead again.
    p.update({ wanted: [A, B], open: true, key: 3 });
    await settle();
    await serve(A);
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C, A, B]);
    expect(p.held(A)).not.toBeNull();
    p.stop();
  });

  it("Save-Data / 2G coming on stops NEW fetches past one step and takes back nothing: what is on the full path is kept, a fetch under way finishes", async () => {
    const { f, urls, p, serve } = setup();
    p.update({ wanted: [A, B, C], path: [A, B, C], open: true, key: 1 });
    await settle();
    await serve(A);
    f.calls[1].respond();
    await flush();
    // The connection turns slow: only A (this step) is wanted now; B and C stay on the path.
    p.update({ wanted: [A], path: [A, B, C], open: true, key: 1 });
    await flush();
    expect(f.calls[1].aborted).toBe(false);
    f.calls[1].end();
    await flush();
    expect([p.held(A), p.held(B)].every((u) => u !== null)).toBe(true);
    expect(urls.revoked).toEqual([]);
    // …and C, past the one step, is not started.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    expect(p.pending(C)).toBe(false);
    p.stop();
  });

  it("stop() (unmount, the hand-off) cancels the file under way, revokes every copy and starts nothing after", async () => {
    const { f, urls, p, serve } = setup();
    p.update({ wanted: [A, B, C], open: true, key: 1 });
    await settle();
    await serve(A);
    f.calls[1].respond();
    await flush();
    const a = p.held(A);
    p.stop();
    await flush();
    expect(f.calls[1].aborted).toBe(true);
    expect(urls.revoked).toEqual([a]);
    expect(urls.alive()).toEqual([]);
    expect([p.held(A), p.pending(B), p.heldBytes()]).toEqual([null, false, 0]);
    p.update({ wanted: [A, B, C], open: true, key: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls).toHaveLength(2);
    expect(urls.made()).toBe(1);
  });

  it("a body that arrives whole although its fetch was cancelled makes no object URL: nothing leaks, and the next fetch is not doubled", async () => {
    const { f, urls, p } = setup();
    f.deaf(true);
    p.update({ wanted: [A], open: true, key: 1 });
    await settle();
    f.calls[0].respond();
    await flush();
    // The learner jumped: A left the path as its last bytes came in.
    p.update({ wanted: [B], open: true, key: 2 });
    f.calls[0].end();
    await flush();
    expect(f.calls[0].aborted && f.calls[0].read).toBe(true);
    expect(urls.made()).toBe(0);
    expect(p.held(A)).toBeNull();
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    p.stop();
    expect(urls.alive()).toEqual([]);
  });

  it("a file that failed (the network, an HTTP error, an empty or cut-short body) keeps no copy and is not tried again on this page; the next one goes on", async () => {
    const { f, urls, p, changes } = setup();
    p.update({ wanted: [A, B, C, D], open: true, key: 1 });
    await settle();
    f.calls[0].fail();
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    f.calls[1].respond({ status: 404 });
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    // Content-Length says more than arrived: not the whole file.
    f.calls[2].respond({ length: SIZE + 100 });
    f.calls[2].end();
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C, D]);
    // A 206 (a part of the file) is not a copy either.
    f.calls[3].respond({ status: 206 });
    await flush();
    p.update({ wanted: [A, B, C, D], open: true, key: 2 });
    await settle();
    expect(f.calls).toHaveLength(4);
    // No copy, and not pending: the player takes the network URL, the preload element may warm it.
    for (const u of [A, B, C, D]) expect([u, p.held(u), p.pending(u)]).toEqual([u, null, false]);
    expect(urls.made()).toBe(0);
    expect(changes).toHaveLength(4);
    p.stop();
  });

  it("no object URL to be had (createObjectURL throws): as a failed fetch — no copy, the next file goes on", async () => {
    const f = stubFetch();
    let n = 0;
    const p = createPrefetcher({
      fetch: f.fetch,
      createObjectURL: () => {
        if (++n === 1) throw new Error("no memory");
        return `blob:test/${n}`;
      },
      revokeObjectURL: () => {},
    });
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond();
    f.calls[0].end();
    await flush();
    expect([p.held(A), p.pending(A)]).toEqual([null, false]);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    f.calls[1].respond();
    f.calls[1].end();
    await flush();
    expect(p.held(B)).toBe("blob:test/2");
    p.stop();
  });

  it("a body as long as Content-Length says is kept; an encoded body is not measured against it", async () => {
    const { f, p } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond({ length: SIZE });
    f.calls[0].end();
    await flush();
    expect(p.held(A)).not.toBeNull();
    f.calls[1].respond({ length: 1234, encoding: "gzip" });
    f.calls[1].end();
    await flush();
    expect(p.held(B)).not.toBeNull();
    p.stop();
  });

  it("a copy the server did not label as audio is typed by the file's name (an object URL has no name to tell by)", async () => {
    const { f, urls, p } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond({ type: "application/octet-stream" });
    f.calls[0].end();
    await flush();
    expect(urls.blob(p.held(A))?.type).toBe("audio/mpeg");
    expect(urls.blob(p.held(A))?.size).toBe(SIZE);
    // The CI's silent stand-in is a WAV behind an .mp3 name: the server's audio type is kept.
    f.calls[1].respond({ type: "audio/wav" });
    f.calls[1].end();
    await flush();
    expect(urls.blob(p.held(B))?.type).toBe("audio/wav");
    p.stop();
  });

  it("discard(): a copy the player could not play is revoked and not fetched again — the network URL from then on", async () => {
    const { f, urls, p, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    await serve(A);
    const a = p.held(A);
    p.update({ wanted: [B], playing: A, open: true, key: 2 });
    p.discard(A);
    expect(urls.revoked).toEqual([a]);
    expect([p.held(A), p.pending(A)]).toEqual([null, false]);
    await settle();
    await serve(B);
    // The step replayed: A is ahead again, and is left to the network.
    p.update({ wanted: [A, B], open: true, key: 3 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    p.stop();
  });

  it("bounded: no new fetch while the copies held reach maxBytes; it goes on once one has been played", async () => {
    const { f, p, serve } = setup({ maxBytes: 2 * SIZE });
    p.update({ wanted: [A, B, C], open: true, key: 1 });
    await settle();
    await serve(A);
    await serve(B);
    expect(p.heldBytes()).toBe(2 * SIZE);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    // A plays (kept), then is through (revoked): room for C.
    p.update({ wanted: [B, C], playing: A, open: true, key: 2 });
    await settle();
    expect(f.calls).toHaveLength(2);
    p.update({ wanted: [B, C], playing: null, open: true, key: 3 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    await serve(C);
    expect(p.heldBytes()).toBe(2 * SIZE);
    p.stop();
  });

  it("the runner is told when a fetch ends (a copy, or a failure) — never from inside update() or stop()", async () => {
    const { f, p, changes, serve } = setup();
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    expect(changes).toEqual([]);
    await serve(A);
    expect(changes).toHaveLength(1);
    f.calls[1].fail();
    await flush();
    expect(changes).toHaveLength(2);
    p.update({ wanted: [], open: true, key: 2 }); // revokes A's copy
    p.stop();
    await flush();
    expect(changes).toHaveLength(2);
  });

  it("fetches same-origin narration only: never a recitation, never another path", async () => {
    const { f, p } = setup();
    const others = [
      "https://everyayah.com/data/Alafasy_128kbps/001001.mp3",
      "//everyayah.com/data/Alafasy_128kbps/001001.mp3",
      "/belajar/api/ayah?loc=1:1",
      "/belajar/media/narration/../secret.mp3",
    ];
    p.update({ wanted: [...others, A], open: true, key: 1 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A]);
    for (const u of others) expect(p.pending(u)).toBe(false);
    p.stop();
  });
});
