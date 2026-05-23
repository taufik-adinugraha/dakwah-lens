/**
 * Image registry for the modular flyer system.
 *
 * DB-backed since 2026-05-23 (promoted from a hand-edited TS array so
 * admins can upload new assets via /admin/system/flyer-assets without
 * a code redeploy).
 *
 * Three asset categories:
 *   - "photo"   — raster JPGs (Unsplash CC0 or admin-uploaded)
 *   - "ornament" — single-color SVGs with `currentColor` fills, tint via CSS
 *   - "pattern"  — tileable SVGs
 *
 * Assets are read from the `flyer_assets` table on demand and cached in
 * memory for `CACHE_TTL_MS`. Admin upload/delete actions invalidate the
 * cache so new rows show up immediately for the next render.
 */

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/db";

export type FlyerImageKind = "pattern" | "ornament" | "photo";

export type FlyerImageAsset = {
  /** Stable identifier — used as the seed for deterministic selection. */
  id: string;
  kind: FlyerImageKind;
  /** Path relative to web root, e.g. "/flyer-assets/photos/mosque.jpg". */
  src: string;
  /** Aspect ratio of the asset itself. Photos are 1:1, ornaments vary. */
  aspect: "1:1" | "wide" | "tall";
  /** Free-form mood tags used by compose() to filter candidates. */
  tags: string[];
};

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  assets: FlyerImageAsset[];
  expiresAt: number;
};

let cache: CacheEntry | null = null;

function rowToAsset(row: {
  id: string;
  kind: string;
  src: string;
  aspect: string;
  tags: string[];
}): FlyerImageAsset {
  return {
    id: row.id,
    kind: row.kind as FlyerImageKind,
    src: row.src,
    aspect: row.aspect as FlyerImageAsset["aspect"],
    tags: row.tags ?? [],
  };
}

/**
 * Force the cache to be refreshed on next read. Called by admin
 * upload/delete actions so the new state is visible immediately.
 */
export function invalidateAssetCache(): void {
  cache = null;
}

/** Read every asset (cached up to CACHE_TTL_MS). */
export async function getAllAssets(): Promise<FlyerImageAsset[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.assets;
  }
  const rows = await db
    .select({
      id: schema.flyerAssets.id,
      kind: schema.flyerAssets.kind,
      src: schema.flyerAssets.src,
      aspect: schema.flyerAssets.aspect,
      tags: schema.flyerAssets.tags,
    })
    .from(schema.flyerAssets)
    .orderBy(asc(schema.flyerAssets.kind), asc(schema.flyerAssets.id));

  const assets = rows.map(rowToAsset);
  cache = { assets, expiresAt: Date.now() + CACHE_TTL_MS };
  return assets;
}

/** Filter the cached registry by kind. Returned arrays are NEW so
 *  callers can sort/pick without mutating the cache. */
export async function getAssetsByKind(
  kind: FlyerImageKind,
): Promise<FlyerImageAsset[]> {
  const all = await getAllAssets();
  return all.filter((a) => a.kind === kind);
}

/** Pick an asset by id — null if not registered. */
export async function findAsset(id: string): Promise<FlyerImageAsset | null> {
  const all = await getAllAssets();
  return all.find((a) => a.id === id) ?? null;
}

/** Bypass the cache and read directly — used by the admin list page so
 *  freshly-uploaded rows show up without a 60s lag. */
export async function getAllAssetsFresh(): Promise<
  Array<
    FlyerImageAsset & {
      uploadedById: string | null;
      createdAt: Date;
    }
  >
> {
  return await db
    .select({
      id: schema.flyerAssets.id,
      kind: schema.flyerAssets.kind,
      src: schema.flyerAssets.src,
      aspect: schema.flyerAssets.aspect,
      tags: schema.flyerAssets.tags,
      uploadedById: schema.flyerAssets.uploadedById,
      createdAt: schema.flyerAssets.createdAt,
    })
    .from(schema.flyerAssets)
    .orderBy(asc(schema.flyerAssets.kind), asc(schema.flyerAssets.id))
    .then((rows) =>
      rows.map((r) => ({
        ...rowToAsset(r),
        uploadedById: r.uploadedById,
        createdAt: r.createdAt,
      })),
    );
}

/** Delete by id. Caller is responsible for removing the underlying
 *  file from disk + invalidating the cache. */
export async function deleteAssetRow(id: string): Promise<void> {
  await db.delete(schema.flyerAssets).where(eq(schema.flyerAssets.id, id));
}
