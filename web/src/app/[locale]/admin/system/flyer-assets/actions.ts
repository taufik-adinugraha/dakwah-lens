"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { logAdminAction } from "@/lib/admin-log";
import { requireSystemAccess } from "@/lib/superadmin";
import {
  invalidateAssetCache,
  type FlyerImageKind,
} from "@/lib/flyer/images/registry";

/**
 * Admin actions for the DB-backed flyer asset registry.
 *
 * Both upload + delete go through `requireSystemAccess()` (admin OR
 * superadmin — non-superadmin admins are intentionally allowed because
 * adding decorative assets is low-risk).
 *
 * Files land under web/public/flyer-assets/uploads/<uuid>.<ext>. The
 * UUID prevents filename collisions across uploads; the original
 * filename is NOT preserved (no security or user-facing reason to).
 *
 * In prod the uploads/ subdir is volume-mounted to the host (see
 * docker-compose.prod.yml) so files survive container rebuilds.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const VECTOR_MIME = new Set(["image/svg+xml"]);

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}$/;

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      throw new Error("unsupported_type");
  }
}

function uploadsDir(): string {
  return path.join(process.cwd(), "public", "flyer-assets", "uploads");
}

/**
 * Upload a new asset. Reads from a multipart FormData posted by the
 * admin page's <form>.
 *
 * Expected fields:
 *   - file       File (the asset itself)
 *   - id         string (kebab-case identifier, unique)
 *   - kind       "photo" | "ornament" | "pattern"
 *   - aspect     "1:1" | "wide" | "tall"
 *   - tags       comma-separated string
 *
 * Throws on validation failure with a single error code — caller
 * surfaces a friendly message.
 */
export async function uploadFlyerAssetAction(formData: FormData): Promise<void> {
  const session = await requireSystemAccess();
  const adminId = session.user!.id!;

  const raw = formData.get("file");
  if (!(raw instanceof File) || raw.size === 0) {
    throw new Error("file_required");
  }
  if (raw.size > MAX_BYTES) {
    throw new Error("file_too_large");
  }

  const idInput = String(formData.get("id") ?? "").trim().toLowerCase();
  const kindInput = String(formData.get("kind") ?? "").trim();
  const aspectInput = String(formData.get("aspect") ?? "").trim();
  const tagsInput = String(formData.get("tags") ?? "").trim();

  if (!ID_PATTERN.test(idInput)) throw new Error("invalid_id");

  if (kindInput !== "photo" && kindInput !== "ornament" && kindInput !== "pattern") {
    throw new Error("invalid_kind");
  }
  const kind = kindInput as FlyerImageKind;

  if (aspectInput !== "1:1" && aspectInput !== "wide" && aspectInput !== "tall") {
    throw new Error("invalid_aspect");
  }
  const aspect = aspectInput as "1:1" | "wide" | "tall";

  // Kind-specific MIME enforcement: photos must be raster, ornaments +
  // patterns must be SVG (so they tint with currentColor and scale).
  const allowed = kind === "photo" ? PHOTO_MIME : VECTOR_MIME;
  if (!allowed.has(raw.type)) {
    throw new Error("kind_mime_mismatch");
  }

  const tags = tagsInput
    ? tagsInput
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];
  if (tags.length > 12) throw new Error("too_many_tags");
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) throw new Error("invalid_tag");
  }

  // Reject duplicate id BEFORE writing the file to disk.
  const [existing] = await db
    .select({ id: schema.flyerAssets.id })
    .from(schema.flyerAssets)
    .where(eq(schema.flyerAssets.id, idInput))
    .limit(1);
  if (existing) throw new Error("id_taken");

  // Write file.
  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  const ext = extFromMime(raw.type);
  const filename = `${randomUUID()}.${ext}`;
  const absolute = path.join(dir, filename);
  const buf = Buffer.from(await raw.arrayBuffer());
  await fs.writeFile(absolute, buf);

  const src = `/flyer-assets/uploads/${filename}`;

  try {
    await db.insert(schema.flyerAssets).values({
      id: idInput,
      kind,
      src,
      aspect,
      tags,
      uploadedById: adminId,
    });
  } catch (err) {
    // Insert failed after the file was written — try to clean up the
    // orphaned file so the disk doesn't accumulate junk.
    await fs.unlink(absolute).catch(() => {});
    throw err;
  }

  await logAdminAction({
    actorId: adminId,
    action: "flyer_asset.upload",
    targetType: "flyer_asset",
    targetId: idInput,
    payload: { kind, src, aspect, tags },
  });

  invalidateAssetCache();
  revalidatePath("/[locale]/admin/system/flyer-assets", "page");
}

/** Delete an asset by id. Also removes the underlying file from disk
 *  when it lives in our uploads/ dir (seeded assets keep their files
 *  on disk — they're committed to the repo). */
export async function deleteFlyerAssetAction(formData: FormData): Promise<void> {
  const session = await requireSystemAccess();
  const adminId = session.user!.id!;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) throw new Error("id_required");

  const [row] = await db
    .select({
      id: schema.flyerAssets.id,
      src: schema.flyerAssets.src,
      uploadedById: schema.flyerAssets.uploadedById,
    })
    .from(schema.flyerAssets)
    .where(eq(schema.flyerAssets.id, id))
    .limit(1);
  if (!row) throw new Error("not_found");

  // Only delete files that live in our uploads/ dir. Seeded assets
  // (e.g. /flyer-assets/photos/mosque-night.jpg) stay on disk — they're
  // committed to the repo + restored by any clean checkout.
  if (row.src.startsWith("/flyer-assets/uploads/")) {
    const filename = path.basename(row.src);
    const absolute = path.join(uploadsDir(), filename);
    await fs.unlink(absolute).catch(() => {
      // Already gone — fine, DB row will still be removed below.
    });
  }

  await db.delete(schema.flyerAssets).where(eq(schema.flyerAssets.id, id));

  await logAdminAction({
    actorId: adminId,
    action: "flyer_asset.delete",
    targetType: "flyer_asset",
    targetId: id,
    payload: { src: row.src, uploadedById: row.uploadedById },
  });

  invalidateAssetCache();
  revalidatePath("/[locale]/admin/system/flyer-assets", "page");
}
