import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrefetcher, PREFETCH_SETTLE_MS, type PrefetchFetch } from "./prefetch";

// The narration fetched ahead, one file at a time (operator 2026-10-12, plan L18): the
// prefetcher the lesson runner feeds, driven here with a stubbed fetch whose bodies arrive when
// the test says, and fake timers.

const A = "/belajar/media/narration/kang-nandar/al-fatihah/aaaaaaaaaaaaaaaa.mp3";
const B = "/belajar/media/narration/kang-nandar/al-fatihah/bbbbbbbbbbbbbbbb.mp3";
const C = "/belajar/media/narration/kang-nandar/shared/cccccccccccccccc.mp3";

type Call = {
  url: string;
  init: RequestInit;
  /** The response arrives; its body is two chunks, the second when `end()` is called. */
  respond: (status?: number) => void;
  /** The body ends (the last chunk, then done). */
  end: () => void;
  fail: () => void;
  aborted: boolean;
  /** The prefetcher has read the body to its end. */
  read: boolean;
};

/** A fetch whose answers the test drives; `live()`: the calls not ended, failed or aborted. */
function stubFetch() {
  const calls: Call[] = [];
  const failed = new Set<Call>();
  let maxLive = 0;
  const live = () => calls.filter((c) => !c.read && !c.aborted && !failed.has(c));
  const fetch: PrefetchFetch = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
      const call: Call = {
        url,
        init,
        aborted: false,
        read: false,
        respond: (status = 200) => {
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              stream = c;
              c.enqueue(new Uint8Array(4096));
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
          resolve(new Response(tracked, { status }));
        },
        end: () => {
          stream?.enqueue(new Uint8Array(4096));
          stream?.close();
        },
        fail: () => {
          failed.add(call);
          reject(new TypeError("network"));
        },
      };
      init.signal?.addEventListener("abort", () => {
        call.aborted = true;
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
  return { fetch, calls, live, maxLive: () => maxLive };
}

const settle = () => vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("the narration prefetcher (prefetch.ts)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts nothing while closed; once open, waits PREFETCH_SETTLE_MS, then fetches the first file — into the HTTP cache, same-origin", async () => {
    const f = stubFetch();
    const p = createPrefetcher({ fetch: f.fetch, done: new Set() });
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

  it("one at a time, in order: the next starts only once the previous body was read to its end", async () => {
    const f = stubFetch();
    const done = new Set<string>();
    const p = createPrefetcher({ fetch: f.fetch, done });
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
    expect(done.has(A)).toBe(false);
    f.calls[0].end();
    await flush();
    expect(f.calls[0].read).toBe(true);
    expect(done.has(A)).toBe(true);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    f.calls[1].respond();
    f.calls[1].end();
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    f.calls[2].respond();
    f.calls[2].end();
    await flush();
    expect([...done]).toEqual([A, B, C]);
    expect(f.maxLive()).toBe(1);
    p.stop();
  });

  it("the gate closing (a line loading or stalled, a pause) lets the file under way finish and starts no other until it reopens and settles", async () => {
    const f = stubFetch();
    const p = createPrefetcher({ fetch: f.fetch, done: new Set() });
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    expect(f.calls).toHaveLength(1);
    p.update({ wanted: [A, B], open: false, key: 1 });
    f.calls[0].respond();
    f.calls[0].end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls[0].aborted).toBe(false);
    expect(f.calls[0].read).toBe(true);
    expect(f.calls).toHaveLength(1);
    p.update({ wanted: [A, B], open: true, key: 1 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 1);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    p.stop();
  });

  it("a new activity starts the settle over: a line just asked for has the connection first", async () => {
    const f = stubFetch();
    const p = createPrefetcher({ fetch: f.fetch, done: new Set() });
    p.update({ wanted: [A], open: true, key: 1 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 100);
    p.update({ wanted: [A], open: true, key: 2 });
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS - 1);
    expect(f.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(1);
    p.stop();
  });

  it("aborts the file under way once it is no longer wanted (it plays now, the learner jumped, the lesson finished) — and fetches it again if it is wanted again", async () => {
    const f = stubFetch();
    const done = new Set<string>();
    const p = createPrefetcher({ fetch: f.fetch, done });
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    f.calls[0].respond();
    await flush();
    // A is now the line playing: no longer ahead.
    p.update({ wanted: [B], open: true, key: 2 });
    await flush();
    expect(f.calls[0].aborted).toBe(true);
    expect(done.has(A)).toBe(false);
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    // The lesson finished (the hand-off to the next ayah): nothing wanted, B aborted.
    p.update({ wanted: [], open: false, key: null });
    await flush();
    expect(f.calls[1].aborted).toBe(true);
    // Wanted again later: fetched again (an aborted file was never marked done).
    p.update({ wanted: [A], open: true, key: 3 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, A]);
    p.stop();
  });

  it("stop() (unmount) aborts the file under way and starts nothing after", async () => {
    const f = stubFetch();
    const p = createPrefetcher({ fetch: f.fetch, done: new Set() });
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    p.stop();
    await flush();
    expect(f.calls[0].aborted).toBe(true);
    p.update({ wanted: [A, B], open: true, key: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.calls).toHaveLength(1);
  });

  it("each file once per page: what is done is skipped, also by the next ayah's prefetcher sharing the set", async () => {
    const f = stubFetch();
    const done = new Set<string>([A]);
    const p = createPrefetcher({ fetch: f.fetch, done });
    p.update({ wanted: [A, B], open: true, key: 1 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([B]);
    f.calls[0].respond();
    f.calls[0].end();
    await flush();
    p.stop();
    // The hand-off: the next page's prefetcher, the same module-level set.
    const q = createPrefetcher({ fetch: f.fetch, done });
    q.update({ wanted: [B, A, C], open: true, key: 1 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([B, C]);
    q.stop();
  });

  it("a file that failed (the network, an HTTP error) is not tried again on this page; the next one goes on", async () => {
    const f = stubFetch();
    const done = new Set<string>();
    const p = createPrefetcher({ fetch: f.fetch, done });
    p.update({ wanted: [A, B, C], open: true, key: 1 });
    await settle();
    f.calls[0].fail();
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B]);
    f.calls[1].respond(404);
    await flush();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    p.update({ wanted: [A, B, C], open: true, key: 2 });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A, B, C]);
    expect(done.has(A) && done.has(B)).toBe(true);
    p.stop();
  });

  it("fetches same-origin narration only: never a recitation, never another path", async () => {
    const f = stubFetch();
    const p = createPrefetcher({ fetch: f.fetch, done: new Set() });
    p.update({
      wanted: [
        "https://everyayah.com/data/Alafasy_128kbps/001001.mp3",
        "//everyayah.com/data/Alafasy_128kbps/001001.mp3",
        "/belajar/api/ayah?loc=1:1",
        "/belajar/media/narration/../secret.mp3",
        A,
      ],
      open: true,
      key: 1,
    });
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual([A]);
    p.stop();
  });
});
