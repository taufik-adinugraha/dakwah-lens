import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/db";

/**
 * Fetch the approved replies under a single top-level comment.
 *
 *   GET /api/m/{slug}/comments/{commentId}/replies
 *       → { items: [...] } — oldest-first so a thread reads as a
 *         conversation.
 *
 * Replies are scoped to the same room as the parent. Status filter is
 * 'approved' only — blocked rows are invisible to public readers, same
 * as the top-level listing.
 *
 * No pagination: thread depth is capped at 1 (no reply-to-reply), and
 * per-room moderation keeps thread length manageable. If a thread ever
 * grows past ~50 replies the worst case is one heavier query — a
 * problem worth having.
 */
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id: briefingSlug, commentId } = await context.params;

  const rows = await db
    .select({
      id: schema.mahasiswaComments.id,
      displayName: schema.mahasiswaComments.displayName,
      body: schema.mahasiswaComments.body,
      createdAt: schema.mahasiswaComments.createdAt,
      editedAt: schema.mahasiswaComments.editedAt,
    })
    .from(schema.mahasiswaComments)
    .where(
      and(
        eq(schema.mahasiswaComments.parentId, commentId),
        eq(schema.mahasiswaComments.briefingSlug, briefingSlug),
        eq(schema.mahasiswaComments.status, "approved"),
      ),
    )
    .orderBy(asc(schema.mahasiswaComments.createdAt));

  return NextResponse.json({ items: rows });
}
