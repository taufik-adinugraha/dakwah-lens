/**
 * Runtime settings — backed by the `app_settings` key/value table.
 *
 * Why a tiny helper instead of inlining queries everywhere: every page
 * that displays IDR needs the same rate, and we want one place that
 * validates / falls back so a missing or malformed row never blows up
 * the dashboard.
 */

import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";

/** Hard fallback if `app_settings` is empty or the value can't be parsed. */
const DEFAULT_USD_TO_IDR = 16_300;

/** Build the app_settings key for a per-pipeline kill switch.
 *  Mirror of `api/src/api/services/pipeline_flags.py::flag_key`. */
export function pipelineFlagKey(task: string, platform: string): string {
  return `pipeline:${task}:${platform}`;
}

/** Read all `pipeline:*` rows at once and return a (key → enabled) map.
 *  Default-true semantics: a missing row means "never touched, keep
 *  running as scheduled". Only stored value `"disabled"` flips it off. */
export async function getPipelineFlagsMap(
  keys: string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const k of keys) out.set(k, true);
  if (keys.length === 0) return out;
  const rows = await db
    .select({
      key: schema.appSettings.key,
      value: schema.appSettings.value,
    })
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, keys));
  for (const r of rows) {
    out.set(r.key, r.value !== "disabled");
  }
  return out;
}

/** Persist a kill-switch flip. Stores `"enabled"` / `"disabled"` so the
 *  Python side can pattern-match without parsing booleans. Caller is
 *  responsible for permission gating. */
export async function setPipelineEnabled(
  task: string,
  platform: string,
  enabled: boolean,
): Promise<void> {
  const key = pipelineFlagKey(task, platform);
  const value = enabled ? "enabled" : "disabled";
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

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
