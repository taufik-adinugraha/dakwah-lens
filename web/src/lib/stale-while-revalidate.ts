/**
 * A small in-process stale-while-revalidate cache for reads that are slow and
 * change slowly: the landing page's figures.
 *
 * Why it exists (2026-11-04): the landing page counted 30 days of posts on
 * every visit. `social_posts.created_at` has no index, so Postgres read the
 * whole table, about 0.5 GB and 2.8 s each time, and the page waited for it.
 * The figure only changes when the nightly label batch runs, so it is read
 * once an hour instead and a visitor never waits for it.
 *
 * Per key:
 *   - nothing cached yet: the caller waits for the load, and a failure reaches
 *     the caller, as it did before there was a cache;
 *   - younger than `ttlMs`: the cached value;
 *   - older: the cached value NOW, and one load runs in the background (never
 *     two at once). If it fails the old value stays and the next try waits
 *     `retryMs`;
 *   - older than `maxStaleMs` (a long idle): the caller waits for a fresh load,
 *     but gets the old value rather than an error if that load fails, since a
 *     marketing figure from yesterday beats a broken page.
 *
 * It is per process; the web container is one process. The state sits on
 * `globalThis`, not in this module: Next bundles the boot hook that warms it
 * (instrumentation.ts) apart from the pages, and each bundle would get its own
 * module-level Map.
 *
 * Not `unstable_cache`: that serialises to JSON (a Date comes back a string),
 * writes under .next/cache in the container, and cannot be exercised without a
 * build. This is a short module that a unit test covers, each rule above with
 * its own case (stale-while-revalidate.test.ts).
 */

type Entry = { value: unknown; loadedAt: number; retryAt: number };
type Store = { entries: Map<string, Entry>; loading: Map<string, Promise<unknown>> };

export type CacheOptions = {
  /** How long a value counts as fresh. */
  ttlMs: number;
  /** Past this age a caller waits for a new load instead of being handed the old value. Default 24 h. */
  maxStaleMs?: number;
  /** After a failed reload, how long until the next try. Default 60 s. */
  retryMs?: number;
  /** The clock; tests pass their own. */
  now?: () => number;
};

const SLOT = Symbol.for("dakwah-lens.stale-while-revalidate");

function store(): Store {
  const slots = globalThis as unknown as Record<symbol, Store | undefined>;
  return (slots[SLOT] ??= { entries: new Map(), loading: new Map() });
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One load per key at a time: callers that arrive while it runs share it. */
function load<T>(key: string, fn: () => Promise<T>, now: () => number): Promise<T> {
  const { entries, loading } = store();
  const running = loading.get(key);
  if (running) return running as Promise<T>;
  const started = fn()
    .then((value) => {
      entries.set(key, { value, loadedAt: now(), retryAt: 0 });
      return value;
    })
    .finally(() => loading.delete(key));
  loading.set(key, started);
  return started;
}

export async function cached<T>(key: string, fn: () => Promise<T>, options: CacheOptions): Promise<T> {
  const { ttlMs, maxStaleMs = 24 * 3_600_000, retryMs = 60_000, now = Date.now } = options;
  const entry = store().entries.get(key);
  if (!entry) return load(key, fn, now);

  const age = now() - entry.loadedAt;
  if (age < ttlMs) return entry.value as T;

  if (age >= maxStaleMs && now() >= entry.retryAt) {
    try {
      return await load(key, fn, now);
    } catch (err) {
      entry.retryAt = now() + retryMs;
      console.warn(`[cache] ${key}: reload failed, serving the value from ${Math.round(age / 3_600_000)} h ago: ${reason(err)}`);
      return entry.value as T;
    }
  }

  if (now() >= entry.retryAt) {
    void load(key, fn, now).catch((err: unknown) => {
      entry.retryAt = now() + retryMs;
      console.warn(`[cache] ${key}: background reload failed, keeping the old value: ${reason(err)}`);
    });
  }
  return entry.value as T;
}

/** For tests: forget everything. */
export function clearCache(): void {
  const { entries, loading } = store();
  entries.clear();
  loading.clear();
}
