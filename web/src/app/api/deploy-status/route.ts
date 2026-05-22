import { NextResponse } from "next/server";

import { readDeployStatus } from "@/lib/deploy-status";

/**
 * GET /api/deploy-status
 *
 * Public endpoint — the browser polls this to decide whether to show
 * the centered blocking overlay during a deploy. No auth required;
 * the response carries no sensitive data (just commit metadata
 * already public on GitHub once the deploy lands).
 *
 * Polled by `<DeployOverlay>` at varying cadence:
 *   - every 30s while state = "idle"
 *   - every  5s while state = "deploying" (to catch finish quickly)
 *   - every 30s during "failed" until the auto-clear or operator reset
 *
 * `cache: "no-store"` on the client side; we set no-store here too so
 * any reverse proxy / CDN doesn't pin a stale state.
 */
export async function GET() {
  const status = await readDeployStatus();
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

// Static-shape, no segment params — disable Next.js static optimization
// so this always hits the DB on every request.
export const dynamic = "force-dynamic";
