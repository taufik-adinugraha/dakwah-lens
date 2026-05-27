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

  // Curated calm backgrounds for the du'a flyer — the DuaHero layout
  // rotates through these (by edition variant) so successive du'a
  // flyers don't all look the same. Resolved from literal disk paths
  // (robust if the DB rows were pruned; the files live in public/).
  const DUA_BG_SRCS = [
    "/flyer-assets/photos/quran-open.jpg",
    "/flyer-assets/photos/open-book.jpg",
    "/flyer-assets/photos/dome-interior.jpg",
    "/flyer-assets/photos/mosque-interior.jpg",
  ];
  const duaBgAssets: FlyerImageAsset[] = DUA_BG_SRCS.map((src, i) => ({
    id: `dua-bg-${i}`,
    kind: "photo",
    src,
    aspect: "1:1",
    tags: ["quran", "calm"],
  }));

  const results = await Promise.all([
    assetToDataUrl(primaryAsset),
    ...duaBgAssets.map((a) => assetToDataUrl(a)),
    ...sharedAssets.map((a) => assetToDataUrl(a)),
  ]);

  const primary = results[0];
  const duaBackgrounds = results.slice(1, 1 + duaBgAssets.length);
  const [starsRow, dotsPattern, arabesque, arch, star8, lantern, calligraphyFrame] =
    results.slice(1 + duaBgAssets.length);

  return {
    primary,
    duaBackgrounds,
    starsRow,
    dotsPattern,
    arabesque,
    arch,
    star8,
    lantern,
    calligraphyFrame,
  };
}
