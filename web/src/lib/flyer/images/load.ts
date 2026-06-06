import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { FlyerImageAsset } from "./registry";

/**
 * Read a flyer asset off disk and return an inlineable data URL.
 *
 * Puppeteer renders the flyer HTML via `setContent` (no base URL), so
 * relative paths to `/flyer-assets/...` would 404. Inlining as data:
 * URLs side-steps that — assets travel with the HTML, no network at
 * render time, no localhost dependency.
 *
 * Cached in module scope so the same asset isn't re-read on every
 * render. The public/ dir is immutable in production, so cache-forever
 * is safe.
 */

const cache = new Map<string, string>();

/** 1×1 transparent PNG — returned in place of a missing asset so one
 *  orphaned DB row (deleted upload, mis-synced volume, etc.) can't
 *  500 the entire flyer render. Sized to be ignorable when stretched
 *  into a layout's photo slot. The caller still gets a valid data URL,
 *  the puppeteer pipeline keeps flowing. */
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function publicPath(srcRelative: string): string {
  // `src` in the registry starts with "/flyer-assets/...". Strip the
  // leading slash and resolve against `public/`.
  const clean = srcRelative.replace(/^\//, "");
  return path.join(process.cwd(), "public", clean);
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function assetToDataUrl(asset: FlyerImageAsset): Promise<string> {
  const cached = cache.get(asset.src);
  if (cached) return cached;

  const filePath = publicPath(asset.src);
  let buf: Buffer;
  try {
    buf = await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Orphaned DB row (file uploaded then deleted, volume mismatch,
      // etc.). Fall back to a transparent pixel + cache so we don't
      // keep hammering the FS, and let the rest of the flyer render.
      // Upstream cleanup of the orphan row is the real fix; this just
      // prevents the entire flyer from 500ing on a single bad asset.
      console.warn(`[flyer] asset missing on disk, using transparent: ${asset.src}`);
      cache.set(asset.src, TRANSPARENT_PIXEL);
      return TRANSPARENT_PIXEL;
    }
    throw err;
  }
  const ext = path.extname(asset.src);
  const mime = mimeForExt(ext);
  let dataUrl: string;
  if (mime === "image/svg+xml") {
    // SVG can use either base64 or URL-encoded UTF-8. URL-encoded is
    // smaller AND allows `currentColor` to be tinted by parent CSS,
    // which is the whole point of using SVG for ornaments.
    const text = buf.toString("utf8");
    dataUrl = `data:${mime};utf8,${encodeURIComponent(text)}`;
  } else {
    dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  }
  cache.set(asset.src, dataUrl);
  return dataUrl;
}

/** Read SVG asset as raw markup (so we can drop it directly into the
 *  DOM and have `currentColor` work). For non-SVG, falls back to data
 *  URL — caller should branch on asset.src extension. */
export async function readSvgMarkup(asset: FlyerImageAsset): Promise<string> {
  const filePath = publicPath(asset.src);
  const text = await readFile(filePath, "utf8");
  return text;
}
