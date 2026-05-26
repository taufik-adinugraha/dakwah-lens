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
 *   - Audit 2026-05-26 P0: hard-fail at module load time in production
 *     so a misconfigured deploy explodes loudly instead of degrading
 *     silently. Dev/test keep the fallback so local work still runs
 *     without a `.env`.
 *
 * Throws at module-load (not at call time) so a missing secret takes
 * the server down on boot, not at the first comment submission.
 */

function resolveNextAuthSecret(): string {
  const env = process.env.NEXTAUTH_SECRET;
  if (env && env.length > 0) return env;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET is required in production. " +
        "HMAC signing + cookie hashing rely on it; refusing to start with a fallback constant.",
    );
  }

  // Dev / test: predictable fallback so local + CI runs don't need
  // a `.env` file just to render the comment form.
  return "dakwah-lens-dev-fallback-secret";
}

/**
 * The HMAC / hash secret used across comment-token signing, visitor
 * cookie hashing, and ip/ua hashing in the comments POST route.
 *
 * Evaluated once at module-load. In production this throws if the
 * env is missing; in dev/test it returns a known fallback.
 */
export const NEXTAUTH_SECRET = resolveNextAuthSecret();
