/**
 * HMAC-signed submission token for the /m/{slug} discussion form.
 *
 * The token does three things at once:
 *
 *   1. Proves the submitter actually loaded the page (the token is
 *      minted server-side at render time — a bot that POSTs blind
 *      against the API can't forge a valid signature).
 *   2. Binds the submission to one specific briefing slug, so a token
 *      issued for article A can't be replayed against article B.
 *   3. Enforces a minimum age: humans need several seconds to read +
 *      type a comment; a bot that scripts the GET-then-POST in
 *      milliseconds will fail the `too_fresh` check.
 *
 * Stateless: the token IS the (timestamp + signature) pair, so we
 * don't need Redis or a single-use table. Replay within the validity
 * window is still possible but is contained by the per-IP rate
 * limiter + duplicate-body check upstream of insert.
 *
 * Token wire format: "<ts_ms>.<base64url-sig>"
 *   sig = HMAC_SHA256(secret, `${briefingSlug}|${ts_ms}`)
 */

import { createHmac, timingSafeEqual } from "crypto";

import { getNextAuthSecret } from "./secrets";

/** Minimum seconds between page load and submit. Humans typing a 50-
 *  word comment need ≥ 8 seconds; setting the floor at 3 catches
 *  scripted bots that fire instantly without false-positiving fast
 *  typists who skim quickly. */
const MIN_AGE_MS = 3_000;
/** Tokens older than 24h are stale. Wide enough that a tab left open
 *  through a day of campus rounds still submits cleanly, narrow enough
 *  that we don't accept a token signed last week. Replay risk stays
 *  capped by the per-IP rate limit + same-origin gate upstream. */
const MAX_AGE_MS = 24 * 60 * 60_000;

export function issueCommentToken(briefingSlug: string): string {
  const ts = Date.now();
  const sig = sign(briefingSlug, ts);
  return `${ts}.${sig}`;
}

export type TokenVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: "missing" | "malformed" | "bad_signature" | "too_fresh" | "too_old";
    };

export function verifyCommentToken(
  briefingSlug: string,
  token: string | null | undefined,
): TokenVerdict {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1)
    return { ok: false, reason: "malformed" };
  const tsStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const ts = Number.parseInt(tsStr, 10);
  if (!Number.isFinite(ts) || ts <= 0)
    return { ok: false, reason: "malformed" };

  const expected = sign(briefingSlug, ts);
  // Constant-time compare to avoid leaking signature bytes via timing.
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: "bad_signature" };

  const age = Date.now() - ts;
  if (age < MIN_AGE_MS) return { ok: false, reason: "too_fresh" };
  if (age > MAX_AGE_MS) return { ok: false, reason: "too_old" };
  return { ok: true };
}

function sign(slug: string, ts: number): string {
  return createHmac("sha256", getNextAuthSecret())
    .update(`${slug}|${ts}`)
    .digest("base64url");
}
