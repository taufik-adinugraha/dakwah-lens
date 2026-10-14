// CI-only: screenshot key module pages from the real image (started by the
// workflow on :3300) at phone and desktop widths, for visual review of each
// PR without running anything on a developer laptop. Output: ./shots/*.png
//
// Three runs, one container each. By default: the module as production shows
// it, from a container with neither switch set (src/lib/features.ts): Ilmu
// Waris hidden (since 2026-10-10) and the Qur'an track on Al-Fatihah only
// (operator, 2026-10-10: the Mu'awwidzat "segera hadir", not clickable),
// including the 404 a hidden waris or surah URL answers, the "Segera hadir"
// cards (checked: no link, nothing to focus), the curriculum page (checked:
// only reachable lessons are links, the others say "Belum tersedia"), the cheat sheet "Rumus
// singkat" (checked: a formula only for an available lesson, each with the kitab's quoted
// sentences byte for byte, none of a hidden surah's) and the end of Al-Fatihah
// (checked: the next surah is coming soon, nothing to click, no move).
// `--waris`: only the Ilmu Waris pages, from a container started with
// BELAJAR_WARIS=on. `--surahs`: the Mu'awwidzat lessons, from a container
// started with every surah in BELAJAR_SURAHS (the end of Al-Fatihah then
// offers Al-Ikhlas).
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

// The narration audio for the karaoke shots (browser-side only), shared with linebreaks.mjs.
// The workflow copies narration-route.mjs next to this script.
import { BELAJAR_DIR, isNarration, isWordVoice, narrationIndex, narrationRoute, wordVoiceIndex } from "./narration-route.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
// URL shape: plan L9 (hub → /quran track; Konsep/Kosakata at hub level).
const AYAH_1 = "/belajar/id/quran/al-fatihah/1";
const AYAH_2 = "/belajar/id/quran/al-fatihah/2";
// LESSON ZERO, "Pengantar: harakat dan tiga jenis kata" (the basic curriculum's lesson with no ayah,
// kurikulum-dasar.md decision 1; since 2026-10-13 the harakat primer plays there, not in Al-Fatihah
// 1). Its path is src/lib/routes.ts introHref() (lesson-zero.test.ts checks they agree); in the
// content its lines are the lines of "ayah 0" of Al-Fatihah.
const INTRO = "/belajar/id/quran/pengantar";
const ZERO_AYAH = 0;
/** The page of an Al-Fatihah lesson: an ayah's, or lesson zero's (ayah 0). */
const lessonPath = (ayah) => (ayah === ZERO_AYAH ? INTRO : `/belajar/id/quran/al-fatihah/${ayah}`);
// The basic curriculum's page (plan L30; src/lib/routes.ts curriculumHref).
const CURRICULUM = "/belajar/id/quran/kurikulum";
// The cheat sheet "Rumus singkat" (plan L32; src/lib/routes.ts rumusHref).
const RUMUS = "/belajar/id/quran/rumus";
const PAGES = [
  ["hub", "/belajar/id"],
  ["track", "/belajar/id/quran"],
  ["pengantar", INTRO],
  ["kurikulum", CURRICULUM],
  ["rumus", RUMUS],
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
  // The curriculum page with the Mu'awwidzat lessons as links.
  ["kurikulum-semua-surah", CURRICULUM],
  // … and the cheat sheet with every written lesson's formula drawn.
  ["rumus-semua-surah", RUMUS],
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
 * "primer" (lesson zero), "w1:recite", "w1", "w1:compose", …): a step is reached by what it is, never by a count
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
 *   2. the "⚙ Pengaturan" panel open (pace, imam speed, text size), then closed again — and no
 *      reciter to choose in it (assertNoReciterChoice: one imam, operator 2026-10-13);
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

/**
 * ONE imam everywhere, and no reciter setting (operator 2026-10-13: "better to use alafasy for all?
 * no need to give option to user to change"; docs/belajar-plan.md L21): the open "⚙ Pengaturan"
 * panel, as the browser draws it, has no dropdown and names no reciter — and nothing is left where
 * the choice was: the "Bacaan imam" group is its heading and the one speed button, the group ends
 * where that button ends, and no part of the panel is an empty box. The other settings are there:
 * the three paces, the three text sizes, "Tutup pengaturan".
 */
async function assertNoReciterChoice(page, vp) {
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8"));
  const seen = await page.locator('[data-autoplay="settings"]').evaluate((el) => {
    const drawn = (n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const group = el.querySelector('[role="group"]');
    const button = group?.querySelector("button");
    return {
      text: el.innerText.replace(/\s+/g, " ").trim(),
      dropdowns: el.querySelectorAll('select, option, datalist, [role="combobox"], [role="listbox"]').length,
      radios: [...el.querySelectorAll('input[type="radio"]')].map((i) => i.value),
      buttons: [...el.querySelectorAll("button")].filter(drawn).map((b) => b.innerText.replace(/\s+/g, " ").trim()),
      parts: [...el.children].map((c) => c.tagName),
      group: group && {
        label: document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() ?? "",
        children: [...group.children].map((c) => c.tagName),
        gapUnderButton: button ? Math.round(group.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom) : null,
      },
      empty: [...el.querySelectorAll("div, p, fieldset, label")].filter((n) => drawn(n) && !n.innerText.trim()).length,
    };
  });
  const fail = (m) => {
    throw new Error(`${vp}: the settings panel — ${m} (${JSON.stringify(seen)})`);
  };
  if (seen.dropdowns) fail(`${seen.dropdowns} dropdown element(s): a reciter choice is offered`);
  const named = /qari|reciter|husary|mu.?allim|alafasy|mishary/i.exec(seen.text);
  if (named) fail(`names a reciter (“${named[0]}”): there is none to choose`);
  if (!seen.group || seen.group.label !== msgs.Player.heading) fail(`no “${msgs.Player.heading}” group`);
  if (seen.group.children.join(" ") !== "P BUTTON") fail(`the “${msgs.Player.heading}” group is not its heading and the one speed button (${seen.group.children.join(" ")})`);
  // The removed choice sat under the speed button with a 1rem margin: anything left there shows
  // as room under the button (a few px of line box are not that).
  if (seen.group.gapUnderButton === null || Math.abs(seen.group.gapUnderButton) > 8) fail(`${seen.group.gapUnderButton}px left under the speed button in its group (a hole where the reciter choice was)`);
  if (seen.empty) fail(`${seen.empty} empty box(es) drawn`);
  if (seen.parts.join(" ") !== "P FIELDSET DIV DIV BUTTON") fail(`its parts are ${seen.parts.join(" ")}, expected the title, the pace, the imam's speed, the text size and “${msgs.Guided.settings_close}”`);
  // The settings that stay: three paces + three text sizes (radios), the speed and the close button.
  if (seen.radios.length !== 6) fail(`${seen.radios.length} radio options, expected 3 paces + 3 text sizes`);
  const speeds = [msgs.Player.speed_normal, msgs.Player.speed_slow].map((v) => msgs.Player.speed.replace("{speed}", v));
  const speed = seen.buttons.find((b) => speeds.includes(b));
  if (!speed) fail(`no imam speed button (“${speeds.join("” / “")}”; buttons: ${seen.buttons.join(" | ")})`);
  if (!seen.buttons.includes(msgs.Guided.settings_close)) fail(`no “${msgs.Guided.settings_close}” button (buttons: ${seen.buttons.join(" | ")})`);
  if (seen.buttons.length !== 2) fail(`${seen.buttons.length} buttons, expected the imam's speed and “${msgs.Guided.settings_close}”`);
  console.log(`  settings panel: ${seen.radios.length} radio options (pace, text size), “${speed}”, “${msgs.Guided.settings_close}”; no dropdown, no reciter named, nothing left where the choice was`);
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
  await assertNoReciterChoice(page, vp);
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
    ["og-kurikulum-id", `${CURRICULUM}/og`],
    ["og-rumus-id", `${RUMUS}/og`],
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
  // The units with no lessons of their own (Ayat Kursi, 2:255): a dashed card that says "Segera hadir",
  // no link, nothing to focus — and its own attribute, so the surah cards above stay one per hidden surah.
  const units = await page.locator("[data-coming-unit]").evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute("data-coming-unit"), tag: e.tagName, inLink: !!e.closest("a"), focusable: e.querySelectorAll("a, button, input, select, textarea, summary, [tabindex]").length, text: e.textContent ?? "" })),
  );
  if (units.length === 0) problems.push("no card for the unit with no lessons (Ayat Kursi): it is listed as Segera hadir");
  for (const u of units) {
    if (u.tag === "A" || u.inLink) problems.push(`${u.id}: the "Segera hadir" card is a link`);
    if (u.focusable > 0) problems.push(`${u.id}: ${u.focusable} focusable element(s) inside`);
    if (!u.text.includes("Segera hadir")) problems.push(`${u.id}: the card does not say "Segera hadir"`);
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
 * Which lessons of content/curriculum.json a visitor can open in a run: a written ayah of a
 * published surah (`surahsOn`: every surah with lesson pages; else all but HIDDEN_SURAHS) and the
 * introduction (lesson "0") while it is written and the surah that hosts it is published. ONE rule
 * for the curriculum page's links and the cheat sheet's formulas (src/lib/curriculumOutline.ts
 * lessonLink is what the app asks for both), so the two checks cannot drift.
 */
async function reachability(surahsOn) {
  const file = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "curriculum.json"), "utf8"));
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8"));
  const mark = msgs.Curriculum?.unavailable;
  if (!mark) throw new Error("messages/id.json has no Curriculum.unavailable");
  const slugOf = Object.fromEntries(file.units.map((u) => [u.id, u.slug ?? null]));
  // Lesson zero's host: the surah whose harakat primer is played there (src/lib/curriculum.ts ZERO_HOST).
  const zeroHost = (await Promise.all(Object.values(slugOf).filter(Boolean).map(async (slug) => [slug, JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "compose", `${slug}.json`), "utf8").catch(() => "null"))]))).find(([, c]) => c?.primer?.lesson === "0")?.[0] ?? null;
  const on = (slug) => !!slug && (surahsOn || !HIDDEN_SURAHS.includes(slug));
  const reachable = (l) => {
    if (l.id === "0") return !!l.map && on(zeroHost);
    return on(slugOf[l.unit]) && l.ayah !== undefined && l.segment === undefined && !!l.map;
  };
  return { file, msgs, mark, slugOf, reachable };
}

/**
 * The curriculum page as a browser draws it (operator, 2026-10-13: "we should also explain this
 * curriculum in the page"; plan L30), against content/curriculum.json: every lesson of the file
 * is listed once, in its order; a lesson visitors can reach — a written ayah of a published surah
 * (`surahsOn`: every surah with lesson pages; else all but HIDDEN_SURAHS) — has ONE link into the
 * track, to that ayah — and so has the introduction (lesson "0"), to INTRO, while it is written
 * and the surah that hosts it (Al-Fatihah, never hidden in these runs) is published; every other
 * lesson (a hidden surah's, Ayat Kursi's segments) has no link into the track
 * and shows the words "Belum tersedia" (messages/id.json, never typed here) in a label that is
 * VISIBLE and has nothing to click or focus. As production shows it, no link on the page leads
 * into a hidden surah. And at the largest text size nothing makes the page scroll sideways (the
 * line breaks themselves are linebreaks.mjs's); on the phone that size is shot too. Fails the job
 * otherwise.
 */
async function curriculumCheck(page, vp, surahsOn) {
  const { file, msgs, mark, slugOf, reachable } = await reachability(surahsOn);
  await page.goto(BASE + CURRICULUM, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.locator("main [data-lesson]").evaluateAll((els) =>
    els.map((e) => {
      const status = e.querySelector("[data-lesson-status]");
      const box = status ? status.getBoundingClientRect() : null;
      return {
        id: e.getAttribute("data-lesson"),
        links: [...e.querySelectorAll('a[href*="/quran/"]')].map((a) => a.getAttribute("href")),
        status: status && box.width > 0 && box.height > 0 ? (status.textContent ?? "").trim() : null,
        focusable: status ? status.querySelectorAll("a, button, input, select, textarea, summary, [tabindex]").length : 0,
      };
    }),
  );
  const problems = [];
  const want = file.lessons.map((l) => l.id);
  if (JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(want)) problems.push(`lists ${rows.length} lesson(s), not the ${want.length} of content/curriculum.json in its order`);
  let linked = 0;
  for (const l of file.lessons) {
    const r = rows.find((x) => x.id === l.id);
    if (!r) continue;
    if (reachable(l)) {
      const href = l.id === "0" ? INTRO : `/belajar/id/quran/${slugOf[l.unit]}/${l.ayah}`;
      if (JSON.stringify(r.links) !== JSON.stringify([href])) problems.push(`${l.id}: links ${JSON.stringify(r.links)}, expected [${href}]`);
      else linked++;
      if (r.status !== null) problems.push(`${l.id}: a lesson that can be opened says "${r.status}"`);
    } else {
      if (r.links.length > 0) problems.push(`${l.id}: ${r.links.length} link(s) into the track from a lesson that is not available`);
      if (r.status !== mark) problems.push(`${l.id}: no visible "${mark}" (got ${JSON.stringify(r.status)})`);
      if (r.focusable > 0) problems.push(`${l.id}: ${r.focusable} focusable element(s) inside its "${mark}" label`);
    }
  }
  if (linked === 0) problems.push("no lesson is linked");
  if (!surahsOn) {
    for (const slug of HIDDEN_SURAHS) {
      const n = await page.locator(`a[href^="/belajar/id/quran/${slug}"]`).count();
      if (n > 0) problems.push(`${n} link(s) into the hidden ${slug}`);
    }
  }
  await setTextSizeAttr(page, "sangat-besar");
  const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  if (wide.scroll > wide.inner + 1) problems.push(`scrolls sideways at the largest text size (${wide.scroll} > ${wide.inner})`);
  if (vp === "phone") {
    const name = surahsOn ? "kurikulum-semua-surah-sangat-besar" : "kurikulum-sangat-besar";
    await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
    console.log(`shot ${vp}-${name} (${CURRICULUM}, text size sangat-besar)`);
  }
  await setTextSizeAttr(page, null);
  if (problems.length) throw new Error(`${vp}: curriculum page — ${problems.join("; ")}`);
  console.log(`  ${vp}: curriculum page ok (${rows.length} lessons in the file's order, ${linked} linked, ${rows.length - linked} "${mark}" as plain text${surahsOn ? "" : ", no link into a hidden surah"})`);
  await page.goto("about:blank");
}

/**
 * The cheat sheet "Rumus singkat" as a browser draws it (operator, 2026-10-13: "we can make some
 * 'cheat sheet' to explain the rules … of course we need to refer to valid kitab"; 2026-10-14:
 * "release cheat sheet"; plan L32), against content/rumus.json and content/curriculum.json:
 *   1. every step of the curriculum is listed once, in teaching order;
 *   2. a step whose lesson a visitor can open (`reachability`) shows its formula iff the file has
 *      one — else "Rumus belum tersedia"; its quoted kitab sentences are the file's, byte for byte,
 *      each in a right-to-left block at the 24px floor, with its Shamela link, and its example
 *      links one ayah of its own lesson; a step whose lesson is not available names itself, says
 *      "Belum tersedia" and shows no formula, no quote and no link;
 *   3. as production shows it, no byte of a hidden surah's formula is on the page and no link
 *      leads into a hidden surah;
 *   4. at the largest text size nothing scrolls sideways (phone: shot);
 *   5. printed (print media): the header and the page's own controls are gone, the footer (with the
 *      AI label) stays, and every step is kept whole. Desktop saves the page as a PDF too.
 * Fails the job otherwise.
 */
async function rumusCheck(page, vp, surahsOn) {
  const { file, mark, slugOf, reachable } = await reachability(surahsOn);
  const rumus = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "rumus.json"), "utf8"));
  const msgs = JSON.parse(await readFile(path.join(BELAJAR_DIR, "messages", "id.json"), "utf8"));
  const none = msgs.Rumus?.none;
  if (!none) throw new Error("messages/id.json has no Rumus.none");
  const lessonOf = Object.fromEntries(file.lessons.map((l) => [l.id, l]));
  const entry = Object.fromEntries(rumus.steps.map((e) => [e.step, e]));
  await page.goto(BASE + RUMUS, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.locator("main [data-rumus-step]").evaluateAll((els) =>
    els.map((e) => {
      const status = e.querySelector("[data-rumus-status]");
      const box = status ? status.getBoundingClientRect() : null;
      const sources = [...e.querySelectorAll("[data-rumus-source]")].map((s) => ({
        page: s.getAttribute("data-rumus-source"),
        quotes: [...s.querySelectorAll("[data-rumus-quote]")].map((q) => ({
          text: (q.textContent ?? "").trim(),
          lang: q.getAttribute("lang"),
          dir: q.getAttribute("dir"),
          size: parseFloat(getComputedStyle(q).fontSize),
        })),
        shamela: [...s.querySelectorAll("a[data-rumus-shamela]")].map((a) => a.getAttribute("href")),
      }));
      const formula = e.querySelector("[data-rumus-formula]");
      const fbox = formula ? formula.getBoundingClientRect() : null;
      return {
        id: e.getAttribute("data-rumus-step"),
        state: e.getAttribute("data-rumus-state"),
        formula: formula && fbox.width > 0 && fbox.height > 0 ? (formula.textContent ?? "").trim() : null,
        none: !!e.querySelector("[data-rumus-none]"),
        status: status && box.width > 0 && box.height > 0 ? (status.textContent ?? "").trim() : null,
        focusable: status ? status.querySelectorAll("a, button, input, select, textarea, summary, [tabindex]").length : 0,
        example: e.querySelector("[data-rumus-example]")?.getAttribute("data-rumus-example") ?? null,
        links: [...e.querySelectorAll('a[href*="/quran/"]')].map((a) => a.getAttribute("href")),
        sources,
      };
    }),
  );
  const problems = [];
  const want = file.steps.map((s) => s.id);
  if (JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(want)) problems.push(`lists ${rows.length} step(s), not the ${want.length} of content/curriculum.json in its order`);
  let shown = 0;
  for (const s of file.steps) {
    const r = rows.find((x) => x.id === s.id);
    if (!r) continue;
    const l = lessonOf[s.lesson];
    const e = entry[s.id];
    if (!reachable(l)) {
      if (r.state !== "locked") problems.push(`${s.id}: state ${r.state}, expected locked (its lesson is not available)`);
      if (r.status !== mark) problems.push(`${s.id}: no visible "${mark}" (got ${JSON.stringify(r.status)})`);
      if (r.focusable > 0) problems.push(`${s.id}: ${r.focusable} focusable element(s) inside its "${mark}" label`);
      if (r.formula !== null || r.sources.length > 0 || r.example !== null || r.links.length > 0) problems.push(`${s.id}: a step that is not available shows a formula, a source, an example or a link`);
      continue;
    }
    if (!e) {
      if (r.state !== "none" || !r.none) problems.push(`${s.id}: no formula in the file but the page says ${r.state} (expected "${none}")`);
      if (r.formula !== null || r.sources.length > 0) problems.push(`${s.id}: shows a formula or a source that the file does not have`);
      continue;
    }
    shown++;
    if (r.state !== "shown" || !r.formula) problems.push(`${s.id}: state ${r.state}, no visible formula (the file has one)`);
    if ((r.example ?? null) !== (e.example?.loc ?? null)) problems.push(`${s.id}: example ${r.example}, the file's is ${e.example?.loc ?? "none"}`);
    if (e.example) {
      const [surah, ayah] = e.example.loc.split(":");
      const slug = file.units.find((u) => String(u.surah) === surah && u.slug)?.slug;
      const want = `/belajar/id/quran/${slug}/${ayah}#w-${e.example.loc.replaceAll(":", "-")}`;
      if (!r.links.includes(want)) problems.push(`${s.id}: the example does not link ${want}`);
    }
    if (JSON.stringify(r.sources.map((x) => x.page)) !== JSON.stringify(e.sumber.map((x) => x.page))) problems.push(`${s.id}: sources ${JSON.stringify(r.sources.map((x) => x.page))}, the file's are ${JSON.stringify(e.sumber.map((x) => x.page))}`);
    e.sumber.forEach((src, k) => {
      const got = r.sources[k];
      if (!got) return;
      if (JSON.stringify(got.quotes.map((q) => q.text)) !== JSON.stringify(src.quotes)) problems.push(`${s.id}: the quotes of ${src.page} are not the file's, byte for byte`);
      for (const q of got.quotes) {
        if (q.lang !== "ar" || q.dir !== "rtl") problems.push(`${s.id}: a quote of ${src.page} is not lang="ar" dir="rtl"`);
        if (q.size < 23.5) problems.push(`${s.id}: a quote of ${src.page} is drawn at ${q.size}px (< 24px)`);
      }
      if (JSON.stringify(got.shamela) !== JSON.stringify([src.url])) problems.push(`${s.id}: the Shamela link of ${src.page} is ${JSON.stringify(got.shamela)}, the file's is ${src.url}`);
    });
  }
  if (shown === 0) problems.push("no formula is shown");
  // 3. nothing of a hidden surah, as production shows it
  if (!surahsOn) {
    for (const slug of HIDDEN_SURAHS) {
      const n = await page.locator(`a[href^="/belajar/id/quran/${slug}"]`).count();
      if (n > 0) problems.push(`${n} link(s) into the hidden ${slug}`);
    }
    const body = await page.evaluate(() => document.body.innerText);
    for (const e of rumus.steps) {
      const l = lessonOf[e.lesson];
      if (reachable(l)) continue;
      const shownElsewhere = rumus.steps.some((o) => reachable(lessonOf[o.lesson]) && o.sumber.some((x) => x.quotes.some((oq) => e.sumber.some((y) => y.quotes.some((q) => oq.includes(q))))));
      if (shownElsewhere) continue;
      for (const src of e.sumber) for (const q of src.quotes) if (body.includes(q)) problems.push(`${e.step}: a quote of its hidden lesson is on the page (${src.page})`);
    }
  }
  // 4. the largest text size
  await setTextSizeAttr(page, "sangat-besar");
  const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  if (wide.scroll > wide.inner + 1) problems.push(`scrolls sideways at the largest text size (${wide.scroll} > ${wide.inner})`);
  if (vp === "phone") {
    const name = surahsOn ? "rumus-semua-surah-sangat-besar" : "rumus-sangat-besar";
    await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
    console.log(`shot ${vp}-${name} (${RUMUS}, text size sangat-besar)`);
  }
  await setTextSizeAttr(page, null);
  // 5. printed
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
    return {
      header: shown(document.querySelector("body > header")),
      hidden: [...document.querySelectorAll("[data-rumus-sheet] [data-print-hide]")].filter(shown).length,
      sheet: shown(document.querySelector("[data-rumus-sheet]")),
      footer: shown(document.querySelector("body > footer")),
      keep: [...document.querySelectorAll("[data-rumus-step]")].every((e) => getComputedStyle(e).breakInside === "avoid"),
    };
  });
  if (printed.header) problems.push("printed: the site header is still drawn");
  if (printed.hidden > 0) problems.push(`printed: ${printed.hidden} control(s) marked data-print-hide are still drawn`);
  if (!printed.sheet) problems.push("printed: the sheet is not drawn");
  if (!printed.footer) problems.push("printed: the footer (with the AI label) is not drawn");
  if (!printed.keep) problems.push("printed: a step may be cut across pages (break-inside is not avoid)");
  if (vp === "desktop" && !surahsOn) {
    await page.pdf({ path: `shots/${vp}-rumus-cetak.pdf`, format: "A4", printBackground: false });
    console.log(`shot ${vp}-rumus-cetak.pdf (${RUMUS}, print media)`);
  }
  await page.emulateMedia({ media: "screen" });
  if (problems.length) throw new Error(`${vp}: cheat sheet — ${problems.join("; ")}`);
  console.log(`  ${vp}: cheat sheet ok (${rows.length} steps in the file's order, ${shown} with a formula${surahsOn ? "" : ", no byte of a hidden surah's"}, printable)`);
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

/** How late, at most, the player may stop a clip after its word's end (the element's own clock
 *  where it was paused): a timer set for the end, so normally a few ms; the next word starts
 *  10 ms on. Never early. */
const STOP_LATE_S = 0.15;

/**
 * The example voices beside every example (operator 2026-10-12: "in explanation … provide example +
 * additional voice … each explanation should be followed by examples (visual + voice)"; "not only
 * for harakah, but also for all rules"), on a concept page (idhafah: its example rows), the
 * Harakat page (its sign cards) and a page with parts diagrams (huruf jar), in the real browser.
 * Since 2026-10-14 the voice of a word, of a part of a word (bi-, -ta) and of a base form on its
 * own (ismu) is the AI narrator's recording of exactly that text (content/wordvoice.json, served
 * from /belajar/media/narration/kang-nandar/words/; the button says "suara AI"), never a cut of
 * the imam's recitation:
 *   1. every example row / sign card / diagram word and tile shown carries a voice button
 *      ([data-clip]: a real <button>, at least 48px tall, its aria-label naming the word, idle),
 *      each naming a word the content has the Arabic of; neither the reciters' host nor a
 *      recording of the narrator is asked for while the page loads and sits there;
 *   1b. a recording is said whole, so nothing differs from what is written (review 2026-10-12 had
 *      the imam's stop and a hamzat washal to say): no note ([data-clip-note]) on any of the
 *      pages and no button described by one;
 *   2. pressing one (the one with the longest Arabic, so it still plays at step 3) asks for ONE
 *      recording, one that content/wordvoice.json names, and the button says it plays (data-state
 *      "playing"); the reciters' host is not asked at all;
 *   3. pressing a second example's button, of another text, while the first STILL plays (checked
 *      just before the press): the first is back to idle at once (the page's one element left
 *      it), the second plays and its file is asked for, and nothing else;
 *   4. the second ends by itself: back to idle within its recording's length (content/wordvoice.json
 *      `ms`) and a few seconds. It is a whole file, so its own end may end it; where the player
 *      paused it first, the element's clock at that pause (HTMLMediaElement.prototype.pause,
 *      wrapped in the page for this check) is within [length, length + STOP_LATE_S]. (Until
 *      2026-10-14 the clip was a cut of an ayah's file, which went on after the word and only the
 *      player's stop could end — a pause that had to be seen.)
 * The narrator's files are answered in the browser (narrationRoute: silent stand-ins as long as
 * `ms` says — the runner has no media store); the reciters' host is only observed
 * (watchRecitations); every page call is a locator / page.evaluate (never waitForFunction: the CSP
 * refuses its eval). Fails the job otherwise.
 */
async function clipChecks(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const lib = await read("content/library.json");
  const msgs = await read("messages/id.json");
  const idhafah = lib.concepts.find((c) => c.id === "idhafah");
  const hurufJar = lib.concepts.find((c) => c.id === "huruf-jar");
  const signs = lib.basics.flatMap((b) => b.signs);
  if (!idhafah || !hurufJar || !signs.length || !lib.quran) throw new Error("content/library.json has no idhafah, no huruf-jar, no Harakat signs or no quran texts");
  // The Arabic a button's key names: a lesson word of any lesson surah (content/<slug>.json, the
  // files with `ayat`), else library.json `quran` (a part of a word, a form, a word outside).
  const bytes = new Map(Object.entries(lib.quran));
  for (const name of (await readdir(path.join(BELAJAR_DIR, "content"))).filter((n) => n.endsWith(".json")).sort()) {
    const doc = await read(`content/${name}`).catch(() => null);
    for (const a of Array.isArray(doc?.ayat) ? doc.ayat : []) for (const w of a.words ?? []) if (w.loc && w.ar) bytes.set(w.loc, w.ar);
  }
  // The narrator's files: their addresses (paths) → their length in ms.
  const voices = await wordVoiceIndex();
  if (!voices.size) throw new Error("content/wordvoice.json names no recording");
  // The diagrams a concept page shows outside "Lihat N kata lainnya" (ConceptCard PARTS_SHOWN = 2):
  // each one's joined word and every tile (a part of a word too) has a button.
  const shownParts = lib.parts.filter((p) => p.concepts.includes("huruf-jar")).slice(0, 2);
  const diagramButtons = shownParts.reduce((n, p) => n + 1 + p.tiles.length, 0);
  // The whole-word tiles that start with alif wasla (ismu of QS 55:78, Allāhu of 112:1): the ones
  // the imam's recitation read without their alif and the page used to play as a run with the
  // word before. Pressed second on huruf jar: each is the recording of the form on its own.
  const alone = shownParts.flatMap((p) => p.tiles.filter((t) => t.washal).map((t) => t.q.slice(2)));
  const signWord = (sg) => sg.example.slice(2).split("#")[0];
  // [page, how many voice buttons it shows outside a closed disclosure (at least), what they are,
  //  the one to press second when it is shown]
  const pages = [
    ["/belajar/id/konsep/idhafah", Math.min(6, idhafah.examples.length), "example rows", null],
    // The tanwin dhammah card's word (outside the lessons) is pressed second.
    ["/belajar/id/konsep/harakat", signs.length, "sign cards", signWord(signs.find((sg) => sg.translit) ?? signs[0])],
    ["/belajar/id/konsep/huruf-jar", Math.min(6, hurufJar.examples.length) + diagramButtons, "example rows, diagram words and tiles", alone[0] ?? null],
  ];
  const buttons = page.locator("main button[data-clip]");
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  try {
    for (const [urlPath, atLeast, what, pressSecond] of pages) {
      const watch = watchRecitations(page, new Set(["everyayah.com"]));
      const words = watchWordVoices(page);
      const fail = (m) => {
        throw new Error(`${vp} ${urlPath}: example voices — ${m}`);
      };
      try {
        await page.goto(BASE + urlPath, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        // For step 4: the element's clock at every pause() from here on, in this document only.
        await page.evaluate(() => {
          const calls = [];
          window.__clipPauses = calls;
          const pause = HTMLMediaElement.prototype.pause;
          HTMLMediaElement.prototype.pause = function (...args) {
            if (calls.length < 500) calls.push({ src: this.currentSrc || this.getAttribute("src") || "", t: this.currentTime, wasPaused: this.paused });
            return pause.apply(this, args);
          };
        });
        // 1. The buttons as drawn, before any press.
        const all = await buttons.evaluateAll((els) =>
          els.map((el, i) => {
            const r = el.getBoundingClientRect();
            return {
              i,
              loc: el.getAttribute("data-clip"),
              tag: el.tagName,
              type: el.getAttribute("type"),
              label: el.getAttribute("aria-label") ?? "",
              describedBy: (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean),
              state: el.getAttribute("data-state"),
              height: r.height,
              visible: r.width > 0 && r.height > 0 && !el.closest("details:not([open])"),
            };
          }),
        );
        const shown = all.filter((b) => b.visible);
        if (shown.length < atLeast) fail(`${shown.length} voice buttons shown, expected at least ${atLeast} (${what})`);
        for (const b of shown) {
          if (!bytes.get(b.loc)) fail(`button ${b.i} names ${b.loc}, which is no word of the lessons nor a text of content/library.json \`quran\``);
          if (b.tag !== "BUTTON" || b.type !== "button") fail(`${b.loc}: not a <button type="button">`);
          if (b.height < 47.5) fail(`${b.loc}: ${b.height}px tall (< 48px)`);
          const prefix = msgs.Clip.play_label.replace("{word}", "");
          if (!b.label.startsWith(prefix) || b.label.length <= prefix.length) fail(`${b.loc}: aria-label “${b.label}” does not name its word`);
          if (b.state !== "idle") fail(`${b.loc} says "${b.state}" before any press`);
        }
        if (watch.seen.length || words.seen.length) fail(`a recording was asked for before a press: ${watch.list()} / ${words.list()}`);

        // 1b. A recording is said whole: nothing differs from what is written, so no note.
        const noted = await page.locator("main [data-clip-note]").count();
        if (noted) fail(`${noted} note(s) about what is heard on a page whose voices are whole recordings`);
        for (const b of all) {
          if (b.describedBy.length) fail(`${b.loc} is described by ${b.describedBy.join(" ")} though nothing differs in what is heard`);
        }
        await page.screenshot({ path: `shots/${vp}-suara-contoh-${urlPath.split("/").pop()}.png`, fullPage: true });

        // 2. Which two: the SECOND a button of another text (the page's preferred one when it is
        // shown), the FIRST the one with the longest Arabic (the longest recording, so it still
        // plays when the second is pressed).
        const arOf = (b) => bytes.get(b.loc) ?? "";
        const second = shown.find((b) => b.loc === pressSecond) ?? shown[shown.length - 1];
        if (pressSecond && second.loc !== pressSecond) fail(`${pressSecond} is not among the buttons shown (pressed second on this page)`);
        const first = shown.filter((b) => arOf(b) !== arOf(second)).sort((x, y) => arOf(y).length - arOf(x).length)[0];
        if (!first) fail("no two examples of different texts to press");
        const btnA = buttons.nth(first.i);
        const btnB = buttons.nth(second.i);
        const paths = () => [...new Set(words.seen.map((u) => new URL(u).pathname))];
        await btnA.click();
        if (!(await until(page, async () => words.seen.length > 0, 15_000))) {
          fail(`pressing ${first.loc} asked for no recording of the narrator (served: ${served.slice(-3).join(" | ") || "none"})`);
        }
        const stateA = await btnA.getAttribute("data-state");
        if (stateA !== "playing") fail(`after its press ${first.loc} says "${stateA}", not "playing" (${words.list()})`);
        const [fileA] = paths();
        if (!voices.has(fileA)) fail(`pressing ${first.loc} asked for ${fileA}, which content/wordvoice.json does not name`);
        if (paths().length !== 1) fail(`the press asked for other files too: ${words.list()}`);
        if (watch.seen.length) fail(`the press asked the reciters' host: ${watch.list()}`);

        // 3. A second press, on another example, stops the first — which must still be playing,
        // or the press would prove nothing.
        const beforeB = await btnA.getAttribute("data-state");
        if (beforeB !== "playing") {
          fail(`${first.loc} says "${beforeB}" just before ${second.loc} is pressed: its recording (${voices.get(fileA)} ms) is over, so the press cannot show that it stops the first`);
        }
        await btnB.click();
        const states = async () => [await btnA.getAttribute("data-state"), await btnB.getAttribute("data-state")];
        await until(page, async () => (await states()).join() === "idle,playing", 2_000);
        const [aAfter, bAfter] = await states();
        if (aAfter !== "idle") fail(`after pressing ${second.loc}, ${first.loc} still says "${aAfter}" (two voices at once)`);
        if (bAfter !== "playing") fail(`after its press ${second.loc} says "${bAfter}", not "playing"`);
        if (!(await until(page, async () => paths().length > 1, 15_000))) {
          fail(`pressing ${second.loc} asked for no other recording (asked: ${words.list()})`);
        }
        const files = paths();
        if (files.length !== 2) fail(`the presses asked for ${files.length} recordings, not two: ${words.list()}`);
        const fileB = files.find((f) => f !== fileA);
        if (!voices.has(fileB)) fail(`pressing ${second.loc} asked for ${fileB}, which content/wordvoice.json does not name`);
        if (watch.seen.length) fail(`the presses asked the reciters' host: ${watch.list()}`);
        const playingNow = await buttons.evaluateAll((els) => els.filter((el) => el.getAttribute("data-state") === "playing").length);
        if (playingNow > 1) fail(`${playingNow} buttons say "playing" at once`);

        // 4. It ends by itself, within its recording's length.
        const lengthB = voices.get(fileB);
        const ended = await until(page, async () => (await btnB.getAttribute("data-state")) !== "playing", 15_000 + lengthB);
        const endState = await btnB.getAttribute("data-state");
        if (!ended || endState !== "idle") {
          fail(`${second.loc} did not end by itself after its recording (${lengthB} ms; says "${endState}"; ${words.list()})`);
        }
        const pauses = await page.evaluate(() => window.__clipPauses ?? null);
        if (!pauses) fail("the pause recorder is gone from the page (it navigated?)");
        const end = lengthB / 1000;
        const stop = pauses.filter((c) => c.src && new URL(c.src, BASE).pathname === fileB && !c.wasPaused).pop();
        // A whole file may simply end (no pause()); one the player paused was paused at its length.
        if (stop && (stop.t < end - 0.001 || stop.t > end + STOP_LATE_S)) {
          fail(`${second.loc} was stopped at ${stop.t.toFixed(3)} s of ${fileB}; its recording lasts ${end.toFixed(3)} s (allowed: ${end.toFixed(3)}–${(end + STOP_LATE_S).toFixed(3)} s)`);
        }
        console.log(
          `  ${vp}: example voices ok on ${urlPath} (${shown.length} buttons, none asked before a press, no note; ${first.loc} → ${recordingName(fileA, 3)} ` +
            `${words.answered.get(words.seen[0]) ?? "?"}, still playing when stopped by ${second.loc} → ${recordingName(fileB, 3)}, ` +
            `which ended ${stop ? `at ${stop.t.toFixed(3)} s (paused by the player; ${end.toFixed(3)} s long)` : `by itself (${end.toFixed(3)} s long)`}; the reciters' host: not asked)`,
        );
      } catch (err) {
        await page.screenshot({ path: `shots/${vp}-suara-contoh-FAILED.png` }).catch(() => {});
        throw err;
      } finally {
        watch.stop();
        words.stop();
      }
    }
  } finally {
    await page.unroute(isNarration, handler);
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

/** How every emphasised meaning in `scope` ([data-emph="meaning"]: MixedText's overlay, a karaoke
 *  word) looks right now: its text, weight and colour, whether it is the word being said, and
 *  whether it is on screen. */
async function meaningLooks(page, scope) {
  // A karaoke word's colour fades in 150ms when its state changes ("nama." the moment the narrator
  // moves on): measured in a moment none of them is fading, never in between two colours.
  return page.locator(`${scope} [data-emph="meaning"]`).evaluateAll(async (els) => {
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
}

/**
 * Emphasis on the karaoke shot (operator 2026-10-11: "we can also use bold text or different color
 * to highlight the meanings or important things"): the meaning in `scope` — the word card's "yang
 * artinya “…”", the caption's gloss — is on screen, bold, and forest (paper while it is the word
 * being said, on the forest fill). So the emphasis cannot quietly disappear (a renamed prop, a
 * class Tailwind no longer generates) while the shots still look fine at a glance.
 */
async function assertEmphasis(page, vp, scope, what) {
  const looks = await meaningLooks(page, scope);
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
 * the step named "w1" on the stage (toStep: intro → the ayah → what the ayah brings, a step per group → the imam says
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
 * EVERY meaning of a caption is drawn as one (operator 2026-10-13: "sometimes found this: yang
 * artinya “dengan” (which is correct), some sentence dont use “ and without color"; plan L22): on
 * Al-Fatihah 1, the first concept line that glosses two or more words after "yang artinya" — read
 * from content/narration/al-fatihah.json, never typed; today "Huruf jar": "huruf ba’ yang artinya
 * “dengan”, dan huruf lam yang artinya “bagi”" — played from its start on its own step ("↺
 * Ulangi"). Until 2026-10-13 a caption emphasised its first meaning and left the others plain.
 * Each gloss must appear in the caption as [data-emph="meaning"], bold and forest (paper while it
 * is the word being said): in the karaoke caption all of them at once, in a caption-only line
 * (its narration not rendered) as its parts go by. Not asserted: that they fit the viewport (a
 * long caption, a phone) — the karaoke shot's layout check covers the caption a word card sits
 * above. Fails the job when a gloss never shows as a meaning or shows in another style.
 */
async function everyMeaningCheck(page, vp, index) {
  const lines = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "narration", "al-fatihah.json"), "utf8")).lines ?? {};
  const glossesOf = (display) => [...String(display ?? "").matchAll(/artinya:? “([^”]+)”/g)].map((m) => m[1]);
  const found = Object.entries(lines).find(([id, l]) => /^al-fatihah:1:concept:[a-z0-9-]+$/.test(id) && glossesOf(l.display).length >= 2);
  if (!found) throw new Error(`${vp}: every-meaning check — no concept line of Al-Fatihah 1 glosses two words after "artinya" (content/narration/al-fatihah.json)`);
  const [lineId, line] = found;
  const step = lineId.replace(/^al-fatihah:1:/, "");
  const glosses = glossesOf(line.display);
  const voiced = (await narratedLine("al-fatihah", lineId)).voiced;
  /** Letters and digits only, so “dengan”, and dengan, are the same word. */
  const norm = (t) => t.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const scope = `[data-autoplay="caption"][data-line="${lineId}"]`;
  const stage = page.locator('[data-autoplay="stage"]');
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
    await toStep(page, vp, step);
    await page.locator('[data-autoplay="replay"]').click();
    await page.locator(`${scope} [data-emph="meaning"]`).first().waitFor({ state: "attached", timeout: 25_000 });
    // The glosses seen as meanings, and any meaning seen in another style.
    const seen = new Set();
    const wrong = [];
    const all = await until(
      page,
      async () => {
        const looks = await meaningLooks(page, scope);
        const drawn = ` ${looks.map((x) => norm(x.text)).join(" ")} `;
        for (const g of glosses) if (drawn.includes(` ${norm(g)} `)) seen.add(g);
        for (const x of looks) if (!(x.weight >= 600) || x.color !== (x.now ? PAPER : FOREST)) wrong.push(x);
        return seen.size === glosses.length || wrong.length > 0;
      },
      60_000,
    );
    if (wrong.length) throw new Error(`${vp}: ${lineId}: a meaning not bold in ${FOREST} (${PAPER} on the word being said): ${JSON.stringify(wrong.slice(0, 4))}`);
    if (!all) {
      const missing = glosses.filter((g) => !seen.has(g));
      throw new Error(`${vp}: ${lineId} glosses ${glosses.map((g) => `“${g}”`).join(", ")}, but ${missing.map((g) => `“${g}”`).join(", ")} never showed as a meaning ([data-emph="meaning"]) in its caption`);
    }
    await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-every-meaning.png` });
    console.log(`shot ${vp}-autoplay-ayah1-every-meaning`);
    console.log(`  every meaning ok: ${lineId} (${voiced ? "karaoke" : "caption-only"}) — ${glosses.map((g) => `“${g}”`).join(", ")} each bold in forest`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-every-meaning-FAILED.png`, fullPage: true }).catch(() => {});
    const caption = await page
      .locator('[data-autoplay="caption"]')
      .innerHTML()
      .catch(() => "(no caption element)");
    console.error(`✗ ${vp}: the every-meaning check (Al-Fatihah 1, ${lineId}) failed`);
    console.error(`  on screen: step ${(await stage.getAttribute("data-step").catch(() => null)) ?? "—"}, line ${(await page.locator('[data-autoplay="caption"]').getAttribute("data-line").catch(() => null)) ?? "—"}`);
    console.error(`  caption HTML: ${caption.slice(0, 900)}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
  }
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

/**
 * Al-Fatihah's recordings (content/al-fatihah.json): the ONE recitation of an ayah — its address
 * and word timings — and the recordings' hosts. One imam everywhere, and no reciter setting
 * (operator 2026-10-13, docs/belajar-plan.md L21), so the content says which recording a page
 * plays; the stage names no reciter any more. An ayah with none, or with a second one, stops the
 * check that asks.
 */
async function fatihahRecitations() {
  const content = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "al-fatihah.json"), "utf8"));
  const recitationOf = (ayah) => {
    const [only, ...more] = content.ayat.find((a) => a.ayah === ayah)?.recitation ?? [];
    if (!only || more.length) {
      throw new Error(`content/al-fatihah.json gives Al-Fatihah ${ayah} ${only ? more.length + 1 : 0} recitations: every ayah has exactly one (one imam)`);
    }
    return only;
  };
  return {
    recitationOf,
    hosts: new Set(content.ayat.flatMap((a) => a.recitation.map((r) => new URL(r.url).host))),
  };
}

/** A recording's address, short: "Alafasy_128kbps/001001.mp3" (`parts` last path segments; a
 *  narrator's file "kang-nandar/words/<id>-<sum>.mp3" with 3). */
const recordingName = (url, parts = 2) => new URL(url, "http://x").pathname.split("/").slice(-parts).join("/");

/**
 * Every request `pg` makes to a narrator's word recording (content/wordvoice.json, under
 * WORD_VOICE_PREFIX of this site) from now on — the example voices of the Konsep pages and of the
 * lessons' example beats — as it is made (`seen`, full URLs, in order), and how it was answered
 * (`answered`: "ok" for a 200 / 206). The same shape as watchRecitations, for the app's own
 * origin, where only the path tells the narrator's words from every other request.
 */
function watchWordVoices(pg) {
  const isWord = (url) => {
    try {
      return isWordVoice(new URL(url));
    } catch {
      return false;
    }
  };
  const seen = [];
  const answered = new Map();
  const onRequest = (req) => {
    if (isWord(req.url())) seen.push(req.url());
  };
  const onFinished = async (req) => {
    if (!isWord(req.url())) return;
    const status = (await req.response().catch(() => null))?.status();
    answered.set(req.url(), status === 200 || status === 206 ? "ok" : `HTTP ${status ?? "?"}`);
  };
  const onFailed = (req) => {
    if (isWord(req.url())) answered.set(req.url(), `failed (${req.failure()?.errorText ?? "?"})`);
  };
  pg.on("request", onRequest);
  pg.on("requestfinished", onFinished);
  pg.on("requestfailed", onFailed);
  return {
    seen,
    answered,
    requested: (url) => seen.filter((u) => u === url).length,
    list: () => seen.map((u) => `${recordingName(u, 3)} → ${answered.get(u) ?? "no answer yet"}`).join("\n    ") || "(none)",
    stop: () => {
      pg.off("request", onRequest);
      pg.off("requestfinished", onFinished);
      pg.off("requestfailed", onFailed);
    },
  };
}

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
 * Al-Fatihah 1 and then 2, phone, the remembered place of ayah 1 cleared first. The narration is
 * answered in the browser, so the opening line lasts as long as the manifest says (23 s); the
 * requests to the reciters' host are only OBSERVED (watchRecitations) and the real CDN answers
 * them — steps 1, 2 and 4 need no answer from it, only the asking.
 * ONE imam (operator 2026-10-13, docs/belajar-plan.md L21): an ayah has one recording, the one the
 * content gives (fatihahRecitations). Until that day the early fetch was isolated by choosing the
 * second reciter in "Pengaturan" with the lesson paused — a recording no play had asked for. That
 * recording is now the NEXT AYAH's: the lesson reaches ayah 2 by itself (the hand-off), with no
 * click on that page, so no click's unlock() play asks for its file; steps 4 and 5 prove on it
 * what the reciter switch proved.
 *   1. a page view alone asks the reciters' host for no recording: none IDLE_SETTLE_MS after the
 *      page has loaded, when its idle preload (the first narration line) has run;
 *   2. after "Mulai", this ayah's recording is requested while the narrator still speaks the
 *      opening line: the stage is on its first step, not yet on the imam's ("recite"). Not proof
 *      of the early fetch by itself (review 2026-10-11): on a first "Mulai" the click's own
 *      unlock() play asks for the file too, as it did before the early fetch existed. Steps 4 and
 *      5 are the proof;
 *   3. this runner can play the recordings at all (it needs the CDN and the MP3 decoder): on the
 *      imam's step of ayah 1, with the network free, "↺ Ulangi" must make him SOUND. Where the
 *      RUNNER cannot (the CDN did not answer the recording in full, or the browser has no MP3
 *      decoder), step 5 is not checked and says so in a warning on the run's summary, never
 *      failed for the runner's sake. Where the page HAD the recording and the decoder and he still
 *      did not sound, or the page itself cancelled the fetch (net::ERR_ABORTED), the check fails
 *      (review 2026-10-11: a silent imam is the app's fault then, and nothing else in this job
 *      listens for him);
 *   4. a recording is fetched by the page that plays it, by no other, and by the EARLY FETCH
 *      ALONE (review 2026-10-11: the next ayah's is not fetched ahead from the recap). On the
 *      recap of ayah 1, RECAP_SETTLE_MS in, nothing but ayah 1's recording has been requested: no
 *      other ayah's, and no other reciter's (there is none). The lesson then goes on to ayah 2 by
 *      itself, and that page's player requests ITS recording at once, the lesson still on its
 *      first step — with no click on that page (so no unlock() play) and the imam's step not
 *      reached: nothing but warm() asks for it. Without the early fetch the element waits for a
 *      play (preload "none") and this request does not come. This is every ayah after the first
 *      of a sitting, where the wait was. The lesson is then paused there ("Jeda" plays nothing:
 *      only the clicks that start or move a lesson make the silent play), so it cannot reach the
 *      imam's step by itself before step 5 is ready;
 *   5. what the imam's step then plays is what was fetched ahead. For the recording of step 4
 *      (asked for by the early fetch and by nothing else), once the CDN has answered it in full,
 *      every further request to the reciters' host is HELD BACK RECITE_HOLD_MS (a route that
 *      waits, then continues to the CDN), put in place BEFORE the first click that could play
 *      anything on that page. The lesson is taken to the imam's step and "↺ Ulangi" plays it: he
 *      must SOUND, with no "Memuat bacaan imam…" status on the way, and NOT ONE request for the
 *      file reaches the hold — a play that needed the network would ask it, show the status after
 *      0.6 s and sound 6 s late.
 *      "Sounding" (review 2026-10-11) is a mushaf word lit (aria-current) that the player can only
 *      light once the recording has ADVANCED: one whose segment starts after 0 ms (the chip's
 *      data-word → the recording's segments in content/al-fatihah.json). A lit word alone proves
 *      nothing: a word whose segment starts at 0 ms is lit on the "play" event, before any data
 *      (it lit with the network held back, 2026-10-11), and a recitation paused mid-ayah keeps
 *      its word lit. So the word lit before the click does not count until the line has been
 *      seen to change.
 * Fails the job on 1–5.
 */
const IDLE_SETTLE_MS = 4000;
const RECITE_HOLD_MS = 6000;
const RECAP_SETTLE_MS = 2500;
async function warmupChecks(page, vp, index) {
  const { recitationOf, hosts } = await fatihahRecitations();
  const isRecitation = (url) => hosts.has(url.host);
  const name = recordingName;
  const { seen, answered, requested, list, stop } = watchRecitations(page, hosts);
  // Step 5: later requests to the reciters' hosts wait, then go on to the CDN.
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
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // The recordings of the two pages this check visits: each ayah's one recitation.
    const mine = recitationOf(1).url;
    const theirs = recitationOf(2).url;
    if (mine === theirs) throw new Error(`${vp}: early fetch — Al-Fatihah 1 and 2 share one recording (${name(mine)}) in content/al-fatihah.json`);

    // 1. A page view alone: nothing of the imam's.
    await page.waitForTimeout(IDLE_SETTLE_MS);
    if (seen.length) throw new Error(`${vp}: a page view alone asked the reciters' host for ${seen.map(name).join(", ")} — before "Mulai"`);
    console.log(`  early fetch 1/5: no request to ${[...hosts].join(", ")} on a page view (two loads, ${IDLE_SETTLE_MS} ms idle)`);

    // 2. "Mulai": this ayah's recording, while the narrator speaks the opening line.
    const t0 = Date.now();
    await Promise.all([
      page.waitForRequest((r) => r.url() === mine, { timeout: 10_000 }).catch(() => {
        throw new Error(`${vp}: 10 s after "Mulai" this ayah's recording (${name(mine)}) was not requested (requests: ${seen.map(name).join(", ") || "none"})`);
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
    // Also asked for by the click's own unlock() play: the early fetch alone is shown by 4 and 5.
    console.log(
      `  early fetch 2/5: ${name(mine)} requested ${askedAfter} ms after "Mulai", the lesson on step "${opening}" (line ${line ?? "—"}), before the imam's step ` +
        `(the click's own silent play asks for it too: steps 4 and 5 show the early fetch alone)`,
    );

    // 3. The imam's step with the network free: can this runner play him at all?
    await toStep(page, vp, "recite");
    const lit = stage.locator('button[aria-current="true"]');
    const status = page.locator('[data-autoplay="loading"][data-kind="recitation"]');
    const replay = page.locator('[data-autoplay="replay"]');
    /** How long the imam's cue line of `ayah` lasts (its narration file, as the route answers it). */
    const cueMsOf = async (ayah) => {
      const cue = await narratedLine(KARAOKE.slug, `al-fatihah:${ayah}:recite`);
      return (cue.url && index.get(cue.url)) || 10_000;
    };
    /** The place of the mushaf word lit as "being recited" (its chip's data-word); null: none. */
    const litWord = async () => {
      const [place] = await lit.evaluateAll((els) => els.map((el) => el.getAttribute("data-word")));
      if (place === undefined) return null;
      if (!/^[1-9]\d*$/.test(place ?? "")) throw new Error(`${vp}: early fetch — the mushaf word lit carries no data-word (${place}): its place cannot be read (AyahPlayer.tsx)`);
      return Number(place);
    };
    /** The words of `ayah`'s recording that light only once it has ADVANCED: those whose segment
     *  starts after 0 ms (a word at 0 ms lights on the "play" event, before any data). */
    const laterWords = (ayah) => new Set(recitationOf(ayah).segments.filter(([, startMs]) => startMs > 0).map(([word]) => word));
    /** "↺ Ulangi" on the imam's step of `ayah` (the page on screen), then: ms until he SOUNDS — a
     *  later word of his lit, and not merely the chip the turn before left lit (null: not in
     *  time) — and whether "Memuat bacaan imam…" showed first (`stopOnStatus`: that ends the
     *  watch, the play is waiting for the network). Leaves the lesson paused on that step. */
    const imamTurn = async (ayah, stopOnStatus) => {
      const url = recitationOf(ayah).url;
      const proof = laterWords(ayah);
      if (!proof.size) throw new Error(`${vp}: early fetch — ${name(url)} has no word that starts after 0 ms in content/al-fatihah.json: nothing shows that it advanced`);
      const cueMs = await cueMsOf(ayah);
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
      return { sounded, word, waited, took, cueMs };
    };
    const base = await imamTurn(1, false);
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
    /** Step 5 left unchecked for the runner's sake: said where it shows, on the run's summary. */
    const notChecked = (why) => console.log(`::warning title=Belajar early fetch 5/5 not checked::${vp}: ${why}`);
    if (canSound) {
      console.log(
        `  early fetch 3/5, network free: the imam sounded (word ${base.word} lit) ${base.sounded} ms after "↺ Ulangi" (his cue line is ${base.cueMs} ms)${base.waited ? ", after a loading status" : ""}`,
      );
    } else {
      const state = `no later word lit in ${base.took} ms; ${name(mine)} → ${answered.get(mine) ?? "no answer"}; canPlayType("audio/mpeg") = "${codec}"`;
      const blame = runnerFault(mine);
      // The page had what it needs and the imam stayed silent: the lesson is broken, not the runner.
      if (!blame) throw new Error(`${vp}: with the network free the imam did not sound on his step (${state}) — the page had the recording, or cancelled its own fetch of it`);
      console.log(`  early fetch 3/5: the imam does not sound on this runner (${state})`);
      notChecked(`the imam's recitation was not heard at all — ${blame}`);
    }

    // 4. A recording is fetched by the page that plays it. Up to the recap: nothing but this
    //    ayah's. Then the hand-off: ayah 2's player fetches its own at once, by the early fetch alone.
    await toStep(page, vp, "recap");
    await page.waitForTimeout(RECAP_SETTLE_MS);
    const strangers = [...new Set(seen)].filter((u) => u !== mine);
    if (strangers.length) {
      throw new Error(`${vp}: on ayah 1, ${RECAP_SETTLE_MS} ms into the recap, recordings this page does not play were requested: ${strangers.map(name).join(", ")} (a recording is fetched by the page that plays it)`);
    }
    await handOffToAyah2(page);
    const t2 = Date.now();
    if (!(await until(page, () => requested(theirs) > 0, 5_000))) {
      throw new Error(
        `${vp}: 5 s after the lesson went on to ayah 2 by itself, its recording (${name(theirs)}) was not requested (requests: ${seen.map(name).join(", ")}) — ` +
          `no click was made on that page, so only the early fetch asks for it`,
      );
    }
    const askedAfter2 = Date.now() - t2;
    const at = await stage.getAttribute("data-step");
    if (at !== "intro") throw new Error(`${vp}: after the hand-off ${name(theirs)} was requested only on step "${at}", not while the first line plays`);
    // Hold the lesson on its first step until step 5 is ready. "Jeda" plays nothing, so the
    // recording stays asked for by the early fetch alone. (A lesson that is not running needs no
    // holding; that it runs after a hand-off is aheadChecks' to prove.)
    if ((await middle.getAttribute("data-mode").catch(() => null)) === "pause") await middle.click();
    await page.waitForTimeout(150);
    const held2 = await stage.getAttribute("data-step");
    if (held2 !== "intro") throw new Error(`${vp}: the lesson on ayah 2 left its first step for "${held2}" before it could be paused`);
    const unknown = [...new Set(seen)].filter((u) => u !== mine && u !== theirs);
    if (unknown.length) throw new Error(`${vp}: recordings neither page plays were requested: ${unknown.map(name).join(", ")} (one imam: each ayah has one recording)`);
    console.log(
      `  early fetch 4/5: nothing but ${name(mine)} requested on ayah 1 (to its recap); on ayah 2, reached by the lesson itself, ` +
        `${name(theirs)} requested within ${askedAfter2} ms of its start, the lesson on step "${at}" — no click on that page, before the imam's step: the early fetch alone`,
    );

    // 5. That recording was fetched ahead, by nothing else: with the network held back, the
    //    imam's step must play it all the same, and ask the network for nothing.
    await until(page, () => answered.has(theirs), 20_000);
    if (!canSound) {
      console.log("  early fetch 5/5 not checked on this runner: the imam does not sound here (above)");
    } else if (answered.get(theirs) !== "ok") {
      const blame = runnerFault(theirs);
      // The page cancelled the very fetch it made ahead: what this step is there to catch.
      if (!blame) throw new Error(`${vp}: the recording fetched ahead (${name(theirs)}) was cancelled by the page itself before it was played (${answered.get(theirs)})`);
      console.log(`  early fetch 5/5 not checked on this runner: ${blame}`);
      notChecked(`played from what was fetched ahead — ${blame}`);
    } else {
      // Before the first click that could play anything on this page ("Berikutnya ›", "↺ Ulangi").
      await page.route(isRecitation, hold);
      try {
        await toStep(page, vp, "recite");
        const held = await imamTurn(2, true);
        const again = heldBack.filter((u) => u === theirs).length;
        const problems = [];
        if (held.waited) problems.push("“Memuat bacaan imam…” showed");
        else if (held.sounded === null) problems.push("no later word of his lit (he did not sound)");
        if (again > 0) problems.push(`${again} new request(s) for ${name(theirs)} went to the network`);
        if (problems.length) {
          throw new Error(
            `${vp}: the imam's step on ayah 2 did not play what was fetched ahead — ${problems.join("; ")} within ${held.took} ms of "↺ Ulangi", ` +
              `the network held back ${RECITE_HOLD_MS} ms (on ayah 1, with the network free, he sounded after ${base.sounded} ms)`,
          );
        }
        console.log(
          `  early fetch 5/5: on ayah 2, with the reciters' host held back ${RECITE_HOLD_MS} ms, the imam sounded (word ${held.word} lit) ${held.sounded} ms after "↺ Ulangi" ` +
            `(his cue line is ${held.cueMs} ms), no loading status, no new request for ${name(theirs)} — played from what the early fetch alone had asked for`,
        );
      } finally {
        await page.unroute(isRecitation, hold);
      }
    }
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
 * made at once would overlap; one file's fetch() is made to fail (503: the lesson map's first
 * line, "al-fatihah:1:map:new" — what is new in the ayah —, the step two ahead of the first since
 * 2026-10-13, plan L23 and L26: the harakat primer came there before it, and until the basic
 * curriculum the map was one step, "map"); and the check holds back two of the PLAYER's own loads
 * (a slow connection for that file). navigator.wakeLock is the recorder above.
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
 *      step's (the ayah: "al-fatihah:1:recite"), then the step after's (the lesson map's first
 *      line) —
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
 *      FETCHES: "Berikutnya ›" twice, to the lesson map's first step, whose line's fetch() failed in 4
 *      and whose own load is now held back AHEAD_STALL_MS. The player asks the network for it (never
 *      silence: its karaoke caption runs once it is answered), "Memuat suara narator…" shows
 *      meanwhile as it always did, and from that request until it was answered plus the settle
 *      time NO fetch() starts — though one is due (the step after it: what was learnt so far,
 *      the map's second line), and comes right after.
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
  // The one line of the step two ahead of the first: what is new in the ayah, the first of the
  // lesson map's steps (plan L23, L26). The step is named as its line is ("map:new").
  const MAP_1 = "al-fatihah:1:map:new";
  const MAP_STEP = MAP_1.replace(/^al-fatihah:1:/, "");
  const startUrl = lineFiles(shared, "shared:start")[0];
  const introFiles = lineFiles(lines, INTRO);
  const reciteFiles = lineFiles(lines, "al-fatihah:1:recite");
  const mapFiles = lineFiles(lines, MAP_1);
  const [intro1, recite1, map1] = [introFiles[0], reciteFiles[0], mapFiles[0]];
  const [introLine, mapLine] = [await narratedLine("al-fatihah", INTRO), await narratedLine("al-fatihah", MAP_1)];
  if (!startUrl || !intro1 || !recite1 || !map1 || !introLine.voiced || !mapLine.voiced) {
    throw new Error(
      `${vp}: look-ahead check — Al-Fatihah 1's opening lines have no rendered narration (shared:start ${!!startUrl}, intro ${introFiles.length}, recite ${!!recite1}, map ${!!map1}; ` +
        `word timings: intro ${introLine.voiced}, map ${mapLine.voiced}). A line whose text is new has neither until it is rendered: ` +
        "pipeline/render_narration.py (pipeline/README.md, “Peta pelajaran”), commit the manifest, and run again.",
    );
  }
  /** What the page may fetch while the lesson is on "intro": the rest of that step (the intro
   *  line) and the next two steps' files. */
  const ahead = new Set([...introFiles, ...reciteFiles, ...mapFiles]);
  const short = (p) => p.split("/").slice(-2).join("/");

  const pg = await page.context().newPage();
  await pg.addInitScript(wakeLockStub);
  const served = [];
  const timeline = [];
  const delays = new Map();
  // The page's copy of the lesson map's line cannot be made (step 6).
  const failFetch = new Set([map1]);
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
    if (!(await until(pg, () => fetches(mark2).some((e) => e.path === map1), 25_000))) {
      throw new Error(`${vp}: 25 s after "Mulai" the lesson map's line (${short(map1)}) was not fetched ahead (fetches: ${fetches(mark2).map((e) => short(e.path)).join(", ") || "none"})`);
    }
    await onIntro(`${short(map1)} was fetched`);
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
    if (order.indexOf(map1) < order.indexOf(recite1)) problems.push(`${short(map1)} was fetched before ${short(recite1)}`);
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
        ` — this step's next line, the next step's, then the lesson map's; nothing past them, and no audio element asked for any of them`,
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
    const failed = timeline.slice(mark2).filter((e) => e.path === map1);
    if (failed.length !== 1 || failed[0].type !== "fetch") throw new Error(`${vp}: ${short(map1)} (its fetch() answered 503) was requested ${failed.length} time(s) before its step (${failed.map((e) => e.type).join(", ")}): expected the one failed fetch, not tried again`);
    delays.set(map1, AHEAD_STALL_MS);
    const mark6 = timeline.length;
    await forward.click(); // the ayah ("recite")
    await forward.click(); // what is new in the ayah ("map:new")
    if (!(await until(pg, async () => (await stage.getAttribute("data-step")) === MAP_STEP, 5_000))) {
      throw new Error(`${vp}: two "Berikutnya ›" from the first step did not reach the lesson map's first step ("${MAP_STEP}"; on "${await stage.getAttribute("data-step")}")`);
    }
    const stream = () => timeline.slice(mark6).find((e) => e.path === map1 && e.type === "media");
    if (!(await until(pg, () => !!stream(), 3_000))) {
      throw new Error(`${vp}: on the lesson map's step, whose line the page could not fetch, the player did not ask the network for ${short(map1)} within 3 s (requests since: ${timeline.slice(mark6).map((e) => `${short(e.path)} ${e.type}`).join(", ") || "none"})`);
    }
    try {
      await status.waitFor({ state: "visible", timeout: 2_000 });
    } catch {
      throw new Error(`${vp}: the lesson map's line is loading from the network (held back ${AHEAD_STALL_MS} ms) and no loading status shows`);
    }
    const [text, kind] = [(await status.innerText()).replace(/\s+/g, " ").trim(), await status.getAttribute("data-kind")];
    if (text !== msgs.loading_narration || kind !== "narration") throw new Error(`${vp}: the loading status says “${text}” (data-kind ${kind}), expected “${msgs.loading_narration}” (narration)`);
    // "Played" is the held request ANSWERED and then the caption's words being said. Not the first
    // word marked "now": the caption marks it the moment play is asked for, before any audio has
    // arrived (CI 2026-10-13: it showed 822 ms into the 4 s hold, and the check took the hold for
    // broken).
    if (!(await until(pg, () => stream().end !== null, AHEAD_STALL_MS + 10_000))) {
      throw new Error(`${vp}: the lesson map's line, held back ${AHEAD_STALL_MS} ms, was never answered (${Date.now() - stream().start} ms on)`);
    }
    delays.delete(map1);
    const mapSaid = () => caption(MAP_1).locator('[data-karaoke="said"]').count();
    const saidAtAnswer = await mapSaid();
    if (!(await until(pg, async () => (await mapSaid()) > saidAtAnswer, 10_000))) {
      throw new Error(`${vp}: the lesson map's line never played from the network after its fetch ahead had failed (${saidAtAnswer} word(s) said 10 s after its load was answered; line on screen: ${await pg.locator('[data-autoplay="caption"]').first().getAttribute("data-line").catch(() => null)})`);
    }
    const line = stream();
    const stalled = line.end - line.start;
    if (stalled < AHEAD_STALL_MS - AHEAD_SLACK_MS) throw new Error(`${vp}: the lesson map's line was answered after ${stalled} ms, not held back ${AHEAD_STALL_MS} ms: the check cannot show the stall`);
    const since = timeline.slice(timeline.indexOf(line) + 1).filter((e) => e.type === "fetch");
    const during = since.filter((e) => e.start < line.end + AHEAD_SETTLE_MS - AHEAD_SLACK_MS);
    if (during.length) {
      throw new Error(`${vp}: while the lesson map's line was loading (${rel(line.start)}–${rel(line.end)} ms), the page started fetching ahead: ${during.map((e) => `${short(e.path)} at ${rel(e.start)} ms`).join(", ")}`);
    }
    const fetchesAfter = () => timeline.slice(timeline.indexOf(line) + 1).filter((e) => e.type === "fetch");
    if (!(await until(pg, () => fetchesAfter().length > 0, 10_000))) {
      throw new Error(`${vp}: 10 s after the stalled line played, nothing more was fetched ahead — with nothing due, the wait above shows no closed gate (the step after it, the map's second line, has narration: was it fetched before? ${timeline.slice(mark2, mark6).map((e) => short(e.path)).join(", ")})`);
    }
    const next = fetchesAfter()[0];
    if ((await status.count()) > 0) throw new Error(`${vp}: the loading status is still there while the lesson map's line plays`);
    console.log(
      `  ahead 6/9: ${short(map1)} (fetch() failed) played from the network, “${text}” shown while it loaded (held back ${stalled} ms, ${rel(line.start)}–${rel(line.end)} ms); ` +
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
 * on the real pages: the harakat primer in lesson zero (frame 2: fathah on its dotted circle, بَ "b + a"), then
 * word 1 of Al-Fatihah 1 explained by its parts — its first frame [بِ] + [ٱسْمُ], MID-WAY through
 * the change frame (the dhammah fading into kasrah, مُ → مِ, u → i), the change settled, the
 * join (بِٱسْمِ, "bi + ismi → bismi"), and the LAST frame, the joined word exactly as the ayah
 * writes it (content/al-fatihah.json, never typed here): on screen while a line of that frame is
 * the caption, no tile filled as "being recited", and the step ENDS there, waiting for Lanjut with
 * its last line still the caption — the imam does not recite the word again (operator 2026-10-13,
 * docs/belajar-plan.md L24: "when transation from word X to X+1, i think we dont need to recite
 * the X, just directly to X+1"; until then this check waited for a "recited" tile here); plus the
 * change frame with reduced motion (static); and THE AYAH'S LAST WORD (word 4), the one word
 * recited once more: after the last line of its composition — the line that says the imam stops
 * on it — its last frame is marked "recited" (data-recited), still shows the word as the ayah
 * writes it, that line still the caption, and its tile is filled forest with its word readable
 * (computed style: the review of 2026-10-10 found it white on white). Each is
 * checked unclipped (composeFit). In the "Tunggu saya" pace each caption-only line waits for
 * Lanjut, so the frames are stepped through by clicking it (rendered lines play on by themselves);
 * "↺ Ulangi" starts each step even if the imam's stream paused the lesson on the way. Fails the
 * job if the animation never shows or sits under the bottom panel.
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
  // The primer is a unit of the lesson that plays it: its own ayah's, or lesson zero's (ayah 0).
  const plays = c.primer?.lesson === "0" ? ZERO_AYAH : c.primer?.ayah;
  if (c.primer) by.set(plays, ["primer", ...(by.get(plays) ?? [])]);
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
      await page.goto(BASE + lessonPath(ayah), { waitUntil: "networkidle" });
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
              // Caption-only here: three lines at reading pace (~35 s), then the bentuk dasar's example
              // (plan L20: its caption's reading time, ~11 s since plan L24), then the change frame.
              for (let w = 0; w < 180 && (await change.count()) === 0; w++) await page.waitForTimeout(500);
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
  // Word 1's composition and the word itself, from the content: its last frame is the joined word.
  const composeFile = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "compose", "al-fatihah.json"), "utf8"));
  const lessonFile = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "al-fatihah.json"), "utf8"));
  const unit = composeFile.words?.["1:1:1"];
  const word1 = lessonFile.ayat.find((a) => a.ayah === 1)?.words[0];
  if (!unit?.frames?.length || !unit.lines?.length || !word1?.ar) throw new Error(`${vp}: composition check — content/compose/al-fatihah.json has no composition for 1:1:1, or content/al-fatihah.json no word 1:1:1`);
  const lastFrame = unit.frames.length;
  /** The narration lines said over the last frame ("al-fatihah:1:w1:compose:8", …), in order. */
  const lastFrameLines = unit.lines.flatMap((l, k) => (l.frame === lastFrame ? [`al-fatihah:1:w1:compose:${k + 1}`] : []));
  const lastLine = `al-fatihah:1:w1:compose:${unit.lines.length}`;
  if (lastFrameLines.at(-1) !== lastLine) throw new Error(`${vp}: composition check — the last line of 1:1:1's composition is not said over its last frame (${lastFrame})`);
  // The ayah's last word and its composition: the one the imam recites once more (plan L24).
  const ayah1 = lessonFile.ayat.find((a) => a.ayah === 1);
  const lastWord = ayah1.words.length;
  const stopWord = ayah1.words[lastWord - 1];
  const stopUnit = composeFile.words?.[stopWord.loc];
  if (!stopUnit?.frames?.length || !stopUnit.lines?.length) throw new Error(`${vp}: composition check — content/compose/al-fatihah.json has no composition for ${stopWord.loc}, the last word of ayah 1`);
  const stopLine = `al-fatihah:1:w${lastWord}:compose:${stopUnit.lines.length}`;
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
    // The harakat primer: LESSON ZERO's, right after its opening line (it opened Al-Fatihah 1,
    // after the imam's ayah and the lesson map, until 2026-10-13).
    await page.goto(BASE + INTRO, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
    const replay = page.locator('[data-autoplay="replay"]');
    await toStep(page, vp, "primer");
    await setPace("Tunggu saya");
    await replay.click();
    await comp.waitFor({ state: "visible", timeout: 10_000 });
    await advanceTo('[data-compose-kind="primer"][data-compose-frame="2"]');
    await page.waitForTimeout(1600);
    await assertComposeLayout(page, vp);
    await assertComposeFits(page, `${vp}: primer`);
    await shot("autoplay-pengantar-primer");
    // Ayah 1: intro → the ayah → what the ayah brings → the imam says word 1 → its gloss line →
    // its composition (Biasa: "Berikutnya ›" jumps whole steps)
    await setPace("Biasa");
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
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
    // The last frame: the joined word, while a line of that frame is said. Nothing follows it in
    // the step — the imam does not recite word 1 again (plan L24; only the ayah's last word,
    // below) — so no tile is filled as "being recited" and the figure carries no such mark.
    await advanceTo(`[data-compose-word="1"][data-compose-frame="${lastFrame}"]`);
    await page.waitForTimeout(1600);
    const caption = page.locator('[data-autoplay="caption"]').first();
    const joined = {
      step: await stage.getAttribute("data-step"),
      frame: await comp.getAttribute("data-compose-frame"),
      line: await caption.getAttribute("data-line"),
      tiles: await comp.locator("[data-compose-layer] [data-compose-tile]").evaluateAll((els) =>
        els.map((el) => ({ ar: [...el.querySelectorAll('[lang="ar"]')].map((n) => n.textContent ?? ""), bg: getComputedStyle(el).backgroundColor })),
      ),
    };
    const lastTile = joined.tiles.at(-1);
    const joinedProblems = [];
    if (joined.step !== "w1:compose" || joined.frame !== String(lastFrame)) joinedProblems.push(`the stage is on step "${joined.step}", frame ${joined.frame}, not on w1:compose frame ${lastFrame}`);
    if (!lastFrameLines.includes(joined.line ?? "")) joinedProblems.push(`the caption is line ${joined.line ?? "—"}, not a line said over the last frame (${lastFrameLines.join(", ")})`);
    // (a tile that changes shows the form it changes from first, then the form it becomes: the last)
    if (joined.tiles.length !== 1 || lastTile?.ar.at(-1) !== word1.ar) joinedProblems.push(`the last frame does not show the one word as the ayah writes it (tiles: ${JSON.stringify(joined.tiles.map((t) => t.ar))})`);
    if (joined.tiles.some((t) => t.bg === FOREST)) joinedProblems.push(`a tile of the last frame is filled forest, as if the imam were reciting the joined word (${joined.tiles.map((t) => t.bg).join(", ")})`);
    if (joinedProblems.length) throw new Error(`${vp}: word 1's joined word — ${joinedProblems.join("; ")}`);
    await assertComposeFits(page, `${vp}: word 1 joined`);
    await shot("autoplay-ayah1-compose-5-joined");
    // … and the step ends on it: "Tunggu saya" waits for Lanjut with the composition's last line
    // still the caption and the joined word still on screen (a line that is caption-only here is
    // held for Lanjut too: clicked through, as advanceTo does).
    let ended = false;
    for (const deadline = Date.now() + 60_000; Date.now() < deadline && !ended; ) {
      const [guide, line] = [await middle.getAttribute("data-guide"), await caption.getAttribute("data-line")];
      if (guide === "lanjut" && line === lastLine) ended = true;
      else if (guide === "lanjut") await middle.click();
      if (!ended) await page.waitForTimeout(300);
    }
    const atEnd = {
      step: await stage.getAttribute("data-step"),
      frame: await comp.getAttribute("data-compose-frame").catch(() => null),
      line: await caption.getAttribute("data-line"),
      recited: await comp.getAttribute("data-recited").catch(() => null),
    };
    if (!ended || atEnd.step !== "w1:compose" || atEnd.frame !== String(lastFrame)) {
      throw new Error(`${vp}: word 1's composition did not end on its joined word waiting for Lanjut (${ended ? "Lanjut shows" : "no Lanjut within 60 s"}; step "${atEnd.step}", frame ${atEnd.frame}, line ${atEnd.line ?? "—"})`);
    }
    if (atEnd.recited !== null) throw new Error(`${vp}: word 1's composition ends marked "recited" (data-recited="${atEnd.recited}"): only the ayah's last word is recited once more`);
    console.log(`  joined word: frame ${lastFrame} of ${lastFrame} shows ${word1.translit} as the ayah writes it while ${joined.line} is said, no tile filled; the step ends there (Lanjut, line ${atEnd.line}) — no recitation after it`);
    // The change frame again with reduced motion: static frames, no transition.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await replay.click();
    await advanceTo('[data-compose-stage="change"]');
    await page.waitForTimeout(300);
    await shot("autoplay-ayah1-compose-3-change-reduced-motion");
    await page.emulateMedia({ reducedMotion: null });
    const text = (await comp.innerText()).replace(/\s+/g, " ").trim();
    console.log(`  composition: ${text}`);
    // The ayah's last word: its lines, then the imam recites it once more — "recited" from the
    // moment the lesson asks him (whether this runner can play the recording or not), and, in
    // "Tunggu saya", until Lanjut. The tile is filled forest, its word readable on it.
    await setPace("Biasa");
    await toStep(page, vp, `w${lastWord}:compose`);
    await setPace("Tunggu saya");
    await replay.click();
    await advanceTo(`[data-compose-word="${lastWord}"][data-recited="true"]`);
    await page.waitForTimeout(700);
    const stop = {
      step: await stage.getAttribute("data-step"),
      frame: await comp.getAttribute("data-compose-frame"),
      line: await caption.getAttribute("data-line"),
      tiles: await comp.locator("[data-compose-layer] [data-compose-tile]").evaluateAll((els) =>
        els.map((el) => {
          const ar = [...el.querySelectorAll('[lang="ar"]')];
          return { ar: ar.map((n) => n.textContent ?? ""), bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(ar.at(-1) ?? el).color };
        }),
      ),
    };
    const stopProblems = [];
    if (stop.step !== `w${lastWord}:compose` || stop.frame !== String(stopUnit.frames.length)) stopProblems.push(`the stage is on step "${stop.step}", frame ${stop.frame}, not on the last frame (${stopUnit.frames.length}) of w${lastWord}:compose`);
    if (stop.line !== stopLine) stopProblems.push(`the caption is line ${stop.line ?? "—"}, not the composition's last line (${stopLine}), which says the imam stops on this word`);
    if (stop.tiles.length !== 1 || stop.tiles[0].ar.at(-1) !== stopWord.ar) stopProblems.push(`the frame does not show the one word as the ayah writes it (tiles: ${JSON.stringify(stop.tiles.map((t) => t.ar))})`);
    else if (stop.tiles[0].bg === "rgb(255, 255, 255)" || stop.tiles[0].bg === stop.tiles[0].fg) stopProblems.push(`the recited tile is ${stop.tiles[0].fg} on ${stop.tiles[0].bg}`);
    if (stopProblems.length) throw new Error(`${vp}: the ayah's last word recited once more — ${stopProblems.join("; ")}`);
    console.log(`  last word (${stopWord.translit}): recited after ${stopLine}, frame ${stop.frame} "recited", tile ${stop.tiles[0].fg} on ${stop.tiles[0].bg}`);
    await assertComposeFits(page, `${vp}: word ${lastWord} recited`);
    await shot("autoplay-ayah1-compose-last-word-recited");
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
 * The examples inside the autoplay lesson (operator 2026-10-12: "in explanation, for example when
 * explaining dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice + show
 * visual) when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each
 * explanation should be followed by examples (visual + voice)" — "not only for harakah, but also
 * for all rules"; docs/belajar-plan.md L20), on Al-Fatihah 1, its remembered place cleared. The
 * narration is answered in the browser (narrationRoute: silent stand-ins as long as the manifests
 * say — the lines' and, since 2026-10-14, the narrator's recordings of the words, which the
 * example beats play from the same media store), so the lines last as long as the lesson's; the
 * reciters' host is the real CDN, only OBSERVED (watchRecitations) — in step 2 the requests for the
 * narrator's word recordings are HELD BACK (a route that waits, then goes on to the narration
 * route). Which examples: read from the content (content/compose/al-fatihah.json `examples`; what
 * the ayah teaches, in order, from content/curriculum.json — its lesson's `lines` — with
 * content/library.json), never typed.
 *   1. THE BENTUK DASAR, IN THE BISMI COMPOSITION ("ismu (read by voice + show visual)"): reached
 *      paused (toStep "w1:compose"), no recording of the narrator has been asked for — a page that
 *      is only looked at, or a step that is not running, asks for no example. "↺ Ulangi" plays the
 *      step: by the time the `base` frame's lines are said and the beat shows (the stage's
 *      data-example = the composition's, on its base frame; its clip key is "<word>#<form>"), the
 *      narrator's recording of the form (one file content/wordvoice.json names) has been
 *      requested; the lesson plays it (data-example-state "reciting", the ringed tile filled
 *      forest); the caption says "Contoh", the base form and where it stands — and NOT that it is
 *      heard with the word before it (the form is recorded on its own, its alif read); nothing in
 *      the figure is clipped and it stays above the panel. Then the composition goes on to its
 *      `change` frame BY ITSELF — whether the runner could play the recording or not.
 *   2. A CLIP THAT DOES NOT COME IS NEVER A DEAD STOP (phone): word 2's composition with every
 *      request for a narrator's word recording held back (its base form's, QS 112:2). The beat
 *      shows; "Memuat bacaan imam…" shows in the bottom panel; after the lesson's own limit
 *      (EXAMPLE_LOAD_LIMIT_MS, not sooner) the example is given up — data-example-state "failed",
 *      "Suara contoh ini belum bisa diputar." — and the lesson, never paused, goes on to the next
 *      frame by itself.
 *   3. A CONCEPT'S EXAMPLE: the first thing this ayah's lesson teaches (the curriculum's first
 *      "Konsep baru" line of the lesson: since the basic curriculum, plan L26, a step with a text
 *      of its own — majrur — where it was the first Konsep whose first example stood in this
 *      ayah), its line played from its
 *      start ("↺ Ulangi" on the concept's step); when the line is through the lesson moves BY
 *      ITSELF to the example step: the example card in the word card's slot ("Contoh", the word's
 *      Arabic exactly as content/al-fatihah.json has it, its transliteration and meaning), above
 *      the panel; the caption names the example; the lesson asks the imam for the word (this
 *      ayah's own recording, already requested: the stage's player); the mushaf line marks that
 *      word. Then the lesson goes on by itself to the next concept's line.
 * Shots: the base example and the concept example (stage; on a phone also the viewport), and the
 * given-up example. What this cannot show: that the right word is HEARD (an ear does that; the
 * recordings are listened to and kept by pipeline/wordvoice.py, and the right text of each is
 * unit-tested: wordvoice.test.ts, clips.test.ts, examples.test.ts), and iOS Safari letting the
 * example player sound without a new tap.
 * Fails the job on 1–3.
 */
/** = src/lib/autoplay/timing.ts (examples.test.ts checks they agree). */
const EXAMPLE_LOAD_LIMIT_MS = 6000;
const EXAMPLE_FAILED_HOLD_MS = 3000;
async function exampleChecks(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const msgs = (await read("messages/id.json")).Guided;
  const lesson = await read("content/al-fatihah.json");
  const lib = await read("content/library.json");
  const compose = await read("content/compose/al-fatihah.json");
  const lines = (await read("content/narration/al-fatihah.json")).lines ?? {};
  const ayah1 = lesson.ayat.find((a) => a.ayah === 1);
  // The narrator's recordings (content/wordvoice.json): the example beats play one for every base
  // form, whether or not an ayah has it. Word 1's base frame is ismu (QS 55:78), word 2's allahu.
  const voices = await wordVoiceIndex();
  const [ismu, allahu] = [compose.examples?.["1:1:1"]?.[0], compose.examples?.["1:1:2"]?.[0]];
  // What Al-Fatihah 1 teaches, in the order its "Konsep baru" lines are said, and the word each
  // one's example is (src/lib/autoplay/curriculum.ts taughtIn: a Konsep taught whole shows its own
  // example in this ayah; a step with a text of its own, or a Konsep with no example here, the
  // first word of the ayah it occurs on).
  const curriculum = await read("content/curriculum.json");
  const lesson1 = curriculum.lessons.find((l) => l.unit === "al-fatihah" && l.ayah === 1);
  const taught = (lesson1?.lines ?? []).map((l) => {
    const step = curriculum.steps.find((s) => s.id === l.step);
    const own = !step?.teach && step?.concept ? lib.concepts.find((c) => c.id === step.concept)?.examples?.find((e) => e.loc.startsWith(`${lesson1.id}:`)) : null;
    return { id: l.line.replace(/^concept:/, ""), step: l.line, n: own ? Number(own.loc.split(":")[2]) : (l.words[0] ?? null) };
  });
  const [concept, after] = taught;
  if (!ayah1 || !ismu?.loc || !allahu || !voices.size || !concept || !after || !concept.n) {
    throw new Error(`${vp}: example check — the content has no bentuk dasar for 1:1:1 (placed in the Qur'an: QS ${ismu?.loc ?? "?"}) and 1:1:2, content/wordvoice.json names no recording, or content/curriculum.json gives Al-Fatihah 1 fewer than two “Konsep baru” lines, the first on a word of the ayah`);
  }
  const word = ayah1.words[concept.n - 1];
  /** How long line `id` lasts at most: its files' lengths (the manifests'); or, not rendered yet
   *  — it is then shown caption-only at the reading pace (src/lib/lessonSteps.ts captionMs at
   *  Biasa: 10 characters a second and 2.5 s to settle per caption part, at least 5 s a part) —
   *  its characters at that pace plus 5 s for every part it could be cut into (a part holds 180
   *  characters at most: one per started 100, and one more). Since the basic curriculum (plan
   *  L26) the first thing Al-Fatihah 1 teaches is a new line, unrendered at first. */
  const lineMs = (id) => {
    const files = lineFiles(lines, id).reduce((n, u) => n + (index.get(u) ?? 0), 0);
    if (files) return files;
    const chars = String(lines[id]?.display ?? "").length;
    return chars ? chars * 100 + (Math.ceil(chars / 100) + 1) * 5_000 : 20_000;
  };
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const watch = watchRecitations(page, new Set(["everyayah.com"]));
  // The narrator's word recordings: observed as the requests are made, answered by `handler`.
  const words = watchWordVoices(page);
  const askedWords = () => [...new Set(words.seen.map((u) => new URL(u).pathname))];
  // Step 2: every request for a narrator's word recording waits until the check lets it go, then
  // goes on to the narration route (`handler`, registered first), which answers it.
  let release = () => {};
  const gate = new Promise((done) => (release = done));
  const heldBack = [];
  const isHeld = isWordVoice;
  const hold = async (route) => {
    heldBack.push(Date.now());
    await gate;
    await route.fallback().catch(() => {});
  };
  const stage = page.locator('[data-autoplay="stage"]');
  const middle = page.locator('[data-autoplay="middle"]');
  const replay = page.locator('[data-autoplay="replay"]');
  const caption = page.locator('[data-autoplay="caption"]');
  const comp = page.locator('[data-autoplay="composition"]');
  const text = async (loc) => ((await loc.first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const attr = (name) => stage.getAttribute(name);
  const fail = (m) => {
    throw new Error(`${vp}: lesson examples (Al-Fatihah 1) — ${m}`);
  };
  /** Waits until the stage shows example beat `id`; false after `ms`. */
  const beatShows = (id, ms) => until(page, async () => (await attr("data-example")) === id, ms);
  /** The states the beat on screen goes through until `done` is true (or `ms` passed). */
  const follow = async (id, done, ms) => {
    const seen = [];
    const ok = await until(
      page,
      async () => {
        const s = (await attr("data-example")) === id ? await attr("data-example-state") : null;
        if (s && seen.at(-1) !== s) seen.push(s);
        return done();
      },
      ms,
    );
    return { ok, seen };
  };
  const running = async () => (await middle.getAttribute("data-mode").catch(() => null)) === "pause";
  try {
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate(() => localStorage.removeItem("belajar:v1:autoplay:al-fatihah/1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);

    // 1. The bentuk dasar of bismi: "ismu (read by voice + show visual)".
    const baseId = `w1:base:${ismu.frame}`;
    await toStep(page, vp, "w1:compose");
    await page.waitForTimeout(800);
    if (words.seen.length) fail(`a recording of the narrator was requested before its step played (requests: ${words.list()})`);
    const t1 = Date.now();
    await replay.click();
    const untilBase = compose.words["1:1:1"].lines.filter((l) => l.frame <= ismu.frame).length;
    const baseWait = Array.from({ length: untilBase }, (_, k) => lineMs(`al-fatihah:1:w1:compose:${k + 1}`)).reduce((a, b) => a + b, 0);
    if (!(await beatShows(baseId, baseWait + 20_000))) {
      fail(`the bentuk dasar's example (${baseId}) never showed in word 1's composition (step "${await attr("data-step")}", frame ${await comp.getAttribute("data-compose-frame").catch(() => "—")})`);
    }
    const shownAfter = Date.now() - t1;
    const at = { step: await attr("data-step"), stage: await comp.getAttribute("data-compose-stage"), frame: await comp.getAttribute("data-compose-frame"), on: await comp.getAttribute("data-example"), clip: await attr("data-example-clip") };
    // The beat's clip key names the word and its form, never the place an imam's cut came from.
    const baseKey = `1:1:1#${ismu.form}`;
    if (at.step !== "w1:compose" || at.stage !== "base" || at.frame !== String(ismu.frame) || at.on !== baseId || at.clip !== baseKey) {
      fail(`the base example is not on the composition's base frame playing ${baseKey}: ${JSON.stringify(at)}`);
    }
    if (!words.seen.length) fail(`at the base frame the narrator's recording of the bentuk dasar had not been requested (requests: ${words.list()})`);
    const recordings = askedWords();
    for (const f of recordings) if (!voices.has(f)) fail(`the base example asked for ${f}, which content/wordvoice.json does not name`);
    if (recordings.length !== 1) fail(`the base example asked for ${recordings.length} recordings, expected its own one: ${words.list()}`);
    const said = await text(caption);
    for (const part of [msgs.example_tag, compose.words["1:1:1"].forms[ismu.form].translit, `QS ${ismu.loc.split(":").slice(0, 2).join(":")}`]) {
      if (!said.includes(part)) fail(`the base example's caption “${said}” does not say “${part}”`);
    }
    // The form is recorded on its own: its caption no longer says it is heard with the word before
    // it (until 2026-10-14 "tabārakasmu", the imam's run).
    if (ismu.washal && said.includes(ismu.washal.heard)) fail(`the base example's caption “${said}” says it is heard with the word before it (“${ismu.washal.heard}”), but the form is recorded on its own`);
    // "reciting": the lesson has played it; "failed": it asked, and this runner could not play the
    // recording (an example given up) — either way the beat was played, not skipped.
    const asked = async () => ["reciting", "failed"].includes((await attr("data-example-state")) ?? "") || (await attr("data-example")) !== baseId;
    const base = await follow(baseId, asked, 5_000);
    if (!base.seen.some((s) => s === "reciting" || s === "failed")) fail(`the lesson never played the bentuk dasar's recording (states: ${base.seen.join(" → ") || "none"})`);
    // The tile changes colour over 300 ms (motion-safe): read once it has settled.
    await page.waitForTimeout(400);
    if ((await attr("data-example")) === baseId && (await attr("data-example-state")) === "reciting") {
      const fill = await comp.locator("[data-compose-layer] [data-compose-tile]").evaluateAll((els) =>
        els.map((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector('[lang="ar"]') ?? el).color })),
      );
      const filled = fill.find((t) => t.bg === FOREST);
      if (!filled) fail(`while the bentuk dasar's recording plays, no tile is filled forest (tiles: ${fill.map((t) => t.bg).join(", ")})`);
      // The filled tile's word must stay readable: the review found a filled tile's word in the
      // tile's own colour (2026-10-10; checked on the joined word's tile until plan L24 took its
      // recitation away).
      if (filled.fg === filled.bg) fail(`the tile filled while the bentuk dasar's recording plays shows its word ${filled.fg} on ${filled.bg}`);
    }
    await assertComposeLayout(page, vp);
    await assertComposeFits(page, `${vp}: word 1 base example`);
    await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-base.png` });
    console.log(`shot ${vp}-autoplay-ayah1-example-base`);
    if (vp === "phone") await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-base-viewport.png` });
    const change = page.locator('[data-autoplay="composition"][data-compose-stage="change"]');
    // Its caption's reading time (the lesson's rule), or the limit and the hold if it did not come.
    const onward = await follow(baseId, async () => (await change.count()) > 0, 20_000 + EXAMPLE_LOAD_LIMIT_MS + EXAMPLE_FAILED_HOLD_MS);
    if (!onward.ok) fail(`after the base example the composition did not go on to its change frame by itself (step "${await attr("data-step")}", mode ${await middle.getAttribute("data-mode")})`);
    if (!(await running())) fail("the lesson is paused after the base example");
    console.log(
      `  examples 1/3: ${baseId} on the base frame ${shownAfter} ms into the step, ${recordings.map((f) => recordingName(f, 3)).join(", ")} requested (${words.answered.get(words.seen[0]) ?? "no answer yet"}), ` +
        `caption “${said}”, states ${[...new Set([...base.seen, ...onward.seen])].join(" → ")}, then the change frame by itself`,
    );

    // 2. A recording that does not come: the status, then given up — the lesson goes on.
    if (vp === "phone") {
      const heldId = `w2:base:${allahu.frame}`;
      await page.route(isHeld, hold);
      try {
        await toStep(page, vp, "w2:compose");
        await replay.click();
        const wait2 = compose.words["1:1:2"].lines.filter((l) => l.frame <= allahu.frame).length * 12_000;
        if (!(await beatShows(heldId, wait2 + 20_000))) fail(`the example ${heldId} never showed in word 2's composition (step "${await attr("data-step")}")`);
        const t2 = Date.now();
        const status = page.locator('[data-autoplay="loading"][data-kind="recitation"]');
        await status.waitFor({ state: "visible", timeout: 3_000 }).catch(() => fail(`with the narrator's recordings held back, no loading status showed within 3 s of the beat`));
        const says = await text(status);
        if (says !== msgs.loading_recitation) fail(`the loading status says “${says}”, expected “${msgs.loading_recitation}”`);
        if (!heldBack.length) fail(`no recording of the narrator was requested at the beat (nothing was held back)`);
        await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-loading.png` });
        console.log(`shot ${vp}-autoplay-ayah1-example-loading`);
        const gone = await follow(heldId, async () => (await attr("data-example-state")) === "failed", EXAMPLE_LOAD_LIMIT_MS + 5_000);
        const gaveUpAfter = Date.now() - t2;
        if (!gone.ok) fail(`the example whose recording was held back was not given up within ${EXAMPLE_LOAD_LIMIT_MS + 5_000} ms (states: ${gone.seen.join(" → ")}; mode ${await middle.getAttribute("data-mode")})`);
        if (gaveUpAfter < EXAMPLE_LOAD_LIMIT_MS - 1_500) fail(`the example was given up after ${gaveUpAfter} ms, before the lesson's limit (${EXAMPLE_LOAD_LIMIT_MS} ms)`);
        const sorry = await text(page.locator('[data-autoplay="example-failed"]'));
        if (sorry !== msgs.example_failed) fail(`the given-up example says “${sorry}”, expected “${msgs.example_failed}”`);
        if ((await page.locator('[data-autoplay="panel"]').innerText()).includes(msgs.recite_failed)) fail("a given-up example shows the lesson's “Bacaan imam belum bisa diputar” (a dead stop)");
        await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-given-up.png` });
        console.log(`shot ${vp}-autoplay-ayah1-example-given-up`);
        const change2 = page.locator('[data-autoplay="composition"][data-compose-word="2"][data-compose-stage="change"]');
        if (!(await until(page, async () => (await change2.count()) > 0, EXAMPLE_FAILED_HOLD_MS + 8_000))) {
          fail(`after the given-up example the lesson did not go on by itself (step "${await attr("data-step")}", mode ${await middle.getAttribute("data-mode")})`);
        }
        if (!(await running())) fail("the lesson is paused after a given-up example");
        console.log(`  examples 2/3: the narrator's recording held back (${heldBack.length} request(s)) → “${says}”, given up after ${gaveUpAfter} ms (limit ${EXAMPLE_LOAD_LIMIT_MS} ms) with “${sorry}”, then the next frame by itself, never paused`);
      } finally {
        release();
        await page.unroute(isHeld, hold).catch(() => {});
      }
    }

    // 3. A concept's line, then its example by itself, then the next concept's line.
    const conceptStep = concept.step;
    const exampleId = `${conceptStep}:1`;
    await toStep(page, vp, conceptStep);
    const t3 = Date.now();
    await replay.click();
    if (!(await until(page, async () => (await attr("data-step")) === `${conceptStep}:ex`, lineMs(`al-fatihah:1:${conceptStep}`) + 20_000))) {
      fail(`after the line of ${concept.id} the lesson did not go on to its example by itself (step "${await attr("data-step")}", mode ${await middle.getAttribute("data-mode")})`);
    }
    const lineTook = Date.now() - t3;
    const card = page.locator(`[data-autoplay="example"][data-example="${exampleId}"]`);
    await card.waitFor({ state: "visible", timeout: 5_000 }).catch(() => fail(`on the example step of ${concept.id} no example card shows`));
    const cardText = await text(card);
    for (const part of [msgs.example_tag, word.ar, word.translit, word.gloss]) if (!cardText.includes(part)) fail(`the example card “${cardText}” does not show “${part}”`);
    const cap = await text(caption);
    for (const part of [msgs.example_tag, word.translit]) if (!cap.includes(part)) fail(`the example's caption “${cap}” does not say “${part}”`);
    const asked3 = async () => ["reciting", "failed"].includes((await attr("data-example-state")) ?? "") || (await attr("data-example")) !== exampleId;
    const first = await follow(exampleId, asked3, 5_000);
    if (!first.seen.some((s) => s === "reciting" || s === "failed")) fail(`the lesson never asked the imam for the concept's example (states: ${first.seen.join(" → ") || "none"})`);
    // This ayah's one recording (one imam, plan L21): what the stage's player plays.
    const [only, ...more] = ayah1.recitation;
    const mine = only && !more.length ? only.url : null;
    if (!mine || !watch.requested(mine)) fail(`the example is this ayah's word, and the ayah's recording (${mine ? recordingName(mine) : "—: content/al-fatihah.json does not give ayah 1 exactly one"}) was never requested`);
    // The word on the mushaf line is marked (its ring), the card clear of the panel, the caption on screen.
    const n = concept.n;
    const chip = (await stage.locator(`button[data-word="${n}"]`).first().getAttribute("class").catch(() => null)) ?? "";
    if (!chip.includes("ring-forest")) fail(`word ${n} on the mushaf line is not marked while it is the example (class “${chip}”)`);
    const box = async (sel) => {
      const b = await page.locator(sel).first().boundingBox();
      if (!b) fail(`${sel} is not rendered`);
      return { top: b.y, bottom: b.y + b.height };
    };
    const [cardBox, panelBox, capBox, controls] = [await box('[data-autoplay="example"]'), await box('[data-autoplay="panel"]'), await box('[data-autoplay="caption"]'), await box('[data-autoplay="panel"] [role="group"]')];
    if (cardBox.top < 0 || cardBox.bottom > panelBox.top + 1) fail(`the example card ${fmt(cardBox)} is off screen or under the panel ${fmt(panelBox)}`);
    if (capBox.top < 0 || capBox.bottom > controls.top + 1) fail(`the example's caption ${fmt(capBox)} is not above the controls ${fmt(controls)}`);
    await stage.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-concept.png` });
    console.log(`shot ${vp}-autoplay-ayah1-example-concept`);
    if (vp === "phone") await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-concept-viewport.png` });
    const nextStep = after.step;
    if (!(await until(page, async () => (await attr("data-step")) === nextStep, 15_000 + EXAMPLE_LOAD_LIMIT_MS + EXAMPLE_FAILED_HOLD_MS))) {
      fail(`after the example of ${concept.id} the lesson did not go on to ${nextStep} by itself (step "${await attr("data-step")}", mode ${await middle.getAttribute("data-mode")})`);
    }
    console.log(
      `  examples 3/3: ${conceptStep} (line ${lineTook} ms) → its example by itself: card “${cardText}”, caption “${cap}”, states ${first.seen.join(" → ")}; then ${nextStep} by itself. ` +
        `Reciters' host: ${[...new Set(watch.seen)].map((u) => `${recordingName(u)} ${watch.answered.get(u) ?? "…"}`).join(", ")}`,
    );
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-ayah1-example-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the lesson's example beats check (Al-Fatihah 1) failed`);
    console.error(`  requests to the reciters' host (${watch.seen.length}):\n    ${watch.list()}`);
    console.error(`  narration requests answered: ${served.length}`);
    throw err;
  } finally {
    release();
    watch.stop();
    words.stop();
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
 *   3. question 1 (it has three options: the reveal needs two wrong picks): a second wrong pick,
 *      then "Tunjukkan jawaban": shared:revealed ("Ini jawabannya.") and question 1's explanation
 *      line (al-fatihah:2:ex:label-role:1:why) — requested by its URL when the manifest has its
 *      audio, else shown as the caption (caption-only until it is rendered);
 *   4. question 2 (two options since the quiz follows the curriculum): the RIGHT pick:
 *      shared:correct ("Benar."), then question 2's explanation, the same way.
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

    // 3. Question 1, two wrong picks in all (one is made above), then Tunjukkan jawaban: "Ini
    //    jawabannya." and the explanation of question 1. (The reveal needs two wrong picks, so it
    //    is asked of the question with three options: since the quiz plan followed the
    //    curriculum, question 2 has two, one of them wrong: 2026-10-14.)
    if (q1.options.length < 3) throw new Error(`${vp}: label-role question 1 of Al-Fatihah 2 has ${q1.options.length} options; the reveal needs a question with three`);
    await option(q1.options[2].from).click();
    await page.waitForTimeout(400);
    const reveal = exercise.locator('[data-guide="exercise:label-role:reveal"]');
    await reveal.waitFor({ state: "visible", timeout: 5_000 });
    mark = served.length;
    await reveal.click();
    const afterRevealed = await said(shared["shared:revealed"], mark, "Ini jawabannya. (shared:revealed)");
    await said(lesson["al-fatihah:2:ex:label-role:1:why"], afterRevealed, "question 1's explanation, after Ini jawabannya.");

    // 4. Question 2 (the lesson moves on by itself): the right pick, Benar. and its explanation.
    await exercise.getByText(`Soal 2 dari ${role.questions.length}`).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(800);
    mark = served.length;
    await option(q2.options[0].from).click();
    const afterCorrect = await said(shared["shared:correct"], mark, "Benar. (shared:correct)");
    await said(lesson["al-fatihah:2:ex:label-role:2:why"], afterCorrect, "question 2's explanation, after Benar.");
    await page.locator('[data-autoplay="stage"]').screenshot({ path: `shots/${vp}-quiz-ayah2-role-right.png` });
    console.log(`shot ${vp}-quiz-ayah2-role-right`);
    console.log("  quiz: Tunjukkan jawaban → Ini jawabannya. + its explanation; right → Benar. + its explanation");
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
 * THE WARM-UP, "isim, fi'il, atau huruf?" (operator 2026-10-13: "i think it's better in every ayat
 * we identify first each words fall into which category: ismu, fi'il or harf. it's kind of
 * exercise, kind of warming up"; plan L31), on Al-Fatihah 2 — a word of one part, then a word of
 * two (a huruf jar and the Name), its remembered place cleared, the narration answered in the
 * browser. Everything expected is read from content/quiz/al-fatihah.json, never typed:
 *   1. it is the exercise the lesson reaches FIRST, by "Berikutnya ›" from the start, on the step
 *      "ex:word-kind", and no word has been explained yet (no step "w1" was passed);
 *   2. question 1 shows its word as ONE piece, the lesson's bytes, in the thick frame
 *      ([data-asked]), and three answers in the lessons' order, each with its Arabic term;
 *   3. a wrong pick shows no explanation; the right pick shows the question's sentence
 *      (content/quiz `why`), the one the narrator says;
 *   4. the lesson goes on to the next question BY ITSELF, and a word of two parts shows both
 *      pieces, the one asked in the frame, in the ayah's reading order;
 *   5. "Lewati latihan" leaves it for the first word.
 * Shot at question 1 (and the viewport on the phone). Fails the job otherwise.
 */
async function wordKindChecks(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const quiz = await read("content/quiz/al-fatihah.json");
  const warm = quiz.ayat.find((a) => a.ayah === 2).exercises.find((e) => e.key === "word-kind");
  if (!warm) throw new Error("content/quiz/al-fatihah.json: ayah 2 has no warm-up (word-kind)");
  const [q1] = warm.questions;
  const part = warm.questions.find((q) => q.of > 1);
  if (!part || q1.of !== 1) throw new Error("the warm-up of Al-Fatihah 2 no longer opens with a word of one part and has a word of two: pick another ayah for this check");
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const exercise = page.locator('[data-autoplay="exercise"] [data-exercise="word-kind"]');
  const next = page.locator('[data-autoplay="next"]');
  const option = (kind) => exercise.locator(`[data-option="${kind}"]`);
  /** The Latin start of a sentence, up to its first Arabic (what innerText surely holds). */
  const head = (text) => text.split(/\s*[(\u0600-\u06FF]/u)[0].slice(0, 40);
  const pieces = () =>
    exercise.locator("[data-kind-piece]").evaluateAll((els) => els.map((e) => ({ part: Number(e.getAttribute("data-kind-piece")), asked: e.getAttribute("data-asked") === "true", ar: e.textContent ?? "", x: e.getBoundingClientRect().left })));
  try {
    await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
    // The earlier checks left a remembered place on this ayah ("Lanjutkan dari langkah N").
    await page.evaluate((key) => localStorage.removeItem(key), "belajar:v1:autoplay:al-fatihah/2");
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);
    // 1. The first exercise the lesson reaches, before any word.
    const passed = [];
    for (let i = 0; i < 20 && !(await exercise.isVisible()); i++) {
      const at = await stage.getAttribute("data-step");
      if (at && passed.at(-1) !== at) passed.push(at);
      if (at?.startsWith("ex:") && at !== "ex:word-kind") break;
      await next.click();
      await page.waitForTimeout(250);
    }
    await exercise.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      throw new Error(`${vp}: the warm-up never came up from the start of Al-Fatihah 2 (passed: ${passed.join(" → ")})`);
    });
    if ((await stage.getAttribute("data-step")) !== "ex:word-kind") throw new Error(`${vp}: the warm-up is on the step "${await stage.getAttribute("data-step")}", not "ex:word-kind"`);
    if (passed.some((s) => /^w\d/.test(s))) throw new Error(`${vp}: the warm-up came after a word's step (passed: ${passed.join(" → ")}); it opens the lesson`);
    // 2. Question 1: one piece, the lesson's bytes, framed; three answers with their Arabic.
    const first = await pieces();
    if (JSON.stringify(first.map((p) => [p.part, p.asked, p.ar])) !== JSON.stringify([[1, true, q1.ar]])) {
      throw new Error(`${vp}: question 1 shows ${JSON.stringify(first)}, expected the one piece ${q1.ar} in the frame`);
    }
    const kinds = Object.keys(quiz.kinds);
    const shown = await exercise.locator("[data-option]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-option"), e.textContent ?? ""]));
    if (JSON.stringify(shown.map((o) => o[0])) !== JSON.stringify(kinds)) throw new Error(`${vp}: the warm-up offers ${JSON.stringify(shown.map((o) => o[0]))}, expected ${JSON.stringify(kinds)}`);
    for (const [kind, text] of shown) {
      const ar = /\(([^()]+)\)/.exec(quiz.kinds[kind])?.[1];
      if (!ar || !text.includes(ar)) throw new Error(`${vp}: the answer "${kind}" does not show its Arabic term (${quiz.kinds[kind]}): “${text}”`);
    }
    await stage.screenshot({ path: `shots/${vp}-warm-up.png` });
    console.log(`shot ${vp}-warm-up`);
    if (vp === "phone") await page.screenshot({ path: `shots/${vp}-warm-up-viewport.png` });
    // The exercise waits once its introduction and its options prompt are through (caption-only
    // until they are rendered: read at reading pace): answer then, as quizVoiceCheck does.
    const caption = page.locator('[data-autoplay="caption"]');
    for (let i = 0; i < 400 && (await caption.first().getAttribute("data-line").catch(() => null)) !== "shared:ex:word-kind:options"; i++) {
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(3_000);
    // 3. A wrong pick: no explanation. The right one: the question's sentence.
    const wrong = kinds.find((k) => k !== q1.kind);
    await option(wrong).click();
    await page.waitForTimeout(600);
    if ((await exercise.innerText()).includes(head(q1.why))) throw new Error(`${vp}: a wrong pick (${wrong}) already shows the explanation`);
    await option(q1.kind).click();
    if (!(await until(page, async () => (await exercise.innerText()).includes(head(q1.why)), 5_000))) {
      throw new Error(`${vp}: the right pick (${q1.kind}) does not show the question's sentence (“${head(q1.why)}…”)`);
    }
    // 4. On by itself, question by question, to the word of two parts (answered right each time).
    for (const q of warm.questions.slice(1)) {
      const here = exercise.locator(`[data-kind-word="${q.word}"][data-kind-part="${q.part}"]`);
      if (!(await here.waitFor({ state: "attached", timeout: 60_000 }).then(() => true, () => false))) {
        throw new Error(`${vp}: 60 s after the answer the warm-up had not gone on to question ${q.n} (word ${q.word}, part ${q.part}) by itself`);
      }
      if (q.n === part.n) {
        const both = await pieces();
        const want = warm.questions.filter((x) => x.word === q.word).map((x) => [x.part, x.part === q.part, x.ar]);
        if (JSON.stringify(both.map((p) => [p.part, p.asked, p.ar])) !== JSON.stringify(want)) throw new Error(`${vp}: question ${q.n} shows ${JSON.stringify(both)}, expected the pieces ${JSON.stringify(want)}`);
        // The ayah's reading order: the first part to the RIGHT of the second.
        if (!(both[0].x > both[1].x)) throw new Error(`${vp}: the parts of word ${q.word} are not drawn right to left (${both.map((p) => Math.round(p.x)).join(", ")})`);
        await stage.screenshot({ path: `shots/${vp}-warm-up-part.png` });
        console.log(`shot ${vp}-warm-up-part`);
        break;
      }
      await option(q.kind).click();
    }
    // 5. "Lewati latihan": on to the first word.
    await next.click();
    if (!(await until(page, async () => /^w1(?::|$)/.test((await stage.getAttribute("data-step")) ?? ""), 8_000))) {
      throw new Error(`${vp}: "Lewati latihan" on the warm-up led to "${await stage.getAttribute("data-step")}", not to the first word`);
    }
    console.log(`  warm-up: first exercise of Al-Fatihah 2 (${warm.questions.length} questions), before its first word; passed ${passed.join(" → ")}`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-warm-up-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the warm-up check on Al-Fatihah 2 failed`);
    console.error(`  narration requests answered (${served.length}):\n    ${served.join("\n    ") || "(none)"}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/**
 * The lesson map's cards (operator 2026-10-13: "at the beginning of the ayat, better to inform
 * what concept we will learn in this ayat, also explain maybe we skip some concept and will visit
 * later in next ayat … so at the beginning we inform what will be learnt, in the end recap what
 * we've learnt"; docs/belajar-plan.md L23 — and, with the basic curriculum, L26: "so the knowledge
 * is accummulating and repeated"; "but separate new vs already knows concept, this is what new,
 * this is what we've learnt so far"), on Al-Fatihah 1 and 2, each one's remembered place cleared,
 * the narration answered in the browser (narrationRoute). ONE GROUP AT A TIME, in step with the
 * narrator: each group of the opening is a step of the lesson with a line and a card of its own.
 * What a card must show is read from content/map/al-fatihah.json and messages/id.json, never typed
 * here. Per ayah:
 *   1. THE OPENING comes right after the imam's ayah: from the step "recite" (reached by name,
 *      paused), each "Berikutnya ›" lands on the next of "map:new", "map:learnt", "map:later" (a
 *      group with nothing in it has no step: src/lib/autoplay/lessonMap.ts mapOpening), and the
 *      one after them on a step that is no map step, the card gone. On each, ONE card
 *      ([data-autoplay="lesson-map"][data-map=<group>]) is on the stage with exactly that group:
 *        new     "Baru di ayat ini": the steps the ayah's lesson teaches, in the file's order,
 *                each under the name the file gives.
 *        learnt  "Sudah kita pelajari (N hal)", N the whole list so far: under "Kita temui lagi di
 *                ayat ini (n):" the ones that come up again — up to MAP_HERE_FULL one per row,
 *                each with a repeat mark, more as one flowing line of their Latin names, each
 *                carrying its own comma —, then "Tidak ada di ayat ini (n)" for the others.
 *        later   "Nanti": the steps a later lesson teaches, each with its ayah ("di ayat 3"; up to
 *                MAP_LATER_FULL one per row, more as one flowing line) — and "Tingkat lanjut (N
 *                hal)" with the line that says they are not taught at this level.
 *      "↺ Ulangi" plays the step: the caption is that step's line (data-line
 *      "al-fatihah:N:map:<group>") and says what the manifest shows for it.
 *   2. THE CLOSING comes right before the recap: on the step "learned" (by name) the card
 *      ([data-map="learned"]) has one group, "Baru saja kita pelajari", the ayah's new steps in
 *      order, each with a tick, and the running total ("Sudah N hal kita pelajari."); its caption
 *      is "al-fatihah:N:learned"; and one "Berikutnya ›" from there lands on "recap".
 *   3. NOTHING STICKS OUT SIDEWAYS, on any card: the card lies within the screen's width, does
 *      not scroll sideways, and the page does not either.
 *   4. A PHONE'S SMALL ROOM (CI 2026-10-13, base branch: at 390×844 the card has about 270px above
 *      the caption panel at the normal text size): below sm the names of the learnt steps that do
 *      NOT come up again and the names of the next-level topics take no box (display none — their
 *      counts stand for them), from sm up they are drawn; every other list is drawn on every
 *      screen. And on every screen: nothing on the card is a visually hidden 1px box with text in
 *      it (the line-break check measures such text, every word "into a 0px line"), and a count
 *      stands on its heading's row in one piece.
 * Whether the whole card is in view above the bottom panel is MEASURED and reported, not failed: a
 * warning on the run's summary gives the numbers — look at the viewport shots.
 * Works rendered or not: a map line without audio yet is shown at reading pace (caption-only).
 * Shots: each card (stage; on a phone also the viewport). Fails the job on 1–4.
 */
/** = src/lib/autoplay/lessonMap.ts MAP_HERE_FULL, MAP_LATER_FULL and MAP_ARABIC_GLOSS, the pattern
 *  of mapLatinName (lesson-map.test.ts checks they agree). */
const MAP_HERE_FULL = 3;
const MAP_LATER_FULL = 2;
const MAP_ARABIC_GLOSS = / \([^()]*[\u0600-\u06FF][^()]*\)/g;
async function lessonMapChecks(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const msgs = (await read("messages/id.json")).Guided;
  const map = await read("content/map/al-fatihah.json");
  const lines = (await read("content/narration/al-fatihah.json")).lines ?? {};
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const middle = page.locator('[data-autoplay="middle"]');
  const replay = page.locator('[data-autoplay="replay"]');
  const next = page.locator('[data-autoplay="next"]');
  const anyCard = stage.locator('[data-autoplay="lesson-map"]');
  const fail = (m) => {
    throw new Error(`${vp}: lesson map — ${m}`);
  };
  const fill = (message, values) => Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), message);
  /** A step's name as the captions show it (the file's), and as a flowing line lists it. */
  const nameOf = (id) => map.steps[id]?.name ?? fail(`content/map/al-fatihah.json lists the step "${id}" and does not name it`);
  const latin = (id) => nameOf(id).replace(MAP_ARABIC_GLOSS, "");
  /** Where a postponed step is taught, as the card says it ("di ayat 3"; with its surah when that
   *  is another one); nothing for a lesson that is no whole ayah. */
  const whereOf = (id) => {
    const m = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/.exec(map.steps[id]?.lesson ?? "");
    if (!m) return null;
    return Number(m[1]) === map.surah ? fill(msgs.map_later_ayah, { n: Number(m[2]) }) : fill(msgs.map_later_surah, { surah: Number(m[1]), ayah: Number(m[2]) });
  };
  const count = (n) => `(${fill(msgs.map_count, { n })})`;
  /** A name on a row of its own, and names as one flowing line (each but the last with its comma). */
  const row = (id, { here = null, where = null, mark = false } = {}) => ({ id, text: [nameOf(id), where].filter(Boolean).join(" "), here, where, mark });
  const flow = (ids, { here = null, where = () => null } = {}) =>
    ids.map((id, i) => ({ id, text: `${[latin(id), where(id)].filter(Boolean).join(" ")}${i < ids.length - 1 ? "," : ""}`, here, where: null, mark: false }));
  const none = () => [{ id: null, text: msgs.map_none, here: null, where: null, mark: false }];
  const group = (g) => ({ count: null, subs: [], lists: [], note: null, total: null, ...g });
  /** The opening groups an ayah's map has, in the order their steps are played (mapOpening). */
  const openingOf = (entry) => ["new", ...(entry.learnt.length ? ["learnt"] : []), ...(entry.later.length || entry.lanjut.length ? ["later"] : [])];
  /** What the card of `kind` ("new" | "learnt" | "later" | "learned") must show for `entry`, on a
   *  screen below sm (`narrow`) or not. */
  const expected = (entry, kind, narrow) => {
    if (kind === "new") {
      return [group({ group: "new", heading: msgs.map_new, lists: [{ kind: "rows", drawn: true, items: entry.new.length ? entry.new.map((id) => row(id)) : none() }] })];
    }
    if (kind === "learnt") {
      const here = entry.learnt.filter((x) => x.here).map((x) => x.id);
      const rest = entry.learnt.filter((x) => !x.here).map((x) => x.id);
      return [
        group({
          group: "learnt",
          heading: msgs.map_learnt,
          count: count(entry.learnt.length),
          subs: [{ sub: "here", text: here.length ? fill(msgs.map_here, { n: here.length }) : msgs.map_here_none }, ...(rest.length ? [{ sub: "rest", text: fill(msgs.map_rest, { n: rest.length }) }] : [])],
          lists: [
            ...(here.length
              ? [here.length <= MAP_HERE_FULL ? { kind: "rows", drawn: true, items: here.map((id) => row(id, { here: "true", mark: true })) } : { kind: "flow", drawn: true, items: flow(here, { here: "true" }) }]
              : []),
            ...(rest.length ? [{ kind: "flow", drawn: !narrow, items: flow(rest, { here: "false" }) }] : []),
          ],
        }),
      ];
    }
    if (kind === "later") {
      return [
        ...(entry.later.length
          ? [
              group({
                group: "later",
                heading: msgs.map_later,
                lists: [
                  entry.later.length <= MAP_LATER_FULL
                    ? { kind: "rows", drawn: true, items: entry.later.map((id) => row(id, { where: whereOf(id) })) }
                    : { kind: "flow", drawn: true, items: flow(entry.later, { where: whereOf }) },
                ],
              }),
            ]
          : []),
        ...(entry.lanjut.length
          ? [
              group({
                group: "lanjut",
                heading: msgs.map_lanjut,
                count: count(entry.lanjut.length),
                lists: [
                  {
                    kind: "names",
                    drawn: !narrow,
                    items: entry.lanjut.map((id) => ({
                      id,
                      text: map.lanjut[id]?.name ?? fail(`content/map/al-fatihah.json lists the next-level topic "${id}" and does not name it`),
                      here: null,
                      where: null,
                      mark: false,
                    })),
                  },
                ],
                note: msgs.map_lanjut_note,
              }),
            ]
          : []),
      ];
    }
    return [
      group({
        group: "learned",
        heading: msgs.map_learned,
        lists: [{ kind: "rows", drawn: true, items: entry.new.length ? entry.new.map((id) => row(id, { mark: true })) : none() }],
        total: fill(msgs.map_total, { n: entry.learnt.length + entry.new.length }),
      }),
    ];
  };
  /** The card on the stage as the browser drew it: its groups (each list with whether it takes a
   *  box), its own box, whether anything scrolls sideways, any 1px box with text, each count
   *  against its heading. */
  const readCard = (kind) =>
    stage.locator(`[data-autoplay="lesson-map"][data-map="${kind}"]`).first().evaluate((el) => {
      const text = (n) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
      const one = (g, sel) => (g.querySelector(sel) ? text(g.querySelector(sel)) : null);
      const r = el.getBoundingClientRect();
      return {
        groups: [...el.querySelectorAll("[data-map-group]")].map((g) => ({
          count: one(g, "[data-map-count]"),
          subs: [...g.querySelectorAll("[data-map-sub]")].map((p) => ({ sub: p.getAttribute("data-map-sub"), text: text(p) })),
          lists: [...g.querySelectorAll("ul")].map((ul) => {
            const b = ul.getBoundingClientRect();
            return {
              kind: ul.hasAttribute("data-map-flow") ? "flow" : ul.hasAttribute("data-map-names") ? "names" : "rows",
              drawn: b.width > 1 && b.height > 1,
              items: [...ul.children].map((li) => ({
                id: li.getAttribute("data-map-item"),
                text: text(li),
                here: li.getAttribute("data-map-here"),
                where: one(li, "[data-map-where]"),
                mark: !!li.querySelector("svg"),
              })),
            };
          }),
          note: one(g, "[data-map-note]"),
          total: one(g, "[data-map-total]"),
          group: g.getAttribute("data-map-group"),
          heading: text(g.querySelector("h3")),
        })),
        // A box of a pixel or two with text in it: hidden from the eye, still measured.
        hiddenText: [...el.querySelectorAll("*")]
          .filter((n) => {
            const b = n.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && b.width <= 2 && b.height <= 2 && text(n) !== "";
          })
          .map((n) => text(n).slice(0, 40)),
        counts: [...el.querySelectorAll("[data-map-count]")].map((c) => {
          const [h, b] = [c.parentElement?.querySelector("h3")?.getBoundingClientRect(), c.getBoundingClientRect()];
          return { text: text(c), onHeadingRow: !!h && b.top < h.bottom && b.bottom > h.top, pieces: c.getClientRects().length };
        }),
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        scrollsSideways: el.scrollWidth > el.clientWidth + 1,
        pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
        width: window.innerWidth,
      };
    });
  /** The same keys in the same order as `group` above gives them, so two cards compare as text. */
  const shape = (groups) => JSON.stringify(groups.map((g) => ({ group: g.group, heading: g.heading, count: g.count, subs: g.subs, lists: g.lists, note: g.note, total: g.total })));
  /** One card, checked and shot: `kind` "new" | "learnt" | "later" on its step "map:<kind>", or
   *  "learned" on the step of that name. */
  const check = async (ayah, entry, kind) => {
    const step = kind === "learned" ? kind : `map:${kind}`;
    const what = `Al-Fatihah ${ayah}, ${kind === "learned" ? "the closing" : `the opening's “${kind}”`}`;
    const card = stage.locator(`[data-autoplay="lesson-map"][data-map="${kind}"]`);
    await card.first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => fail(`${what}: on the step "${step}" no card shows`));
    if ((await anyCard.count()) !== 1) fail(`${what}: ${await anyCard.count()} lesson-map cards on the stage (one group at a time: one card)`);
    // The step's line, played from its start: the caption is that line, and says what the manifest shows.
    const id = `al-fatihah:${ayah}:${step}`;
    const line = lines[id];
    if (!line?.display) fail(`${what}: content/narration/al-fatihah.json has no line ${id}`);
    await replay.click();
    const caption = page.locator(`[data-autoplay="caption"][data-line="${id}"]`);
    await caption.first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => fail(`${what}: "↺ Ulangi" did not put the line ${id} on the caption`));
    const head = line.display.split(/\s*[(\u0600-\u06FF]/u)[0].slice(0, 40);
    if (!(await until(page, async () => (await caption.first().innerText()).replace(/\s+/g, " ").includes(head), 10_000))) {
      fail(`${what}: the caption “${(await caption.first().innerText()).replace(/\s+/g, " ").slice(0, 80)}” does not say “${head}”`);
    }
    // Held there while it is measured (a step that ends would take its card with it).
    if ((await middle.getAttribute("data-mode").catch(() => null)) === "pause") await middle.click();
    await page.waitForTimeout(500);
    if ((await stage.getAttribute("data-step")) !== step) fail(`${what}: the lesson left the step "${step}" for "${await stage.getAttribute("data-step")}" while it was measured`);
    const got = await readCard(kind);
    const narrow = got.width < 640;
    const want = expected(entry, kind, narrow);
    if (shape(got.groups) !== shape(want)) {
      fail(`${what}: at ${got.width}px the card shows ${shape(got.groups)}, expected ${shape(want)} (content/map/al-fatihah.json, messages/id.json)`);
    }
    // 4. Nothing hidden in a 1px box; a count in one piece on its heading's row.
    if (got.hiddenText.length) fail(`${what}: text in a visually hidden box (it must take no box at all): ${got.hiddenText.map((t) => `“${t}”`).join(", ")}`);
    const loose = got.counts.filter((c) => !c.onHeadingRow || c.pieces !== 1);
    if (loose.length) fail(`${what}: at ${got.width}px a count is not in one piece beside its heading: ${loose.map((c) => `“${c.text}” (${c.onHeadingRow ? "on" : "off"} the heading's row, ${c.pieces} piece(s))`).join(", ")}`);
    // 3. Nothing sticks out sideways.
    const sideways = [];
    if (got.box.left < -1 || got.box.right > got.width + 1) sideways.push(`the card ${Math.round(got.box.left)}–${Math.round(got.box.right)} is wider than the screen (${got.width})`);
    if (got.scrollsSideways) sideways.push("the card scrolls sideways");
    if (got.pageScrollsSideways) sideways.push("the page scrolls sideways");
    if (sideways.length) fail(`${what}: ${sideways.join("; ")}`);
    const panel = await page.locator('[data-autoplay="panel"]').first().boundingBox();
    const panelBox = panel ? { top: panel.y, bottom: panel.y + panel.height } : null;
    const inView = !!panelBox && got.box.top >= 0 && got.box.bottom <= panelBox.top + 1;
    const drawn = got.groups.flatMap((g) => g.lists.filter((l) => l.drawn));
    const n = drawn.reduce((sum, l) => sum + l.items.length, 0);
    const shot = `${vp}-autoplay-ayah${ayah}-${step.replace(":", "-")}`;
    console.log(
      `  lesson map ${ayah} ${step}: ${got.groups.map((g) => `${g.heading}${g.count ? ` ${g.count}` : ""} [${g.lists.map((l) => `${l.items.length} ${l.kind}${l.drawn ? "" : ", no box"}`).join("; ")}]`).join(" · ")}; ` +
        `card ${fmt(got.box)} (${Math.round(got.box.bottom - got.box.top)}px) · panel ${panelBox ? fmt(panelBox) : "—"}${inView ? "" : " — NOT wholly in view"}`,
    );
    if (!inView) {
      console.log(
        `::warning title=Belajar lesson map card not wholly in view::${vp}: ${what}: the card (${n} names drawn, ${Math.round(got.box.bottom - got.box.top)}px high) is at ${fmt(got.box)} and the bottom panel at ${panelBox ? fmt(panelBox) : "—"} ` +
          `(viewport ${page.viewportSize().height} high): part of it is reached only by scrolling. See shots/${shot}${vp === "phone" ? "-viewport" : ""}.png`,
      );
    }
    await stage.screenshot({ path: `shots/${shot}.png` });
    console.log(`shot ${shot}`);
    if (vp === "phone") await page.screenshot({ path: `shots/${shot}-viewport.png` });
  };
  try {
    for (const ayah of [1, 2]) {
      const entry = map.ayat.find((a) => a.ayah === ayah);
      if (!entry) fail(`content/map/al-fatihah.json has no ayah ${ayah}`);
      await page.goto(BASE + `/belajar/id/quran/al-fatihah/${ayah}`, { waitUntil: "networkidle" });
      // The earlier checks left a remembered place on these ayat ("Lanjutkan dari langkah N").
      await page.evaluate((key) => localStorage.removeItem(key), `belajar:v1:autoplay:al-fatihah/${ayah}`);
      await page.reload({ waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('[data-autoplay="start"]').click();
      await settleScroll(page);
      // 1. Right after the imam's ayah: one step, one card, per group.
      await toStep(page, vp, "recite");
      let before = "recite";
      for (const g of openingOf(entry)) {
        await next.click();
        if (!(await until(page, async () => (await stage.getAttribute("data-step")) === `map:${g}`, 5_000))) {
          fail(`Al-Fatihah ${ayah}: the step after "${before}" is "${await stage.getAttribute("data-step")}", not the lesson map's "map:${g}"`);
        }
        await check(ayah, entry, g);
        before = `map:${g}`;
      }
      await next.click();
      if (!(await until(page, async () => ((await stage.getAttribute("data-step")) ?? before) !== before, 5_000))) fail(`Al-Fatihah ${ayah}: "Berikutnya ›" did not leave the step "${before}"`);
      const onward = await stage.getAttribute("data-step");
      if (onward?.startsWith("map:") || onward === "learned" || (await anyCard.count())) {
        fail(`Al-Fatihah ${ayah}: after the opening's last group ("${before}") the lesson is on "${onward}" with ${await anyCard.count()} lesson-map card(s) on the stage, not on with the ayah`);
      }
      // 2. Right before the recap.
      await toStep(page, vp, "learned");
      await check(ayah, entry, "learned");
      await next.click();
      if (!(await until(page, async () => (await stage.getAttribute("data-step")) === "recap", 5_000))) {
        fail(`Al-Fatihah ${ayah}: the step after "learned" is "${await stage.getAttribute("data-step")}", not the recap`);
      }
    }
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-autoplay-lesson-map-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the lesson map check (Al-Fatihah 1 and 2) failed`);
    console.error(`  narration requests answered: ${served.length}`);
    throw err;
  } finally {
    await page.unroute(isNarration, handler);
  }
  await page.goto("about:blank");
}

/**
 * LESSON ZERO in a browser — "Pengantar: harakat dan tiga jenis kata" (the basic curriculum,
 * kurikulum-dasar.md decision 1, operator-approved 2026-10-13: "A 'lesson zero' with no ayah opens
 * the course. It teaches harakat and the three kinds of word (kalimah: isim, fi'il, huruf), so
 * ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into lesson zero."). Its
 * narration is answered in the browser (narrationRoute); what it must play is read from the
 * content (content/curriculum.json lesson "0", content/narration/al-fatihah.json), never typed.
 *   1. IT IS LISTED FIRST: on the track page and on the Al-Fatihah page the first link into a
 *      lesson is its card ([data-intro-card] → INTRO), before any ayah's; Al-Fatihah 1 carries the
 *      one quiet line for someone who lands there first ([data-intro-hint], a link to INTRO), and
 *      ayah 2 does not.
 *   2. THE SAME STAGE, WITH NO AYAH ON IT: one "Mulai pelajaran", and no word of a mushaf line
 *      (no button[data-word]) before the start or while it plays.
 *   3. ITS STEPS, by name (toStep): "intro" first; "primer" with the harakat primer's figure
 *      (data-compose-kind "primer") in the card slot; then, for each step the curriculum teaches
 *      there with a line, "concept:<id>" (its caption is the line "al-fatihah:0:concept:<id>") and
 *      "concept:<id>:ex" with an example card; then "next". Al-Fatihah 1's lesson has no primer
 *      step any more (checked on its page by composeShots, which reaches word 1 without one).
 *   4. THE HAND-OVER: from "next", one "Berikutnya ›" ends the lesson and the page goes on to
 *      Al-Fatihah 1 by itself — its address, and its stage live — as an ayah goes on to the next.
 * Shots: the page before "Mulai" (stage; on a phone also the viewport), the primer, the concept
 * line, its example. Works rendered or not (a line without audio is caption-only). Fails the job
 * on 1–4.
 */
async function introChecks(page, vp, index) {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const curriculum = await read("content/curriculum.json");
  const lines = (await read("content/narration/al-fatihah.json")).lines ?? {};
  const zero = curriculum.lessons.find((l) => l.id === "0");
  const taught = (zero?.lines ?? []).map((l) => l.line);
  const fail = (m) => {
    throw new Error(`${vp}: lesson zero — ${m}`);
  };
  if (!taught.length) fail('content/curriculum.json gives lesson "0" no “Konsep baru” line (it has no page)');
  for (const part of ["intro", "primer:1", ...taught, "next"]) {
    if (!lines[`al-fatihah:${ZERO_AYAH}:${part}`]) fail(`content/narration/al-fatihah.json has no line al-fatihah:${ZERO_AYAH}:${part}`);
  }
  const served = [];
  const handler = narrationRoute(index, served);
  await page.route(isNarration, handler);
  const stage = page.locator('[data-autoplay="stage"]');
  const next = page.locator('[data-autoplay="next"]');
  const replay = page.locator('[data-autoplay="replay"]');
  const step = () => stage.getAttribute("data-step");
  /** The first link into a lesson (lesson zero or an ayah) inside <main>, as a path. */
  const firstLessonLink = () =>
    page.locator("main a[href]").evaluateAll((as) => {
      const paths = as.map((a) => new URL(a.getAttribute("href"), location.href).pathname);
      return paths.find((p) => /\/quran\/(?:pengantar|[a-z-]+\/\d+)$/.test(p)) ?? null;
    });
  const shot = async (name) => {
    await stage.screenshot({ path: `shots/${vp}-${name}.png` });
    console.log(`shot ${vp}-${name}`);
  };
  try {
    // 1. Listed first, and pointed at from the first ayah.
    for (const from of ["/belajar/id/quran", "/belajar/id/quran/al-fatihah"]) {
      await page.goto(BASE + from, { waitUntil: "networkidle" });
      const card = page.locator("main a[data-intro-card]");
      if ((await card.count()) !== 1) fail(`${from}: ${await card.count()} lesson-zero card(s), expected one`);
      const href = new URL(await card.first().getAttribute("href"), BASE).pathname;
      if (href !== INTRO) fail(`${from}: the card links ${href}, not ${INTRO}`);
      const first = await firstLessonLink();
      if (first !== INTRO) fail(`${from}: the first lesson link is ${first}, not lesson zero's (${INTRO})`);
    }
    await page.goto(BASE + AYAH_1, { waitUntil: "networkidle" });
    const hint = page.locator("main [data-intro-hint] a");
    if ((await hint.count()) !== 1 || new URL(await hint.first().getAttribute("href"), BASE).pathname !== INTRO) {
      fail(`${AYAH_1}: no quiet line that links lesson zero ([data-intro-hint] a → ${INTRO})`);
    }
    await page.goto(BASE + AYAH_2, { waitUntil: "networkidle" });
    if ((await page.locator("[data-intro-hint]").count()) !== 0) fail(`${AYAH_2}: the line for a first-time visitor shows on another ayah than the first`);

    // 2. The same stage, no ayah on it.
    await page.goto(BASE + INTRO, { waitUntil: "networkidle" });
    await page.evaluate((key) => localStorage.removeItem(key), `belajar:v1:autoplay:al-fatihah/${ZERO_AYAH}`);
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    if ((await stage.count()) !== 1) fail(`${INTRO}: no lesson stage`);
    if ((await stage.locator("button[data-word]").count()) !== 0) fail("its stage shows words of a mushaf line: lesson zero has no ayah");
    await shot("pengantar-before-start");
    if (vp === "phone") await page.screenshot({ path: `shots/${vp}-pengantar-before-start-viewport.png` });
    await page.locator('[data-autoplay="start"]').click();
    await settleScroll(page);

    // 3. Its steps, by name.
    if (!(await until(page, async () => (await step()) === "intro", 10_000))) fail(`after "Mulai" the lesson is on "${await step()}", not on its opening line ("intro")`);
    await toStep(page, vp, "primer");
    await replay.click();
    const figure = page.locator('[data-autoplay="composition"][data-compose-kind="primer"]');
    await figure.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => fail('on the step "primer" the harakat primer\'s figure does not show'));
    if ((await stage.locator("button[data-word]").count()) !== 0) fail("a mushaf word shows while the primer plays");
    await shot("pengantar-primer");
    for (const part of taught) {
      await toStep(page, vp, part);
      await replay.click();
      const caption = page.locator(`[data-autoplay="caption"][data-line="al-fatihah:${ZERO_AYAH}:${part}"]`);
      await caption.first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => fail(`on the step "${part}" the caption is not its line al-fatihah:${ZERO_AYAH}:${part}`));
      await shot(`pengantar-${part.replace(":", "-")}`);
      await toStep(page, vp, `${part}:ex`);
      // Reached paused: "↺ Ulangi" plays the step from its start, and its card shows.
      await replay.click();
      const example = page.locator('[data-autoplay="example"]');
      await example.first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => fail(`on the step "${part}:ex" no example card shows`));
      await shot(`pengantar-${part.replace(":", "-")}-example`);
    }
    await toStep(page, vp, "next");

    // 4. On to Al-Fatihah 1 by itself.
    await next.click();
    await page.waitForURL(/\/quran\/al-fatihah\/1(\?.*)?$/, { timeout: 20_000 }).catch(() => fail(`from its last step the lesson did not go on to ${AYAH_1} (still at ${page.url()})`));
    await page.locator('[data-autoplay="panel"]').first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => fail(`${AYAH_1} opened, and its lesson did not start by itself`));
    const there = await step();
    if (!there) fail(`${AYAH_1} opened after lesson zero, and its stage is not live`);
    if (there === "primer") fail("Al-Fatihah 1 still plays the harakat primer");
    console.log(`  lesson zero ok: listed first on the track and the surah page; intro → primer → ${taught.join(" → ")} (each with its example) → next → Al-Fatihah 1 by itself (on "${there}")`);
  } catch (err) {
    await page.screenshot({ path: `shots/${vp}-pengantar-FAILED.png`, fullPage: true }).catch(() => {});
    console.error(`✗ ${vp}: the lesson zero check failed (on step "${await step().catch(() => null)}")`);
    console.error(`  narration requests answered: ${served.length}`);
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
      await curriculumCheck(page, vp, true);
      await rumusCheck(page, vp, true);
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
    await clipChecks(page, vp, narration);
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
    await everyMeaningCheck(page, vp, narration);
    if (vp === "phone") await loadingChecks(page, vp, narration);
    if (vp === "phone") await warmupChecks(page, vp, narration);
    if (vp === "phone") await aheadChecks(page, vp, narration);
    await composeShots(page, vp, narration);
    await exampleChecks(page, vp, narration);
    await quizVoiceCheck(page, vp, narration);
    await wordKindChecks(page, vp, narration);
    await lessonMapChecks(page, vp, narration);
    await introChecks(page, vp, narration);
    // Every composition frame fits at every text size (largest: all seven ayat; the others: ayah 1).
    // Lesson zero (ayah 0: the harakat primer) with ayah 1 at every size; all of them at the largest.
    await composeFitSweep(page, vp, "normal", [ZERO_AYAH, 1], units);
    await composeFitSweep(page, vp, "besar", [ZERO_AYAH, 1], units);
    await composeFitSweep(page, vp, "sangat-besar", [ZERO_AYAH, 1, 2, 3, 4, 5, 6, 7], units);
    await comingSoonCheck(page, vp);
    await curriculumCheck(page, vp, false);
    await rumusCheck(page, vp, false);
    await endCardShots(page, vp, false);
    await ctx.close();
  }
} finally {
  await browser.close();
}
