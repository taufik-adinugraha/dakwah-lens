/**
 * Local-filesystem attachment storage for admin-uploaded invoices
 * (manual costs) and donation receipts.
 *
 * Why local disk, not object storage: matches the UU PDP §17 data-
 * residency commitment in the privacy policy by keeping everything
 * inside the IDCloudHost VPS. Tradeoff: backups need to include the
 * UPLOAD_DIR alongside the Postgres dump.
 *
 * Storage shape: <UPLOAD_DIR>/<uuid>.<ext> — never uses the user's
 * filename for the on-disk path. The original filename + size + MIME
 * type are persisted on the owning row so the download endpoint can
 * stream the file back with a sensible Content-Disposition.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/** ~5 MB cap. Bumping this means every receipt sits in memory for
 *  the duration of the upload — Node server actions buffer the
 *  request body, so don't make this huge. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Curated allow-list. Invoices are PDFs in practice; the image
 *  formats cover phone photos of paper receipts. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Subdirectory under the upload root for each kind. Keeps invoices
 *  and donation receipts in separate folders for easier backup +
 *  audit, even though they share the same column shape. */
export type AttachmentKind = "manual-cost" | "donation";

export type AttachmentMeta = {
  path: string;
  filename: string;
  sizeBytes: number;
  mimeType: AllowedMimeType;
};

/** Root upload directory. Defaults to `./data/attachments` relative
 *  to the Node process cwd (i.e. the `web/` folder in dev, the
 *  deployed app root in prod). Override via `UPLOAD_DIR` env var so
 *  prod can point at a mounted volume (e.g. `/data/attachments`) that
 *  survives container restarts. */
function uploadRoot(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "attachments");
}

function extFromMime(mime: AllowedMimeType): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
  }
}

/** Strip directory components from the user's filename and cap length.
 *  We never use this for the storage path (we use a UUID for that),
 *  but the download endpoint serves it back as Content-Disposition. */
function sanitizeFilename(name: string): string {
  // Take just the basename, strip anything that isn't a sensible
  // filename character. Allow spaces; the HTTP layer encodes them.
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").trim();
  const trimmed = cleaned.length > 0 ? cleaned : "file";
  return trimmed.slice(0, 200);
}

/** Type-guarded MIME check. */
export function isAllowedMime(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Persist a File from a server-action FormData to the upload dir.
 * Returns the metadata to store on the owning DB row. Throws on
 * validation failure; callers should catch + surface a friendly error.
 */
export async function writeAttachment(
  kind: AttachmentKind,
  file: File,
): Promise<AttachmentMeta> {
  if (!file || file.size === 0) {
    throw new Error("attachment_empty");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment_too_large");
  }
  if (!isAllowedMime(file.type)) {
    throw new Error("attachment_unsupported_type");
  }

  const dir = path.join(uploadRoot(), kind);
  await fs.mkdir(dir, { recursive: true });

  const ext = extFromMime(file.type);
  const id = randomUUID();
  const relativePath = `${kind}/${id}.${ext}`;
  const absolutePath = path.join(uploadRoot(), relativePath);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absolutePath, buffer);

  return {
    path: relativePath,
    filename: sanitizeFilename(file.name || `${id}.${ext}`),
    sizeBytes: file.size,
    mimeType: file.type,
  };
}

/** Resolve a stored relative path to its on-disk absolute path. */
export function resolveAttachment(relativePath: string): string {
  // Prevent path traversal — the relative path came from the DB but
  // belt-and-braces in case of column tampering.
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("attachment_invalid_path");
  }
  return path.join(uploadRoot(), normalized);
}

/** Read attachment bytes for the download endpoint. Returns null when
 *  the file is missing on disk (e.g. backup-restore mismatch) so the
 *  caller can render a 404 rather than 500. */
export async function readAttachment(
  relativePath: string,
): Promise<Buffer | null> {
  try {
    const abs = resolveAttachment(relativePath);
    return await fs.readFile(abs);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/** Best-effort delete. Called from the delete actions for manual
 *  costs / donations. Missing files are not an error — they just
 *  mean the cleanup already happened (e.g. on a previous attempt). */
export async function deleteAttachment(
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) return;
  try {
    const abs = resolveAttachment(relativePath);
    await fs.unlink(abs);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    // Anything else: log but don't block the calling action. Losing
    // the row is more user-visible than leaving a dangling file.
    console.warn("[attachments] delete failed:", relativePath, err);
  }
}
