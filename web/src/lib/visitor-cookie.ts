/**
 * Anonymous visitor token cookie.
 *
 * On first comment we set an httpOnly random-UUID cookie (`dl_visitor`).
 * We persist its SHA-256 hash on every comment as
 * `visitor_token_hash`. That lets us see "this is a returning poster"
 * across IP / UA changes without storing any PII — the raw UUID
 * lives only in the user's browser, the server only ever holds the
 * hash.
 *
 * Cleared by clearing cookies → the user resets to "stranger" state.
 * Privacy stance matches the rest of the public discussion surface.
 */

import { createHash, randomUUID } from "crypto";

import { getNextAuthSecret } from "./secrets";

import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

const COOKIE_NAME = "dl_visitor";
/** One year — long enough that a campus-rounds visitor returning months
 *  later still reads as "same person". User can revoke at any time by
 *  clearing cookies. */
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;

/** Read the visitor cookie from the incoming request. Returns null on
 *  first visit (caller should mint one and stick it on the response). */
export async function readVisitorToken(): Promise<string | null> {
  const c = await cookies();
  const v = c.get(COOKIE_NAME)?.value;
  return v && /^[A-Za-z0-9_-]{16,128}$/.test(v) ? v : null;
}

/** Mint a fresh visitor token. Caller is responsible for setting it
 *  on the response via {@link setVisitorCookie}. */
export function mintVisitorToken(): string {
  return randomUUID().replace(/-/g, "");
}

/** Attach the visitor cookie to a NextResponse. Use this when the
 *  caller already minted a token for this request (so the same value
 *  is both hashed into the comment row and returned to the browser). */
export function setVisitorCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}

/** SHA-256 hash with the auth secret as salt. Same primitive the
 *  POST route uses for ip_hash / ua_hash, kept consistent so admins
 *  can reason about both side-by-side. Secret resolution (with
 *  prod-time hard-fail if NEXTAUTH_SECRET is missing) lives in
 *  `./secrets`. */
export function hashVisitorToken(token: string): string {
  return createHash("sha256").update(`${token}|${getNextAuthSecret()}`).digest("hex");
}
