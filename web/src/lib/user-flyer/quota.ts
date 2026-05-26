/**
 * Weekly user-flyer quota — 5 flyers per user per week, reset every
 * Sunday (Ahad) 00:00 WIB.
 *
 * No counter table — we just COUNT rows in `user_flyers` newer than
 * the most-recent Sunday boundary. WIB anchored (Asia/Jakarta) so
 * "minggu ini" matches the user's local week.
 */

import { sql } from "drizzle-orm";

import { db } from "@/db";

export const WEEKLY_QUOTA = 5;

/** WIB offset in minutes (UTC+7, no DST). */
const WIB_OFFSET_MIN = 7 * 60;

/** Most-recent Sunday 00:00 WIB at or before `now`, as a UTC Date. */
export function currentWeekStartUtc(now: Date = new Date()): Date {
  // Shift to WIB clock, find the most-recent Sunday 00:00 in that clock,
  // shift back to UTC.
  const wibMs = now.getTime() + WIB_OFFSET_MIN * 60_000;
  const wib = new Date(wibMs);
  const dayOfWeek = wib.getUTCDay(); // 0 = Sunday
  const wibStartMs =
    Date.UTC(
      wib.getUTCFullYear(),
      wib.getUTCMonth(),
      wib.getUTCDate(),
      0,
      0,
      0,
    ) - dayOfWeek * 86_400_000;
  // wibStartMs is a UTC ms value that represents Sunday-00:00 in WIB
  // when reinterpreted as a wall clock. Shift back to actual UTC.
  return new Date(wibStartMs - WIB_OFFSET_MIN * 60_000);
}

/** Next Sunday 00:00 WIB after `now`, as a UTC Date. The reset moment. */
export function nextWeekResetUtc(now: Date = new Date()): Date {
  const start = currentWeekStartUtc(now);
  return new Date(start.getTime() + 7 * 86_400_000);
}

export type QuotaSnapshot = {
  used: number;
  remaining: number;
  limit: number;
  /** ISO timestamp of the next reset (Sunday 00:00 WIB). */
  resetAt: string;
};

export async function getQuotaSnapshot(userId: string): Promise<QuotaSnapshot> {
  const weekStart = currentWeekStartUtc();
  const reset = nextWeekResetUtc();
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS used
    FROM user_flyers
    WHERE user_id = ${userId}
      AND created_at >= ${weekStart.toISOString()}
  `)) as unknown as Array<{ used: number }>;
  const used = Math.max(0, Number(rows[0]?.used ?? 0));
  return {
    used,
    remaining: Math.max(0, WEEKLY_QUOTA - used),
    limit: WEEKLY_QUOTA,
    resetAt: reset.toISOString(),
  };
}

export class QuotaExceededError extends Error {
  constructor(public snapshot: QuotaSnapshot) {
    super(
      `Weekly user-flyer quota exhausted (used ${snapshot.used}/${snapshot.limit}). Reset at ${snapshot.resetAt}.`,
    );
    this.name = "QuotaExceededError";
  }
}

/** Throws QuotaExceededError when the user has no remaining quota. Used
 *  by the generate handler as a pre-flight check before any LLM/Qdrant
 *  cost is incurred. Race condition with parallel requests is acceptable
 *  given the 5/week budget — at worst one user gets 6 flyers in a week. */
export async function assertQuotaAvailable(
  userId: string,
): Promise<QuotaSnapshot> {
  const snap = await getQuotaSnapshot(userId);
  if (snap.remaining <= 0) throw new QuotaExceededError(snap);
  return snap;
}
