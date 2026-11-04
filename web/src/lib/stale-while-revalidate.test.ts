import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cached, clearCache } from "./stale-while-revalidate";

// The landing page's post count read the whole posts table on every visit (2.8 s, 0.5 GB).
// These pin the cache that replaced it: a visitor never waits for a reload, two visitors never
// start two, a failing database never breaks the page, and nothing older than a day is shown
// without trying for a fresh one.

const HOUR = 3_600_000;

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let promise callbacks that are already queued run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  clearCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("cached: the first load and the fresh window", () => {
  it("loads once, then hands back the same value until it is older than ttl", async () => {
    const c = clock();
    const fn = vi.fn(async () => ({ posts: 68_272 }));
    const a = await cached("k", fn, { ttlMs: HOUR, now: c.now });
    c.advance(HOUR - 1);
    const b = await cached("k", fn, { ttlMs: HOUR, now: c.now });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("keeps a Date a Date (unstable_cache would have made it a string)", async () => {
    const when = new Date("2026-11-04T00:00:00Z");
    await cached("d", async () => ({ when }), { ttlMs: HOUR });
    const again = await cached("d", async () => ({ when: new Date(0) }), { ttlMs: HOUR });
    expect(again.when).toBeInstanceOf(Date);
    expect(again.when.getTime()).toBe(when.getTime());
  });

  it("keeps keys apart", async () => {
    const a = await cached("a", async () => 1, { ttlMs: HOUR });
    const b = await cached("b", async () => 2, { ttlMs: HOUR });
    expect([a, b]).toEqual([1, 2]);
  });

  it("visitors who arrive while the first load runs share it", async () => {
    const gate = deferred<number>();
    const fn = vi.fn(() => gate.promise);
    const first = Array.from({ length: 5 }, () => cached("k", fn, { ttlMs: HOUR }));
    gate.resolve(7);
    expect(await Promise.all(first)).toEqual([7, 7, 7, 7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a first load that fails reaches the caller and is not remembered", async () => {
    const fn = vi.fn<() => Promise<number>>().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce(3);
    await expect(cached("k", fn, { ttlMs: HOUR })).rejects.toThrow("db down");
    expect(await cached("k", fn, { ttlMs: HOUR })).toBe(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("cached: stale values and the background reload", () => {
  it("past ttl, answers with the old value at once and reloads behind it, once", async () => {
    const c = clock();
    const opts = { ttlMs: HOUR, now: c.now };
    await cached("k", async () => "old", opts);
    c.advance(HOUR + 1);

    const gate = deferred<string>();
    const fn = vi.fn(() => gate.promise);
    // Three visitors during the reload: all get the old value immediately, none starts another load.
    expect(await cached("k", fn, opts)).toBe("old");
    expect(await cached("k", fn, opts)).toBe("old");
    expect(await cached("k", fn, opts)).toBe("old");
    expect(fn).toHaveBeenCalledTimes(1);

    gate.resolve("new");
    await settle();
    expect(await cached("k", fn, opts)).toBe("new");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a reload that fails keeps the old value and does not hammer the database", async () => {
    const c = clock();
    const opts = { ttlMs: HOUR, retryMs: 60_000, now: c.now };
    await cached("k", async () => "old", opts);
    c.advance(2 * HOUR);

    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce("new");
    expect(await cached("k", fn, opts)).toBe("old"); // starts the reload that will fail
    await settle();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("db down"));

    c.advance(30_000);
    expect(await cached("k", fn, opts)).toBe("old"); // inside the retry wait: no new attempt
    await settle();
    expect(fn).toHaveBeenCalledTimes(1);

    c.advance(31_000);
    expect(await cached("k", fn, opts)).toBe("old"); // wait over: tries again, still answers at once
    await settle();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(await cached("k", fn, opts)).toBe("new");
  });
});

describe("cached: a long idle", () => {
  it("past maxStale, the caller waits for a fresh value", async () => {
    const c = clock();
    const opts = { ttlMs: HOUR, maxStaleMs: 24 * HOUR, now: c.now };
    await cached("k", async () => "yesterday", opts);
    c.advance(25 * HOUR);
    const fn = vi.fn(async () => "today");
    expect(await cached("k", fn, opts)).toBe("today");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("past maxStale with the database down: the old value, not an error, and no wait on every visit", async () => {
    const c = clock();
    const opts = { ttlMs: HOUR, maxStaleMs: 24 * HOUR, retryMs: 60_000, now: c.now };
    await cached("k", async () => "yesterday", opts);
    c.advance(25 * HOUR);
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("db down"));
    expect(await cached("k", fn, opts)).toBe("yesterday");
    expect(await cached("k", fn, opts)).toBe("yesterday");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("serving the value from 25 h ago"));
  });
});

describe("cached: one cache for every bundle", () => {
  it("a second copy of the module (the boot hook's bundle) sees what the first one loaded", async () => {
    await cached("shared", async () => "warmed at boot", { ttlMs: HOUR });
    vi.resetModules();
    const other = await import("./stale-while-revalidate");
    const fn = vi.fn(async () => "loaded again");
    expect(await other.cached("shared", fn, { ttlMs: HOUR })).toBe("warmed at boot");
    expect(fn).not.toHaveBeenCalled();
  });
});
