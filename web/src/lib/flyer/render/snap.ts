import "server-only";
import type { Page } from "puppeteer";
import { getBrowser } from "./browser";
import { FLYER_HEIGHT, FLYER_WIDTH } from "../design";

/**
 * Shrink-to-fit pass. Any element marked `data-autofit` (a BOUNDED box —
 * flex `flex-1 min-h-0`, or an explicit height/max-height + overflow
 * hidden) gets its text scaled DOWN (never up) until its content no
 * longer overflows — `scrollHeight ≤ clientHeight` and `scrollWidth ≤
 * clientWidth` — or its text hits `data-fit-min` (px).
 *
 * It scales every text-bearing descendant proportionally (or the
 * element itself when it's a text leaf), so one attribute on a card
 * fits the whole card — translation + citation + Arabic shrink together
 * and keep their relative hierarchy.
 *
 * This replaces the old "tier the font by character count + hard-clip
 * the overflow + truncate the string" approach, which guessed at sizing
 * and still clipped long Arabic du'a / long hadith translations.
 * Auto-fit measures the real rendered box (after fonts load) so nothing
 * gets cut. Runs AFTER fonts settle.
 */
async function applyAutofit(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-autofit]"),
    );
    for (const card of cards) {
      const min = parseFloat(card.getAttribute("data-fit-min") || "12");
      const kids = Array.from(card.querySelectorAll<HTMLElement>("*"));
      const nodes = kids.length ? kids : [card];
      const bases = nodes.map(
        (n) => parseFloat(getComputedStyle(n).fontSize) || 16,
      );
      const overflowing = () =>
        card.scrollHeight > card.clientHeight + 1 ||
        card.scrollWidth > card.clientWidth + 1;
      let scale = 1;
      let guard = 80;
      while (guard-- > 0 && scale > 0.45 && overflowing()) {
        scale -= 0.03;
        nodes.forEach((n, i) => {
          n.style.fontSize = `${Math.max(min, bases[i] * scale)}px`;
        });
      }
    }
  });
}

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
    // Shrink-to-fit any `data-autofit` text now that fonts are loaded
    // (so measurements are accurate), before the settle frame.
    await applyAutofit(page);
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
    await applyAutofit(page);
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
      // Tagged PDF was tried + reverted (2026-05-24): enabling it
      // collapses the rendered content height to ~65% of the A4
      // page (visible white band at the bottom of every poster).
      // Recent Chromium / Puppeteer versions DEFAULT this to true,
      // so simply omitting the option isn't enough — we have to
      // pass `tagged: false` explicitly to opt out. Accessibility
      // upgrade isn't worth the broken visual.
      tagged: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
