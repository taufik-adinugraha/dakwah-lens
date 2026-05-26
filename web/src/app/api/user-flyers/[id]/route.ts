import "server-only";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db, schema } from "@/db";

/**
 * DELETE /api/user-flyers/[id] — delete one of the caller's own flyers.
 *
 * Auth-gated. Owners only — a 404 is returned for non-owners (we don't
 * leak existence). The `user_flyer_uploads` rows referenced by this
 * flyer's `image_ref` are NOT deleted — same upload can be reused
 * across flyers; orphan cleanup is a separate concern.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const res = await db
    .delete(schema.userFlyers)
    .where(
      and(
        eq(schema.userFlyers.id, id),
        eq(schema.userFlyers.userId, session.user.id),
      ),
    )
    .returning({ id: schema.userFlyers.id });

  if (res.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
