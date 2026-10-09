/**
 * Does a Cookie header carry an Auth.js session (plain or __Secure-, and the
 * chunked `.0`, `.1` … form Auth.js uses for large JWEs)? A cheap pre-check
 * so anonymous learners never trigger a session lookup against the main app.
 */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?authjs\.session-token(?:\.\d+)?=/;

export function hasSessionCookie(cookieHeader: string): boolean {
  return SESSION_COOKIE.test(cookieHeader);
}
