/**
 * Vetted du'a-flyer background pool.
 *
 * The DuaHero (slot-6 "Doa Pekan Ini") layout floats a centered opaque
 * white card over one of these photos; the photo shows as a frame around
 * the card's edges. To keep successive du'a flyers from looking
 * identical, compose.ts picks one of these by a content-derived hash and
 * resolves ONLY that one to a data URL (vs. resolving the whole pool per
 * render).
 *
 * Curated 2026-06-26 by a vision pass over the full 205-photo asset
 * library (70 of 205 kept): each image was visually classified as a
 * clean / calm / on-theme Islamic or serene-nature frame with no
 * embedded text, no prominent faces, and no garish/busy edges, then
 * adversarially re-checked. Literal `src` paths (not DB ids) so the pool
 * survives registry pruning. DO NOT hand-edit individual entries to
 * "kind-of-fits" photos — re-run the curation pass instead.
 */
export const DUA_BACKGROUND_SRCS: readonly string[] = [
  "/flyer-assets/photos/mosque-interior.jpg",
  "/flyer-assets/photos/quran-open.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-01-oawplyM6.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-02-6NiUh7ZP.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-03-fSdjQO8r.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-04-kXoEdaZ3.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-07-KW1SLscF.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-11-rARwqh9I.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-12-_OQ17__L.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-16-i-nbFnz8.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-17-Y678onxF.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-18-Vr_Ox50Q.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-23-r4M3EY2w.jpg",
  "/flyer-assets/photos/uploads/indonesia-nature-25-4Fzp6z40.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-03-fk_RMyFK.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-06-iZf6K_OC.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-12-bB0H-7PE.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-14-UumoXmNz.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-15-8rDPYpI1.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-19-Q4XF0fCw.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-20-LiWrNTFI.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-21-LgRpWcrH.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-22-XJI2zF_B.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-23-LOFvEAtK.jpg",
  "/flyer-assets/photos/uploads/islamic-calligraphy-25-QvTIxJwC.jpg",
  "/flyer-assets/photos/uploads/mosque-01-D5xvlpBt.jpg",
  "/flyer-assets/photos/uploads/mosque-04-_yhAaEfN.jpg",
  "/flyer-assets/photos/uploads/mosque-09-xGuVofvh.jpg",
  "/flyer-assets/photos/uploads/mosque-11-bb50ODCt.jpg",
  "/flyer-assets/photos/uploads/mosque-14-B-TUPhhc.jpg",
  "/flyer-assets/photos/uploads/mosque-16-mrH9CATf.jpg",
  "/flyer-assets/photos/uploads/mosque-17-Cg-HD932.jpg",
  "/flyer-assets/photos/uploads/mosque-20-DSkhHXdi.jpg",
  "/flyer-assets/photos/uploads/mosque-21-c-ijf9Bp.jpg",
  "/flyer-assets/photos/uploads/mosque-23-QmVp8x13.jpg",
  "/flyer-assets/photos/uploads/mosque-detail-03-V9YdTVV_.jpg",
  "/flyer-assets/photos/uploads/mosque-detail-06-hXIH78Zg.jpg",
  "/flyer-assets/photos/uploads/mosque-detail-19-4dpXJh5I.jpg",
  "/flyer-assets/photos/uploads/mosque-detail-23-waL6iN6b.jpg",
  "/flyer-assets/photos/uploads/nature-extra-02-MjhtSHj5.jpg",
  "/flyer-assets/photos/uploads/nature-extra-03-LNY1xlnc.jpg",
  "/flyer-assets/photos/uploads/nature-extra-04-AV9Y3kRc.jpg",
  "/flyer-assets/photos/uploads/nature-extra-05-gcKKWl8l.jpg",
  "/flyer-assets/photos/uploads/nature-extra-10-j9U9yw5L.jpg",
  "/flyer-assets/photos/uploads/nature-extra-18-HiW3AeTg.jpg",
  "/flyer-assets/photos/uploads/nature-extra-20-mY7Bm6Is.jpg",
  "/flyer-assets/photos/uploads/nature-extra-21-wHhuWXGi.jpg",
  "/flyer-assets/photos/uploads/nature-extra-23-f5idoAO4.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-01-3Bsw31s1.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-02-AaNNuyN8.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-03-rdE5QcMS.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-04-qIhrkPtv.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-05-HFn0mFCQ.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-08-LhD5dmoh.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-09-eKpBUgbS.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-10-0zlJK2Ax.jpg",
  "/flyer-assets/photos/uploads/night-cosmos-13-tLUAqlbx.jpg",
  "/flyer-assets/photos/uploads/prayer-objects-21-j2xcowPA.jpg",
  "/flyer-assets/photos/uploads/quran-2.jpg",
  "/flyer-assets/photos/uploads/quran-3.jpg",
  "/flyer-assets/photos/uploads/quran-4.jpg",
  "/flyer-assets/photos/uploads/quran-5.jpg",
  "/flyer-assets/photos/uploads/quran-7.jpg",
  "/flyer-assets/photos/uploads/quran-8.jpg",
  "/flyer-assets/photos/uploads/sky-light-02-cYDerOoL.jpg",
  "/flyer-assets/photos/uploads/sky-light-04-a5rm25OL.jpg",
  "/flyer-assets/photos/uploads/sky-light-05-kRmotVOb.jpg",
  "/flyer-assets/photos/uploads/sky-light-18-3OS_gppe.jpg",
  "/flyer-assets/photos/uploads/sky-light-19-1QJ2Dr79.jpg",
  "/flyer-assets/photos/uploads/sky-light-20-ALBNfhBW.jpg",
];
