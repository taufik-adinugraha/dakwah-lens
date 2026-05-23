import "server-only";
import { assetToDataUrl } from "./load";
import { findAsset, type FlyerImageAsset } from "./registry";
import type { ResolvedAssets } from "../layouts/types";

/**
 * Resolve every asset a layout might need into a data URL — single
 * Promise.all so disk reads happen in parallel, results cached
 * module-scope by `assetToDataUrl`.
 *
 * The `primary` slot is the chosen image for THIS composition (photo or
 * ornament). The rest are shared decorative SVGs — layouts pick which
 * to use based on their design language.
 */
export async function resolveAssets(
  primaryAsset: FlyerImageAsset,
): Promise<ResolvedAssets> {
  const shared = [
    "stars-row",
    "dots",
    "arabesque",
    "arch",
    "star8",
    "lantern",
    "calligraphy-frame",
  ] as const;

  // Resolve all shared assets first (each `findAsset` is its own
  // async call but they share the same registry cache).
  const sharedAssets = await Promise.all(
    shared.map(async (id) => {
      const a = await findAsset(id);
      if (!a) throw new Error(`Missing shared flyer asset: ${id}`);
      return a;
    }),
  );

  const [primary, ...rest] = await Promise.all([
    assetToDataUrl(primaryAsset),
    ...sharedAssets.map((a) => assetToDataUrl(a)),
  ]);

  const [starsRow, dotsPattern, arabesque, arch, star8, lantern, calligraphyFrame] = rest;

  return {
    primary,
    starsRow,
    dotsPattern,
    arabesque,
    arch,
    star8,
    lantern,
    calligraphyFrame,
  };
}
