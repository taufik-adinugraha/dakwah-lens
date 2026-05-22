import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { writeDeployStatus, type DeployState } from "@/lib/deploy-status";

/**
 * POST /api/internal/deploy-event
 *
 * Webhook called by `.github/workflows/deploy.yml` at deploy start +
 * end (or failure). Updates the singleton deploy_status row that the
 * client-side overlay polls.
 *
 * Body (JSON):
 *   {
 *     "state": "deploying" | "idle" | "failed",
 *     "commit_sha":      "<optional>",
 *     "commit_message":  "<optional>",
 *     "workflow_run_url":"<optional>"
 *   }
 *
 * Auth: HMAC SHA-256 over the raw body using DEPLOY_WEBHOOK_SECRET.
 * Sent as header `X-Deploy-Signature: sha256=<hex>`. Without auth a
 * malicious caller could trigger fake "deploying" overlays for all
 * users, locking the app indefinitely.
 *
 * Idempotency: a state write is just an UPSERT; replaying the same
 * webhook is safe.
 */
export async function POST(request: Request) {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "DEPLOY_WEBHOOK_SECRET not configured on server" },
      { status: 500 },
    );
  }

  const sig = request.headers.get("x-deploy-signature") ?? "";
  const raw = await request.text();
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(raw).digest("hex");

  // Timing-safe compare. If lengths differ, timingSafeEqual throws —
  // catch and reject. Both buffers must be the same length.
  let validSig = false;
  try {
    validSig =
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    validSig = false;
  }
  if (!validSig) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: {
    state?: string;
    commit_sha?: string;
    commit_message?: string;
    workflow_run_url?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const state = body.state;
  if (state !== "idle" && state !== "deploying" && state !== "failed") {
    return NextResponse.json(
      { error: "state must be one of: idle | deploying | failed" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  await writeDeployStatus({
    state: state as DeployState,
    startedAt: state === "deploying" ? now : null,
    finishedAt:
      state === "idle" || state === "failed" ? now : null,
    commitSha: body.commit_sha ?? null,
    commitMessage: body.commit_message ?? null,
    workflowRunUrl: body.workflow_run_url ?? null,
  });

  return NextResponse.json({ ok: true, state });
}

export const dynamic = "force-dynamic";
