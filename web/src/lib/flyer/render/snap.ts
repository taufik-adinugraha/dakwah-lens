import "server-only";
import { getBrowser } from "./browser";
import { FLYER_HEIGHT, FLYER_WIDTH } from "../design";

/**
 * Render a self-contained HTML document to a 1080×1080 PNG.
 *
 * The caller passes a complete HTML document (with `<html>`, `<head>`,
 * `<body>`). We open it via `page.setContent` (no localhost round-trip),
 * wait for fonts + images to settle, then screenshot the body.
 *
 * Why not navigate to a real Next.js route instead? Two reasons:
 *   1. Avoids a Puppeteer-in-process → localhost-loopback dance that can
 *      deadlock under load when the dev server is single-process.
 *   2. setContent is faster (~200ms saved per render).
 *
 * Tailwind comes in via the Play CDN (`https://cdn.tailwindcss.com`),
 * which JITs the classes used in the HTML. ~250ms first-render cost,
 * cached by the browser across renders on the same Chromium instance.
 */

export async function snapHtmlToPng(
  html: string,
  options: { width?: number; height?: number; deviceScaleFactor?: number } = {},
): Promise<Buffer> {
  const width = options.width ?? FLYER_WIDTH;
  const height = options.height ?? FLYER_HEIGHT;
  // 1 = native 1080×1080. Bumping to 2 doubles file size for retina but
  // social platforms (IG, WA) downscale aggressively, so 1 is plenty.
  const deviceScaleFactor = options.deviceScaleFactor ?? 1;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor });
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    // Manual wait for network idle — setContent's waitUntil only
    // accepts "load" | "domcontentloaded", so we poll for fonts +
    // images to settle ourselves.
    await page.evaluate(async () => {
      // Wait for document.fonts (used by @font-face from Google) AND
      // all <img> elements to finish loading.
      const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
      const imgs = Array.from(document.images);
      const imgsReady = Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              }),
        ),
      );
      await Promise.all([fontsReady, imgsReady]);
    });
    // Wait one extra animation frame so any layout shift from Tailwind
    // JIT or font loading is settled.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const png = await page.screenshot({
      type: "png",
      omitBackground: false,
      clip: { x: 0, y: 0, width, height },
    });
    return Buffer.from(png);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Render a self-contained HTML document to an A4-portrait PDF.
 *
 * Same Puppeteer pipeline as `snapHtmlToPng`, but the output is a
 * vector PDF — `<a href>` tags become real clickable link annotations
 * in the PDF, CSS @page sets paper size, `printBackground` keeps the
 * gradient + photo backgrounds.
 *
 * Use for the printable poster + any other surface that benefits from
 * a tappable URL (vs the PNG, which is pixels-only).
 */
export async function snapHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // The viewport is the "screen size" Puppeteer renders at before
    // converting to PDF paper. 794×1123 ≈ A4 at 96 DPI, which keeps
    // CSS px ↔ PDF mm math clean (1 mm ≈ 3.78 px).
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    await page.evaluate(async () => {
      const fontsReady =
        (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
          ?.ready ?? Promise.resolve();
      const imgs = Array.from(document.images);
      const imgsReady = Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.addEventListener("load", () => resolve(), { once: true });
                img.addEventListener("error", () => resolve(), { once: true });
              }),
        ),
      );
      await Promise.all([fontsReady, imgsReady]);
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
