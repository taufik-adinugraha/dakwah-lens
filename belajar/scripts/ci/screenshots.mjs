// CI-only: screenshot key module pages from the real image (started by the
// workflow on :3300) at phone and desktop widths, for visual review of each
// PR without running anything on a developer laptop. Output: ./shots/*.png
//
// Three runs, one container each. By default: the module as production shows
// it, from a container with neither switch set (src/lib/features.ts): Ilmu
// Waris hidden (since 2026-10-10) and the Qur'an track on Al-Fatihah only
// (operator, 2026-10-10: the Mu'awwidzat "segera hadir", not clickable),
// including the 404 a hidden waris or surah URL answers, the "Segera hadir"
// cards (checked: no link, nothing to focus) and the end of Al-Fatihah
// (checked: the next surah is coming soon, nothing to click, no move).
// `--waris`: only the Ilmu Waris pages, from a container started with
// BELAJAR_WARIS=on. `--surahs`: the Mu'awwidzat lessons, from a container
// started with every surah in BELAJAR_SURAHS (the end of Al-Fatihah then
// offers Al-Ikhlas).
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

// The narration audio for the karaoke shots (browser-side only), shared with linebreaks.mjs.
// The workflow copies narration-route.mjs next to this script.
import { BELAJAR_DIR, isNarration, narrationIndex, narrationRoute } from "./narration-route.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
// URL shape: plan L9 (hub → /quran track; Konsep/Kosakata at hub level).
const AYAH_1 = "/belajar/id/quran/al-fatihah/1";
const AYAH_2 = "/belajar/id/quran/al-fatihah/2";
const PAGES = [
  ["hub", "/belajar/id"],
  ["track", "/belajar/id/quran"],
  ["surah", "/belajar/id/quran/al-fatihah"],
  ["ayah-2", AYAH_2],
  ["ayah-7", "/belajar/id/quran/al-fatihah/7"],
  ["konsep", "/belajar/id/konsep"],
  // Konsep with every term in Arabic (operator 2026-10-10): the Harakat page (Dasar membaca) and
  // the operator's model page, huruf jar, with its parts diagram.
  ["konsep-harakat", "/belajar/id/konsep/harakat"],
  ["konsep-huruf-jar", "/belajar/id/konsep/huruf-jar"],
  ["kredit", "/belajar/id/kredit"],
  // What a visitor gets at a hidden address: the module's own 404.
  ["waris-tersembunyi-404", "/belajar/id/waris"],
  ["ikhlas-tersembunyi-404", "/belajar/id/quran/al-ikhlas/1"],
];
// The Mu'awwidzat (hidden on the live site), `--surahs` only: the track with every surah a link,
// and a lesson of two of them.
const SURAH_PAGES = [
  ["track-semua-surah", "/belajar/id/quran"],
  ["ikhlas-1", "/belajar/id/quran/al-ikhlas/1"],
  ["nas-6", "/belajar/id/quran/an-nas/6"],
];
/** The surahs the default (production-like) container does not publish (lib/features.ts). */
const HIDDEN_SURAHS = ["al-ikhlas", "al-falaq", "an-nas"];
const AYAH_7 = "/belajar/id/quran/al-fatihah/7";
// Ilmu Waris (docs/waris-plan.md §9.1), `--waris` only: track home, the questionnaire's first
// screen, and the report page with no answers (its "start" notice). Filled reports, print and
// reduced-motion shots come from waris-e2e.mjs (waris-*.png).
const WARIS_PAGES = [
  ["waris", "/belajar/id/waris"],
  ["waris-hitung", "/belajar/id/waris/hitung"],
  ["waris-laporan-kosong", "/belajar/id/waris/laporan"],
];
const WARIS_ONLY = process.argv.includes("--waris");
const SURAHS_ON = process.argv.includes("--surahs");
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }, 2],
  ["desktop", { width: 1280, height: 900 }, 1],
];

/**
 * Waits until the page has stopped scrolling. Right after "Mulai" the stage scrolls itself up once,
 * smoothly (LessonStage), and the next Playwright click would cut that scroll short wherever it
 * stands: its scroll-into-view is a programmatic scroll, which a learner's tap never makes (CI
 * 2026-10-11: the stage stood 80px short of the top, the word card under the panel). So the checks
 * see the page where a learner sees it. The playing stage first: after the click the button says
 * "Menyiapkan pelajaran…" until the first line is heard or shown (2026-10-11), and only then does
 * the stage appear and scroll. Animation frames awaited in the page (page.evaluate), never
 * waitForFunction (the CSP refuses its eval).
 */
async function settleScroll(page) {
  await page.locator('[data-autoplay="panel"]').first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(150);
  return page.evaluate(
    () =>
      new Promise((done) => {
        let last = window.scrollY;
        let still = 0;
        let frames = 0;
        const tick = () => {
          const y = window.scrollY;
          still = y === last ? still + 1 : 0;
          last = y;
          if (still >= 12 || ++frames > 300) done(y);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * "Berikutnya ›" until the lesson is on step `id` — the stage's data-step (LessonStage: "intro",
 * "primer", "w1:recite", "w1", "w1:compose", …): a step is reached by what it is, never by a count
 * of clicks (the harakat primer and the composition steps, 2026-10-10, moved every step after them
 * and the karaoke check landed on a composition line). The lesson is paused first ("Jeda"), so it
 * cannot move on by itself between a look and a click (a step that ends on its own just then would
 * be jumped over): each "Berikutnya ›" then enters the next step paused, and the caller starts the
 * step with "↺ Ulangi" (it plays a step from its start, paused or not). Fails naming the steps it
 * passed.
 */
async function toStep(page, vp, id) {
  const stage = page.locator('[data-autoplay="stage"]');
  const next = page.locator('[data-autoplay="next"]');
  const middle = page.locator('[data-autoplay="middle"]');
  const pause = async () => {
    if ((await middle.getAttribute("data-mode").catch(() => null)) !== "pause") return;
    await middle.click();
    await page.waitForTimeout(150);
  };
  const seen = [];
  for (let i = 0; i < 80; i++) {
    await pause();
    const at = await stage.getAttribute("data-step");
    if (at === id) return;
    if (at && seen.at(-1) !== at) seen.push(at);
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(250);
  }
  throw new Error(`${vp}: the lesson never reached step "${id}" (passed: ${seen.join(" → ") || "no step"})`);
}

/**
 * Line `id` of content/narration/<slug>.json as the lesson plays it — the whole line, or its split
 * parts "<id>:a", "<id>:b", … (src/lib/autoplay/ids.ts manifestParts) — with whether every part has
 * a rendered file and its word timings (what the karaoke caption follows). A line whose text
 * changed has neither until the narration is rendered again.
 */
async function narratedLine(slug, id) {
  const file = path.join("content", "narration", `${slug}.json`);
  const lines = JSON.parse(await readFile(path.join(BELAJAR_DIR, file), "utf8")).lines ?? {};
  const split = [];
  for (let c = 97; c <= 122 && Object.hasOwn(lines, `${id}:${String.fromCharCode(c)}`); c++) split.push(lines[`${id}:${String.fromCharCode(c)}`]);
  const parts = Object.hasOwn(lines, id) ? [lines[id]] : split.length >= 2 ? split : [];
  // As src/lib/autoplay/narration.ts usableAudio / usableTokens take them (else caption-only).
  const voiced = (l) =>
    typeof l?.audio?.url === "string" &&
    l.audio.url.startsWith("/belajar/media/narration/") &&
    Number.isInteger(l.audio.ms) &&
    l.audio.ms > 0 &&
    /^[0-9a-f]{64}$/.test(l.audio.sha256 ?? "") &&
    Array.isArray(l.tokens) &&
    l.tokens.length > 0;
  return {
    file,
    exists: parts.length > 0,
    voiced: parts.length > 0 && parts.every(voiced),
    words: parts[0]?.tokens?.length ?? 0,
    // The file the lesson plays first for this line (its first part).
    url: parts[0]?.audio?.url ?? null,
  };
}

/**
 * The autoplay lesson on Al-Fatihah 2 (a real browser, the real image). Its narration is not routed
 * here, and on the runner every narration file 404s (the MP3s live in the VM media dir), rendered
 * or not, so this is the CAPTION-ONLY path a learner gets for every unrendered line:
 *   1. the stage before "Mulai pelajaran" (stage, and the viewport a learner lands on: header,
 *      short title, the one focused stage);
 *   2. the "⚙ Pengaturan" panel open (pace, imam speed, reciter, text size), then closed again;
 *   3. after the one click, jumped to the first word's explanation (step "w1", by name: toStep);
 *   4. the first exercise inside the stage, with the spotlight ring + label
 *      (stage, and what a phone shows in the viewport with the sticky bar).
 * "Berikutnya ›" jumps whole steps, so this neither waits for the reading
 * timers nor depends on the imam's stream (a failed recording only pauses
 * the lesson; the jumps still work). It fails the job if the settings panel does not open and
 * close, the stage never reaches an exercise or the spotlight never appears: that is the check
 * that the autoplay really runs in a browser.
 */
/**
 * Two controls share one row (their vertical centres within 4px) at the normal text size. On a
 * phone at an exercise, ‹ Sebelumnya and "Lewati latihan" wrapping made the panel three rows tall
 * over the exercise, and "Langkah 15 dari 21" pushed ⚙ Pengaturan onto a row of its own
 * (2026-10-10 shots). A larger text size may wrap them: that is the graceful fallback, not tested.
 */
async function assertSameRow(page, vp, a, b, what) {
  const [ba, bb] = [await page.locator(a).first().boundingBox(), await page.locator(b).first().boundingBox()];
  if (!ba || !bb) throw new Error(`${vp}: ${what} — not rendered`);
  const [ca, cb] = [ba.y + ba.height / 2, bb.y + bb.height / 2];
  if (Math.abs(ca - cb) > 4) throw new Error(`${vp}: ${what} wrapped onto two rows (centres ${Math.round(ca)} / ${Math.round(cb)})`);
  console.log(`  one row: ${what}`);
}

async function autoplayShots(page, vp) {
  await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const stage = page.locator('[data-autoplay="stage"]');
  await stage.screenshot({ path: `shots/${vp}-autoplay-1-ready.png` });
  console.log(`shot ${vp}-autoplay-1-ready`);
  await page.screenshot({ path: `shots/${vp}-autoplay-1-ready-viewport.png` });
  console.log(`shot ${vp}-autoplay-1-ready-viewport`);

  // Every secondary control sits behind the one "⚙ Pengaturan" button.
  const settingsToggle = page.locator('[data-autoplay="settings-toggle"]');
  const settings = page.locator('[data-autoplay="settings"]');
  await settingsToggle.click();
  await settings.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(200);
  await stage.screenshot({ path: `shots/${vp}-autoplay-settings-open.png` });
  console.log(`shot ${vp}-autoplay-settings-open`);
  await settingsToggle.click();
  await settings.waitFor({ state: "hidden", timeout: 5_000 });

  await page.locator('[data-autoplay="start"]').click();
  await settleScroll(page);
  const next = page.locator('[data-autoplay="next"]');
  // intro → the ayah → the imam says word 1 → its explanation, played from its start.
  await toStep(page, vp, "w1");
  await page.locator('[data-autoplay="replay"]').click();
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
  await assertSameRow(page, vp, '[data-autoplay="prev"]', '[data-autoplay="next"]', "‹ Sebelumnya and Lewati latihan");
  await assertSameRow(page, vp, '[data-autoplay="step"]', '[data-autoplay="settings-toggle"]', "Langkah N dari M and Pengaturan");
  await stage.screenshot({ path: `shots/${vp}-autoplay-3-exercise.png` });
  console.log(`shot ${vp}-autoplay-3-exercise`);
  await page.screenshot({ path: `shots/${vp}-autoplay-3-exercise-viewport.png` });
  console.log(`shot ${vp}-autoplay-3-exercise-viewport`);
  // Leave the page quiet for whatever comes next.
  await page.goto("about:blank");
}

/**
 * The header's one "Menu" button, open, on the hub (viewport): the panel holding Konsep tata
 * bahasa, Kembali ke Dakwah-Lens and Sumber & lisensi (no sign-in: operator, 2026-10-12). Escape closes it
 * again. Fails the job if the panel never opens or never closes.
 */
async function menuShots(page, vp) {
  await page.goto(BASE + "/belajar/id", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("[data-header-menu-toggle]").click();
  const menu = page.locator("[data-header-menu]");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `shots/${vp}-menu-open.png` });
  console.log(`shot ${vp}-menu-open`);
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden", timeout: 5_000 });
  await page.goto("about:blank");
}

// ─────────────── Brand, bridges to the main site, sharing (operator, 2026-10-10) ───────────────

const SIZES = [null, "besar", "sangat-besar"];
const MAIN = "https://dakwah-lens.id";
const UTM = (campaign) => `utm_source=belajar&utm_medium=referral&utm_campaign=${campaign}`;

/** Sets the learner's text size the way the "Aa" panel does (the attribute on <html>). */
async function setTextSizeAttr(page, size) {
  await page.evaluate((s) => {
    if (s) document.documentElement.dataset.textSize = s;
    else delete document.documentElement.dataset.textSize;
  }, size);
  await page.waitForTimeout(150);
}

/**
 * The header holds ONE brand mark (the Dakwah-Lens logo with "Dakwah-Lens" over "Belajar"), the
 * "Aa" button and ONE Menu, and stays uncluttered: measured on the hub and a lesson at every text
 * size. The logo is a rendered <img alt="Dakwah-Lens"> that actually loaded (next/image); each
 * of the two words stays on one line; nothing overlaps or scrolls sideways; "Aa" and Menu share
 * a row; the header is one row on the desktop and at most two on a phone (the buttons under the
 * mark: they do not fit beside it below about 440px). Shots of the header at the normal and the
 * largest size.
 */
async function headerShots(page, vp) {
  for (const path of ["/belajar/id", AYAH_1]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    for (const size of SIZES) {
      await setTextSizeAttr(page, size);
      const m = await page.locator("header").evaluate((header) => {
        const brand = header.querySelector("[data-brand]");
        const img = brand?.querySelector('img[alt="Dakwah-Lens"]');
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mid: r.top + r.height / 2 };
        };
        const lines = [...(brand?.querySelectorAll("span > span") ?? [])].map((s) => {
          const range = document.createRange();
          range.selectNodeContents(s);
          return { text: s.textContent, lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
        });
        const size = header.querySelector("[data-text-size-toggle]");
        const menu = header.querySelector("[data-header-menu-toggle]");
        return {
          img: img ? { loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc, w: img.getBoundingClientRect().width } : null,
          lines,
          brand: brand ? box(brand) : null,
          size: size ? box(size) : null,
          menu: menu ? box(menu) : null,
          height: header.getBoundingClientRect().height,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const where = `${vp} ${path} [${size ?? "normal"}]`;
      const problems = [];
      if (!m.img) problems.push('no <img alt="Dakwah-Lens"> in the brand mark');
      else if (!m.img.loaded) problems.push(`the logo did not load (${m.img.src})`);
      if (m.lines.length !== 2 || m.lines.some((l) => l.lines !== 1)) problems.push(`brand words wrap: ${JSON.stringify(m.lines)}`);
      if (!m.brand || !m.size || !m.menu) problems.push("brand, Aa or Menu not rendered");
      else {
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        if (overlap(m.brand, m.size) || overlap(m.brand, m.menu)) problems.push("the brand mark overlaps a button");
        if (Math.abs(m.size.mid - m.menu.mid) > 4) problems.push("Aa and Menu are not on one row");
        const rows = Math.abs(m.brand.mid - m.size.mid) > 4 ? 2 : 1;
        if (vp === "desktop" && rows !== 1) problems.push("the desktop header is not one row");
      }
      if (m.overflow > 0) problems.push(`the page scrolls sideways by ${m.overflow}px`);
      if (problems.length) throw new Error(`${where}: header — ${problems.join("; ")}`);
      console.log(`  header ok ${where}: ${Math.round(m.height)}px tall, logo ${Math.round(m.img.w)}px`);
      if (path === "/belajar/id" && size !== "besar") {
        await page.locator("header").screenshot({ path: `shots/${vp}-header-${size ?? "normal"}.png` });
        console.log(`shot ${vp}-header-${size ?? "normal"}`);
      }
    }
    await setTextSizeAttr(page, null);
  }
  await page.goto("about:blank");
}

/**
 * The footer's "Bagian dari Dakwah-Lens" (en "Part of Dakwah-Lens"): a rendered, visible link to
 * the main site's home in the page's locale, UTM-tagged; the AI label beside it is untouched.
 * Checked on the rendered element, not the HTML: next-intl ships every message in the page's
 * scripts, so the words alone prove nothing.
 */
async function footerCheck(page, vp) {
  for (const [locale, words] of [["id", "Bagian dari Dakwah-Lens"], ["en", "Part of Dakwah-Lens"]]) {
    await page.goto(`${BASE}/belajar/${locale}`, { waitUntil: "networkidle" });
    const link = page.locator('footer [data-main-site="footer"]');
    await link.waitFor({ state: "visible", timeout: 10_000 });
    const [href, label, height] = [await link.getAttribute("href"), (await link.innerText()).trim(), (await link.boundingBox())?.height ?? 0];
    const want = `${MAIN}/${locale}?${UTM("footer")}`;
    if (href !== want || label !== words || height < 47.5) {
      throw new Error(`${vp} /belajar/${locale}: footer link "${label}" → ${href} (${Math.round(height)}px); expected "${words}" → ${want}, ≥48px`);
    }
    if (locale === "id" && !(await page.locator("footer").innerText()).includes("Dibantu AI, bukan fatwa otoritatif")) {
      throw new Error(`${vp}: the footer's AI label is gone`);
    }
    console.log(`  footer ok ${vp} ${locale}: "${label}" → ${href}`);
  }
  await page.locator("footer").screenshot({ path: `shots/${vp}-footer-en.png` });
  console.log(`shot ${vp}-footer-en`);
  await page.goto("about:blank");
}

/**
 * "Bagikan" on Al-Fatihah ayah 1, under the ayah navigation: a 48px labelled button. On the CI
 * runner Chromium has no share sheet (Linux), so the fallback panel opens: "Kirim lewat WhatsApp"
 * (wa.me, the address tagged utm_source=share&utm_medium=whatsapp) and "Salin tautan", which
 * copies the address tagged utm_medium=share and says "Tautan disalin." (the context grants the
 * clipboard). Shots: phone + desktop, at the normal and the largest text size.
 */
async function shareShots(page, vp) {
  await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const share = page.locator("[data-share]");
  const toggle = page.locator("[data-share-toggle]");
  await toggle.scrollIntoViewIfNeeded();
  const url = `${MAIN}${AYAH_1}`;
  const hasSheet = await page.evaluate(() => typeof navigator.share === "function");
  for (const size of [null, "sangat-besar"]) {
    await setTextSizeAttr(page, size);
    const h = (await toggle.boundingBox())?.height ?? 0;
    if (h < 47.5) throw new Error(`${vp}: Bagikan is ${Math.round(h)}px tall (< 48)`);
  }
  await setTextSizeAttr(page, null);
  if (hasSheet) {
    console.log(`  ${vp}: this browser has a share sheet; the fallback panel is not exercised`);
  } else {
    await toggle.click();
    await page.locator("[data-share-panel]").waitFor({ state: "visible", timeout: 5_000 });
    const wa = await page.locator("[data-share-whatsapp]").getAttribute("href");
    const sent = new URL(wa).searchParams.get("text") ?? "";
    if (!wa.startsWith("https://wa.me/?text=") || !sent.endsWith(`${url}?utm_source=share&utm_medium=whatsapp`)) {
      throw new Error(`${vp}: WhatsApp link ${wa} does not carry ${url}?utm_source=share&utm_medium=whatsapp`);
    }
    await page.locator("[data-share-copy]").click();
    const status = page.locator("[data-share-status]");
    await status.filter({ hasText: "Tautan disalin" }).waitFor({ state: "visible", timeout: 5_000 });
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (copied !== `${url}?utm_source=share&utm_medium=share`) throw new Error(`${vp}: copied "${copied}"`);
    console.log(`  share ok ${vp}: WhatsApp → …utm_medium=whatsapp, copied ${copied}`);
    for (const size of [null, "sangat-besar"]) {
      await setTextSizeAttr(page, size);
      await share.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `shots/${vp}-share-${size ?? "normal"}.png` });
      console.log(`shot ${vp}-share-${size ?? "normal"}`);
    }
    await setTextSizeAttr(page, null);
  }
  await page.goto("about:blank");
}

/**
 * The end of a surah's autoplay lesson (Al-Fatihah 7, the last ayah): "Berikutnya ›" jumps whole
 * steps, exercises included ("Lewati latihan"), until the calm end card shows, with its one line
 * to Tafsir Pekan Ini on the main site (src/components/MainSiteBridge.tsx). Fails the job if the
 * card never shows or its link is not the tagged main-site address.
 */
async function surahEndBridgeShots(page, vp) {
  await page.goto(BASE + "/belajar/id/quran/al-fatihah/7", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-autoplay="start"]').click();
  const end = page.locator('[data-autoplay="end"]');
  const next = page.locator('[data-autoplay="next"]');
  for (let i = 0; i < 200 && (await end.count()) === 0; i++) {
    if ((await next.count()) > 0) await next.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  await end.waitFor({ state: "visible", timeout: 10_000 });
  const link = end.locator('[data-main-site="surah_end"] a');
  const href = await link.getAttribute("href");
  const want = `${MAIN}/id/briefings?${UTM("surah-end")}`;
  if (href !== want || !(await link.isVisible())) throw new Error(`${vp}: end card bridge → ${href}, expected ${want}`);
  await page.waitForTimeout(300);
  await page.locator('[data-autoplay="stage"]').screenshot({ path: `shots/${vp}-autoplay-surah-end.png` });
  console.log(`shot ${vp}-autoplay-surah-end (bridge → ${href})`);
  await page.goto("about:blank");
}

/**
 * The share cards themselves (1200×630 PNG, drawn at build time): the hub's and Al-Fatihah ayah
 * 1's, saved as they are served. Latin only by design (src/lib/og/text.ts).
 */
async function ogShots(request) {
  const { writeFile } = await import("node:fs/promises");
  for (const [name, path] of [
    ["og-hub-id", "/belajar/id/og"],
    ["og-al-fatihah-1-id", "/belajar/id/quran/al-fatihah/1/og"],
  ]) {
    const res = await request.get(BASE + path);
    const body = await res.body();
    const size = body.toString("ascii", 12, 16) === "IHDR" ? [body.readUInt32BE(16), body.readUInt32BE(20)] : null;
    if (res.status() !== 200 || !(res.headers()["content-type"] ?? "").startsWith("image/png") || size?.join("x") !== "1200x630") {
      throw new Error(`${path}: ${res.status()} ${res.headers()["content-type"]} ${size?.join("x") ?? "not a PNG"}`);
    }
    await writeFile(`shots/${name}.png`, body);
    console.log(`shot ${name} (${path}, ${body.length} bytes)`);
  }
}

/**
 * Everything under the lesson stage folds into one row, "Materi lengkap ayat ini" (collapsed in
 * the ayah-2 page shot): here it is opened, full page, so the word cards, the standalone Latihan
 * and Pelajari lebih dalam can be reviewed inside it.
 */
async function materialsShot(page, vp) {
  await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("[data-materials] > summary").click();
  await page.locator("[data-materials][open]").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/${vp}-ayah-2-materials-open.png`, fullPage: true });
  console.log(`shot ${vp}-ayah-2-materials-open`);
  await page.goto("about:blank");
}

/**
 * The fact cards' ayah popup (operator 2026-10-12: a location chip opened quran.com in a new tab
 * or app; now "show popup and show the verse (arabic + translation + play qari voice)";
 * src/components/surah/AyahDialog.tsx), on the Al-Fatihah surah page, in the real image:
 *   1. a click on the first location chip opens the dialog, modal, with the focus inside it; the
 *      address did not change, no page opened, nothing asked of the reciters' host;
 *   2. it shows the reference with the surah's name and the ayah's Arabic (lang ar, RTL) and
 *      translation exactly as content/ayat/locations.json has them (read here, never typed);
 *   3. the page behind does not move under a wheel over the backdrop, and nothing scrolls
 *      sideways; shot of the open dialog;
 *   4. Escape closes it and the focus is back on the chip;
 *   5. opened again, "Putar bacaan imam" asks EveryAyah for that ayah's file (and nothing was
 *      asked before); "Tutup" closes it and the recitation stops (back to idle);
 *   6. the longest ayah a card on the page locates, at the largest text size: it wraps inside the
 *      dialog (no box wider than its own, the page not wider than the screen); shot.
 * The reciters' host is reached through the real CDN and only observed (watchRecitations); the
 * recording need not play on the runner, only be asked for. Fails the job otherwise.
 */
async function ayahDialogChecks(page, vp) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const data = await read("content/ayat/locations.json");
  const msgs = await read("messages/id.json");
  const byLoc = new Map(data.ayat.map((e) => [e.loc, e]));
  const fill = (template, values) => template.replace(/\{(\w+)\}/g, (all, k) => (k in values ? String(values[k]) : all));
  const fileOf = (loc) => {
    const [s, a] = loc.split(":").map((n) => String(n).padStart(3, "0"));
    return `https://everyayah.com/data/Alafasy_128kbps/${s}${a}.mp3`;
  };
  const surahPage = "/belajar/id/quran/al-fatihah";
  const dialog = page.locator("dialog[data-ayah-dialog]");
  const arabic = dialog.locator("[data-ayah-ar]");
  const opened = [];
  const onPage = (p) => opened.push(p.url());
  page.context().on("page", onPage);
  const watch = watchRecitations(page, new Set(["everyayah.com"]));
  const fail = (what) => {
    throw new Error(`${vp}: ayah popup — ${what}`);
  };
  /** The dialog as drawn: open/modal, focus, reference, Arabic, translation, sideways overflow. */
  const look = () =>
    dialog.evaluate((d) => {
      const ar = d.querySelector("[data-ayah-ar]");
      const body = d.querySelector("[data-ayah-body]");
      return {
        open: d.open,
        modal: d.matches(":modal"),
        focusInside: d.contains(document.activeElement),
        title: d.querySelector("h2")?.textContent?.trim() ?? "",
        ar: ar?.textContent ?? "",
        lang: ar?.getAttribute("lang"),
        dir: ar?.getAttribute("dir"),
        translation: (d.querySelector("[data-ayah-translation] blockquote")?.textContent ?? "").replace(/\s+/g, " "),
        wide: [d, body, ar].filter((el) => el && el.scrollWidth > el.clientWidth + 1).map((el) => el.tagName.toLowerCase()),
        dialogRight: d.getBoundingClientRect().right,
        pageWide: document.documentElement.scrollWidth > window.innerWidth + 1,
        innerWidth: window.innerWidth,
      };
    });
  try {
    await page.goto(BASE + surahPage, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // The dialog is drawn into <body> once the page has hydrated: from then on a chip opens it.
    await dialog.waitFor({ state: "attached", timeout: 15_000 });
    const chip = page.locator("[data-ayah-chip]").first();
    await chip.scrollIntoViewIfNeeded();
    const loc = await chip.getAttribute("data-ayah-chip");
    const entry = byLoc.get(loc ?? "");
    if (!entry) fail(`the first chip (${loc}) has no entry in content/ayat/locations.json`);
    if ((await chip.evaluate((el) => el.tagName)) !== "BUTTON") fail(`the chip ${loc} is not a button`);
    const address = page.url();
    const y = await page.evaluate(() => window.scrollY);

    // 1–2. Open, modal, focus inside; the ayah as the data file has it.
    await chip.click();
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
    await arabic.waitFor({ state: "visible", timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    const shown = await look();
    const [s, a] = loc.split(":");
    const title = fill(msgs.Ayah.ref, { name: data.names[s], surah: s, ayah: a });
    if (!shown.open || !shown.modal) fail(`the dialog is not open as a modal (open ${shown.open}, modal ${shown.modal})`);
    if (!shown.focusInside) fail("the focus did not move into the dialog");
    if (shown.title !== title) fail(`the reference reads “${shown.title}”, expected “${title}”`);
    if (shown.ar !== entry.ar) fail(`the Arabic of ${loc} is not the data file's`);
    if (shown.lang !== "ar" || shown.dir !== "rtl") fail(`the Arabic is not marked lang="ar" dir="rtl" (${shown.lang}, ${shown.dir})`);
    if (!shown.translation.includes(entry.translation.text.replace(/\s+/g, " "))) fail(`the translation of ${loc} is not the data file's`);
    if (page.url() !== address) fail(`the address changed to ${page.url()}`);
    if (opened.length) fail(`a page was opened: ${opened.join(", ")}`);
    if (watch.seen.length) fail(`the reciters' host was asked before play: ${watch.list()}`);

    // 3. The page behind stays put; nothing scrolls sideways.
    await page.mouse.move(4, 4);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(400);
    if ((await page.evaluate(() => window.scrollY)) !== y) fail("the page behind scrolled under the open dialog");
    if (shown.pageWide || shown.wide.length || shown.dialogRight > shown.innerWidth + 1) {
      fail(`something is wider than the screen or its box (${shown.wide.join(", ") || "the page"})`);
    }
    await page.screenshot({ path: `shots/${vp}-ayah-dialog.png` });
    console.log(`shot ${vp}-ayah-dialog (${loc}: “${title}”)`);

    // 4. Escape closes it; the focus is back on the chip.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    if (!(await chip.evaluate((el) => el === document.activeElement))) fail("after Escape the focus is not back on the chip");

    // 5. Play asks EveryAyah for this ayah's file, and nothing before; Tutup stops it.
    await chip.click();
    await arabic.waitFor({ state: "visible", timeout: 10_000 });
    if (watch.seen.length) fail(`the reciters' host was asked before play: ${watch.list()}`);
    const file = fileOf(loc);
    await dialog.locator("[data-ayah-play]").click();
    if (!(await until(page, async () => watch.requested(file) > 0, 15_000))) {
      fail(`play did not ask for ${file} (asked: ${watch.list()})`);
    }
    const others = watch.seen.filter((u) => u !== file);
    if (others.length) fail(`play asked for other files too: ${others.join(", ")}`);
    await page.waitForTimeout(1500);
    const playing = await dialog.locator("[data-ayah-play]").getAttribute("data-state");
    console.log(`  ${vp}: play asked for ${recordingName(file)} → ${watch.answered.get(file) ?? "no answer yet"}; the button says ${playing}`);
    await dialog.locator("[data-ayah-close]").click();
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    await page.waitForTimeout(300);
    const after = await dialog.locator("[data-ayah-play]").getAttribute("data-state");
    if (after !== "idle") fail(`after Tutup the recitation is "${after}", not stopped`);

    // 6. The longest ayah on the page, at the largest text size.
    const locs = await page.locator("[data-ayah-chip]").evaluateAll((els) => els.map((el) => el.getAttribute("data-ayah-chip")));
    const longest = locs.reduce((best, l) => ((byLoc.get(l)?.ar.length ?? 0) > (byLoc.get(best)?.ar.length ?? 0) ? l : best), locs[0]);
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => (d.open = true));
      return true;
    });
    await setTextSizeAttr(page, "sangat-besar");
    const longChip = page.locator(`[data-ayah-chip="${longest}"]`).first();
    await longChip.scrollIntoViewIfNeeded();
    await longChip.click();
    await arabic.waitFor({ state: "visible", timeout: 10_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const big = await look();
    if (big.ar !== byLoc.get(longest).ar) fail(`the Arabic of ${longest} is not the data file's`);
    if (big.pageWide || big.wide.length || big.dialogRight > big.innerWidth + 1) {
      fail(`${longest} at Sangat besar does not wrap inside the dialog (${big.wide.join(", ") || "the page is wider than the screen"})`);
    }
    await page.screenshot({ path: `shots/${vp}-ayah-dialog-long-sangat-besar.png` });
    console.log(`shot ${vp}-ayah-dialog-long-sangat-besar (${longest}, ${byLoc.get(longest).ar.length} characters)`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    await setTextSizeAttr(page, null);

    // 7. The same dialog in a lesson's "Pelajari lebih dalam" row (Al-Fatihah 2: Materi lengkap →
    //    Tahukah Anda?), its first chip.
    await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
    await dialog.waitFor({ state: "attached", timeout: 15_000 });
    await page.locator("[data-materials] > summary").click();
    const facts = page.locator("details", { has: page.locator("summary", { hasText: msgs.Lesson.facts_heading }) }).last();
    await facts.locator("summary").first().click();
    const lessonChip = facts.locator("[data-ayah-chip]").first();
    await lessonChip.scrollIntoViewIfNeeded();
    const lessonLoc = await lessonChip.getAttribute("data-ayah-chip");
    const lessonAddress = page.url();
    await lessonChip.click();
    await arabic.waitFor({ state: "visible", timeout: 10_000 });
    const inLesson = await look();
    if (!inLesson.modal || inLesson.ar !== byLoc.get(lessonLoc ?? "")?.ar) fail(`on ${AYAH_2} the chip ${lessonLoc} did not open its ayah`);
    if (page.url() !== lessonAddress || opened.length) fail(`on ${AYAH_2} the chip ${lessonLoc} navigated or opened a page`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 5_000 });
    console.log(`  ${vp}: ayah popup ok (button chip, modal, ${loc} as the data file has it, no navigation, no new page, page behind still, Escape → chip, play → ${recordingName(file)} only, Tutup stops it, ${longest} wraps; ${lessonLoc} from the lesson row)`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-ayah-dialog-FAILED.png` }).catch(() => {});
    throw err;
  } finally {
    watch.stop();
    page.context().off("page", onPage);
  }
  await page.goto("about:blank");
}

/**
 * The track page as production shows it (operator, 2026-10-10: "show cards for other surah as
 * 'segera hadir', but not clickable"): Al-Fatihah's card is a link; each hidden surah has a card
 * that is a plain element, not inside a link, with nothing focusable in it, and that says
 * "Segera hadir" in its own text. Checked on the rendered elements (the next-intl messages in the
 * page's scripts carry the same words). Fails the job otherwise.
 */
async function comingSoonCheck(page, vp) {
  await page.goto(BASE + "/belajar/id/quran", { waitUntil: "networkidle" });
  const cards = await page.locator("[data-coming-soon]").evaluateAll((els) =>
    els.map((e) => ({
      slug: e.getAttribute("data-coming-soon"),
      tag: e.tagName,
      inLink: !!e.closest("a"),
      focusable: e.querySelectorAll("a, button, input, select, textarea, summary, [tabindex]").length,
      text: e.textContent ?? "",
    })),
  );
  const problems = [];
  const slugs = cards.map((c) => c.slug);
  if (JSON.stringify(slugs) !== JSON.stringify(HIDDEN_SURAHS)) problems.push(`cards for ${JSON.stringify(slugs)}, expected ${JSON.stringify(HIDDEN_SURAHS)}`);
  for (const c of cards) {
    if (c.tag === "A" || c.inLink) problems.push(`${c.slug}: the "Segera hadir" card is a link`);
    if (c.focusable > 0) problems.push(`${c.slug}: ${c.focusable} focusable element(s) inside`);
    if (!c.text.includes("Segera hadir")) problems.push(`${c.slug}: the card does not say "Segera hadir"`);
  }
  if ((await page.locator('a[href="/belajar/id/quran/al-fatihah"]').count()) === 0) problems.push("Al-Fatihah's card is no link");
  for (const slug of HIDDEN_SURAHS) {
    const n = await page.locator(`a[href^="/belajar/id/quran/${slug}"]`).count();
    if (n > 0) problems.push(`${n} link(s) into the hidden ${slug}`);
  }
  if (problems.length) throw new Error(`${vp}: track page — ${problems.join("; ")}`);
  console.log(`  ${vp}: "Segera hadir" cards ok (${slugs.join(", ")}: plain elements, nothing to focus)`);
  await page.goto("about:blank");
}

/**
 * The end of Al-Fatihah's autoplay lesson (ayah 7), reached with "Berikutnya ›" / "Lewati
 * latihan", step by step. As production shows it (`surahsOn` false): the card says the next surah
 * is coming soon, offers no "Surah berikutnya" and "Ulangi Al-Fatihah" instead, and the page does
 * not move on by itself. With every surah listed (`--surahs`): it offers "Surah berikutnya:
 * Al-Ikhlas". Fails the job otherwise.
 */
async function endCardShots(page, vp, surahsOn) {
  // networkidle: the stage's /belajar/api/surahs answer has arrived.
  await page.goto(BASE + AYAH_7, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-autoplay="start"]').click();
  const end = page.locator('[data-autoplay="end"]');
  const next = page.locator('[data-autoplay="next"]');
  let clicks = 0;
  for (; clicks < 300 && (await end.count()) === 0; clicks++) {
    if ((await next.count()) > 0) await next.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await end.waitFor({ state: "visible", timeout: 10_000 });
  const at = page.url();
  await page.waitForTimeout(1500);
  const problems = [];
  if (page.url() !== at) problems.push(`the page moved on by itself (${at} → ${page.url()})`);
  const soon = page.locator('[data-autoplay="end-soon"]');
  const nextSurah = page.locator('[data-autoplay="end-next"]');
  const repeat = (await page.locator('[data-autoplay="end-repeat"]').innerText()).trim();
  if (repeat !== "Ulangi Al-Fatihah") problems.push(`the repeat button says "${repeat}", expected "Ulangi Al-Fatihah"`);
  if (surahsOn) {
    if ((await soon.count()) > 0) problems.push('says "segera hadir" with every surah published');
    const label = (await nextSurah.count()) > 0 ? (await nextSurah.innerText()).trim() : "";
    if (!label.includes("Al-Ikhlas")) problems.push(`no "Surah berikutnya: Al-Ikhlas" (got "${label}")`);
  } else {
    const text = (await soon.count()) > 0 ? (await soon.innerText()).trim() : "";
    if (!text.includes("Al-Ikhlas") || !text.includes("segera hadir")) problems.push(`no coming-soon line (got "${text}")`);
    if ((await nextSurah.count()) > 0) problems.push('offers "Surah berikutnya" into a hidden surah');
    const links = await end.locator('a[href*="/quran/al-ikhlas"], a[href*="/quran/al-falaq"], a[href*="/quran/an-nas"]').count();
    if (links > 0) problems.push(`${links} link(s) into a hidden surah`);
  }
  const name = surahsOn ? "autoplay-fatihah-end-semua-surah" : "autoplay-fatihah-end";
  await page.locator('[data-autoplay="stage"]').screenshot({ path: `shots/${vp}-${name}.png` });
  console.log(`shot ${vp}-${name} (${clicks} step click(s) to the end)`);
  if (problems.length) throw new Error(`${vp}: end of Al-Fatihah — ${problems.join("; ")}`);
  await page.goto("about:blank");
}

/**
 * The Konsep pages show grammar terms in Arabic script, measured in the real browser (operator
 * 2026-10-10: "mention the arabic word like majrur in arabic letter"; narration rule 15: a
 * transliteration and its Arabic never split across lines). On the index and on three concept
 * pages, at each of the three text sizes (html[data-text-size], as the Aa control sets it): the
 * term table's Arabic for majrur (read from content/library.json, never typed here) is rendered
 * and visible inside <main>; every "latin (Arabic)" pair is one line box; every visible Arabic
 * box lies inside the viewport on BOTH sides (review 2026-10-10: a nowrap RTL headword ran off
 * the LEFT edge, which scrollWidth cannot see), checked on tanda-irab, whose headword has four
 * terms; the Harakat page shows its signs on dotted circles and the first letter of 1:1:1
 * (content bytes); huruf jar shows its parts diagrams and links the first harakah term to the
 * Harakat page. Fails the job otherwise; the next-intl messages payload is never what is checked.
 */
async function konsepChecks(page, vp) {
  const lib = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "library.json"), "utf8"));
  const majrur = lib.terms.find((t) => t.id === "majrur")?.ar;
  const ba = lib.quran["1:1:1#1"];
  if (!majrur || !ba) throw new Error("content/library.json has no majrur term or no letter 1:1:1#1");
  const paths = ["/belajar/id/konsep", "/belajar/id/konsep/huruf-jar", "/belajar/id/konsep/tanda-irab", "/belajar/id/konsep/harakat"];
  for (const size of [null, "besar", "sangat-besar"]) {
    for (const path_ of paths) {
      await page.goto(BASE + path_, { waitUntil: "networkidle" });
      await page.evaluate((s) => {
        if (s) document.documentElement.dataset.textSize = s;
        else delete document.documentElement.dataset.textSize;
      }, size);
      await page.evaluate(() => document.fonts.ready);
      const res = await page.evaluate(
        ({ majrur, ba }) => {
          const main = document.querySelector("main");
          const ar = [...main.querySelectorAll('[lang="ar"]')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("details:not([open])");
          });
          const texts = ar.map((el) => el.textContent);
          // a "latin (Arabic)" pair: the nowrap span holding a bdi[lang=ar] must be one line box
          const split = [...main.querySelectorAll("span.whitespace-nowrap")]
            .filter((sp) => sp.querySelector('bdi[lang="ar"]'))
            .filter((sp) => new Set([...sp.getClientRects()].map((r) => Math.round(r.top))).size > 1)
            .map((sp) => sp.textContent);
          // every Arabic box inside the viewport, left edge too (an RTL overflow goes left)
          const outside = ar
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < -1 || r.right > window.innerWidth + 1;
            })
            .map((el) => el.textContent.slice(0, 40));
          const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
          return {
            visible: ar.length,
            majrur: texts.includes(majrur),
            ba: texts.includes(ba),
            circles: main.querySelectorAll(".mark-circle").length,
            figure: main.querySelectorAll("figure").length,
            harakatLink: !!main.querySelector('a[href$="/konsep/harakat"]'),
            split,
            outside,
            overflow,
          };
        },
        { majrur, ba },
      );
      const problems = [];
      if (res.visible < 3) problems.push(`only ${res.visible} visible Arabic elements`);
      if (!path_.endsWith("/harakat") && !path_.endsWith("/tanda-irab") && !res.majrur) problems.push("majrur's Arabic is not rendered");
      if (res.split.length) problems.push(`a term and its Arabic split across lines: ${res.split.slice(0, 3).join(" | ")}`);
      if (res.outside.length) problems.push(`Arabic outside the screen: ${res.outside.slice(0, 3).join(" | ")}`);
      if (res.overflow) problems.push("the page scrolls sideways");
      if (path_.endsWith("/harakat") && (res.circles < 6 || !res.ba)) problems.push(`Harakat page: ${res.circles} dotted circles, letter 1:1:1#1 shown: ${res.ba}`);
      if (path_.endsWith("/huruf-jar") && (!res.figure || !res.harakatLink)) problems.push(`huruf jar: parts diagram ${res.figure}, link to the Harakat page ${res.harakatLink}`);
      if (problems.length) throw new Error(`${vp} ${size ?? "default"} ${path_}: ${problems.join("; ")}`);
      console.log(`  konsep ok: ${vp} ${size ?? "default"} ${path_} (${res.visible} Arabic elements${res.circles ? `, ${res.circles} dotted circles` : ""})`);
    }
  }
  await page.goto("about:blank");
}

/**
 * What a learner must see while the narrator explains a word, checked on the real page in the
 * viewport (not the screenshot's stage crop): the whole caption on screen and above the controls,
 * and the word card fully on screen, not under the bottom panel. The 2026-10-10 phone shot had the
 * caption below the fold behind the sticky controls, showing only its last fragment.
 */
async function assertKaraokeLayout(page, vp) {
  const { height } = page.viewportSize();
  const box = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${vp}: ${sel} has no box (not rendered)`);
    return { top: b.y, bottom: b.y + b.height };
  };
  const caption = await box('[data-autoplay="caption"]');
  const controls = await box('[data-autoplay="panel"] [role="group"]');
  const panel = await box('[data-autoplay="panel"]');
  const card = await box('[data-autoplay="word-card"]');
  const problems = [];
  if (caption.top < 0 || caption.bottom > height) problems.push(`caption ${fmt(caption)} not inside the viewport (0–${height})`);
  if (caption.bottom > controls.top + 1) problems.push(`caption ${fmt(caption)} not above the controls ${fmt(controls)}`);
  if (card.top < 0 || card.bottom > panel.top + 1) problems.push(`word card ${fmt(card)} off screen or under the panel ${fmt(panel)}`);
  if (problems.length) throw new Error(`${vp}: karaoke layout — ${problems.join("; ")}`);
  console.log(`  layout ok: card ${fmt(card)} · panel ${fmt(panel)} · caption ${fmt(caption)} · controls ${fmt(controls)}`);
}
const fmt = (b) => `${Math.round(b.top)}–${Math.round(b.bottom)}`;

/** The module's forest and paper as getComputedStyle reports them (globals.css --color-forest,
 *  --color-paper). */
const FOREST = "rgb(14, 90, 60)";
const PAPER = "rgb(251, 250, 246)";

/**
 * Emphasis on the karaoke shot (operator 2026-10-11: "we can also use bold text or different color
 * to highlight the meanings or important things"): the meaning in `scope` — the word card's "yang
 * artinya “…”", the caption's gloss — is on screen, bold, and forest (paper while it is the word
 * being said, on the forest fill). So the emphasis cannot quietly disappear (a renamed prop, a
 * class Tailwind no longer generates) while the shots still look fine at a glance.
 */
async function assertEmphasis(page, vp, scope, what) {
  // A karaoke word's colour fades in 150ms when its state changes ("nama." the moment the narrator
  // moves on): measured in a moment none of them is fading, never in between two colours.
  const looks = await page.locator(`${scope} [data-emph="meaning"]`).evaluateAll(async (els) => {
    for (let k = 0; k < 20; k++) {
      const fading = els.flatMap((el) => el.getAnimations());
      if (!fading.length) break;
      await Promise.all(fading.map((a) => a.finished.catch(() => null)));
    }
    return els.map((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? "").trim(),
        weight: Number(s.fontWeight),
        color: s.color,
        now: !!el.closest('[data-karaoke="now"]'),
        shown: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true }),
      };
    });
  });
  if (!looks.length) throw new Error(`${vp}: ${what} has no emphasised meaning ([data-emph="meaning"])`);
  const bad = looks.filter((x) => !x.shown || !(x.weight >= 600) || x.color !== (x.now ? PAPER : FOREST));
  if (bad.length) throw new Error(`${vp}: ${what}: emphasised meaning not shown bold in ${FOREST} (${PAPER} on the word being said): ${JSON.stringify(bad)}`);
  console.log(`  emphasis ok: ${what} — ${looks.map((x) => `“${x.text}” ${x.weight}`).join(", ")}`);
}

/** The karaoke check's line: word 1 of Al-Fatihah 1 explained ("w1"; rendered with the rest of
 *  Al-Fatihah's narration — a line whose text changed has no audio until then). */
const KARAOKE = { slug: "al-fatihah", step: "w1", line: "al-fatihah:1:w1" };

/**
 * Al-Fatihah ayah 1, the narrated ayah, after the one "Mulai" click: the stage mid-explanation of
 * word 1 — the KARAOKE caption (the narrator's current word filled forest, words said in ink,
 * words to come muted) under the large WORD CARD (the word's Arabic · transliteration · "yang
 * artinya …"), the mushaf words numbered with word 1 marked. "Berikutnya ›" jumps whole steps up to
 * the step named "w1" on the stage (toStep: intro → the ayah → the harakat primer → the imam says
 * word 1 → its explanation, whatever steps come between), then "↺ Ulangi langkah ini" plays the
 * explanation from its start — the replay control, and a start that holds even when the imam's
 * stream paused the lesson on the way — and the caption must be that line (data-line) with half
 * its words said. Needs the line rendered (audio + word timings in content/narration/
 * al-fatihah.json): checked FIRST, so a missing render fails here with that message, not with a
 * timeout on a caption that can never turn karaoke (CI 2026-10-11: the word line became "gloss +
 * lead" with the composition, and the stage played on into the composition lines caption-only).
 * Fails the job if the word card or the karaoke caption never shows (what a learner would see
 * without them is the caption-only fallback, already covered by the ayah 2 shots above), or if
 * either shows its meaning without the emphasis (assertEmphasis: "dengan nama" bold in forest).
 */
async function karaokeShots(page, vp, index) {
  const line = await narratedLine(KARAOKE.slug, KARAOKE.line);
  if (!line.exists) throw new Error(`${vp}: the karaoke check's line ${KARAOKE.line} is not in ${line.file} (renamed? update KARAOKE in screenshots.mjs)`);
  if (!line.voiced)
    throw new Error(
      `${vp}: ${KARAOKE.line} has no rendered narration in ${line.file} (no audio file or no word timings): its text changed and it was not rendered since. ` +
        "Render Al-Fatihah's narration (pipeline/render_narration.py), commit the manifest, and run again; the karaoke check plays that line.",
    );
  const served = [];
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", onConsole);
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
    await toStep(page, vp, KARAOKE.step);
    await page.locator('[data-autoplay="replay"]').click();
    await page.locator('[data-autoplay="word-card"]').waitFor({ state: "visible", timeout: 10_000 });
    // Mid-line: half its words said, the narrator on the next. Locator waits, not
    // page.waitForFunction: Playwright evaluates waitForFunction predicates with eval in the page,
    // which the module's CSP (no 'unsafe-eval') rightly refuses.
    const caption = page.locator(`[data-autoplay="caption"][data-line="${KARAOKE.line}"]`);
    const half = Math.max(1, Math.floor(line.words / 2));
    await caption.locator('[data-karaoke="said"]').nth(half - 1).waitFor({ state: "attached", timeout: 25_000 });
    await caption.locator('[data-karaoke="now"]').first().waitFor({ state: "attached", timeout: 25_000 });
    await assertKaraokeLayout(page, vp);
    await assertEmphasis(page, vp, '[data-autoplay="word-card"]', "the word card");
    await assertEmphasis(page, vp, `[data-autoplay="caption"][data-line="${KARAOKE.line}"]`, "the karaoke caption");
    await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-karaoke.png` });
    console.log(`shot ${vp}-autoplay-ayah1-karaoke`);
    await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-karaoke-viewport.png` });
    console.log(`shot ${vp}-autoplay-ayah1-karaoke-viewport`);
    const card = (await page.locator('[data-autoplay="word-card"]').innerText()).replace(/\s+/g, " ").trim();
    console.log(`  word card: ${card}`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-FAILED.png`, fullPage: true }).catch(() => {});
    const caption = await page
      .locator('[data-autoplay="caption"]')
      .innerHTML()
      .catch(() => "(no caption element)");
    const on = await stage.getAttribute("data-step").catch(() => null);
    const said = await page.locator('[data-autoplay="caption"]').getAttribute("data-line").catch(() => null);
    console.error(`✗ ${vp}: the Al-Fatihah ayah 1 karaoke caption / word card never showed`);
    if (![...index.keys()].length) console.error("  (no narration audio in the manifests at all)");
    console.error(`  wanted: step ${KARAOKE.step}, line ${KARAOKE.line} (${line.words} words) · on screen: step ${on ?? "—"}, line ${said ?? "—"}`);
    console.error(`  caption HTML: ${caption.slice(0, 600)}`);
    console.error(`  narration requests answered (${served.length}):\n    ${served.join("\n    ") || "(none)"}`);
    console.error(`  console errors (${consoleErrors.length}):\n    ${consoleErrors.join("\n    ") || "(none)"}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
    page.off("console", onConsole);
  }
  const standIns = served.filter((s) => s.includes("silent stand-in")).length;
  console.log(
    `  narration: ${served.length} request(s) answered — ${standIns} silent stand-in(s) (the MP3s are not on this machine), ${served.length - standIns} other`,
  );
  await page.goto("about:blank");
}

/**
 * Never a silent wait (operator 2026-10-11: "sometimes it takes time for autoplay to run … there is
 * no info to user, user is confused what happen and dont know what to do"; narration rule 19), on
 * Al-Fatihah 1 with the routed narration held back for one file at a time (narration-route.mjs
 * `delays`: a slow connection for that file only), its remembered place cleared first so the
 * primary button is "Mulai pelajaran":
 *   1. "Mulai" with its first line (shared:start) held back START_HOLD_MS: at once the button says
 *      "Menyiapkan pelajaran…" (aria-busy) and the playing stage is not there; it appears once the
 *      line plays (not before the hold is over), the button gone;
 *   2. word 1's explanation (step "w1", started with "↺ Ulangi") with its line held back
 *      LINE_HOLD_MS: within 1.5 s the bottom panel's status names the narrator ("Memuat suara
 *      narator…", data-kind="narration"), the word card and the caption still clear of the panel
 *      (assertKaraokeLayout); it goes once the line plays (not before the hold is over), and the
 *      karaoke caption then follows the narrator with no status.
 * The words are read from messages/id.json, never typed here. Shots: the preparing button, and the
 * status (stage + viewport). Phone only. Fails the job otherwise.
 */
const START_HOLD_MS = 3000;
const LINE_HOLD_MS = 4000;
async function loadingChecks(page, vp, index) {
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8")).Guided;
  const shared = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "narration", "shared.json"), "utf8")).lines ?? {};
  const startUrl = (shared["shared:start"] ?? shared["shared:start:a"])?.audio?.url;
  const line = await narratedLine(KARAOKE.slug, KARAOKE.line);
  if (!startUrl) throw new Error(`${vp}: loading check — shared:start has no rendered narration (content/narration/shared.json)`);
  if (!line.voiced || !line.url) throw new Error(`${vp}: loading check — ${KARAOKE.line} has no rendered narration in ${line.file}`);
  const served = [];
  const delays = new Map();
  const handler = narrationRoute(index, served, { delays });
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const panel = page.locator('[data-autoplay="panel"]');
  const status = page.locator('[data-autoplay="loading"]');
  const start = page.locator('[data-autoplay="start"]');
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    // 1. "Mulai" answers at once, and the stage waits for its first line.
    delays.set(startUrl, START_HOLD_MS);
    const t0 = Date.now();
    await start.click();
    await start.filter({ hasText: msgs.preparing }).waitFor({ state: "visible", timeout: 1_000 });
    const problems = [];
    if ((await start.getAttribute("aria-busy")) !== "true") problems.push('the preparing button is not aria-busy="true"');
    if ((await panel.count()) > 0) problems.push("the playing stage showed before its first line played");
    if (problems.length) throw new Error(`${vp}: Mulai — ${problems.join("; ")}`);
    await stage.screenshot({ path: `shots/${vp}-autoplay-preparing.png` });
    console.log(`shot ${vp}-autoplay-preparing (“${msgs.preparing}” after ${Date.now() - t0} ms)`);
    await panel.waitFor({ state: "visible", timeout: START_HOLD_MS + 10_000 });
    const shownAfter = Date.now() - t0;
    delays.delete(startUrl);
    if (shownAfter < START_HOLD_MS - 300) throw new Error(`${vp}: the playing stage showed after ${shownAfter} ms, before its first line (held back ${START_HOLD_MS} ms) could play`);
    if ((await start.count()) > 0) throw new Error(`${vp}: the start button is still there with the playing stage`);
    console.log(`  Mulai ok: "${msgs.preparing}" at once, the playing stage after ${shownAfter} ms (first line held back ${START_HOLD_MS} ms)`);
    await settleScroll(page);

    // 2. A narration line that is slow to come is named in the bottom panel.
    await toStep(page, vp, KARAOKE.step);
    delays.set(line.url, LINE_HOLD_MS);
    const t1 = Date.now();
    await page.locator('[data-autoplay="replay"]').click();
    await status.waitFor({ state: "visible", timeout: 1_500 });
    const seenAfter = Date.now() - t1;
    const [text, kind] = [(await status.innerText()).replace(/\s+/g, " ").trim(), await status.getAttribute("data-kind")];
    if (text !== msgs.loading_narration || kind !== "narration") {
      throw new Error(`${vp}: the loading status says “${text}” (data-kind ${kind}), expected “${msgs.loading_narration}” (narration)`);
    }
    await page.waitForTimeout(600); // its row opening (200ms), then the word card's glide (200ms) above the taller panel
    await assertKaraokeLayout(page, vp);
    await stage.screenshot({ path: `shots/${vp}-autoplay-loading.png` });
    console.log(`shot ${vp}-autoplay-loading (“${text}” after ${seenAfter} ms)`);
    await page.screenshot({ path: `shots/${vp}-autoplay-loading-viewport.png` });
    console.log(`shot ${vp}-autoplay-loading-viewport`);
    await status.waitFor({ state: "detached", timeout: LINE_HOLD_MS + 10_000 });
    const goneAfter = Date.now() - t1;
    delays.delete(line.url);
    if (goneAfter < LINE_HOLD_MS - 300) throw new Error(`${vp}: the loading status went after ${goneAfter} ms, before the line (held back ${LINE_HOLD_MS} ms) could play`);
    const caption = page.locator(`[data-autoplay="caption"][data-line="${KARAOKE.line}"]`);
    await caption.locator('[data-karaoke="now"]').first().waitFor({ state: "attached", timeout: 10_000 });
    if ((await status.count()) > 0) throw new Error(`${vp}: the loading status is back while the line plays`);
    console.log(`  loading status ok: “${text}” after ${seenAfter} ms, gone after ${goneAfter} ms (line held back ${LINE_HOLD_MS} ms), then the karaoke caption`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-loading-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the loading status check on Al-Fatihah 1 failed`);
    console.error(`  narration requests answered (${served.length}):\n    ${served.join("\n    ") || "(none)"}`);
    throw err;
  } finally {
    delays.clear();
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/** Al-Fatihah's recordings (content/al-fatihah.json): by ayah, by ayah and reciter, their hosts. */
async function fatihahRecitations() {
  const content = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "al-fatihah.json"), "utf8"));
  const recitations = (ayah) => content.ayat.find((a) => a.ayah === ayah)?.recitation ?? [];
  return {
    recitations,
    urlOf: (ayah, reciter) => recitations(ayah).find((r) => r.reciter === reciter)?.url ?? null,
    hosts: new Set(content.ayat.flatMap((a) => a.recitation.map((r) => new URL(r.url).host))),
  };
}

/** A recording's address, short: "Alafasy_128kbps/001001.mp3". */
const recordingName = (url) => new URL(url).pathname.split("/").slice(-2).join("/");

/**
 * Every request `pg` makes to the reciters' hosts from now on, as it is made (`seen`, in order),
 * and how the CDN answered it (`answered`: "ok" for a 200 / 206 received in full). Observed only:
 * nothing is intercepted, the real CDN answers. `stop()` ends the watch.
 */
function watchRecitations(pg, hosts) {
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  };
  const seen = [];
  const answered = new Map();
  const onRequest = (req) => {
    if (hosts.has(hostOf(req.url()))) seen.push(req.url());
  };
  const onFinished = async (req) => {
    if (!hosts.has(hostOf(req.url()))) return;
    const status = (await req.response().catch(() => null))?.status();
    answered.set(req.url(), status === 200 || status === 206 ? "ok" : `HTTP ${status ?? "?"}`);
  };
  const onFailed = (req) => {
    if (hosts.has(hostOf(req.url()))) answered.set(req.url(), `failed (${req.failure()?.errorText ?? "?"})`);
  };
  pg.on("request", onRequest);
  pg.on("requestfinished", onFinished);
  pg.on("requestfailed", onFailed);
  return {
    seen,
    answered,
    requested: (url) => seen.filter((u) => u === url).length,
    list: () => seen.map((u) => `${recordingName(u)} → ${answered.get(u) ?? "no answer yet"}`).join("\n    ") || "(none)",
    stop: () => {
      pg.off("request", onRequest);
      pg.off("requestfinished", onFinished);
      pg.off("requestfailed", onFailed);
    },
  };
}

/** Waits (in Node: the CSP refuses waitForFunction's eval) until `fn` is true; false after `ms`. */
async function until(pg, fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await fn()) return true;
    await pg.waitForTimeout(100);
  }
  return false;
}

/**
 * From the recap, paused: on to Al-Fatihah 2 as the lesson goes there by itself (the hand-off) —
 * "Berikutnya ›" to the "next" step, the line that announces the next ayah, and once more to the
 * end of the ayah. Two clicks and no more: a third could land on ayah 2's own "Berikutnya ›" and
 * move that lesson off its first step. Returns once the lesson runs there.
 */
async function handOffToAyah2(pg) {
  const stage = pg.locator('[data-autoplay="stage"]');
  const forward = pg.locator('[data-autoplay="next"]');
  await forward.click();
  if (!(await until(pg, async () => (await stage.getAttribute("data-step")) === "next", 5_000))) {
    throw new Error(`the lesson did not reach its last step ("next") from the recap (on "${await stage.getAttribute("data-step")}")`);
  }
  await forward.click();
  await pg.waitForURL(/\/quran\/al-fatihah\/2(\?.*)?$/, { timeout: 15_000 });
  await pg.locator('[data-autoplay="panel"]').first().waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * The imam's recitation is fetched EARLY, so it is ready when its step comes (operator 2026-10-11:
 * "how to reduce the loading time? upgrade VM?" … "do all three"; src/lib/autoplay/warm.ts), on
 * Al-Fatihah 1, phone, its remembered place cleared first. The narration is answered in the
 * browser, so the opening line lasts as long as the manifest says (23 s); the requests to the
 * reciters' host are only OBSERVED (watchRecitations) and the real CDN answers them — steps 1–3
 * and 5 need no answer from it, only the asking:
 *   1. a page view alone asks the reciters' host for no recording: none IDLE_SETTLE_MS after the
 *      page has loaded, when its idle preload (the first narration line) has run;
 *   2. after "Mulai", this ayah's recording by the reciter chosen (the stage's data-reciter →
 *      content/al-fatihah.json) is requested while the narrator still speaks the opening line:
 *      the stage is on its first step, not yet on the imam's ("recite"). Not proof of the early
 *      fetch by itself (review 2026-10-11): on a first "Mulai" the click's own unlock() play asks
 *      for the file too, as it did before the early fetch existed. Steps 3 and 5 are the proof —
 *      there nothing plays, and without warm() the recording is not requested;
 *   3. another reciter chosen in "Pengaturan" with the lesson paused: his recording is requested
 *      at once (nothing plays it: until 2026-10-11 a recording was fetched only by its play);
 *   4. what the imam's step then plays is what was fetched ahead. First, with the network free,
 *      "↺ Ulangi" on the imam's step must make him SOUND — that this runner can play the
 *      recordings at all (it needs the CDN and the MP3 decoder). Where the RUNNER cannot (the CDN
 *      did not answer the recording in full, or the browser has no MP3 decoder), 4 is not checked
 *      and says so in a warning on the run's summary, never failed for the runner's sake. Where
 *      the page HAD the recording and the decoder and he still did not sound, or the page itself
 *      cancelled the fetch (net::ERR_ABORTED), the check fails (review 2026-10-11: a silent imam
 *      is the app's fault then, and nothing else in this job listens for him).
 *      Then, for the recording of step 3 (fetched
 *      ahead and by nothing else), with every further request to the reciters' host HELD BACK
 *      RECITE_HOLD_MS (a route that waits, then continues to the CDN): "↺ Ulangi" makes him sound
 *      again, with no "Memuat bacaan imam…" status on the way, and NOT ONE request for the file
 *      reaches the hold — a play that needed the network would ask it, show the status after
 *      0.6 s and sound 6 s late.
 *      "Sounding" (review 2026-10-11) is a mushaf word lit (aria-current) that the player can only
 *      light once the recording has ADVANCED: one whose segment starts after 0 ms (the chip's
 *      data-word → the recording's segments in content/al-fatihah.json). A lit word alone proves
 *      nothing: the player lights the word at 0 ms on the "play" event, before any data (Husary's
 *      1:1 starts its first word at 0 ms, so that word lit with the network held back), and a
 *      recitation paused mid-ayah keeps its word lit. So the word lit before the click does not
 *      count until the line has been seen to change;
 *   5. a recording is fetched by the page that plays it, and by no other (review 2026-10-11: the
 *      next ayah's is no longer fetched ahead from the recap). On the recap, RECAP_SETTLE_MS in,
 *      nothing but the recordings of steps 2 and 3 has been requested: no other ayah's, no other
 *      reciter's. The lesson then goes on to ayah 2 by itself (the hand-off), and that page's
 *      player requests its recording at once, the lesson still on its first step — with no click
 *      on that page (so no unlock() play) and the imam's step not reached: the early fetch alone.
 *      This is every ayah after the first of a sitting, where the wait was.
 * Fails the job on 1–5.
 */
const IDLE_SETTLE_MS = 4000;
const RECITE_HOLD_MS = 6000;
const RECAP_SETTLE_MS = 2500;
async function warmupChecks(page, vp, index) {
  const { recitations, urlOf, hosts } = await fatihahRecitations();
  const isRecitation = (url) => hosts.has(url.host);
  const name = recordingName;
  const { seen, answered, requested, list, stop } = watchRecitations(page, hosts);
  // Step 4: later requests to the reciters' hosts wait, then go on to the CDN.
  const heldBack = [];
  const hold = async (route) => {
    heldBack.push(route.request().url());
    await new Promise((done) => setTimeout(done, RECITE_HOLD_MS));
    await route.continue().catch(() => {});
  };

  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const middle = page.locator('[data-autoplay="middle"]');
  const settingsToggle = page.locator('[data-autoplay="settings-toggle"]');
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const reciter = await stage.getAttribute("data-reciter");
    const mine = reciter ? urlOf(1, reciter) : null;
    if (!mine) throw new Error(`${vp}: early fetch — the stage's data-reciter (${reciter}) names no recording of Al-Fatihah 1 in content/al-fatihah.json`);

    // 1. A page view alone: nothing of the imam's.
    await page.waitForTimeout(IDLE_SETTLE_MS);
    if (seen.length) throw new Error(`${vp}: a page view alone asked the reciters' host for ${seen.map(name).join(", ")} — before "Mulai"`);
    console.log(`  early fetch 1/5: no request to ${[...hosts].join(", ")} on a page view (two loads, ${IDLE_SETTLE_MS} ms idle)`);

    // 2. "Mulai": this ayah's recording, while the narrator speaks the opening line.
    const t0 = Date.now();
    await Promise.all([
      page.waitForRequest((r) => r.url() === mine, { timeout: 10_000 }).catch(() => {
        throw new Error(`${vp}: 10 s after "Mulai" the chosen reciter's recording (${name(mine)}) was not requested (requests: ${seen.map(name).join(", ") || "none"})`);
      }),
      page.locator('[data-autoplay="start"]').click(),
    ]);
    const askedAfter = Date.now() - t0;
    const early = await stage.getAttribute("data-step");
    if (early !== null && early !== "intro") throw new Error(`${vp}: ${name(mine)} was requested only on step "${early}", not while the opening line plays`);
    await settleScroll(page);
    const opening = await stage.getAttribute("data-step");
    const line = await page.locator('[data-autoplay="caption"]').first().getAttribute("data-line").catch(() => null);
    if (opening !== "intro") throw new Error(`${vp}: the lesson is on step "${opening}" right after "Mulai" (expected its first step, "intro")`);
    // Also asked for by the click's own unlock() play: the early fetch alone is shown by 3 and 5.
    console.log(
      `  early fetch 2/5: ${name(mine)} requested ${askedAfter} ms after "Mulai", the lesson on step "${opening}" (line ${line ?? "—"}), before the imam's step ` +
        `(the click's own silent play asks for it too: steps 3 and 5 show the early fetch alone)`,
    );

    // 4, first half. The imam's step with the network free: can this runner play him at all?
    await toStep(page, vp, "recite");
    const cue = await narratedLine(KARAOKE.slug, "al-fatihah:1:recite");
    const cueMs = (cue.url && index.get(cue.url)) || 10_000;
    const lit = stage.locator('button[aria-current="true"]');
    const status = page.locator('[data-autoplay="loading"][data-kind="recitation"]');
    const replay = page.locator('[data-autoplay="replay"]');
    /** The place of the mushaf word lit as "being recited" (its chip's data-word); null: none. */
    const litWord = async () => {
      const [place] = await lit.evaluateAll((els) => els.map((el) => el.getAttribute("data-word")));
      if (place === undefined) return null;
      if (!/^[1-9]\d*$/.test(place ?? "")) throw new Error(`${vp}: early fetch — the mushaf word lit carries no data-word (${place}): its place cannot be read (AyahPlayer.tsx)`);
      return Number(place);
    };
    /** The words of recording `url` that light only once it has ADVANCED: those whose segment
     *  starts after 0 ms (the word at 0 ms lights on the "play" event, before any data). */
    const laterWords = (url) => new Set((recitations(1).find((r) => r.url === url)?.segments ?? []).filter(([, startMs]) => startMs > 0).map(([word]) => word));
    /** "↺ Ulangi" on the imam's step, playing recording `url`, then: ms until he SOUNDS — a later
     *  word of his lit, and not merely the chip the turn before left lit (null: not in time) —
     *  and whether "Memuat bacaan imam…" showed first (`stopOnStatus`: that ends the watch, the
     *  play is waiting for the network). Leaves the lesson paused on that step. */
    const imamTurn = async (url, stopOnStatus) => {
      const proof = laterWords(url);
      if (!proof.size) throw new Error(`${vp}: early fetch — ${name(url)} has no word that starts after 0 ms in content/al-fatihah.json: nothing shows that it advanced`);
      // A recitation paused mid-ayah keeps its word lit: not this turn's until the line changes.
      const before = await litWord();
      let changed = false;
      const t = Date.now();
      await replay.click();
      let sounded = null;
      let word = null;
      let waited = false;
      while (sounded === null && !(waited && stopOnStatus) && Date.now() - t < cueMs + 15_000) {
        const w = await litWord();
        if (w !== before) changed = true;
        if (w !== null && proof.has(w) && changed) [sounded, word] = [Date.now() - t, w];
        else if ((await status.count()) > 0) waited = true;
        if (sounded === null) await page.waitForTimeout(100);
      }
      const took = Date.now() - t;
      if ((await middle.getAttribute("data-mode").catch(() => null)) === "pause") await middle.click();
      await page.waitForTimeout(150);
      const at = await stage.getAttribute("data-step");
      if (at !== "recite") throw new Error(`${vp}: early fetch — the lesson left the imam's step for "${at}" while it was watched`);
      return { sounded, word, waited, took };
    };
    const base = await imamTurn(mine, false);
    const codec = await page.evaluate(() => document.createElement("audio").canPlayType("audio/mpeg"));
    const canSound = base.sounded !== null;
    /** Why the RUNNER, not the page, may be why recording `url` is not there to play; null: the
     *  page has it (answered in full) or cancelled the fetch itself — nothing to blame the runner
     *  for. A request the page aborts ends as net::ERR_ABORTED; the CDN's own failures do not. */
    const runnerFault = (url) => {
      const how = answered.get(url);
      if (!codec) return 'this browser plays no MP3 (canPlayType("audio/mpeg") is empty)';
      if (how === undefined) return `the reciters' host has not answered ${name(url)}`;
      if (how === "ok" || how.startsWith("failed (net::ERR_ABORTED")) return null;
      return `the reciters' host did not answer ${name(url)} in full (${how})`;
    };
    /** Step 4 left unchecked for the runner's sake: said where it shows, on the run's summary. */
    const notChecked = (why) => console.log(`::warning title=Belajar early fetch 4/5 not checked::${vp}: ${why}`);
    if (canSound) {
      console.log(
        `  early fetch 4/5, network free: the imam sounded (word ${base.word} lit) ${base.sounded} ms after "↺ Ulangi" (his cue line is ${cueMs} ms)${base.waited ? ", after a loading status" : ""}`,
      );
    } else {
      const state = `no later word lit in ${base.took} ms; ${name(mine)} → ${answered.get(mine) ?? "no answer"}; canPlayType("audio/mpeg") = "${codec}"`;
      const blame = runnerFault(mine);
      // The page had what it needs and the imam stayed silent: the lesson is broken, not the runner.
      if (!blame) throw new Error(`${vp}: with the network free the imam did not sound on his step (${state}) — the page had the recording, or cancelled its own fetch of it`);
      console.log(`  early fetch 4/5: the imam does not sound on this runner (${state})`);
      notChecked(`the imam's recitation was not heard at all — ${blame}`);
    }

    // 3. Another reciter, chosen with the lesson paused on the imam's step: fetched when chosen.
    let file = mine;
    const others = recitations(1).map((r) => r.url).filter((u) => u !== mine);
    const settings = page.locator('[data-autoplay="settings"]');
    const select = settings.locator("select");
    await settingsToggle.click();
    await settings.waitFor({ state: "visible", timeout: 5_000 });
    if (others.length && (await select.count()) > 0) {
      const other = await select.evaluate((el) => [...el.options].findIndex((o) => !o.selected));
      const [req] = await Promise.all([
        page.waitForRequest((r) => others.includes(r.url()), { timeout: 5_000 }).catch(() => {
          throw new Error(`${vp}: 5 s after another reciter was chosen, his recording was not requested (requests: ${seen.map(name).join(", ")})`);
        }),
        select.selectOption({ index: other }),
      ]);
      const chosen = await stage.getAttribute("data-reciter");
      file = urlOf(1, chosen);
      const mode = await middle.getAttribute("data-mode");
      const problems = [];
      if (chosen === reciter) problems.push("the stage's data-reciter did not change");
      if (req.url() !== file) problems.push(`requested ${name(req.url())}, not the chosen reciter's ${file ? name(file) : "(none)"}`);
      if (mode === "pause") problems.push("the lesson is playing (the check wants it paused, so that no play asked for the file)");
      if (problems.length) throw new Error(`${vp}: another reciter chosen — ${problems.join("; ")}`);
      console.log(`  early fetch 3/5: ${chosen} chosen with the lesson paused → ${name(file)} requested at once`);
    } else {
      console.log("  early fetch 3/5 skipped: this ayah has one reciter");
    }
    await settingsToggle.click();
    await settings.waitFor({ state: "hidden", timeout: 5_000 });

    // 4, second half. That recording was fetched ahead, by nothing else: with the network held
    // back, the imam's step must play it all the same, and ask the network for nothing.
    await until(page, () => answered.has(file), 20_000);
    if (!canSound) {
      console.log("  early fetch 4/5 not checked on this runner: the imam does not sound here (above)");
    } else if (answered.get(file) !== "ok") {
      const blame = runnerFault(file);
      // The page cancelled the very fetch it made ahead: what this step is there to catch.
      if (!blame) throw new Error(`${vp}: the recording fetched ahead (${name(file)}) was cancelled by the page itself before it was played (${answered.get(file)})`);
      console.log(`  early fetch 4/5 not checked on this runner: ${blame}`);
      notChecked(`played from what was fetched ahead — ${blame}`);
    } else {
      await page.route(isRecitation, hold);
      try {
        const held = await imamTurn(file, true);
        const again = heldBack.filter((u) => u === file).length;
        const problems = [];
        if (held.waited) problems.push("“Memuat bacaan imam…” showed");
        else if (held.sounded === null) problems.push("no later word of his lit (he did not sound)");
        if (again > 0) problems.push(`${again} new request(s) for ${name(file)} went to the network`);
        if (problems.length) {
          throw new Error(
            `${vp}: the imam's step did not play what was fetched ahead — ${problems.join("; ")} within ${held.took} ms of "↺ Ulangi", ` +
              `the network held back ${RECITE_HOLD_MS} ms (with the network free he sounded after ${base.sounded} ms)`,
          );
        }
        console.log(
          `  early fetch 4/5: with the reciters' host held back ${RECITE_HOLD_MS} ms, the imam sounded (word ${held.word} lit) ${held.sounded} ms after "↺ Ulangi", ` +
            `no loading status, no new request for ${name(file)} — played from what was fetched ahead`,
        );
      } finally {
        await page.unroute(isRecitation, hold);
      }
    }

    // 5. A recording is fetched by the page that plays it. Up to the recap: nothing but this
    //    ayah's, by the reciters chosen. Then the hand-off: ayah 2's player fetches its own at once.
    await toStep(page, vp, "recap");
    await page.waitForTimeout(RECAP_SETTLE_MS);
    const strangers = [...new Set(seen)].filter((u) => u !== mine && u !== file);
    if (strangers.length) {
      throw new Error(`${vp}: on ayah 1, ${RECAP_SETTLE_MS} ms into the recap, recordings this page does not play were requested: ${strangers.map(name).join(", ")} (a recording is fetched by the page that plays it)`);
    }
    await handOffToAyah2(page);
    const t2 = Date.now();
    const reciter2 = await stage.getAttribute("data-reciter");
    const theirs = reciter2 ? urlOf(2, reciter2) : null;
    if (!theirs) throw new Error(`${vp}: hand-off — the stage's data-reciter on ayah 2 (${reciter2}) names no recording of Al-Fatihah 2 in content/al-fatihah.json`);
    if (!(await until(page, () => requested(theirs) > 0, 5_000))) {
      throw new Error(`${vp}: 5 s after the lesson went on to ayah 2 by itself, its recording (${name(theirs)}) was not requested (requests: ${seen.map(name).join(", ")})`);
    }
    const at = await stage.getAttribute("data-step");
    if (at !== "intro") throw new Error(`${vp}: after the hand-off ${name(theirs)} was requested only on step "${at}", not while the first line plays`);
    console.log(
      `  early fetch 5/5: nothing but ${[...new Set([mine, file])].map(name).join(" and ")} requested on ayah 1 (to its recap); on ayah 2, reached by the lesson itself, ` +
        `${name(theirs)} requested within ${Date.now() - t2} ms of its start, the lesson on step "${at}" — no click, before the imam's step`,
    );
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-early-fetch-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the early fetch of the imam's recitation check (Al-Fatihah 1 → 2) failed`);
    console.error(`  requests to the reciters' host (${seen.length}):\n    ${list()}`);
    throw err;
  } finally {
    stop();
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/**
 * Installed with addInitScript (aheadChecks), before the page's own scripts: navigator.wakeLock
 * replaced by a recorder — every request("screen") and every sentinel released (by the page:
 * "release"; dropped as a browser drops it: "dropped") goes into window.__belajarWakeLog — and the
 * page's visibility put under the check's control (window.__belajarSetHidden(true | false):
 * document.visibilityState / hidden, the locks dropped on hiding, a visibilitychange event each
 * time). window.__belajarDropLock() drops the locks while the page stays visible (a browser taking
 * them back for its own reasons). As a browser's WakeLockSentinel does, a sentinel fires "release"
 * whenever it ends. A request while hidden is refused, as a browser refuses it. Runs in the page
 * (serialised by Playwright): plain browser JavaScript only.
 */
function wakeLockStub() {
  const log = [];
  const held = new Set();
  let hidden = false;
  class Sentinel extends EventTarget {
    constructor() {
      super();
      this.type = "screen";
      this.released = false;
      this.onrelease = null;
    }
    release() {
      if (!this.released) {
        this.released = true;
        held.delete(this);
        log.push({ t: "release", at: Date.now() });
        this.dispatchEvent(new Event("release"));
      }
      return Promise.resolve();
    }
  }
  const wakeLock = {
    request(type) {
      log.push({ t: "request", type, hidden, at: Date.now() });
      if (hidden) return Promise.reject(new DOMException("The document is hidden", "NotAllowedError"));
      const s = new Sentinel();
      held.add(s);
      return Promise.resolve(s);
    },
  };
  const drop = () => {
    for (const s of [...held]) {
      s.released = true;
      held.delete(s);
      log.push({ t: "dropped", at: Date.now() });
      s.dispatchEvent(new Event("release"));
    }
  };
  Object.defineProperty(Navigator.prototype, "wakeLock", { configurable: true, get: () => wakeLock });
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => hidden });
  window.__belajarWakeLog = log;
  window.__belajarDropLock = drop;
  window.__belajarSetHidden = (h) => {
    hidden = h;
    if (h) drop();
    document.dispatchEvent(new Event("visibilitychange"));
  };
}

/** The delivered file(s) of manifest line `id` in `lines`: the line's, or its split parts'. */
function lineFiles(lines, id) {
  if (lines[id]?.audio?.url) return [lines[id].audio.url];
  const out = [];
  for (let c = 97; c <= 122 && lines[`${id}:${String.fromCharCode(c)}`]?.audio?.url; c++) out.push(lines[`${id}:${String.fromCharCode(c)}`].audio.url);
  return out;
}

/**
 * The two behaviours of operator 2026-10-12 (docs/belajar-plan.md L18) on Al-Fatihah 1, phone, in
 * a page of its own (an init script stays with its page for good, so the stub never reaches the
 * other checks), its remembered place cleared. The narration is answered in the browser
 * (narrationRoute): every request is recorded with its kind ("media": an audio element; "fetch":
 * the page's fetch() ahead) and its times; every fetch() is held back AHEAD_HOLD_MS, so that two
 * made at once would overlap; one file's fetch() is made to fail (503: the first line of the
 * harakat primer); and the check holds back two of the PLAYER's own loads (a slow connection for
 * that file). navigator.wakeLock is the recorder above.
 *   1. A page view alone, AHEAD_IDLE_MS after load: no fetch() of narration at all, nothing but
 *      the idle warm of the first line ("shared:start", by the narration player's preload
 *      element), and no wake lock asked for.
 *   2. "Mulai", with the opening line's own load held back AHEAD_OPEN_HOLD_MS: the wake lock is
 *      asked for ("screen"), once.
 *   3. NO FETCH AHEAD WHILE THE SOUND IS LOADING (review 2026-10-12: the first version of this
 *      check compared two times that could not be out of order): the player's request for the
 *      opening line is there and really was held; part-way through the hold nothing has been
 *      fetched; and the first fetch() starts only after that load was answered plus the settle
 *      time (AHEAD_SETTLE_MS, the app's PREFETCH_SETTLE_MS).
 *   4. While the lesson is still on its first step ("intro": the opening line, then the intro
 *      line, ~36 s): the page fetches the next line of this step (the intro line), then the next
 *      step's (the ayah: "al-fatihah:1:recite"), then the step after's (the harakat primer) —
 *      ONE AT A TIME (each fetch() starts after the previous was answered); each file once;
 *      nothing but those (never a later step's, never another ayah's); and NO audio element asks
 *      for any of them (the preload element downloads nothing the page fetches: no file twice)
 *      until the fetches go quiet.
 *   5. A LINE FETCHED AHEAD PLAYS FROM THE PAGE'S COPY (review 2026-10-12: played from what was
 *      fetched, on every browser): when the lesson reaches the intro line by itself, its karaoke
 *      caption runs (the audio clock advances: words said) and the file has had ONE request in
 *      all — the page's fetch. The player made none: an object URL never reaches the network.
 *      No loading status either.
 *   6. A FILE THE PAGE COULD NOT FETCH PLAYS FROM THE NETWORK, AND A STALLED LINE STOPS NEW
 *      FETCHES: "Berikutnya ›" twice, to the primer, whose first line's fetch() failed in 4 and
 *      whose own load is now held back AHEAD_STALL_MS. The player asks the network for it (never
 *      silence: its karaoke caption runs once it is answered), "Memuat suara narator…" shows
 *      meanwhile as it always did, and from that request until it was answered plus the settle
 *      time NO fetch() starts — though one is due (the step two ahead of the primer), and comes
 *      right after.
 *   7. The wake lock through the lesson's life: the browser dropping it while the page is visible
 *      (held since "Mulai") → asked for again at once; "Jeda" releases it; "Lanjutkan" asks again;
 *      dropped again right after that grant → NOT asked again (no loop with a browser that drops
 *      every lock); the page hidden: nothing asked for; visible again: asked for again.
 *   8. The hand-off keeps it (review 2026-10-12: a release for even a moment can let a phone left
 *      untouched turn its screen off right there): from the recap, "Lanjutkan" lets the lesson
 *      play to its end and go on to Al-Fatihah 2 by itself; from that request on there is no
 *      release and no new request — ayah 2's lesson adopts the lock — while it runs there.
 *   9. A hand-off nobody takes up is released after the grace (WAKE_GRACE_MS, the app's
 *      WAKE_HANDOFF_GRACE_MS): ayah 2's lesson goes on to ayah 3 from its paused recap, with the
 *      hand-off mark the page writes made unusable (sessionStorage), so ayah 3 does not start by
 *      itself and shows "Mulai"; the lock kept for the hand-off is released about WAKE_GRACE_MS
 *      after ayah 3's page appeared — not at the page change.
 *   (The stub's log is the document's: the hand-off is a client-side navigation, the init script
 *   does not run again, so one log spans the three ayat.)
 * What this cannot show: a real phone's screen staying on, the lock let go after two minutes at an
 * exercise (unit-tested over every exercise: src/components/autoplay/ahead.test.ts — too long to
 * wait for here), and Safari / iOS playing the copies (this is Chromium) — a phone does those.
 * Fails the job on 1–9.
 */
const AHEAD_HOLD_MS = 1000;
const AHEAD_IDLE_MS = 4000;
const AHEAD_QUIET_MS = 3000;
const AHEAD_OPEN_HOLD_MS = 3000;
const AHEAD_STALL_MS = 4000;
/** Times are taken in this process as requests arrive and are answered: a little slack. */
const AHEAD_SLACK_MS = 150;
/** = src/lib/autoplay/prefetch.ts PREFETCH_SETTLE_MS (ahead.test.ts checks they agree). */
const AHEAD_SETTLE_MS = 500;
/** = src/lib/autoplay/wake.ts WAKE_HANDOFF_GRACE_MS (ahead.test.ts checks they agree). */
const WAKE_GRACE_MS = 10000;
/** = src/lib/autoplay/wake.ts WAKE_REASK_MIN_HELD_MS (ahead.test.ts checks they agree). */
const WAKE_REASK_MIN_HELD_MS = 5000;
async function aheadChecks(page, vp, index) {
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8")).Guided;
  const shared = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "narration", "shared.json"), "utf8")).lines ?? {};
  const lines = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "narration", "al-fatihah.json"), "utf8")).lines ?? {};
  const INTRO = "al-fatihah:1:intro";
  const PRIMER_1 = "al-fatihah:1:primer:1";
  const startUrl = lineFiles(shared, "shared:start")[0];
  const introFiles = lineFiles(lines, INTRO);
  const reciteFiles = lineFiles(lines, "al-fatihah:1:recite");
  // The primer's lines, a split one ("…:primer:3:a", ":b") by its own id.
  const primerIds = [...new Set(Object.keys(lines).flatMap((id) => /^(al-fatihah:1:primer:\d+)(?::[a-z])?$/.exec(id)?.[1] ?? []))];
  const primerFiles = [...new Set(primerIds.flatMap((id) => lineFiles(lines, id)))];
  const [intro1, recite1, primer1] = [introFiles[0], reciteFiles[0], lineFiles(lines, PRIMER_1)[0]];
  const [introLine, primerLine] = [await narratedLine("al-fatihah", INTRO), await narratedLine("al-fatihah", PRIMER_1)];
  if (!startUrl || !intro1 || !recite1 || !primer1 || !introLine.voiced || !primerLine.voiced) {
    throw new Error(
      `${vp}: look-ahead check — Al-Fatihah 1's opening lines have no rendered narration (shared:start ${!!startUrl}, intro ${introFiles.length}, recite ${!!recite1}, primer:1 ${!!primer1}; ` +
        `word timings: intro ${introLine.voiced}, primer:1 ${primerLine.voiced})`,
    );
  }
  /** What the page may fetch while the lesson is on "intro": the rest of that step (the intro
   *  line) and the next two steps' files. */
  const ahead = new Set([...introFiles, ...reciteFiles, ...primerFiles]);
  const short = (p) => p.split("/").slice(-2).join("/");

  const pg = await page.context().newPage();
  await pg.addInitScript(wakeLockStub);
  const served = [];
  const timeline = [];
  const delays = new Map();
  // The page's copy of the primer's first line cannot be made (step 6).
  const failFetch = new Set([primer1]);
  const handler = narrationRoute(index, served, { delays, timeline, holdFetchMs: AHEAD_HOLD_MS, failFetch });
  await pg.route(isNarration, handler);
  const stage = pg.locator('[data-autoplay="stage"]');
  const middle = pg.locator('[data-autoplay="middle"]');
  const forward = pg.locator('[data-autoplay="next"]');
  const status = pg.locator('[data-autoplay="loading"]');
  const caption = (line) => pg.locator(`[data-autoplay="caption"][data-line="${line}"]`);
  const wakeLog = () => pg.evaluate(() => window.__belajarWakeLog ?? null);
  const requests = async () => ((await wakeLog()) ?? []).filter((e) => e.t === "request");
  const fetches = (from) => timeline.slice(from).filter((e) => e.type === "fetch");
  const t0 = { at: 0 };
  const rel = (ms) => (ms === null ? "…" : `${ms - t0.at}`);
  try {
    await pg.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await pg.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    const mark = timeline.length;
    await pg.reload({ waitUntil: "networkidle" });
    await pg.evaluate(() => document.fonts.ready);
    if (!Array.isArray(await wakeLog())) throw new Error(`${vp}: the wake-lock recorder is not installed (addInitScript)`);

    // 1. A page view alone.
    await pg.waitForTimeout(AHEAD_IDLE_MS);
    const before = timeline.slice(mark);
    const strays = before.filter((e) => e.type === "fetch" || e.path !== startUrl);
    if (strays.length) {
      throw new Error(`${vp}: a page view alone asked for narration beyond the idle warm of the first line: ${strays.map((e) => `${short(e.path)} (${e.type})`).join(", ")}`);
    }
    if ((await wakeLog()).length) throw new Error(`${vp}: a page view alone asked for the wake lock: ${JSON.stringify(await wakeLog())}`);
    console.log(`  ahead 1/9: a page view (${AHEAD_IDLE_MS} ms idle): ${before.length ? `only the idle warm of ${short(startUrl)} (${before.map((e) => e.type).join(", ")})` : "no narration request"}, no fetch(), no wake lock`);

    // 2. "Mulai", its opening line slow to come: the screen is kept on.
    delays.set(startUrl, AHEAD_OPEN_HOLD_MS);
    const mark2 = timeline.length;
    t0.at = Date.now();
    await pg.locator('[data-autoplay="start"]').click();
    if (!(await until(pg, async () => (await requests()).length > 0, 5_000))) throw new Error(`${vp}: 5 s after "Mulai" no wake lock was asked for`);
    const [first] = await requests();
    if (first.type !== "screen" || first.hidden) throw new Error(`${vp}: the wake lock asked for after "Mulai" is ${JSON.stringify(first)} (expected "screen", page visible)`);
    console.log(`  ahead 2/9: wake lock ("screen") asked for ${first.at - t0.at} ms after "Mulai"`);

    // 3. While the opening line loads, nothing is fetched ahead.
    const opening = () => timeline.slice(mark2).find((e) => e.path === startUrl && e.type === "media");
    if (!(await until(pg, () => !!opening(), 5_000))) {
      throw new Error(`${vp}: 5 s after "Mulai" the player had not asked for the opening line (${short(startUrl)}): nothing to hold back, the check cannot show the wait`);
    }
    await pg.waitForTimeout(AHEAD_OPEN_HOLD_MS - 1_200);
    if (opening().end === null && fetches(mark2).length) {
      throw new Error(`${vp}: while the opening line was still loading (held back ${AHEAD_OPEN_HOLD_MS} ms), the page fetched ahead: ${fetches(mark2).map((e) => `${short(e.path)} at ${rel(e.start)} ms`).join(", ")}`);
    }
    // The playing stage appears once the line is heard.
    await settleScroll(pg);
    delays.delete(startUrl);
    const onIntro = async (what) => {
      const at = await stage.getAttribute("data-step");
      if (at !== "intro") throw new Error(`${vp}: ${what} only once the lesson was on step "${at}", not while it is still on its first step ("intro")`);
    };
    if (!(await until(pg, () => fetches(mark2).some((e) => e.path === primer1), 25_000))) {
      throw new Error(`${vp}: 25 s after "Mulai" the primer's first line (${short(primer1)}) was not fetched ahead (fetches: ${fetches(mark2).map((e) => short(e.path)).join(", ") || "none"})`);
    }
    await onIntro(`${short(primer1)} was fetched`);
    const load = opening();
    const firstFetch = fetches(mark2)[0];
    const held = (load.end ?? Date.now()) - load.start;
    if (load.end === null || held < AHEAD_OPEN_HOLD_MS - AHEAD_SLACK_MS) {
      throw new Error(`${vp}: the opening line's own load was answered after ${held} ms${load.end === null ? " (not yet)" : ""}, not held back ${AHEAD_OPEN_HOLD_MS} ms: the check cannot show the wait`);
    }
    if (firstFetch.start < load.end + AHEAD_SETTLE_MS - AHEAD_SLACK_MS) {
      throw new Error(
        `${vp}: the first fetch ahead (${short(firstFetch.path)}) started at ${rel(firstFetch.start)} ms, ${firstFetch.start - load.end} ms after the opening line's own load was answered (${rel(load.end)} ms) — ` +
          `a new fetch must wait for the sound that is loading, then ${AHEAD_SETTLE_MS} ms more`,
      );
    }
    console.log(
      `  ahead 3/9: the opening line's load held back ${held} ms (${rel(load.start)}–${rel(load.end)} ms): no fetch() until ${rel(firstFetch.start)} ms, ` +
        `${firstFetch.start - load.end} ms after it was answered (settle ${AHEAD_SETTLE_MS} ms)`,
    );

    // 4. On the first step: the rest of it and the next two steps fetched, one at a time, each
    //    once — and no audio element downloading any of them. Until the fetches go quiet: the
    //    whole look-ahead of this moment.
    let count = -1;
    let still = 0;
    for (const end = Date.now() + 30_000; Date.now() < end && still < AHEAD_QUIET_MS; ) {
      const n = fetches(mark2).length;
      still = n === count && fetches(mark2).every((e) => e.end !== null) ? still + 250 : 0;
      count = n;
      await pg.waitForTimeout(250);
    }
    await onIntro("the fetches went quiet");
    const got = fetches(mark2);
    const problems = [];
    const order = got.map((e) => e.path);
    if (order[0] !== intro1) problems.push(`the first fetched is ${short(order[0] ?? "(none)")}, not the next line of this step ${short(intro1)}`);
    if (!order.includes(recite1)) problems.push(`the next step's first line ${short(recite1)} was not fetched`);
    else if (order.indexOf(recite1) < order.lastIndexOf(introFiles.at(-1))) problems.push(`${short(recite1)} was fetched before this step's own ${short(introFiles.at(-1))}`);
    if (order.indexOf(primer1) < order.indexOf(recite1)) problems.push(`${short(primer1)} was fetched before ${short(recite1)}`);
    if (new Set(order).size !== order.length) problems.push("a file was fetched twice");
    const outside = order.filter((p) => !ahead.has(p));
    if (outside.length) problems.push(`fetched beyond this step and the next two: ${outside.map(short).join(", ")}`);
    // (Two made at once would overlap by the whole hold, AHEAD_HOLD_MS: the slack hides nothing.)
    for (let i = 1; i < got.length; i++) {
      if (got[i - 1].end === null || got[i].start < got[i - 1].end - AHEAD_SLACK_MS) {
        problems.push(`${short(got[i].path)} was asked for at ${rel(got[i].start)} ms while ${short(got[i - 1].path)} (asked at ${rel(got[i - 1].start)} ms) was answered only at ${rel(got[i - 1].end)} ms: two at once`);
      }
    }
    const byElement = timeline.slice(mark2).filter((e) => e.type !== "fetch" && e.path !== startUrl);
    if (byElement.length) problems.push(`an audio element asked for ${byElement.map((e) => `${short(e.path)} at ${rel(e.start)} ms`).join(", ")}: a file the page fetches is downloaded twice`);
    if (problems.length) throw new Error(`${vp}: the look-ahead on the first step — ${problems.join("; ")}`);
    console.log(
      `  ahead 4/9: on step "intro", ${got.length} file(s) fetched ahead, one at a time (held ${AHEAD_HOLD_MS} ms each): ` +
        got.map((e) => `${short(e.path)} ${rel(e.start)}–${rel(e.end)} ms`).join(", ") +
        ` — this step's next line, the next step's, then the primer's; nothing past them, and no audio element asked for any of them`,
    );

    // 5. The intro line, reached by the lesson itself, plays from the page's copy.
    const intro = caption(INTRO);
    try {
      await intro.locator('[data-karaoke="now"]').first().waitFor({ state: "attached", timeout: 45_000 });
    } catch {
      throw new Error(`${vp}: 45 s on, the intro line's karaoke caption never ran (on step "${await stage.getAttribute("data-step").catch(() => null)}", line ${await pg.locator('[data-autoplay="caption"]').first().getAttribute("data-line").catch(() => null)}): the copy fetched ahead did not play`);
    }
    const said = () => intro.locator('[data-karaoke="said"]').count();
    const saidThen = await said();
    await pg.waitForTimeout(2_500);
    const saidNow = await said();
    const asked = timeline.slice(mark2).filter((e) => e.path === intro1);
    const copyProblems = [];
    if (saidNow <= saidThen) copyProblems.push(`its karaoke caption does not advance (${saidThen} → ${saidNow} word(s) said in 2.5 s): the audio clock is not running`);
    if (asked.length !== 1 || asked[0].type !== "fetch") {
      copyProblems.push(`${short(intro1)} was requested ${asked.length} time(s) (${asked.map((e) => `${e.type} at ${rel(e.start)} ms`).join(", ")}): expected the page's one fetch and no request by the player`);
    }
    if ((await status.count()) > 0) copyProblems.push("a loading status shows while it plays");
    if (copyProblems.length) throw new Error(`${vp}: the intro line, fetched ahead, is not played from the page's copy — ${copyProblems.join("; ")}`);
    console.log(`  ahead 5/9: the intro line plays (karaoke ${saidThen} → ${saidNow} word(s) said) and ${short(intro1)} had one request in all, the page's fetch at ${rel(asked[0].start)} ms: played from the copy, no second download`);

    // 6. A file the page could not fetch: from the network; while it loads, no new fetch.
    const failed = timeline.slice(mark2).filter((e) => e.path === primer1);
    if (failed.length !== 1 || failed[0].type !== "fetch") throw new Error(`${vp}: ${short(primer1)} (its fetch() answered 503) was requested ${failed.length} time(s) before its step (${failed.map((e) => e.type).join(", ")}): expected the one failed fetch, not tried again`);
    delays.set(primer1, AHEAD_STALL_MS);
    const mark6 = timeline.length;
    await forward.click(); // the ayah ("recite")
    await forward.click(); // the harakat primer
    if (!(await until(pg, async () => (await stage.getAttribute("data-step")) === "primer", 5_000))) {
      throw new Error(`${vp}: two "Berikutnya ›" from the first step did not reach the primer (on "${await stage.getAttribute("data-step")}")`);
    }
    const stream = () => timeline.slice(mark6).find((e) => e.path === primer1 && e.type === "media");
    if (!(await until(pg, () => !!stream(), 3_000))) {
      throw new Error(`${vp}: on the primer, whose first line the page could not fetch, the player did not ask the network for ${short(primer1)} within 3 s (requests since: ${timeline.slice(mark6).map((e) => `${short(e.path)} ${e.type}`).join(", ") || "none"})`);
    }
    try {
      await status.waitFor({ state: "visible", timeout: 2_000 });
    } catch {
      throw new Error(`${vp}: the primer's first line is loading from the network (held back ${AHEAD_STALL_MS} ms) and no loading status shows`);
    }
    const [text, kind] = [(await status.innerText()).replace(/\s+/g, " ").trim(), await status.getAttribute("data-kind")];
    if (text !== msgs.loading_narration || kind !== "narration") throw new Error(`${vp}: the loading status says “${text}” (data-kind ${kind}), expected “${msgs.loading_narration}” (narration)`);
    // "Played" is the held request ANSWERED and then the caption's words being said. Not the first
    // word marked "now": the caption marks it the moment play is asked for, before any audio has
    // arrived (CI 2026-10-13: it showed 822 ms into the 4 s hold, and the check took the hold for
    // broken).
    if (!(await until(pg, () => stream().end !== null, AHEAD_STALL_MS + 10_000))) {
      throw new Error(`${vp}: the primer's first line, held back ${AHEAD_STALL_MS} ms, was never answered (${Date.now() - stream().start} ms on)`);
    }
    delays.delete(primer1);
    const primerSaid = () => caption(PRIMER_1).locator('[data-karaoke="said"]').count();
    const saidAtAnswer = await primerSaid();
    if (!(await until(pg, async () => (await primerSaid()) > saidAtAnswer, 10_000))) {
      throw new Error(`${vp}: the primer's first line never played from the network after its fetch ahead had failed (${saidAtAnswer} word(s) said 10 s after its load was answered; line on screen: ${await pg.locator('[data-autoplay="caption"]').first().getAttribute("data-line").catch(() => null)})`);
    }
    const line = stream();
    const stalled = line.end - line.start;
    if (stalled < AHEAD_STALL_MS - AHEAD_SLACK_MS) throw new Error(`${vp}: the primer's first line was answered after ${stalled} ms, not held back ${AHEAD_STALL_MS} ms: the check cannot show the stall`);
    const since = timeline.slice(timeline.indexOf(line) + 1).filter((e) => e.type === "fetch");
    const during = since.filter((e) => e.start < line.end + AHEAD_SETTLE_MS - AHEAD_SLACK_MS);
    if (during.length) {
      throw new Error(`${vp}: while the primer's first line was loading (${rel(line.start)}–${rel(line.end)} ms), the page started fetching ahead: ${during.map((e) => `${short(e.path)} at ${rel(e.start)} ms`).join(", ")}`);
    }
    const fetchesAfter = () => timeline.slice(timeline.indexOf(line) + 1).filter((e) => e.type === "fetch");
    if (!(await until(pg, () => fetchesAfter().length > 0, 10_000))) {
      throw new Error(`${vp}: 10 s after the stalled line played, nothing more was fetched ahead — with nothing due, the wait above shows no closed gate (the step two ahead of the primer has narration: was it fetched before? ${timeline.slice(mark2, mark6).map((e) => short(e.path)).join(", ")})`);
    }
    const next = fetchesAfter()[0];
    if ((await status.count()) > 0) throw new Error(`${vp}: the loading status is still there while the primer's first line plays`);
    console.log(
      `  ahead 6/9: ${short(primer1)} (fetch() failed) played from the network, “${text}” shown while it loaded (held back ${stalled} ms, ${rel(line.start)}–${rel(line.end)} ms); ` +
        `no fetch() meanwhile, the next one (${short(next.path)}) ${next.start - line.end} ms after it was answered`,
    );

    // 7. The wake lock through the lesson's life: dropped while visible, pause, resume, dropped
    //    at once, hidden, visible.
    const wakeEvents = async () => ((await wakeLog()) ?? []).map((e) => e.t);
    if ((await requests()).length !== 1) throw new Error(`${vp}: the wake lock was asked for ${(await requests()).length} times while the lesson ran (expected once): ${(await wakeEvents()).join(", ")}`);
    if ((await middle.getAttribute("data-mode")) !== "pause") throw new Error(`${vp}: the middle button is "${await middle.getAttribute("data-mode")}", not "pause", while the lesson runs`);
    const heldFor = Date.now() - t0.at;
    if (heldFor < WAKE_REASK_MIN_HELD_MS + 1_000) await pg.waitForTimeout(WAKE_REASK_MIN_HELD_MS + 1_000 - heldFor);
    await pg.evaluate(() => window.__belajarDropLock());
    if (!(await until(pg, async () => (await requests()).length === 2, 3_000))) {
      throw new Error(`${vp}: the browser dropped the wake lock while the page was visible and the lesson ran, and it was not asked for again (${(await wakeEvents()).join(", ")})`);
    }
    await middle.click();
    if (!(await until(pg, async () => (await wakeEvents()).includes("release"), 3_000))) throw new Error(`${vp}: "Jeda" did not release the wake lock (${(await wakeEvents()).join(", ")})`);
    await middle.click();
    if (!(await until(pg, async () => (await requests()).length === 3, 3_000))) throw new Error(`${vp}: "Lanjutkan" did not ask for the wake lock again (${(await wakeEvents()).join(", ")})`);
    // Dropped straight after that grant: not asked for again (no loop).
    await pg.evaluate(() => window.__belajarDropLock());
    await pg.waitForTimeout(1_500);
    if ((await requests()).length !== 3) {
      throw new Error(`${vp}: a wake lock dropped right after it was granted (within ${WAKE_REASK_MIN_HELD_MS} ms) was asked for again (${(await wakeEvents()).join(", ")}): a browser that drops every lock would be asked in a loop`);
    }
    await pg.evaluate(() => window.__belajarSetHidden(true));
    await pg.waitForTimeout(1_000);
    if ((await requests()).length !== 3) throw new Error(`${vp}: the wake lock was asked for while the page was hidden (${(await wakeEvents()).join(", ")})`);
    await pg.evaluate(() => window.__belajarSetHidden(false));
    if (!(await until(pg, async () => (await requests()).length === 4, 3_000))) throw new Error(`${vp}: visible again with the lesson running, the wake lock was not asked for again (${(await wakeEvents()).join(", ")})`);
    if ((await requests()).some((e) => e.hidden)) throw new Error(`${vp}: a wake lock was asked for while hidden`);
    console.log(`  ahead 7/9: wake lock — ${(await wakeEvents()).join(" → ")} (Mulai, dropped while visible, Jeda, Lanjutkan, dropped at once, hidden, visible)`);

    // 8. The hand-off keeps the lock: the lesson plays from its recap to its end, on to ayah 2.
    const wakeSince = async (from) => ((await wakeLog()) ?? []).slice(from).map((e) => e.t);
    await toStep(pg, vp, "recap"); // paused there (a release)
    const mark8 = (await wakeLog()).length;
    await middle.click(); // "Lanjutkan": the recap, the last step, then the hand-off by itself
    try {
      await pg.waitForURL(/\/quran\/al-fatihah\/2(\?.*)?$/, { timeout: 60_000 });
    } catch {
      throw new Error(`${vp}: 60 s after "Lanjutkan" on the recap the lesson had not gone on to Al-Fatihah 2 by itself (on step "${await stage.getAttribute("data-step").catch(() => null)}"; wake lock ${(await wakeSince(mark8)).join(", ")})`);
    }
    await pg.locator('[data-autoplay="panel"]').first().waitFor({ state: "visible", timeout: 15_000 });
    if (!(await until(pg, async () => (await middle.getAttribute("data-mode").catch(() => null)) === "pause", 10_000))) {
      throw new Error(`${vp}: on Al-Fatihah 2 after the hand-off the lesson is not running (middle button "${await middle.getAttribute("data-mode").catch(() => null)}")`);
    }
    await pg.waitForTimeout(2_000);
    const across = await wakeSince(mark8);
    if (across.join(",") !== "request") {
      throw new Error(`${vp}: across the hand-off to Al-Fatihah 2 the wake lock went ${across.join(" → ") || "(nothing)"} — expected one request ("Lanjutkan") and no release, ayah 2's lesson adopting the lock`);
    }
    console.log(`  ahead 8/9: recap → end → Al-Fatihah 2 by itself, its lesson running: wake lock ${across.join(" → ")} — no release across the hand-off, no new request there (adopted)`);

    // 9. A hand-off nobody takes up: released after the grace.
    await toStep(pg, vp, "recap"); // paused (a release)
    // The page's hand-off mark made unusable, so ayah 3 does not start by itself.
    await pg.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        return set.call(this, k, k === "belajar:v1:autoplay:continue" ? JSON.stringify({ to: "none", at: 0 }) : v);
      };
    });
    await forward.click();
    if (!(await until(pg, async () => (await stage.getAttribute("data-step")) === "next", 5_000))) {
      throw new Error(`${vp}: Al-Fatihah 2 did not reach its last step ("next") from the recap (on "${await stage.getAttribute("data-step")}")`);
    }
    const mark9 = (await wakeLog()).length;
    await forward.click(); // past the last step: the hand-off to ayah 3
    await pg.waitForURL(/\/quran\/al-fatihah\/3(\?.*)?$/, { timeout: 15_000 });
    await pg.locator('[data-autoplay="start"]').waitFor({ state: "visible", timeout: 15_000 });
    const arrivedAt = await pg.evaluate(() => Date.now());
    const atArrival = await wakeSince(mark9);
    if (atArrival.join(",") !== "request") {
      throw new Error(`${vp}: at the hand-off to Al-Fatihah 3 the wake lock went ${atArrival.join(" → ") || "(nothing)"} — expected it asked for (kept for the hand-off) and not released`);
    }
    if (!(await until(pg, async () => (await wakeSince(mark9)).includes("release"), WAKE_GRACE_MS + 8_000))) {
      throw new Error(`${vp}: on Al-Fatihah 3, its lesson not running, the wake lock kept for the hand-off was not released within ${WAKE_GRACE_MS + 8_000} ms`);
    }
    const released = ((await wakeLog()) ?? []).slice(mark9).find((e) => e.t === "release");
    const after = released.at - arrivedAt;
    if (after < WAKE_GRACE_MS - 2_500) throw new Error(`${vp}: the wake lock kept for the hand-off was released ${after} ms after Al-Fatihah 3 appeared — before the grace (${WAKE_GRACE_MS} ms)`);
    if ((await requests()).some((e) => e.at > released.at)) throw new Error(`${vp}: the wake lock was asked for again on Al-Fatihah 3 with its lesson not running`);
    console.log(`  ahead 9/9: hand-off to Al-Fatihah 3 with its lesson not running ("Mulai" shown): kept, then released ${after} ms after the page appeared (grace ${WAKE_GRACE_MS} ms)`);
  } catch (err) {
    await pg.screenshot({ path: `shots/${vp}-autoplay-ahead-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the look-ahead / wake-lock check on Al-Fatihah 1 failed`);
    console.error(`  narration requests (${timeline.length}):\n    ${timeline.map((e) => `${short(e.path)} ${e.type} ${e.range ?? ""} ${rel(e.start)}–${rel(e.end)}`).join("\n    ") || "(none)"}`);
    console.error(`  wake lock: ${JSON.stringify(await wakeLog().catch(() => null))}`);
    throw err;
  } finally {
    delays.clear();
    await pg.unroute(isNarration, handler).catch(() => {});
    await pg.close().catch(() => {});
  }
}

/**
 * The composition animation on the stage's word-card slot (operator 2026-10-10, narration rule 14),
 * on the real page: the harakat primer (frame 2: fathah on its dotted circle, بَ "b + a"), then
 * word 1 of Al-Fatihah 1 explained by its parts — its first frame [بِ] + [ٱسْمُ], MID-WAY through
 * the change frame (the dhammah fading into kasrah, مُ → مِ, u → i), the change settled, and the
 * join (بِٱسْمِ, "bi + ismi → bismi"), the recited tile (forest fill, checked by computed style);
 * plus the change frame with reduced motion (static). Each is checked unclipped (composeFit). In the
 * "Tunggu saya" pace each caption-only line waits for Lanjut, so the frames are stepped through by
 * clicking it (rendered lines play on by themselves); "↺ Ulangi" starts each step even if the
 * imam's stream paused the lesson on the way. Fails the job if the animation never shows or sits
 * under the bottom panel.
 */
async function assertComposeLayout(page, vp) {
  const box = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${vp}: ${sel} has no box (not rendered)`);
    return { top: b.y, bottom: b.y + b.height };
  };
  const { height } = page.viewportSize();
  const comp = await box('[data-autoplay="composition"]');
  const panel = await box('[data-autoplay="panel"]');
  const caption = await box('[data-autoplay="caption"]');
  const controls = await box('[data-autoplay="panel"] [role="group"]');
  const problems = [];
  if (comp.top < 0 || comp.bottom > panel.top + 1) problems.push(`composition ${fmt(comp)} off screen or under the panel ${fmt(panel)}`);
  if (caption.top < 0 || caption.bottom > height || caption.bottom > controls.top + 1) problems.push(`caption ${fmt(caption)} not on screen above the controls ${fmt(controls)}`);
  if (problems.length) throw new Error(`${vp}: composition layout — ${problems.join("; ")}`);
  console.log(`  layout ok: composition ${fmt(comp)} · panel ${fmt(panel)} · caption ${fmt(caption)}`);
}

/**
 * Nothing in the composition figure is clipped or spills out of it (review 2026-10-10: a fixed
 * 9rem figure with overflow-hidden cut 83 of 87 frames on a phone): every element of the frame on
 * screen AND of the word's other frames (laid out invisibly to hold the height, data-compose-ghost)
 * lies inside the figure's box, the figure scrolls in neither direction, and it is no wider than
 * the screen. Run in the page (page.evaluate: the CSP forbids waitForFunction's eval, not this).
 * Returns null when no composition is on screen.
 */
async function composeFit(page) {
  return page.evaluate(() => {
    const fig = document.querySelector('[data-autoplay="composition"]');
    if (!fig) return null;
    const f = fig.getBoundingClientRect();
    const box = (r) => `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`;
    const out = [];
    if (fig.scrollWidth > fig.clientWidth + 1) out.push(`scrolls sideways (${fig.scrollWidth} > ${fig.clientWidth})`);
    if (fig.scrollHeight > fig.clientHeight + 1) out.push(`scrolls (${fig.scrollHeight} > ${fig.clientHeight})`);
    if (f.left < -1 || f.right > window.innerWidth + 1) out.push(`figure ${box(f)} wider than the screen (${window.innerWidth})`);
    for (const el of fig.querySelectorAll("*")) {
      if (el.closest(".sr-only")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) {
        const where = el.closest("[data-compose-ghost]") ? "another frame" : "the frame on screen";
        out.push(`${where}: <${el.tagName.toLowerCase()}> “${(el.textContent || "").trim().slice(0, 40)}” at ${box(r)}, outside the figure ${box(f)}`);
        if (out.length >= 6) break;
      }
    }
    const d = fig.dataset;
    return { unit: d.composeKind === "primer" ? "primer" : `word ${d.composeWord}`, frame: d.composeFrame, problems: out };
  });
}

async function assertComposeFits(page, where) {
  const fit = await composeFit(page);
  if (!fit) throw new Error(`${where}: no composition on screen`);
  if (fit.problems.length) throw new Error(`${where}: composition ${fit.unit} frame ${fit.frame} clipped — ${fit.problems.join("; ")}`);
  return fit;
}

/** "Ukuran huruf": the stored size (pre-paint script, app/[locale]/layout.tsx), then a reload. */
async function setTextSize(page, size) {
  await page.evaluate((v) => {
    if (v === "normal") localStorage.removeItem("belajar:v1:text-size");
    else localStorage.setItem("belajar:v1:text-size", v);
  }, size);
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

/** Al-Fatihah's composed units per ayah (the primer and each composed word), from the content. */
async function composedUnits() {
  const c = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "compose", "al-fatihah.json"), "utf8"));
  const by = new Map();
  for (const loc of Object.keys(c.words)) {
    const ayah = Number(loc.split(":")[1]);
    by.set(ayah, [...(by.get(ayah) ?? []), `word ${loc.split(":")[2]}`]);
  }
  if (c.primer) by.set(c.primer.ayah, ["primer", ...(by.get(c.primer.ayah) ?? [])]);
  return by;
}

/**
 * Every composition of the given Al-Fatihah ayat at one text size: "Berikutnya ›" step by step
 * through each lesson until every composed unit has shown, each checked with composeFit — which
 * covers all of a unit's frames at once, since they are all laid out in its figure. At the largest
 * size on a phone it also shoots word 1 of ayah 1 on its change frame (caption-only lines advance
 * by reading time). Fails the job on any clipped frame or a unit that never showed.
 */
async function composeFitSweep(page, vp, size, ayat, units) {
  let checked = 0;
  await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
  await setTextSize(page, size);
  try {
    for (const ayah of ayat) {
      const want = new Set(units.get(ayah) ?? []);
      if (!want.size) continue;
      await page.goto(BASE + `/belajar/id/quran/al-fatihah/${ayah}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('[data-autoplay="start"]').click();
      await settleScroll(page);
      const next = page.locator('[data-autoplay="next"]');
      const seen = new Set();
      for (let i = 0; i < 120 && seen.size < want.size; i++) {
        const fit = await composeFit(page);
        if (fit) {
          if (fit.problems.length) {
            await page.screenshot({ path: `shots/${vp}-compose-fit-${size}-FAILED.png`, fullPage: true }).catch(() => {});
            throw new Error(`${vp}, text size ${size}, ayah ${ayah}: composition ${fit.unit} clipped — ${fit.problems.join("; ")}`);
          }
          if (!seen.has(fit.unit)) {
            seen.add(fit.unit);
            checked++;
            if (vp === "phone" && size === "sangat-besar" && ayah === 1 && fit.unit === "word 1") {
              // ↺ plays the step from its start even if the imam's stream paused the lesson.
              await page.locator('[data-autoplay="replay"]').click();
              const change = page.locator('[data-autoplay="composition"][data-compose-stage="change"]');
              for (let w = 0; w < 120 && (await change.count()) === 0; w++) await page.waitForTimeout(500);
              if ((await change.count()) === 0) throw new Error(`${vp} ${size}: word 1 never reached its change frame`);
              await page.waitForTimeout(1600);
              await assertComposeFits(page, `${vp} ${size}: word 1 change frame`);
              await page.locator('[data-autoplay="stage"]').screenshot({ path: `shots/${vp}-autoplay-ayah1-compose-3-change-${size}.png` });
              console.log(`shot ${vp}-autoplay-ayah1-compose-3-change-${size}`);
            }
          }
        }
        if (!(await next.isEnabled().catch(() => false))) break;
        await next.click();
        await page.waitForTimeout(300);
      }
      const missing = [...want].filter((u) => !seen.has(u));
      if (missing.length) throw new Error(`${vp}, text size ${size}, ayah ${ayah}: never showed ${missing.join(", ")}`);
    }
  } finally {
    await setTextSize(page, "normal").catch(() => {});
  }
  console.log(`  composition fits: ${checked} unit(s), every frame, ${vp}, text size ${size}, ayat ${ayat.join(",")}`);
  await page.goto("about:blank");
}

async function composeShots(page, vp, index) {
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const comp = page.locator('[data-autoplay="composition"]');
  const frame = (sel) => page.locator(`[data-autoplay="composition"]${sel}`);
  const middle = page.locator('[data-autoplay="middle"]');
  const settingsToggle = page.locator('[data-autoplay="settings-toggle"]');
  const shot = async (name) => {
    await stage.screenshot({ path: `shots/${vp}-${name}.png` });
    console.log(`shot ${vp}-${name}`);
  };
  // "Tunggu saya" holds each caption-only line until Lanjut: the frames are stepped through
  // deterministically (with rendered narration the lines play on by themselves instead).
  const setPace = async (label) => {
    await settingsToggle.click();
    await page.locator('[data-autoplay="settings"] label', { hasText: label }).click();
    await settingsToggle.click();
    await page.waitForTimeout(200);
  };
  const advanceTo = async (sel) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if ((await frame(sel).count()) > 0 && (await frame(sel).first().isVisible())) return;
      if ((await middle.getAttribute("data-guide")) === "lanjut") await middle.click();
      await page.waitForTimeout(300);
    }
    throw new Error(`${vp}: the composition never reached ${sel}`);
  };
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
    const replay = page.locator('[data-autoplay="replay"]');
    // intro → the ayah → the harakat primer (Biasa: "Berikutnya ›" jumps whole steps)
    await toStep(page, vp, "primer");
    await setPace("Tunggu saya");
    await replay.click();
    await comp.waitFor({ state: "visible", timeout: 10_000 });
    await advanceTo('[data-compose-kind="primer"][data-compose-frame="2"]');
    await page.waitForTimeout(1600);
    await assertComposeLayout(page, vp);
    await assertComposeFits(page, `${vp}: primer`);
    await shot("autoplay-ayah1-primer");
    // → the imam says word 1 → its gloss line → its composition
    await setPace("Biasa");
    await toStep(page, vp, "w1:compose");
    await setPace("Tunggu saya");
    await replay.click();
    await advanceTo('[data-compose-stage="parts"]');
    await page.waitForTimeout(1600);
    await assertComposeLayout(page, vp);
    await assertComposeFits(page, `${vp}: word 1 parts`);
    await shot("autoplay-ayah1-compose-1-parts");
    await advanceTo('[data-compose-stage="change"]');
    await page.waitForTimeout(1100); // mid-way: the before form fading out, the after form fading in
    await shot("autoplay-ayah1-compose-3-change-midway");
    await page.waitForTimeout(1000);
    await assertComposeLayout(page, vp);
    await assertComposeFits(page, `${vp}: word 1 change`);
    await shot("autoplay-ayah1-compose-3-change");
    await advanceTo('[data-compose-stage="join"]');
    await page.waitForTimeout(1800);
    await assertComposeFits(page, `${vp}: word 1 join`);
    await shot("autoplay-ayah1-compose-4-join");
    // While the imam recites the joined word (and, in "Tunggu saya", until Lanjut), the last
    // tile is filled forest with paper text — the review found it white on white (2026-10-10).
    await advanceTo('[data-recited="true"]');
    await page.waitForTimeout(700);
    const fill = await page
      .locator('[data-autoplay="composition"][data-recited="true"] [data-compose-layer] [data-compose-tile]')
      .last()
      .evaluate((el) => {
        const ar = el.querySelector('[lang="ar"]');
        return { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(ar ?? el).color };
      });
    if (fill.bg === "rgb(255, 255, 255)" || fill.bg === fill.fg) throw new Error(`${vp}: recited tile is ${fill.fg} on ${fill.bg}`);
    console.log(`  recited tile: ${fill.fg} on ${fill.bg}`);
    await assertComposeFits(page, `${vp}: word 1 recited`);
    await shot("autoplay-ayah1-compose-5-recited");
    // The change frame again with reduced motion: static frames, no transition.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await replay.click();
    await advanceTo('[data-compose-stage="change"]');
    await page.waitForTimeout(300);
    await shot("autoplay-ayah1-compose-3-change-reduced-motion");
    await page.emulateMedia({ reducedMotion: null });
    const text = (await comp.innerText()).replace(/\s+/g, " ").trim();
    console.log(`  composition: ${text}`);
    await setPace("Biasa");
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-compose-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the Al-Fatihah ayah 1 composition animation never showed (or sat under the panel)`);
    console.error(`  narration requests answered (${served.length}):\n    ${served.join("\n    ") || "(none)"}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/**
 * The quiz's voice on Al-Fatihah 2 (operator 2026-10-10: "in quiz, give narration/voice only for
 * the correct answer, to give auditory explanation"; "better to write the arabic word in quiz as
 * well like majrur in arabic"). In "Tebak peran kata", reached by STEP IDENTITY (the exercise on
 * screen, `[data-exercise]`; "Berikutnya ›" / "Lewati latihan" until it is there), with the
 * narration answered in the browser (narration-route.mjs: silent stand-ins as long as the
 * manifests say) and every request recorded:
 *   1. each option of question 1 shows its terms' Arabic (the plan's text, content/quiz);
 *   2. a WRONG pick: no narration request at all for 2.5 s, and "Belum tepat" on screen;
 *   3. the RIGHT pick: shared:correct ("Benar."), then question 1's explanation line
 *      (al-fatihah:2:ex:label-role:1:why) — requested by its URL when the manifest has its audio,
 *      else shown as the caption (caption-only until it is rendered);
 *   4. question 2: two wrong picks, then "Tunjukkan jawaban": shared:revealed ("Ini jawabannya.")
 *      and question 2's explanation, the same way.
 * Fails the job otherwise.
 */
async function quizVoiceCheck(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const quiz = await read("content/quiz/al-fatihah.json");
  const lesson = (await read("content/narration/al-fatihah.json")).lines;
  const shared = (await read("content/narration/shared.json")).lines;
  const role = quiz.ayat.find((a) => a.ayah === 2).exercises.find((e) => e.key === "label-role");
  const [q1, q2] = role.questions;
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const exercise = page.locator('[data-autoplay="exercise"] [data-exercise="label-role"]');
  const caption = page.locator('[data-autoplay="caption"]');
  const option = (from) => exercise.locator(`[data-option="${from}"]`);
  const urls = (from) => served.slice(from).map((s) => s.split(" → ")[0]);
  /** A line was said after request `from`: its audio requested (the index after that request is
   *  returned, so the next line is looked for after it), or — caption-only, not rendered yet —
   *  its caption shown (its Latin start, up to the first Arabic). */
  const said = async (line, from, what) => {
    const url = line.audio?.url;
    const head = line.display.split(/\s*[(\u0600-\u06FF]/u)[0].slice(0, 40);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (url) {
        const k = urls(from).indexOf(url);
        if (k !== -1) return from + k + 1;
      } else if ((await caption.innerText()).includes(head)) return served.length;
      await page.waitForTimeout(150);
    }
    throw new Error(`${vp}: ${what} was not said (${url ? `no request for ${url}` : `the caption never showed “${head}”`})`);
  };
  try {
    await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    const next = page.locator('[data-autoplay="next"]');
    for (let i = 0; i < 60 && !(await exercise.isVisible()); i++) {
      await next.click();
      await page.waitForTimeout(250);
    }
    await exercise.waitFor({ state: "visible", timeout: 10_000 });
    // The exercise waits once its introduction and its options prompt are through.
    const prompt = shared["shared:ex:label-role:options"];
    await said(prompt, 0, "the options prompt");
    // The player preloads a line while the one before it plays, so its request is not its start:
    // wait until the prompt is the line on screen, then for it to finish.
    for (let i = 0; i < 200 && (await caption.getAttribute("data-line")) !== "shared:ex:label-role:options"; i++) {
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout((prompt.audio?.ms ?? 3000) + 1500);

    // 1. Arabic on every label.
    for (const o of q1.options) {
      const text = await option(o.from).innerText();
      for (const ar of o.text.match(/[\u0600-\u06FF]+(?:\s+[\u0600-\u06FF]+)*/g) ?? []) {
        if (!text.includes(ar)) throw new Error(`${vp}: option ${o.from} shows “${text}”, without its Arabic ${ar}`);
      }
    }
    console.log(`  quiz labels: ${q1.options.map((o) => o.text).join(" | ")}`);

    // 2. A wrong pick: silence, and the note on screen. A new line said shows as a request for
    //    another file or a caption on another line; the browser re-fetching part of the prompt it
    //    is still playing (the same file, logged with its range) is not one.
    let mark = served.length;
    const playing = urls(0).at(-1);
    const lineBefore = await caption.getAttribute("data-line");
    await option(q1.options[1].from).click();
    await page.waitForTimeout(2500);
    const other = urls(mark).filter((u) => u !== playing);
    const lineAfter = await caption.getAttribute("data-line");
    if (other.length || (lineAfter && lineAfter !== lineBefore)) {
      throw new Error(`${vp}: a wrong pick played narration: ${other.join(", ") || `the caption moved to ${lineAfter}`} (requests after the pick: ${served.slice(mark).join(" | ") || "none"})`);
    }
    await exercise.getByText("Belum tepat", { exact: false }).first().waitFor({ state: "visible", timeout: 5_000 });
    console.log("  quiz: a wrong pick plays no narration (Belum tepat on screen)");

    // 3. The right pick: Benar., then the explanation of question 1.
    mark = served.length;
    await option(q1.options[0].from).click();
    const afterCorrect = await said(shared["shared:correct"], mark, "Benar. (shared:correct)");
    await said(lesson["al-fatihah:2:ex:label-role:1:why"], afterCorrect, "question 1's explanation, after Benar.");
    await page.locator('[data-autoplay="stage"]').screenshot({ path: `shots/${vp}-quiz-ayah2-role-right.png` });
    console.log(`shot ${vp}-quiz-ayah2-role-right`);

    // 4. Question 2 (the lesson moves on by itself): two wrong picks, then Tunjukkan jawaban.
    await exercise.getByText(`Soal 2 dari ${role.questions.length}`).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);
    await option(q2.options[1].from).click();
    await page.waitForTimeout(400);
    await option(q2.options[2].from).click();
    const reveal = exercise.locator('[data-guide="exercise:label-role:reveal"]');
    await reveal.waitFor({ state: "visible", timeout: 5_000 });
    mark = served.length;
    await reveal.click();
    const afterRevealed = await said(shared["shared:revealed"], mark, "Ini jawabannya. (shared:revealed)");
    await said(lesson["al-fatihah:2:ex:label-role:2:why"], afterRevealed, "question 2's explanation, after Ini jawabannya.");
    console.log("  quiz: right → Benar. + its explanation; Tunjukkan jawaban → Ini jawabannya. + its explanation");
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-quiz-voice-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the quiz voice check on Al-Fatihah 2 failed`);
    console.error(`  narration requests answered (${served.length}):\n    ${served.join("\n    ") || "(none)"}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/**
 * A hidden address shows the module's own 404 in the browser: answered 404, and the page drawn is
 * src/app/[locale]/not-found.tsx ([data-not-found]) with its title (messages/id.json, never typed
 * here) visible inside <main>. The server HTML carries that page only in the RSC payload (Next
 * renders it as the client takes over), so the smoke checks can find its marker but not see it:
 * this is where it is seen (CI 2026-10-11). Fails the job otherwise.
 */
async function assertNotFoundShown(page, vp, urlPath, status) {
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8"));
  const title = msgs.NotFound?.title;
  if (!title) throw new Error("messages/id.json has no NotFound.title");
  const heading = page.locator("main [data-not-found] h1");
  const shown = await heading.isVisible().catch(() => false);
  const text = shown ? (await heading.innerText()).trim() : "";
  if (status !== 404 || !shown || text !== title)
    throw new Error(`${vp} ${urlPath}: not the module's 404 on screen (status ${status}, heading ${shown ? `“${text}”` : "not visible"}, expected “${title}”)`);
  console.log(`  404 ok: ${vp} ${urlPath} shows “${title}”`);
}

await mkdir("shots", { recursive: true });
const DEFAULT_RUN = !WARIS_ONLY && !SURAHS_ON;
const narration = DEFAULT_RUN ? await narrationIndex() : new Map();
const units = DEFAULT_RUN ? await composedUnits() : new Map();
if (DEFAULT_RUN) console.log(`narration index: ${narration.size} file(s) named by the manifests in ${BELAJAR_DIR}`);
const browser = await chromium.launch();
try {
  for (const [vp, viewport, scale] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "id-ID" });
    // "Salin tautan" (shareShots) writes to the clipboard and the check reads it back.
    if (!WARIS_ONLY) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    const page = await ctx.newPage();
    for (const [name, path] of WARIS_ONLY ? WARIS_PAGES : SURAHS_ON ? SURAH_PAGES : PAGES) {
      const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
      console.log(`shot ${vp}-${name} (${path})`);
      if (name.endsWith("-tersembunyi-404")) await assertNotFoundShown(page, vp, path, res?.status());
    }
    if (WARIS_ONLY) {
      await ctx.close();
      continue;
    }
    if (SURAHS_ON) {
      await endCardShots(page, vp, true);
      await ctx.close();
      continue;
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
    await konsepChecks(page, vp);
    await menuShots(page, vp);
    await headerShots(page, vp);
    await footerCheck(page, vp);
    await materialsShot(page, vp);
    await ayahDialogChecks(page, vp);
    await shareShots(page, vp);
    await surahEndBridgeShots(page, vp);
    if (vp === "desktop") await ogShots(ctx.request);
    await autoplayShots(page, vp);
    await karaokeShots(page, vp, narration);
    if (vp === "phone") await loadingChecks(page, vp, narration);
    if (vp === "phone") await warmupChecks(page, vp, narration);
    if (vp === "phone") await aheadChecks(page, vp, narration);
    await composeShots(page, vp, narration);
    await quizVoiceCheck(page, vp, narration);
    // Every composition frame fits at every text size (largest: all seven ayat; the others: ayah 1).
    await composeFitSweep(page, vp, "normal", [1], units);
    await composeFitSweep(page, vp, "besar", [1], units);
    await composeFitSweep(page, vp, "sangat-besar", [1, 2, 3, 4, 5, 6, 7], units);
    await comingSoonCheck(page, vp);
    await endCardShots(page, vp, false);
    await ctx.close();
  }
} finally {
  await browser.close();
}
