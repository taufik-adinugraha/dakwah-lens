/**
 * In-process rate limiter.
 *
 * Used by public unauthenticated endpoints (contact form, future signup
 * flows) to throttle abuse without persisting IPs to disk — the privacy
 * policy commits to not logging IPs, so this state is intentionally
 * ephemeral. Lost on restart; that's fine.
 *
 * Limitations to be aware of:
 *  - Single-process only. If we ever scale beyond one Node instance,
 *    move this to Redis with the same interface.
 *  - Behind a reverse proxy we trust the *rightmost* `x-forwarded-for`
 *    value as set by nginx — earlier values are attacker-controlled.
 *  - In local dev there's no proxy header, so `getClientIp()` returns
 *    null. Callers should treat null as "skip rate limit", not "allow".
 */

import { headers } from "next/headers";

type Bucket = { count: number; resetAt: number };

const _store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
}

/**
 * Fixed-window counter. `windowMs` after the first hit, the bucket resets.
 * Each subsequent call increments until `max` is reached.
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const bucket = _store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    // Opportunistic prune so the map can't grow without bound under
    // sustained traffic. Only sweeps on bucket creation; O(n) worst case
    // is fine at our scale (sub-1k entries) and avoids a separate timer.
    if (_store.size > 256) {
      for (const [k, b] of _store) {
        if (b.resetAt <= now) _store.delete(k);
      }
    }
    _store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1 };
  }

  if (bucket.count >= max) {
    return { ok: false, remaining: 0 };
  }
  bucket.count += 1;
  return { ok: true, remaining: max - bucket.count };
}

/**
 * Best-effort client-IP resolver. Returns null in local dev (no proxy
 * headers) — callers should treat null as "rate limit not applicable",
 * not "denied", so dev doesn't break.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Rightmost is the one set by our trusted proxy.
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return h.get("x-real-ip");
}
