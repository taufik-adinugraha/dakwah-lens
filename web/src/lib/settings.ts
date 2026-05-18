/**
 * Runtime settings — backed by the `app_settings` key/value table.
 *
 * Why a tiny helper instead of inlining queries everywhere: every page
 * that displays IDR needs the same rate, and we want one place that
 * validates / falls back so a missing or malformed row never blows up
 * the dashboard.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

/** Hard fallback if `app_settings` is empty or the value can't be parsed. */
const DEFAULT_USD_TO_IDR = 16_300;

export async function getUsdToIdr(): Promise<number> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "usd_to_idr"))
    .limit(1);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_IDR;
}

/**
 * Upsert the rate. Caller is responsible for permission gating (the only
 * caller right now lives in a server action that runs `requireSuperadmin()`
 * before invoking this).
 */
export async function setUsdToIdr(rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("invalid_rate");
  }
  await db
    .insert(schema.appSettings)
    .values({
      key: "usd_to_idr",
      value: String(Math.round(rate)),
    })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: String(Math.round(rate)), updatedAt: new Date() },
    });
}

export async function getUsdToIdrRow(): Promise<{
  value: number;
  updatedAt: Date | null;
}> {
  const [row] = await db
    .select({
      value: schema.appSettings.value,
      updatedAt: schema.appSettings.updatedAt,
    })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "usd_to_idr"))
    .limit(1);
  const parsed = Number(row?.value);
  return {
    value:
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_TO_IDR,
    updatedAt: row?.updatedAt ?? null,
  };
}
