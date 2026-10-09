// CI-only: screenshot key module pages from the real image (started by the
// workflow on :3300) at phone and desktop widths, for visual review of each
// PR without running anything on a developer laptop. Output: ./shots/*.png
import { mkdir } from "node:fs/promises";

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
// URL shape: plan L9 (hub → /quran track; Konsep/Kosakata at hub level).
const AYAH_2 = "/belajar/id/quran/al-fatihah/2";
const PAGES = [
  ["hub", "/belajar/id"],
  ["track", "/belajar/id/quran"],
  ["surah", "/belajar/id/quran/al-fatihah"],
  ["ayah-2", AYAH_2],
  ["ayah-7", "/belajar/id/quran/al-fatihah/7"],
  ["ikhlas-1", "/belajar/id/quran/al-ikhlas/1"],
  ["nas-6", "/belajar/id/quran/an-nas/6"],
  ["konsep", "/belajar/id/konsep"],
  ["kredit", "/belajar/id/kredit"],
  // Ilmu Waris (docs/waris-plan.md §9.1): track home, the questionnaire's first screen, and the
  // report page with no answers (its "start" notice). Filled reports, print and reduced-motion
  // shots come from waris-e2e.mjs (waris-*.png).
  ["waris", "/belajar/id/waris"],
  ["waris-hitung", "/belajar/id/waris/hitung"],
  ["waris-laporan-kosong", "/belajar/id/waris/laporan"],
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
    for (const [name, from, sel] of [
      ["konsep-item", "/belajar/id/konsep", 'a[href*="/konsep/"]'],
      ["kosakata-item", AYAH_2, 'a[href*="/kosakata/"]'],
    ]) {
      await page.goto(BASE + from, { waitUntil: "networkidle" });
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
