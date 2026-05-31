/**
 * Per-user weekly quota — decoupled from the row counts on briefs /
 * deliverables so deleting a generation doesn't free up a slot.
 *
 * Mechanism: every successful generate INSERTs (or UPSERTs +1) into
 * `weekly_quota_usage` keyed by (user_id, current_week_start_utc).
 * Delete actions don't touch this table. The cap check reads the
 * counter directly.
 *
 * Window boundary is Sunday-00:00 WIB via `currentWeekStartUtc()`
 * — same boundary the flyer quota and the dashboard chips use.
 */

import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { currentWeekStartUtc } from "@/lib/user-flyer/quota";

export const DRAFTS_PER_WEEK = 5;
export const KAJIAN_PER_WEEK = 5;

export type QuotaKind = "briefs" | "kajian";

/** Read the user's current-week usage. Returns 0 if the row doesn't
 *  exist yet (no UPSERT — just read). */
export async function getWeeklyUsage(
  userId: string,
): Promise<{ briefs: number; kajian: number }> {
  const weekStart = currentWeekStartUtc();
  const [row] = await db
    .select({
      briefs: schema.weeklyQuotaUsage.briefsUsed,
      kajian: schema.weeklyQuotaUsage.kajianUsed,
    })
    .from(schema.weeklyQuotaUsage)
    .where(
      and(
        eq(schema.weeklyQuotaUsage.userId, userId),
        eq(schema.weeklyQuotaUsage.weekStartUtc, weekStart),
      ),
    )
    .limit(1);
  return {
    briefs: Number(row?.briefs ?? 0),
    kajian: Number(row?.kajian ?? 0),
  };
}

/** Atomic "check + reserve" — bumps the counter for `kind` by 1 if
 *  the new value would stay ≤ cap. Returns:
 *   - `{ ok: true, used }` when the reservation succeeded (caller proceeds with LLM call).
 *   - `{ ok: false, used, limit }` when the cap is hit (caller refuses).
 *
 *  Implementation uses INSERT ... ON CONFLICT DO UPDATE with a WHERE
 *  clause on the target so the UPSERT silently no-ops when the cap is
 *  already exhausted. The caller then re-reads the counter to decide.
 *
 *  Reserving BEFORE the LLM call (not after success) means failed
 *  generations still count — prevents retry abuse where a user could
 *  spam attempts until one succeeds. Slight UX hit (a flaky LLM call
 *  costs the user a slot), accepted as the safer default. */
export async function reserveWeeklyQuota(
  userId: string,
  kind: QuotaKind,
): Promise<
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number }
> {
  const weekStart = currentWeekStartUtc();
  const limit = kind === "briefs" ? DRAFTS_PER_WEEK : KAJIAN_PER_WEEK;
  const usedCol =
    kind === "briefs"
      ? sql`briefs_used`
      : sql`kajian_used`;

  // INSERT new row with usage=1 OR increment existing row by 1 — but
  // ONLY when the resulting value would still be ≤ limit. The WHERE
  // clause on DO UPDATE skips the bump when the user is at cap.
  const rows = (await db.execute(sql`
    INSERT INTO weekly_quota_usage (user_id, week_start_utc, briefs_used, kajian_used, updated_at)
    VALUES (
      ${userId}::uuid,
      ${weekStart},
      ${kind === "briefs" ? 1 : 0},
      ${kind === "kajian" ? 1 : 0},
      now()
    )
    ON CONFLICT (user_id, week_start_utc) DO UPDATE
      SET ${usedCol} = weekly_quota_usage.${usedCol} + 1,
          updated_at = now()
      WHERE weekly_quota_usage.${usedCol} < ${limit}
    RETURNING briefs_used, kajian_used
  `)) as unknown as Array<{ briefs_used: number; kajian_used: number }>;

  const result = rows[0];
  if (!result) {
    // ON CONFLICT WHERE failed — the user is at cap. Read current
    // value for the response.
    const current = await getWeeklyUsage(userId);
    return {
      ok: false,
      used: current[kind],
      limit,
    };
  }
  const used = kind === "briefs" ? result.briefs_used : result.kajian_used;
  return { ok: true, used, limit };
}
