import "server-only";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { db, schema } from "@/db";
import { renderUserFlyerPng } from "@/lib/user-flyer/render";

/**
 * GET /api/user-flyers/[id]/png — render PNG for a user-generated flyer.
 *
 * Access rules:
 *   - public flyers: anyone (including anonymous)
 *   - private flyers: owner only
 *
 * Returns 1080×1080 PNG. Same Puppeteer pipeline the briefing flyer
 * endpoint uses (renderFlyerPng). 5-minute browser cache so a user
 * sharing the URL doesn't hammer the renderer.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [row] = await db
    .select({
      id: schema.userFlyers.id,
      userId: schema.userFlyers.userId,
      layout: schema.userFlyers.layout,
      imageRef: schema.userFlyers.imageRef,
      headline: schema.userFlyers.headline,
      body: schema.userFlyers.body,
      daleelCitation: schema.userFlyers.daleelCitation,
      daleelArabic: schema.userFlyers.daleelArabic,
      daleelTranslation: schema.userFlyers.daleelTranslation,
      daleelCorpus: schema.userFlyers.daleelCorpus,
      visibility: schema.userFlyers.visibility,
      createdAt: schema.userFlyers.createdAt,
    })
    .from(schema.userFlyers)
    .where(eq(schema.userFlyers.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (row.visibility !== "public") {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== row.userId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
  }

  let png: Buffer;
  try {
    png = await renderUserFlyerPng({
      id: row.id,
      layout: row.layout,
      imageRef: row.imageRef,
      headline: row.headline,
      body: row.body,
      daleelCitation: row.daleelCitation,
      daleelArabic: row.daleelArabic,
      daleelTranslation: row.daleelTranslation,
      daleelCorpus: row.daleelCorpus,
      createdAt: row.createdAt,
    });
  } catch (err) {
    console.error("[user-flyers] render failed:", err);
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
