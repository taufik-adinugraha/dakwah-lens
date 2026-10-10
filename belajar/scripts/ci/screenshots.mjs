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
];
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }, 2],
  ["desktop", { width: 1280, height: 900 }, 1],
];

/**
 * The autoplay lesson on Al-Fatihah 2 (a real browser, the real image):
 *   1. the stage before "Mulai";
 *   2. after the one tap, jumped to the first word's explanation;
 *   3. the first exercise inside the stage, with the spotlight ring + label
 *      (stage, and what a phone shows in the viewport with the sticky bar).
 * "Berikutnya ›" jumps whole steps, so this neither waits for the reading
 * timers nor depends on the imam's stream (a failed recording only pauses
 * the lesson; the jumps still work). It fails the job if the stage never
 * reaches an exercise or the spotlight never appears: that is the check
 * that the autoplay really runs in a browser.
 */
async function autoplayShots(page, vp) {
  await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator('[data-autoplay="stage"]');
  await stage.screenshot({ path: `shots/${vp}-autoplay-1-ready.png` });
  console.log(`shot ${vp}-autoplay-1-ready`);

  await page.locator('[data-autoplay="start"]').click();
  const next = page.locator('[data-autoplay="next"]');
  // Step 1 intro → 2 the ayah → 3 the imam says word 1 → 4 its explanation.
  for (let i = 0; i < 3; i++) {
    await next.click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  await stage.screenshot({ path: `shots/${vp}-autoplay-2-explain.png` });
  console.log(`shot ${vp}-autoplay-2-explain`);

  const exercise = page.locator('[data-autoplay="exercise"]');
  for (let i = 0; i < 40 && (await exercise.count()) === 0; i++) {
    await next.click();
    await page.waitForTimeout(200);
  }
  await exercise.waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("[data-spotlight-ring]").first().waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1200);
  await stage.screenshot({ path: `shots/${vp}-autoplay-3-exercise.png` });
  console.log(`shot ${vp}-autoplay-3-exercise`);
  await page.screenshot({ path: `shots/${vp}-autoplay-3-exercise-viewport.png` });
  console.log(`shot ${vp}-autoplay-3-exercise-viewport`);
  // Leave the page quiet for whatever comes next.
  await page.goto("about:blank");
}

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
    await autoplayShots(page, vp);
    await ctx.close();
  }
} finally {
  await browser.close();
}
