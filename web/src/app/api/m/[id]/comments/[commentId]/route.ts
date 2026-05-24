import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";
import { moderateComment, MODERATION_LIMITS } from "@/lib/comment-moderation";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { hashVisitorToken, readVisitorToken } from "@/lib/visitor-cookie";

/**
 * Edit a comment in a public room.
 *
 *   PATCH /api/m/{slug}/comments/{commentId}
 *       body: { body: string }
 *       → { ok: true, status: "approved" | "pending", editedAt }
 *
 * Ownership: the request must carry the visitor cookie whose SHA-256
 * hash matches the row's `visitor_token_hash`. No other auth.
 *
 * Restrictions:
 *   - Edit window: `EDIT_WINDOW_MINUTES` from createdAt.
 *   - Edit count cap: `EDIT_COUNT_MAX` total edits per comment.
 *   - Only `status = 'approved'` rows can be edited; blocked rows are
 *     opaque to the poster (silent ack model from the POST path).
 *   - Body is re-moderated. If the new body trips a filter the row
 *     gets demoted to `blocked` — caller sees `status: pending`.
 *   - Same-origin gate + per-IP burst limiter mirror the POST path.
 */
export const runtime = "nodejs";

const EDIT_WINDOW_MINUTES = 15;
const EDIT_COUNT_MAX = 5;
const EDIT_BURST_PER_MINUTE = 6;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id: briefingSlug, commentId } = await context.params;

  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const ua = request.headers.get("user-agent") || "";
  if (ua.length < 8) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Burst cap — a real person clicking Save a few times in a minute is
  // fine; a script hammering edits is not.
  const ip = await getClientIp();
  const burstKey = ip ? `ip:${ip}` : null;
  if (burstKey) {
    const burst = checkRateLimit(
      `comment-edit-burst:${burstKey}`,
      EDIT_BURST_PER_MINUTE,
      60_000,
    );
    if (!burst.ok) {
      return NextResponse.json(
        { ok: false, error: "rate_limited" },
        { status: 429 },
      );
    }
  }

  // Visitor cookie is the ownership proof. No cookie → nothing we can
  // match against, so it can't possibly be the original poster.
  const visitorToken = await readVisitorToken();
  if (!visitorToken) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const visitorHash = hashVisitorToken(visitorToken);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const obj = payload as Record<string, unknown>;
  const newBody = typeof obj.body === "string" ? obj.body.trim() : "";
  if (
    newBody.length < MODERATION_LIMITS.minLen ||
    newBody.length > MODERATION_LIMITS.maxLen
  ) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: schema.mahasiswaComments.id,
      visitorTokenHash: schema.mahasiswaComments.visitorTokenHash,
      status: schema.mahasiswaComments.status,
      createdAt: schema.mahasiswaComments.createdAt,
      editCount: schema.mahasiswaComments.editCount,
      body: schema.mahasiswaComments.body,
      displayName: schema.mahasiswaComments.displayName,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.id, commentId),
        eq(schema.mahasiswaComments.briefingSlug, briefingSlug),
      ),
    )
    .limit(1);

  // Don't distinguish "wrong owner" from "comment doesn't exist" — a
  // mismatch shouldn't leak which IDs are valid.
  if (
    !row ||
    !row.visitorTokenHash ||
    row.visitorTokenHash !== visitorHash ||
    row.status !== "approved"
  ) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const ageMs = Date.now() - new Date(row.createdAt).getTime();
  if (ageMs > EDIT_WINDOW_MINUTES * 60_000) {
    return NextResponse.json(
      { ok: false, error: "window_closed" },
      { status: 410 },
    );
  }
  if (row.editCount >= EDIT_COUNT_MAX) {
    return NextResponse.json(
      { ok: false, error: "edit_limit" },
      { status: 429 },
    );
  }

  // No-op: same body, no point updating.
  if (newBody === row.body) {
    return NextResponse.json({ ok: true, status: "approved", noop: true });
  }

  const verdict = await moderateComment(newBody, { useLlm: true });
  const newStatus = verdict.ok ? "approved" : "blocked";
  const blockReason = verdict.ok ? null : verdict.reason;
  const editedAt = new Date();

  await db
    .update(schema.mahasiswaComments)
    .set({
      body: newBody,
      status: newStatus,
      blockReason,
      editedAt,
      editCount: sql`${schema.mahasiswaComments.editCount} + 1`,
    })
    .where(eq(schema.mahasiswaComments.id, commentId));

  return NextResponse.json({
    ok: true,
    status: newStatus === "approved" ? "approved" : "pending",
    editedAt: editedAt.toISOString(),
  });
}

function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}
