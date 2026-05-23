import "server-only";
import { createElement } from "react";

import { composeFlyer, type FlyerContext } from "./compose";
import { resolveAssets } from "./images/resolve";
import { LAYOUTS } from "./layouts";
import { buildHtmlDocument } from "./render/document";
import { snapHtmlToPng } from "./render/snap";

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
