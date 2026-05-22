/**
 * Deploy status — server-side helpers.
 *
 * Persists as a single JSON-encoded row in `app_settings` (key
 * `deploy_status`). Avoids a dedicated table + migration; the shape
 * is internal so we don't need column-level typing.
 *
 * Writers: /api/internal/deploy-event (called by GitHub Actions).
 * Readers: /api/deploy-status (browser polling) + initial SSR.
 */
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

export type DeployState = "idle" | "deploying" | "failed";

export type DeployStatus = {
  state: DeployState;
  startedAt: string | null;
  finishedAt: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  workflowRunUrl: string | null;
};

const STORAGE_KEY = "deploy_status";

const IDLE: DeployStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  commitSha: null,
  commitMessage: null,
  workflowRunUrl: null,
};

export async function readDeployStatus(): Promise<DeployStatus> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, STORAGE_KEY))
    .limit(1);
  if (!row) return IDLE;
  try {
    const parsed = JSON.parse(row.value) as Partial<DeployStatus>;
    return { ...IDLE, ...parsed };
  } catch {
    // Malformed row from a previous incompatible writer — treat as idle
    // so the overlay doesn't get stuck if someone edits the row by hand.
    return IDLE;
  }
}

export async function writeDeployStatus(status: DeployStatus): Promise<void> {
  const value = JSON.stringify(status);
  await db
    .insert(schema.appSettings)
    .values({ key: STORAGE_KEY, value })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
