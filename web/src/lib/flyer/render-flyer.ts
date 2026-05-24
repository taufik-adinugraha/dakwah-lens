import "server-only";
import { createElement } from "react";

import { composeFlyer, type FlyerContext } from "./compose";
import { resolveAssets } from "./images/resolve";
import { LAYOUTS } from "./layouts";
import { buildHtmlDocument } from "./render/document";
import { snapHtmlToPdf, snapHtmlToPng } from "./render/snap";

/**
 * End-to-end: briefing context → composed flyer → PNG buffer.
 *
 * compose() picks layout + image + palette for this slot+edition,
 * resolveAssets() inlines every asset the layout might use as a data
 * URL, then we render the React tree to static HTML, wrap it in a
 * full HTML doc (Tailwind CDN + Amiri + Inter fonts), and screenshot
 * the result via Puppeteer.
 *
 * One function so every flyer endpoint stays a thin wrapper around
 * this single pipeline.
 */
export async function renderFlyerPng(ctx: FlyerContext): Promise<Buffer> {
  const { layoutId, composition, layoutVariant } = await composeFlyer(ctx);
  const assets = await resolveAssets(composition.image);

  const Layout = LAYOUTS[layoutId];
  const tree = createElement(Layout, {
    ...composition,
    assets,
    layoutVariant,
  });

  const html = await buildHtmlDocument(tree);
  return await snapHtmlToPng(html);
}

/**
 * A4 portrait PDF render of the Mahasiswa poster — same compose
 * pipeline (palette, image, content), but locked to the
 * `poster-question-a4` layout and rendered via `snapHtmlToPdf` so
 * the URL becomes a real clickable link annotation in the PDF.
 *
 * Throws if called for a slot that doesn't carry the poster
 * Mahasiswa content (we expect ctx.slot.kind === "poster"). The
 * caller's route guards that.
 */
export async function renderPosterPdf(ctx: FlyerContext): Promise<Buffer> {
  const { composition } = await composeFlyer(ctx);
  const assets = await resolveAssets(composition.image);

  const Layout = LAYOUTS["poster-question-a4"];
  const tree = createElement(Layout, {
    ...composition,
    assets,
    // A4 layout doesn't read layoutVariant — single canonical design.
    layoutVariant: 0,
  });

  // A4 portrait canvas — the wrapper used to hardcode 1080×1080
  // which produced a poster div filling only ~62% of the A4 page
  // (the famous white-band bug). Passing the mm dimensions makes
  // the wrapper match the PosterQuestionA4 layout's intent.
  const html = await buildHtmlDocument(tree, {
    width: "210mm",
    height: "297mm",
  });
  return await snapHtmlToPdf(html);
}
