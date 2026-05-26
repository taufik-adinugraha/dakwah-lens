"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { db, schema } from "@/db";

/**
 * Server action — upload an image used as the visual for a user-generated
 * flyer. Auth-gated. Writes the file to
 * /public/flyer-assets/user-uploads/<uuid>.<ext> (volume-mounted in prod
 * so it survives container rebuilds — same pattern as the admin pool).
 *
 * Returns the new `user_flyer_uploads.id` so the caller can pass it to
 * the generate endpoint as `imageRef: "upload:<id>"`.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error("unsupported_type");
  }
}

function uploadsDir(): string {
  return path.join(
    process.cwd(),
    "public",
    "flyer-assets",
    "user-uploads",
  );
}

export async function uploadUserFlyerImage(formData: FormData): Promise<{
  uploadId: string;
  src: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("unauthorized");
  }

  const raw = formData.get("file");
  if (!(raw instanceof File) || raw.size === 0) {
    throw new Error("file_required");
  }
  if (raw.size > MAX_BYTES) {
    throw new Error("file_too_large");
  }
  if (!ACCEPTED_MIME.has(raw.type)) {
    throw new Error("unsupported_type");
  }

  const dir = uploadsDir();
  await fs.mkdir(dir, { recursive: true });
  const ext = extFromMime(raw.type);
  const filename = `${randomUUID()}.${ext}`;
  const absolute = path.join(dir, filename);
  const buf = Buffer.from(await raw.arrayBuffer());
  await fs.writeFile(absolute, buf);

  const src = `/flyer-assets/user-uploads/${filename}`;

  try {
    const [row] = await db
      .insert(schema.userFlyerUploads)
      .values({
        userId: session.user.id,
        src,
        mime: raw.type,
        sizeBytes: raw.size,
      })
      .returning({ id: schema.userFlyerUploads.id });
    return { uploadId: row.id, src };
  } catch (err) {
    await fs.unlink(absolute).catch(() => {});
    throw err;
  }
}
