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
  const buf = await readFile(filePath);
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
