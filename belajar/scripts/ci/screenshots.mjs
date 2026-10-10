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

/**
 * Al-Fatihah ayah 1, the narrated ayah, after the one "Mulai" click: the stage mid-explanation of
 * word 1 — the KARAOKE caption (the narrator's current word filled forest, words said in ink,
 * words to come muted; a dictionary term shown "kasrah (كَسْرَة)") under the large WORD CARD
 * (the word's Arabic · transliteration · "yang artinya …"), the mushaf words numbered with word 1
 * marked. "Berikutnya ›" jumps whole steps (intro → the ayah → the harakat primer → the imam says
 * word 1 → its explanation), then "↺ Ulangi langkah ini" plays the explanation from its start —
 * the replay control, and a start that holds even when the imam's stream paused the lesson on the
 * way. Needs al-fatihah:1:w1 rendered (its audio in content/narration/al-fatihah.json): the word
 * line became "gloss + lead" with the composition (2026-10-10), so a rebuilt manifest without a
 * new render has no karaoke there and this check says so.
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
    for (let i = 0; i < 4; i++) {
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
    if (![...index.keys()].length) console.error("  (no narration audio in the manifests at all)");
    console.error("  al-fatihah:1:w1 must have audio + tokens in content/narration/al-fatihah.json (render it after a text change)");
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
    const next = page.locator('[data-autoplay="next"]');
    const replay = page.locator('[data-autoplay="replay"]');
    // intro → the ayah → the harakat primer (Biasa: "Berikutnya ›" jumps whole steps)
    for (let i = 0; i < 2; i++) {
      await next.click();
      await page.waitForTimeout(250);
    }
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
    for (let i = 0; i < 3; i++) {
      await next.click();
      await page.waitForTimeout(250);
    }
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

await mkdir("shots", { recursive: true });
const DEFAULT_RUN = !WARIS_ONLY && !SURAHS_ON;
const narration = DEFAULT_RUN ? await narrationIndex() : new Map();
const units = DEFAULT_RUN ? await composedUnits() : new Map();
if (DEFAULT_RUN) console.log(`narration index: ${narration.size} file(s) named by the manifests in ${BELAJAR_DIR}`);
const browser = await chromium.launch();
try {
  for (const [vp, viewport, scale] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "id-ID" });
    const page = await ctx.newPage();
    for (const [name, path] of WARIS_ONLY ? WARIS_PAGES : SURAHS_ON ? SURAH_PAGES : PAGES) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `shots/${vp}-${name}.png`, fullPage: true });
      console.log(`shot ${vp}-${name} (${path})`);
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
    await materialsShot(page, vp);
    await autoplayShots(page, vp);
    await karaokeShots(page, vp, narration);
    await composeShots(page, vp, narration);
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
