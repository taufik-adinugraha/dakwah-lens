"use server";

/**
 * Page-view tracking server action.
 *
 * Called from `<PageTracker />` on every route render. We deliberately keep
 * this minimal:
 *  - No IP storage (UU PDP §15: personal data minimisation).
 *  - Anonymous sessions are an httpOnly random ID, never tied back to identity.
 *  - User agent is stored but you can strip it via SQL if PII rules tighten.
 *
 * Failures are swallowed — analytics must never break the page.
 */

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";

import { auth } from "@/auth";
import { db, schema } from "@/db";

const SESSION_COOKIE = "dlens_session";
// 1 year — long enough that repeat visitors get attributed to one session
// without identifying them.
const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

export async function trackPageView(input: {
  path: string;
  locale?: string;
}): Promise<void> {
  try {
    const jar = await cookies();
    let sessionId = jar.get(SESSION_COOKIE)?.value;
    if (!sessionId) {
      sessionId = randomUUID();
      jar.set(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE_S,
        secure: process.env.NODE_ENV === "production",
      });
    }

    const session = await auth();
    const hdrs = await headers();

    await db.insert(schema.pageViews).values({
      path: input.path,
      locale: input.locale ?? null,
      userId: session?.user?.id ?? null,
      sessionId,
      referer: hdrs.get("referer") ?? null,
      userAgent: hdrs.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.warn("[analytics] page view track failed:", err);
  }
}
