import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { readAttachment } from "@/lib/attachments";
import { requireSuperadmin } from "@/lib/superadmin";

/**
 * Auth-gated attachment download.
 *
 *   GET /api/admin/attachments/manual-cost/<row-id>
 *   GET /api/admin/attachments/donation/<row-id>
 *
 * Streams the file with the original filename in
 * `Content-Disposition: attachment` so the browser triggers a download
 * with a sensible name. Returns 404 for unknown rows or missing files
 * (e.g. backup-restore mismatch), 403 for non-superadmin requests.
 *
 * Two kinds, two tables — kept as parallel branches rather than a
 * dynamic table lookup because the `db.select(...).from(...)` typing
 * doesn't compose cleanly across tables and the savings would be
 * minimal.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ kind: string; id: string }> },
) {
  // Throws redirect to /dashboard for non-superadmin. The redirect
  // wouldn't reach the browser as a 302 from a route handler — it'd
  // bubble as an error — so callers see a 500 instead, which is
  // unhelpful but rare (only fires if someone with admin but not
  // superadmin role tries to hit this URL).
  await requireSuperadmin();

  const { kind, id } = await ctx.params;
  if (!id || (kind !== "manual-cost" && kind !== "donation")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let row:
    | {
        attachmentPath: string | null;
        attachmentFilename: string | null;
        attachmentMimeType: string | null;
      }
    | undefined;
  if (kind === "manual-cost") {
    [row] = await db
      .select({
        attachmentPath: schema.manualCosts.attachmentPath,
        attachmentFilename: schema.manualCosts.attachmentFilename,
        attachmentMimeType: schema.manualCosts.attachmentMimeType,
      })
      .from(schema.manualCosts)
      .where(eq(schema.manualCosts.id, id))
      .limit(1);
  } else {
    [row] = await db
      .select({
        attachmentPath: schema.donations.attachmentPath,
        attachmentFilename: schema.donations.attachmentFilename,
        attachmentMimeType: schema.donations.attachmentMimeType,
      })
      .from(schema.donations)
      .where(eq(schema.donations.id, id))
      .limit(1);
  }

  if (!row?.attachmentPath) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bytes = await readAttachment(row.attachmentPath);
  if (!bytes) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const filename = row.attachmentFilename ?? "attachment";
  const mime = row.attachmentMimeType ?? "application/octet-stream";

  // Copy the Buffer into a fresh ArrayBuffer-backed Uint8Array so
  // the Response body type is unambiguously `BodyInit`. Passing the
  // Node Buffer directly trips TS's `Uint8Array<ArrayBuffer |
  // SharedArrayBuffer>` variance check.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
