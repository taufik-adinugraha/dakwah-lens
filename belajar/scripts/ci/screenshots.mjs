// CI-only: screenshot key module pages from the real image (started by the
// workflow on :3300) at phone and desktop widths, for visual review of each
// PR without running anything on a developer laptop. Output: ./shots/*.png
//
// Two runs, one container each. By default: the module as production shows
// it, from a container with the Ilmu Waris switch off (hidden since
// 2026-10-10, src/lib/features.ts), including the 404 a hidden waris URL
// answers. `--waris`: only the Ilmu Waris pages, from a container started
// with BELAJAR_WARIS=on.
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
// URL shape: plan L9 (hub → /quran track; Konsep/Kosakata at hub level).
const AYAH_1 = "/belajar/id/quran/al-fatihah/1";
const AYAH_2 = "/belajar/id/quran/al-fatihah/2";

// belajar/: the narration manifests (content/narration/*.json) and, on a
// machine that rendered them, the git-ignored MP3s (pipeline/out/narration/).
// The workflow copies this script to /tmp/shots-run and passes BELAJAR_DIR;
// run in place (belajar/scripts/ci/), it is two levels up.
const BELAJAR_DIR = process.env.BELAJAR_DIR ?? fileURLToPath(new URL("../..", import.meta.url));
const NARRATION_PREFIX = "/belajar/media/narration/";
const isNarration = (url) => url.pathname.startsWith(NARRATION_PREFIX);
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
  // What a visitor gets at the hidden track's address: the module's own 404.
  ["waris-tersembunyi-404", "/belajar/id/waris"],
];
// Ilmu Waris (docs/waris-plan.md §9.1), `--waris` only: track home, the questionnaire's first
// screen, and the report page with no answers (its "start" notice). Filled reports, print and
// reduced-motion shots come from waris-e2e.mjs (waris-*.png).
const WARIS_PAGES = [
  ["waris", "/belajar/id/waris"],
  ["waris-hitung", "/belajar/id/waris/hitung"],
  ["waris-laporan-kosong", "/belajar/id/waris/laporan"],
];
const WARIS_ONLY = process.argv.includes("--waris");
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }, 2],
  ["desktop", { width: 1280, height: 900 }, 1],
];

/**
 * The autoplay lesson on Al-Fatihah 2 (a real browser, the real image). Ayah 2 has no narration
 * audio yet, and on the runner the shared lines' files 404 (the MP3s live in the VM media dir), so
 * this is the CAPTION-ONLY path a learner gets for every unrendered line:
 *   1. the stage before "Mulai pelajaran" (stage, and the viewport a learner lands on: header,
 *      short title, the one focused stage);
 *   2. the "⚙ Pengaturan" panel open (pace, imam speed, reciter, text size), then closed again;
 *   3. after the one click, jumped to the first word's explanation;
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
 * bahasa, Kembali ke Dakwah-Lens, Masuk / the signed-in name and Sumber & lisensi. Escape closes it
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

// ─────────────── Narration audio for the karaoke shots (browser-side only) ───────────────

/** Every narration file the manifests point at → its duration (ms). */
async function narrationIndex() {
  const dir = path.join(BELAJAR_DIR, "content", "narration");
  const index = new Map();
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const m = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    for (const line of Object.values(m.lines ?? {})) {
      const a = line?.audio;
      if (a && typeof a.url === "string" && Number.isInteger(a.ms) && a.ms > 0) index.set(a.url, a.ms);
    }
  }
  return index;
}

/** A silent WAV (8 kHz, mono, 8-bit PCM: 0x80 is silence) of `ms` milliseconds. */
function silentWav(ms) {
  const rate = 8000;
  const n = Math.max(1, Math.round((rate * ms) / 1000));
  const b = Buffer.alloc(44 + n, 0x80);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24); // sample rate
  b.writeUInt32LE(rate, 28); // byte rate
  b.writeUInt16LE(1, 32); // block align
  b.writeUInt16LE(8, 34); // bits per sample
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n, 40);
  return b;
}

/** Answers a media request with `body`, honouring a single byte Range (the media element asks for
 *  "bytes=0-" and may seek). */
function fulfillBytes(route, body, contentType) {
  const total = body.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers()["range"] ?? "");
  if (!m || (m[1] === "" && m[2] === "")) {
    return route.fulfill({ status: 200, contentType, headers: { "accept-ranges": "bytes" }, body });
  }
  const start = m[1] === "" ? Math.max(0, total - Number(m[2])) : Number(m[1]);
  const end = m[1] === "" || m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  if (start >= total || start > end) {
    return route.fulfill({ status: 416, headers: { "content-range": `bytes */${total}` }, body: "" });
  }
  return route.fulfill({
    status: 206,
    contentType,
    headers: { "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${total}` },
    body: body.subarray(start, end + 1),
  });
}

/**
 * The narration URLs, answered in the browser for these shots only (production keeps serving
 * them from the VM media dir through Caddy; nothing here changes routing): the rendered MP3 from
 * pipeline/out/narration/ when this machine has it (git-ignored: never on the CI runner), else a
 * SILENT stand-in exactly as long as the manifest says — the karaoke caption follows the audio
 * clock, so its word timings still play out as they would with the voice. A URL no manifest
 * names answers 404 (the lesson then shows that line caption-only). `served` records each answer.
 */
function narrationRoute(index, served) {
  return async (route) => {
    const { pathname } = new URL(route.request().url());
    const rel = pathname.slice(NARRATION_PREFIX.length);
    const ms = index.get(pathname);
    if (ms === undefined || rel.split("/").some((p) => p === ".." || p === "")) {
      served.push(`${pathname} → 404 (not in a manifest)`);
      return route.fulfill({ status: 404, body: "" });
    }
    let body = null;
    try {
      body = await readFile(path.join(BELAJAR_DIR, "pipeline", "out", "narration", ...rel.split("/")));
    } catch {
      body = null;
    }
    if (body) {
      served.push(`${pathname} → pipeline/out MP3`);
      return fulfillBytes(route, body, "audio/mpeg");
    }
    served.push(`${pathname} → silent stand-in, ${ms} ms`);
    return fulfillBytes(route, silentWav(ms), "audio/wav");
  };
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

/**
 * Al-Fatihah ayah 1, the narrated ayah, after the one "Mulai" click: the stage mid-explanation of
 * word 1 — the KARAOKE caption (the narrator's current word filled forest, words said in ink,
 * words to come muted; a dictionary term shown "kasrah (كَسْرَة)") under the large WORD CARD
 * (the word's Arabic · transliteration · "yang artinya …"), the mushaf words numbered with word 1
 * marked. "Berikutnya ›" jumps whole steps (intro → the ayah → the imam says word 1 → its
 * explanation), then "↺ Ulangi langkah ini" plays the explanation from its start — the replay
 * control, and a start that holds even when the imam's stream paused the lesson on the way.
 * Fails the job if the word card or the karaoke caption never shows (what a learner would see
 * without them is the caption-only fallback, already covered by the ayah 2 shots above).
 */
async function karaokeShots(page, vp, index) {
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
    const next = page.locator('[data-autoplay="next"]');
    for (let i = 0; i < 3; i++) {
      await next.click();
      await page.waitForTimeout(250);
    }
    await page.locator('[data-autoplay="replay"]').click();
    await page.locator('[data-autoplay="word-card"]').waitFor({ state: "visible", timeout: 10_000 });
    // Mid-line: the first sentence said, the narrator on the term "kasrah (كَسْرَة)," (8th word).
    // Locator waits, not page.waitForFunction: Playwright evaluates waitForFunction predicates
    // with eval in the page, which the module's CSP (no 'unsafe-eval') rightly refuses.
    const caption = page.locator('[data-autoplay="caption"]');
    await caption.locator('[data-karaoke="said"]').nth(6).waitFor({ state: "attached", timeout: 25_000 });
    await caption.locator('[data-karaoke="now"]').first().waitFor({ state: "attached", timeout: 25_000 });
    await assertKaraokeLayout(page, vp);
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
    console.error(`✗ ${vp}: the Al-Fatihah ayah 1 karaoke caption / word card never showed`);
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

await mkdir("shots", { recursive: true });
const narration = WARIS_ONLY ? new Map() : await narrationIndex();
if (!WARIS_ONLY) console.log(`narration index: ${narration.size} file(s) named by the manifests in ${BELAJAR_DIR}`);
const browser = await chromium.launch();
try {
  for (const [vp, viewport, scale] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "id-ID" });
    const page = await ctx.newPage();
    for (const [name, path] of WARIS_ONLY ? WARIS_PAGES : PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
      console.log(`shot ${vp}-${name} (${path})`);
    }
    if (WARIS_ONLY) {
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
    await menuShots(page, vp);
    await materialsShot(page, vp);
    await autoplayShots(page, vp);
    await karaokeShots(page, vp, narration);
    await ctx.close();
  }
} finally {
  await browser.close();
}
