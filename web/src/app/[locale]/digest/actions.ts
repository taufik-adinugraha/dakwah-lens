"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { auth } from "@/auth";
import { db, schema } from "@/db";

/**
 * Toggle weekly-digest opt-in for the current user.
 *
 * Issuing a `digest_unsubscribe_token` on first opt-in so the email
 * footer's one-click unsubscribe link works without requiring the
 * recipient to log in. Token is opaque and per-user; rotating it on
 * each opt-in cycle is overkill at our scale (one stale token per
 * user is a tolerable forwarding-grace-period rather than a leak).
 */
export async function setDigestOptIn(optIn: boolean): Promise<{
  saved: boolean;
}> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("not_authenticated");

  if (optIn) {
    // First opt-in needs a token. Mint one if missing.
    const [existing] = await db
      .select({ token: schema.users.digestUnsubscribeToken })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1);
    const token =
      existing?.token ?? randomBytes(24).toString("base64url");
    await db
      .update(schema.users)
      .set({
        emailDigestOptIn: true,
        digestUnsubscribeToken: token,
      })
      .where(eq(schema.users.id, session.user.id));
  } else {
    await db
      .update(schema.users)
      .set({ emailDigestOptIn: false })
      .where(eq(schema.users.id, session.user.id));
  }

  revalidatePath("/briefings");
  revalidatePath("/saved");
  return { saved: true };
}
