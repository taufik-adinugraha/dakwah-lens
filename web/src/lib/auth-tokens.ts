/**
 * Short-lived tokens for email verification and password reset.
 *
 * Backed by the existing `verification_tokens` table (Auth.js convention,
 * already in our schema). We prefix the `identifier` with the token kind
 * so verify-tokens and reset-tokens live in the same table without
 * colliding:
 *
 *   identifier = "verify:user@example.com"
 *   identifier = "reset:user@example.com"
 *
 * Tokens themselves are 32-byte random hex strings — long enough that
 * brute-forcing the address space is infeasible. We store the token
 * *plaintext* in the DB (not a hash) because:
 *  (a) the row is single-use — we delete on consume
 *  (b) the row carries no PII beyond the email itself
 *  (c) the value never leaves our DB or the user's inbox
 *
 * Expiry windows:
 *   verify → 24h (gives users a day to find the email)
 *   reset  → 1h  (short, since reset is more sensitive)
 */

import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { db, schema } from "@/db";

type TokenKind = "verify" | "reset";

function makeIdentifier(kind: TokenKind, email: string): string {
  return `${kind}:${email.toLowerCase()}`;
}

/**
 * Issue a fresh token. Replaces any pending token of the same kind for
 * the same email so a user clicking "Resend" twice doesn't end up with a
 * dangling old token still valid for 24h.
 */
export async function issueAuthToken(
  kind: TokenKind,
  email: string,
): Promise<{ token: string; expires: Date }> {
  const identifier = makeIdentifier(kind, email);
  const token = randomBytes(32).toString("hex");
  const hoursValid = kind === "verify" ? 24 : 1;
  const expires = new Date(Date.now() + hoursValid * 3600 * 1000);

  // Wipe any older tokens for this identifier — they're invalidated by the
  // new one. Cheaper than UPSERT because the table is small and the
  // composite PK on (identifier, token) makes targeted updates awkward.
  await db
    .delete(schema.verificationTokens)
    .where(eq(schema.verificationTokens.identifier, identifier));

  await db.insert(schema.verificationTokens).values({
    identifier,
    token,
    expires,
  });

  return { token, expires };
}

/**
 * Validate a token claim. Returns the email if valid; null otherwise.
 * Consumes the row on success — re-clicking the link does nothing.
 */
export async function consumeAuthToken(
  kind: TokenKind,
  email: string,
  token: string,
): Promise<string | null> {
  const identifier = makeIdentifier(kind, email);
  const [row] = await db
    .select()
    .from(schema.verificationTokens)
    .where(
      and(
        eq(schema.verificationTokens.identifier, identifier),
        eq(schema.verificationTokens.token, token),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.expires.getTime() < Date.now()) {
    // Expired — clean up but don't hand back a "valid" result.
    await db
      .delete(schema.verificationTokens)
      .where(
        and(
          eq(schema.verificationTokens.identifier, identifier),
          eq(schema.verificationTokens.token, token),
        ),
      );
    return null;
  }

  await db
    .delete(schema.verificationTokens)
    .where(
      and(
        eq(schema.verificationTokens.identifier, identifier),
        eq(schema.verificationTokens.token, token),
      ),
    );
  return email.toLowerCase();
}

/** Optional housekeeping. Safe to call any time; usually unused at scale
 *  since the table stays small (one row per pending verification). */
export async function purgeExpiredTokens(): Promise<number> {
  const res = await db
    .delete(schema.verificationTokens)
    .where(lt(schema.verificationTokens.expires, new Date()));
  // drizzle returns row count via the postgres driver's command tag —
  // not always typed; this is best-effort.
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
