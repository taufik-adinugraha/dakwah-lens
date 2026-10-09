// CI-only: screenshot key module pages from the real image (started by the
// workflow on :3300) at phone and desktop widths, for visual review of each
// PR without running anything on a developer laptop. Output: ./shots/*.png
import { mkdir } from "node:fs/promises";

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const PAGES = [
  ["home", "/belajar/id"],
  ["surah", "/belajar/id/al-fatihah"],
  ["ayah-2", "/belajar/id/al-fatihah/2"],
  ["ayah-7", "/belajar/id/al-fatihah/7"],
  ["konsep", "/belajar/id/konsep"],
  ["kredit", "/belajar/id/kredit"],
];
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }, 2],
  ["desktop", { width: 1280, height: 900 }, 1],
];

await mkdir("shots", { recursive: true });
const browser = await chromium.launch();
try {
  for (const [vp, viewport, scale] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "id-ID" });
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
      console.log(`shot ${vp}-${name} (${path})`);
    }
    // First concept and vocabulary pages, discovered from the links.
    for (const [name, sel] of [["konsep-item", 'a[href*="/konsep/"]'], ["kosakata-item", 'a[href*="/kosakata/"]']]) {
      await page.goto(BASE + (name === "konsep-item" ? "/belajar/id/konsep" : "/belajar/id/al-fatihah/2"), { waitUntil: "networkidle" });
      const href = await page.locator(sel).first().getAttribute("href").catch(() => null);
      if (!href) continue;
      await page.goto(new URL(href, BASE).toString(), { waitUntil: "networkidle" });
      await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
      console.log(`shot ${vp}-${name} (${href})`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
