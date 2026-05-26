/**
 * Centralized secret resolution for HMAC + cookie + comment-token use.
 *
 * Why a helper instead of inline `process.env.X || fallback`:
 *
 *   - Three call sites (comment-token.ts, visitor-cookie.ts, the
 *     comments POST route's ip/ua hasher) used the SAME pattern with
 *     SAME fallback string. If the env is ever missing in production,
 *     every HMAC/hash quietly collapses to a known constant — making
 *     tokens forgeable AND hash-keyed lookups identical across users.
 *
 *   - Audit 2026-05-26 P0: hard-fail in production so a misconfigured
 *     deploy explodes loudly instead of degrading silently. Dev/test
 *     keep the fallback so local work still runs without a `.env`.
 *
 * The check is RUNTIME, not module-load. `next build` runs static-
 * route analysis with NODE_ENV=production but without the runtime env
 * — throwing at import would block the build itself. Calling
 * `getNextAuthSecret()` lazily means the only code path that throws
 * is the actual request handler, where the env IS available.
 */

const DEV_FALLBACK_SECRET = "dakwah-lens-dev-fallback-secret";

// Cached resolved value — only re-evaluated until we successfully
// resolve a real env. Means we don't keep paying the env-lookup cost
// on every comment submission, but we also don't lock in a stale
// fallback that resolved during build-phase static analysis.
let cached: string | null = null;

function resolveNextAuthSecret(): string {
  if (cached) return cached;

  const env = process.env.NEXTAUTH_SECRET;
  if (env && env.length > 0) {
    cached = env;
    return env;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. " +
        "HMAC signing + cookie hashing rely on it; refusing to operate with a fallback constant.",
    );
  }

  // Dev / test: predictable fallback so local + CI runs don't need
  // a `.env` file just to render the comment form. Cache it so the
  // fallback message doesn't keep getting re-evaluated.
  cached = DEV_FALLBACK_SECRET;
  return cached;
}

/**
 * Lazy getter for the HMAC / hash secret used across comment-token
 * signing, visitor cookie hashing, and ip/ua hashing in the comments
 * POST route.
 *
 * Resolves on first call. In production this throws if NEXTAUTH_SECRET
 * is missing AT REQUEST TIME (not at module-load — that would break
 * `next build` which runs without the runtime env). In dev/test it
 * returns a predictable fallback.
 */
export function getNextAuthSecret(): string {
  return resolveNextAuthSecret();
}
