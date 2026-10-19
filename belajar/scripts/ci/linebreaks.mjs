// CI-only: where Chromium REALLY breaks the lines of the real image (operator, 2026-10-10: "make
// sure the line break is clean and easy to read, sometime i see wrong line break especially for
// arabic words"). Started by the workflow against a container on :3300, like screenshots.mjs.
//
// Every page a learner reaches by its links — the hub, the track, the curriculum page the track
// links (plan L30: every unit, lesson and step name of the basic curriculum, the next level's
// list), the cheat sheet it links too (plan L32: "Rumus singkat", each formula with its Arabic
// terms, its example word and the kitab's own quoted sentences in right-to-left blocks), each
// surah and ayah it links
// (every ayah closed, then with every disclosure open), the Konsep index and every concept, every
// Kosakata entry linked from those, the fact cards' ayah dialog (the longest ayah a card locates,
// one with footnotes, the first chip) — and the autoplay lesson stage step by step (Al-Fatihah 1 with
// its narration, so the KARAOKE caption; Al-Fatihah 2 and 7 caption-only), each kind of exercise
// answered once (a wrong pick, then the answer or "Tunjukkan jawaban") so its feedback is laid out
// too, on a phone (390) and a desktop (1280), each at the three text sizes (Normal, Besar, Sangat
// besar). In the page it takes the box of every character (Range.getClientRects), groups them into
// the lines the browser drew, and reports each bad seam (the "offenders", kinds below), printed
// one per line and written to shots/linebreaks.json (uploaded with the screenshots). Any offender
// fails the step.
//
//   term-split           "huruf jar ⏎ (حَرْف جَرّ)" — a term and its Arabic on two lines; also an
//                        Arabic word and the gloss after it, "«مَلِكِ» ⏎ (raja)", and, inside the
//                        text's own bracket, an item and the Arabic right after it, "(mudhaf
//                        ilaih ⏎ مُضَاف إِلَيْه)"
//   arabic-phrase-split  an inline Arabic phrase cut across lines (read in the wrong order there)
//   arabic-word-split    an Arabic word cut inside   ·   word-split: the same for a Latin word
//   hyphen-split         "Al- ⏎ Fatihah"   ·   footnote-orphan: a line starting with "[1]"
//   line-start-punct     a line starting with , . ; : ! ? ) ] » ” · • — – … or a spaced "-"
//   line-end-opener      a line ending with ( [ « “
//   arabic-not-isolated  Arabic in Latin text without lang="ar", RTL and a bidi isolate
//   arabic-box-ltr       an Arabic box that wraps (a part or quotation wider than its line) with
//                        its lines not right-aligned: not laid out right to left
//   unit-broken          a MixedText unit / kept word on two lines although it fits on one
//   unit-boxed           a kept box wider than its line still a box as wide as the line, so the
//                        words before and after it sit on lines of their own (the in-flow
//                        fallback, src/lib/lineFit.ts, did not take it)
//   overflow             text sticking out of its line or its box (a word wider than its column)
//   ayah-marker-alone    ﴿n﴾ on a row of its own   ·   karaoke-word-broken: a spoken word cut
//   karaoke-fill-wide    a karaoke word's fill wider than the words it covers
//   page-overflow        the page scrolls sideways   ·   nothing-measured: a check that saw nothing
//   page-error / check-error   a page that did not load; a bug in this check (never swallowed)
//
// The same walk also checks that MARKS NEVER RUN INTO THEIR NEIGHBOURS (operator 2026-10-17: "fix
// some layout to avoid overlapping between words like this (isim overlap with harakat)"), with
// inkMeasure (linebreaks-measure.mjs), at every measure — every text size, phone and desktop,
// every page and lesson step above, and in a composition step every frame of the word at once (all
// are laid out in its figure):
//
//   ink-overlap   a box of Arabic whose glyphs' ink (baseline ± the run's own ink ascent/descent,
//                 measured on a canvas in its computed font) enters the text box of a label, a
//                 transliteration, a badge or a word above or below it
//   ink-border    … or crosses the border of its chip, tile or card
//   quote-order   “…” around Latin drawn closing-quote first ("”rabbu · “Tuhan"): no LTR isolate
//
// and that it measured something: on each lesson, at each size, every composition the content
// gives that lesson (content/compose: the primer in Pengantar, every composed word of Al-Fatihah
// 1, 2 — رَبُّ is its word 3 — and 7) had its tiles ink-checked. A self-test first calibrates the
// canvas on the page's own Amiri against its known ink (رَبُّ 1.287em above the baseline,
// ٱلرَّحِيمِ 0.759em below, ب 0.386em: measured with HarfBuzz, 2026-10-17) — measureText's
// actualBoundingBox, or else the rows the run inks when drawn — checks the baseline it derives
// against a probe on the baseline, and lays out one bad case of each kind (they must be caught) and
// the markup as it ships (ar-clear, dir="ltr": it must not be).
//
// The rules themselves live in linebreaks-measure.mjs (run in the page; unit-tested under vitest
// against a scripted layout, linebreaks-measure.test.mjs). A break inside a kept box is allowed
// only when the box is wider than its whole line (the fallback: then it breaks between its
// pieces). The text rules do not depend on MixedText's markup, so text that never went through it
// (a new component, a merged branch) is checked too: every [lang="ar"] run and every marked box
// on the pages it visits.
//
// `--surahs`: the same check on the container started with every surah listed (BELAJAR_SURAHS,
// src/lib/features.ts), where the track links the Mu'awwidzat too: the production-like run reaches
// Al-Fatihah only (operator, 2026-10-10: the others "segera hadir", not linked). Its results go to
// shots/linebreaks-semua-surah.json and lb-semua-surah-*.png, beside the production-like run's.
// It also walks the lesson stage of every ayah of Al-Ikhlas (2026-10-19: brought to Al-Fatihah's
// standard, still hidden on the live site), step by step like Al-Fatihah's, every composition of
// its fifteen words ink-checked at every size.
//
// Before the real run, a self-test lays out linebreaks-fixture.html in a real page: one known-bad
// case of every kind must be caught, the markup as it ships must not be, and a unit wider than its
// line must break in the paragraph's flow, the words around it sharing its lines. The cases sit in
// a box that clips sideways, so a bad case sticking out on purpose never makes the page scroll
// sideways for the others; page-overflow is laid out on its own, outside it, last.
//
// Every page call is page.evaluate / locator.evaluateAll with a FUNCTION (CDP callFunctionOn):
// never page.waitForFunction, whose predicate Playwright runs through eval, which the module's CSP
// (no 'unsafe-eval') refuses. Waits are locator waits, fixed timeouts, or animation frames awaited
// inside page.evaluate.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

// The in-page measurement (tested in linebreaks-measure.test.mjs), the self-test fixture and the
// routed narration audio shared with screenshots.mjs; the workflow copies them next to this script.
import { loadFixture } from "./linebreaks-fixture.mjs";
import { INK_KINDS, inkMeasure, KINDS, measure } from "./linebreaks-measure.mjs";
import { BELAJAR_DIR, isNarration, narrationIndex, narrationRoute } from "./narration-route.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const SURAHS_ON = process.argv.includes("--surahs");
const TAG = SURAHS_ON ? "-semua-surah" : "";
const REPORT = `shots/linebreaks${TAG}.json`;
const SIZES = ["normal", "besar", "sangat-besar"];
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 900 }],
];
/** The lesson stage, step by step: [ayah path, narrated (karaoke via the routed narration)?]. */
// LESSON ZERO ("Pengantar": the curriculum's lesson with no ayah, 2026-10-13; src/lib/routes.ts
// introHref). A page of its own under the track: no surah, although its path has a surah's shape.
const INTRO_PATH = "/belajar/id/quran/pengantar";
const LESSONS = [
  [INTRO_PATH, false],
  ["/belajar/id/quran/al-fatihah/1", true],
  ["/belajar/id/quran/al-fatihah/2", false],
  ["/belajar/id/quran/al-fatihah/7", false],
  // `--surahs` only (2026-10-19): every ayah of Al-Ikhlas, brought to Al-Fatihah's standard and
  // hidden on the live site; caption-only (its narration is not rendered yet). Its ayat 1 and 2
  // introduce no concept (the curriculum teaches Al-Ikhlas after An-Nas and Al-Falaq), so they
  // show no example card: the third field says a lesson need not.
  ...(SURAHS_ON
    ? [
        ["/belajar/id/quran/al-ikhlas/1", false, false],
        ["/belajar/id/quran/al-ikhlas/2", false, false],
        ["/belajar/id/quran/al-ikhlas/3", false],
        ["/belajar/id/quran/al-ikhlas/4", false],
      ]
    : []),
];
/** The surahs whose compositions the ink check must have measured on the lessons above. */
const COMPOSED_SURAHS = SURAHS_ON ? ["al-fatihah", "al-ikhlas"] : ["al-fatihah"];
const MAX_PRINTED = 600;
/** Pages also shot at each size: the surah page (its "Tahukah Anda?" facts hold the longest
 *  inline Arabic), an ayah page with every disclosure open (word cards, Rujukan) and the
 *  curriculum page (a long list of step names with their Arabic: how it reads on a phone at the
 *  largest size is looked at by eye, too). */
const SHOTS = { "surah al-fatihah": "surah", "ayah al-fatihah/2 (open)": "ayah-2-open", kurikulum: "kurikulum", rumus: "rumus" };
/** The curriculum page (src/lib/routes.ts curriculumHref): a page of the track beside the surahs'
 *  own segment, so its address has the shape of a surah's and is told apart by name. */
const CURRICULUM = "/belajar/id/quran/kurikulum";
/** The cheat sheet (src/lib/routes.ts rumusHref, plan L32): the same shape of address, the same
 *  rule — measured as a page of its own, never taken for a surah. The shot at the largest size is
 *  the one the operator's phone question is about (a long list of formulas and Arabic quotes). */
const RUMUS = "/belajar/id/quran/rumus";
const SURAH_PATH = /^\/belajar\/id\/quran\/[^/]+$/;
const AYAH_PATH = /^\/belajar\/id\/quran\/[^/]+\/\d+$/;

// ───────────────────────────── Node side ─────────────────────────────

const all = [];
const tally = { measures: 0, containers: 0, lines: 0, units: 0, glued: 0, flowed: 0, arabic: 0, karaoke: 0, markers: 0, exercises: 0, inkRuns: 0, inkInline: 0, inkTiles: 0, inkQuotes: 0 };
const record = (o) => all.push(o);
/** How the ink check measures a run's ink: "metrics" (measureText) or "pixels" — picked by the
 *  ink self-test, the one that matches Amiri's known ink on this browser. */
let INK_MODE = null;

/** The compositions of each lesson (content/compose, the shapes inkMeasure reports: "primer",
 *  "word N"), by its path — what the ink check must have measured there at every size. */
async function composedByLesson() {
  const by = new Map();
  const add = (p, u) => by.set(p, [...(by.get(p) ?? []), u]);
  for (const slug of COMPOSED_SURAHS) {
    const c = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "compose", `${slug}.json`), "utf8"));
    for (const loc of Object.keys(c.words ?? {})) add(`/belajar/id/quran/${slug}/${loc.split(":")[1]}`, `word ${loc.split(":")[2]}`);
    // The primer plays in the lesson that hosts it: lesson zero's ("0"), or its ayah's.
    if (c.primer) add(c.primer.lesson === "0" ? INTRO_PATH : `/belajar/id/quran/${slug}/${c.primer.ayah}`, "primer");
  }
  return by;
}

/** A few animation frames: the in-flow fallback (src/lib/lineFit.ts) runs a frame after the page
 *  changes size, and again if that pass changed it. */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let n = 4;
        const tick = () => (--n ? requestAnimationFrame(tick) : done(true));
        requestAnimationFrame(tick);
      }),
  );

async function setSize(page, size) {
  // Pure CSS (rem on html[data-text-size]), so this equals a fresh load at that size; storage
  // too (the same key as src/hooks/useTextSize.ts), so a navigation inside the lesson keeps it.
  await page.evaluate((s) => {
    try {
      localStorage.setItem("belajar:v1:text-size", s);
    } catch {
      // blocked storage: the attribute alone still applies
    }
    const d = document.documentElement;
    if (s === "normal") delete d.dataset.textSize;
    else d.dataset.textSize = s;
    return true;
  }, size);
  await settle(page);
}

/** One measure per text size; the size is back to Normal afterwards. `shot`: also a screenshot
 *  at each size (shots/lb[-semua-surah]-<vp>-<shot>-<size>.png), for reviewing the breaks by eye — every other CI
 *  shot is at the Normal size only. Each measure is the line breaks and the ink of the marks
 *  (inkMeasure); `inkUnits` (size → Set): the compositions the ink check measured, added to. */
async function measureAllSizes(page, vp, label, scope = null, shot = null, inkUnits = null) {
  for (const size of SIZES) {
    await setSize(page, size);
    const { counts, offenders } = await page.evaluate(measure, { scope });
    tally.measures++;
    for (const k of Object.keys(counts)) tally[k] += counts[k];
    if (counts.containers === 0) offenders.push({ kind: "nothing-measured", where: scope ?? "body", detail: "no text found", text: "" });
    const ink = await page.evaluate(inkMeasure, { scope, mode: INK_MODE });
    tally.inkRuns += ink.counts.runs;
    tally.inkInline += ink.counts.inline;
    tally.inkTiles += ink.counts.tiles;
    tally.inkQuotes += ink.counts.quotes;
    offenders.push(...ink.offenders);
    if (inkUnits) {
      if (!inkUnits.has(size)) inkUnits.set(size, new Set());
      for (const u of ink.units) inkUnits.get(size).add(u);
    }
    for (const o of offenders) record({ page: label, viewport: vp, size, ...o });
    if (shot) {
      const file = `shots/lb${TAG}-${vp}-${shot}-${size}.png`;
      if (scope) await page.locator(scope).first().screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: true });
    }
  }
  await setSize(page, "normal");
}

async function open(page, vp, urlPath) {
  const res = await page.goto(BASE + urlPath, { waitUntil: "networkidle" }).catch((e) => {
    record({ page: urlPath, viewport: vp, size: "-", kind: "page-error", where: "", detail: String(e).split("\n")[0], text: "" });
    return undefined;
  });
  if (res === undefined) return false;
  if (!res || res.status() !== 200) {
    record({ page: urlPath, viewport: vp, size: "-", kind: "page-error", where: "", detail: `HTTP ${res?.status() ?? "no response"}`, text: "" });
    return false;
  }
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await settle(page);
  return true;
}
const openDetails = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    return document.fonts.ready.then(() => true);
  });
  await settle(page);
};
/** The paths `sel` links to on this page (no hash, no query), each once. */
const paths = (page, sel) =>
  page.locator(sel).evaluateAll((as) => [...new Set(as.map((a) => new URL(a.getAttribute("href"), location.href).pathname))]);

/** The pages a learner reaches by links: the hub, the track, the curriculum page, every surah and
 *  ayah the track and surah pages link (a surah behind a runtime switch is not linked, so not
 *  visited), the Konsep index and every concept, then every Kosakata entry those pages link. */
async function staticPages(page, vp) {
  const pages = [
    ["hub", "/belajar/id"],
    ["track", "/belajar/id/quran"],
    ["kurikulum", CURRICULUM],
    ["rumus", RUMUS],
  ];
  const surahs = [];
  const ayat = new Set();
  let intro = false;
  let curriculumLinked = false;
  let rumusLinked = false;
  if (await open(page, vp, "/belajar/id/quran"))
    for (const p of await paths(page, 'main a[href*="/quran/"]')) {
      // Lesson zero and the curriculum page are no surahs, though their addresses look like one:
      // left out of the surah harvest, each measured as a page of its own.
      if (p === INTRO_PATH) intro = true;
      else if (p === CURRICULUM) curriculumLinked = true;
      else if (p === RUMUS) rumusLinked = true;
      else if (SURAH_PATH.test(p)) surahs.push(p);
      else if (AYAH_PATH.test(p)) ayat.add(p);
    }
  // "Reached by its links": the track must link the curriculum page.
  if (!curriculumLinked)
    record({ page: "/belajar/id/quran", viewport: vp, size: "-", kind: "nothing-measured", where: "track", detail: "the track does not link the curriculum page", text: "" });
  if (!rumusLinked)
    record({ page: "/belajar/id/quran", viewport: vp, size: "-", kind: "nothing-measured", where: "track", detail: "the track does not link the cheat sheet (rumus)", text: "" });
  for (const s of surahs) {
    if (!(await open(page, vp, s))) continue;
    for (const p of await paths(page, 'main a[href*="/quran/"]')) if (AYAH_PATH.test(p)) ayat.add(p);
  }
  const byAyah = (a, b) => {
    const [sa, na] = a.split("/").slice(-2);
    const [sb, nb] = b.split("/").slice(-2);
    return surahs.findIndex((s) => s.endsWith(`/${sa}`)) - surahs.findIndex((s) => s.endsWith(`/${sb}`)) || Number(na) - Number(nb);
  };
  pages.push(["pengantar", INTRO_PATH]);
  if (!intro) record({ page: "/belajar/id/quran", viewport: vp, size: "-", kind: "nothing-measured", where: "track", detail: `the track does not link lesson zero (${INTRO_PATH})`, text: "" });
  pages.push(...surahs.map((s) => [`surah ${s.split("/").pop()}`, s]));
  pages.push(...[...ayat].sort(byAyah).map((a) => [`ayah ${a.split("/").slice(-2).join("/")}`, a]));
  pages.push(["konsep", "/belajar/id/konsep"]);
  if (await open(page, vp, "/belajar/id/konsep"))
    for (const p of await paths(page, 'main a[href*="/konsep/"]')) pages.push([`konsep ${p.split("/").pop()}`, p]);
  if (!ayat.size) record({ page: "/belajar/id/quran", viewport: vp, size: "-", kind: "nothing-measured", where: "track", detail: "the track links no ayah page", text: "" });
  // With every surah listed, the point of the run: the Mu'awwidzat are reached and measured.
  if (SURAHS_ON && !surahs.some((s) => !s.endsWith("/al-fatihah")))
    record({ page: "/belajar/id/quran", viewport: vp, size: "-", kind: "nothing-measured", where: "track", detail: "--surahs: the track links no surah besides Al-Fatihah", text: "" });
  const kosakata = new Set();
  for (const [label, urlPath] of pages) {
    try {
      if (!(await open(page, vp, urlPath))) continue;
      const details = await page.locator("details").count();
      await measureAllSizes(page, vp, details ? `${label} (closed)` : label, null, SHOTS[label] ?? null);
      if (details) {
        await openDetails(page);
        await measureAllSizes(page, vp, `${label} (open)`, null, SHOTS[`${label} (open)`] ?? null);
      }
      for (const p of await paths(page, 'a[href*="/kosakata/"]')) kosakata.add(p);
    } catch (e) {
      record({ page: label, viewport: vp, size: "-", kind: "check-error", where: "", detail: String(e?.stack ?? e), text: "" });
    }
  }
  for (const urlPath of [...kosakata].sort()) {
    try {
      if (!(await open(page, vp, urlPath))) continue;
      await openDetails(page);
      await measureAllSizes(page, vp, `kosakata ${urlPath.split("/").pop()}`);
    } catch (e) {
      record({ page: urlPath, viewport: vp, size: "-", kind: "check-error", where: "", detail: String(e?.stack ?? e), text: "" });
    }
  }
  console.log(`  ${vp}: ${pages.length} pages (${surahs.length} surahs, ${ayat.size} ayat), ${kosakata.size} kosakata entries`);
}

/** A click a learner could make; if something drawn over the stage (a spotlight label) takes the
 *  pointer, the same click is dispatched on the control itself (React handles both alike). */
const press = (loc) => loc.click({ timeout: 3000 }).catch(() => loc.dispatchEvent("click"));

const AYAH_DIALOG = "dialog[data-ayah-dialog]";

/**
 * The fact cards' ayah dialog (operator 2026-10-12; src/components/surah/AyahDialog.tsx), opened
 * from the Al-Fatihah surah page (every disclosure open, so every chip is reachable) on the
 * longest ayah its cards locate, the first one with QuranEnc footnotes, and the first chip, each
 * measured inside the dialog at every text size: the Arabic wraps inside it, the reference, the
 * translation and its footnotes break cleanly, and the page does not scroll sideways
 * (page-overflow). The longest is also shot at each size (lb-<vp>-ayah-dialog-long-<size>.png).
 */
async function ayahDialogs(page, vp) {
  const label = "ayah dialog";
  try {
    const data = JSON.parse(await readFile(path.join(BELAJAR_DIR, "content", "ayat", "locations.json"), "utf8"));
    const byLoc = new Map(data.ayat.map((e) => [e.loc, e]));
    if (!(await open(page, vp, "/belajar/id/quran/al-fatihah"))) return;
    // Drawn into <body> once the page has hydrated: from then on a chip opens it.
    await page.locator(AYAH_DIALOG).waitFor({ state: "attached", timeout: 15_000 });
    await openDetails(page);
    const locs = await page.locator("[data-ayah-chip]").evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("data-ayah-chip")))]);
    const len = (l) => (byLoc.get(l)?.ar.length ?? 0) + (byLoc.get(l)?.translation.text.length ?? 0);
    const longest = locs.reduce((best, l) => (len(l) > len(best) ? l : best), locs[0]);
    const footnoted = locs.find((l) => byLoc.get(l)?.translation.footnotes.length);
    const picks = [...new Set([longest, footnoted, locs[0]].filter(Boolean))];
    for (const loc of picks) {
      await press(page.locator(`[data-ayah-chip="${loc}"]`).first());
      await page.locator(`${AYAH_DIALOG} [data-ayah-ar]`).waitFor({ state: "visible", timeout: 10_000 });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await settle(page);
      await measureAllSizes(page, vp, `${label} ${loc}`, AYAH_DIALOG, loc === longest ? "ayah-dialog-long" : null);
      await page.keyboard.press("Escape");
      await page.locator(AYAH_DIALOG).waitFor({ state: "hidden", timeout: 5_000 });
    }
    console.log(`  ${vp}: ayah dialog measured on ${picks.join(", ")} (of ${locs.length} chips)`);
    if (!picks.length) record({ page: label, viewport: vp, size: "-", kind: "nothing-measured", where: "surah al-fatihah", detail: "no location chip", text: "" });
  } catch (e) {
    record({ page: label, viewport: vp, size: "-", kind: "check-error", where: AYAH_DIALOG, detail: String(e?.stack ?? e), text: "" });
  }
  await page.goto("about:blank");
}

/** "Langkah N dari M" → [N, M] (null once the stage is no longer playing). */
const stepOf = async (page) => {
  const loc = page.locator('[data-autoplay="step"]');
  if (!(await loc.count())) return null;
  const m = /(\d+)\D+(\d+)/.exec((await loc.first().textContent()) ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
};

const STAGE = '[data-autoplay="stage"]';

/** The exercise on this lesson step (its data-guide key: "label-role", "sort-case", …), or null. */
const exerciseOn = (page) =>
  page.locator(`${STAGE} [data-guide^="exercise:"]`).evaluateAll((els) => {
    for (const el of els) {
      const m = /^exercise:([\w-]+):/.exec(el.getAttribute("data-guide") ?? "");
      if (m) return m[1];
    }
    return null;
  });

/** The exercise's feedback laid out and measured (it shows only once a question is answered): a
 *  pick, measured; while the question is not settled, the next pick; "Tunjukkan jawaban" once it
 *  is offered (after two misses), measured — so the "not yet" note and the answer with its rule
 *  ("why", the role, the word with its transliteration) are both on screen at every text size.
 *  The guided controls carry data-guide="exercise:<key>:<part>" (ExerciseShell). */
async function answerExercise(page, vp, label, key) {
  const part = (p) => page.locator(`${STAGE} [data-guide="exercise:${key}:${p}"]`);
  const after = async (what) => {
    await page.waitForTimeout(250);
    await settle(page);
    await measureAllSizes(page, vp, `${label} · ${key} · ${what}`, STAGE);
  };
  let shown = 0;
  for (let k = 0; k < 6; k++) {
    if (key === "sort-case") {
      const word = part("words").locator("button").first();
      if (!(await word.count())) break;
      if ((await word.getAttribute("aria-pressed")) !== "true") await press(word);
      const bins = part("bins").locator("button");
      if (k >= (await bins.count())) break;
      await press(bins.nth(k));
    } else {
      const options = part("options").locator("button");
      if (k >= (await options.count())) break;
      await press(options.nth(k));
    }
    await after(`pick ${k + 1}`);
    shown++;
    if (await part("reveal").count()) {
      await press(part("reveal").first());
      await after("answer shown");
      shown++;
      break;
    }
    // Settled (right on this pick): "Lanjut"/"Selesai", or for Sortir the word left the list.
    if ((await part("next").count()) || (key === "sort-case" && (await page.locator(`${STAGE} [role="status"] .bg-ok-bg`).count()))) break;
  }
  tally.exercises++;
  if (!shown) record({ page: label, viewport: vp, size: "-", kind: "nothing-measured", where: `exercise ${key}`, detail: "no answer could be given, so its feedback was never laid out", text: "" });
}

/** The lesson stage before "Mulai", then every step "Berikutnya ›" reaches (the caption, the word
 *  card, the mushaf line, an exercise and its prompt), up to the last step; on an exercise step
 *  of a kind not yet answered, its feedback too. Narrated: each step is replayed so its narration
 *  plays and the KARAOKE caption shows (routed narration, as in screenshots.mjs).
 *  The EXAMPLE beats (operator 2026-10-12, plan L20): a concept's example is a step of its own,
 *  so its card ("Contoh" · the word · "yang artinya …") and its caption are measured like any
 *  step — at once, with no wait for a karaoke caption it never has; the first is also shot at
 *  each size. A bentuk dasar's example comes inside its composition step, after its base frame's
 *  lines: on the narrated lesson the first one is waited for and its caption measured (and shot)
 *  too.
 *  BRIEF steps are measured PAUSED (operator 2026-10-13, plan L24): a word's opening step
 *  ("w3:recite": the imam says the word) now lasts as long as his word, about a second and a
 *  half, and a concept's example about three (they were 7.7 s and 5.8 s) — less than three sizes
 *  take to measure, and the lesson would move on under the measurement. "Jeda" keeps the step as
 *  it is (its caption, the word card or the example card); "Lanjutkan" before the walk moves on,
 *  so the steps after it run as before (an exercise needs the lesson running). */
/** How long the walk waits, inside a composition step, for its bentuk dasar's example to come. */
const BASE_EXAMPLE_WAIT_MS = 45_000;
const MIDDLE = '[data-autoplay="middle"]';
/** A word's opening step, by the stage's data-step ("w1:recite"). */
const WORD_RECITE_STEP = /^w\d+:recite$/;
/** The middle control's mode ("pause" while the lesson runs, "resume" while it is paused). */
const middleMode = (page) => page.locator(MIDDLE).first().getAttribute("data-mode").catch(() => null);
/** "Jeda", when the lesson runs. True when this call paused it. */
async function pauseLesson(page) {
  if ((await middleMode(page)) !== "pause") return false;
  await press(page.locator(MIDDLE).first());
  await page.waitForTimeout(150);
  return (await middleMode(page)) === "resume";
}
/** "Lanjutkan", when the lesson is paused. */
async function resumeLesson(page) {
  if ((await middleMode(page)) !== "resume") return;
  await press(page.locator(MIDDLE).first());
  await page.waitForTimeout(150);
}
/** "Berikutnya ›" until the lesson leaves step `n` ("Langkah n dari N") or the page. On a step
 *  with animation frames (the harakat primer, a word's composition) each press moves ONE frame
 *  (src/lib/autoplay/machine.ts, operator 2026-10-15), so it is left after as many presses as it
 *  has frames left; anywhere else one press does. The walk measures steps, not frames. Bounded
 *  (Al-Fatihah's longest composition has 5 frames, the primer 13 since its bare-then-marked examples). */
async function leaveStep(page, n) {
  const from = page.url();
  for (let i = 0; i < 16; i++) {
    await press(page.locator('[data-autoplay="next"]'));
    for (let t = 0; t < 5; t++) {
      await page.waitForTimeout(100);
      if (page.url() !== from) return;
      const at = await stepOf(page);
      if (!at || at[0] !== n) return;
    }
  }
}
async function lessonPages(page, vp, index, composed) {
  const answered = new Set();
  for (const [urlPath, narrated, example = true] of LESSONS) {
    const served = [];
    const handler = narrationRoute(index, served);
    if (narrated) await page.route(isNarration, handler);
    /** The compositions the ink check measured on this lesson, by text size. */
    const inkUnits = new Map();
    let karaoke = 0;
    let cards = 0;
    let steps = 0;
    let examples = 0;
    let baseExample = 0;
    try {
      if (!(await open(page, vp, urlPath))) continue;
      await measureAllSizes(page, vp, `${urlPath} before Mulai`, STAGE, null, inkUnits);
      await press(page.locator('[data-autoplay="start"]'));
      await page.locator('[data-autoplay="step"]').first().waitFor({ state: "visible", timeout: 10_000 });
      const start = page.url();
      for (let guard = 0; guard < 60; guard++) {
        await page.waitForTimeout(300);
        if (page.url() !== start) break;
        const at = await stepOf(page);
        if (!at) break;
        let shot = null;
        // A word's opening step and a concept's example step are brief: paused while measured.
        const stepId = await page.locator(STAGE).first().getAttribute("data-step").catch(() => null);
        // A concept's example step: its card is on screen at once, and only for a few seconds.
        const onExample = (await page.locator(`${STAGE} [data-autoplay="example"]`).count()) > 0;
        const brief = onExample || WORD_RECITE_STEP.test(stepId ?? "");
        const held = brief ? await pauseLesson(page) : false;
        if (onExample && examples++ === 0) shot = "example";
        if (narrated && !brief) {
          await press(page.locator('[data-autoplay="replay"]')).catch(() => {});
          const word = page.locator('[data-autoplay="caption"] [data-karaoke]').first();
          if (await word.waitFor({ state: "attached", timeout: 4000 }).then(() => true, () => false)) {
            // the first karaoke step is also shot at each size
            if (karaoke++ === 0) shot = "karaoke";
            // a few words in, so the forest fill sits on a word
            await page.waitForTimeout(700);
          }
        }
        // the first word card is also shot at each size (it reflows at large sizes)
        if (!shot && !cards && (await page.locator(`${STAGE} [data-autoplay="word-card"]`).count())) shot = "word-card";
        if (shot === "word-card") cards++;
        await settle(page);
        await measureAllSizes(page, vp, `${urlPath} step ${at[0]}/${at[1]}`, STAGE, shot, inkUnits);
        steps++;
        if (held) await resumeLesson(page);
        // The first bentuk dasar's example of the narrated lesson: inside word 1's composition,
        // once its base frame's lines are said (its caption says what is heard: the longest).
        if (narrated && !baseExample && (await page.locator(`${STAGE}[data-step="w1:compose"]`).count())) {
          const beat = page.locator(`${STAGE}[data-example^="w1:base:"]`);
          if (await beat.waitFor({ state: "attached", timeout: BASE_EXAMPLE_WAIT_MS }).then(() => true, () => false)) {
            await settle(page);
            await measureAllSizes(page, vp, `${urlPath} step ${at[0]}/${at[1]} · bentuk dasar example`, STAGE, "example-base", inkUnits);
            baseExample++;
          }
        }
        const key = await exerciseOn(page);
        if (key && !answered.has(key)) {
          answered.add(key);
          await answerExercise(page, vp, `${urlPath} step ${at[0]}/${at[1]}`, key);
        }
        if (at[0] >= at[1]) {
          // Past the last step of a surah's last ayah: the end card ("Surah berikutnya: …").
          await press(page.locator('[data-autoplay="next"]')).catch(() => {});
          const end = page.locator('[data-autoplay="end"]');
          if (await end.waitFor({ state: "visible", timeout: 5000 }).then(() => true, () => false))
            await measureAllSizes(page, vp, `${urlPath} end card`, STAGE);
          break;
        }
        await leaveStep(page, at[0]);
      }
    } catch (e) {
      record({ page: urlPath, viewport: vp, size: "-", kind: "check-error", where: "stage", detail: String(e?.stack ?? e), text: "" });
    } finally {
      if (narrated) await page.unroute(isNarration, handler);
    }
    console.log(
      `  ${vp}: ${urlPath} — ${steps} steps measured${narrated ? `, karaoke on ${karaoke}` : ""}, ${examples} example card(s)${narrated ? `, ${baseExample} bentuk dasar example` : ""}`,
    );
    // Not vacuous: each of these lessons introduces a concept, so it shows an example card; the
    // narrated one (Al-Fatihah 1) also plays the bentuk dasar of its first word.
    if (example && steps > 0 && examples === 0)
      record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "example", detail: "no example card was on screen at any step", text: "" });
    if (narrated && steps > 0 && baseExample === 0)
      record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "example", detail: "the bentuk dasar's example never showed in word 1's composition", text: "" });
    if (steps === 0) record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "stage", detail: "no lesson step was measured", text: "" });
    // Not vacuous: the narrated ayah must have shown its karaoke words.
    if (narrated && karaoke === 0)
      record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "caption", detail: "the karaoke caption never showed", text: "" });
    // Not vacuous: at every size, every composition of this lesson had its tiles ink-checked (all
    // its frames are laid out in its figure, so this covers every tile of every frame).
    if (steps > 0)
      for (const size of SIZES) {
        const missing = (composed.get(urlPath) ?? []).filter((u) => !inkUnits.get(size)?.has(u));
        if (missing.length)
          record({ page: urlPath, viewport: vp, size, kind: "nothing-measured", where: "composition", detail: `the ink check never measured ${missing.join(", ")} (content/compose)`, text: "" });
      }
    console.log(`  ${vp}: ${urlPath} — ink checked on ${[...new Set([...inkUnits.values()].flatMap((s) => [...s]))].join(", ") || "no composition"}`);
  }
  console.log(`  ${vp}: exercises answered: ${[...answered].join(", ") || "none"}`);
  if (!answered.size) record({ page: "lessons", viewport: vp, size: "-", kind: "nothing-measured", where: "exercise", detail: "no exercise step was reached", text: "" });
  await page.goto("about:blank");
}

/**
 * The check measures what it claims (linebreaks-fixture.html): every bad case must report the
 * kinds it names, every good case nothing; and the unit wider than its line must be laid out in
 * the paragraph's flow (data-lb-flow), "kata" sharing a line with its first word and "lagi" with
 * its seam — not a box as wide as the line with those words on lines of their own. Laid out in a
 * real page with its real fonts, CSS and fallback. Also logs one probe of Chromium itself: does it
 * break between an inline-block and a "," right after it? (If so, a unit must never end where
 * punctuation follows outside it — MixedText units always end at a space.)
 */
async function selfTest(page, fixture) {
  if (!(await open(page, "phone", "/belajar/id/quran/al-fatihah/1"))) throw new Error("self-test: page did not load");
  /** The page's own width, and its widest elements when it scrolls sideways. */
  const pageWidth = () =>
    page.evaluate(() => {
      const over = document.documentElement.scrollWidth > window.innerWidth + 1;
      const widest = over
        ? [...document.body.querySelectorAll("*")]
            .map((el) => ({ el, right: el.getBoundingClientRect().right }))
            .filter((x) => x.right > window.innerWidth + 1)
            .sort((a, b) => b.right - a.right)
            .slice(0, 3)
            .map(({ el, right }) => `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.closest("[data-case]") ? ` in ${el.closest("[data-case]").getAttribute("data-case")}` : ""}> to ${Math.round(right)}px`)
        : [];
      return { over, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, widest };
    });
  const bare = await pageWidth();
  if (bare.over) throw new Error(`self-test: the page scrolls sideways before any case is added (${bare.scrollWidth} > ${bare.innerWidth}: ${bare.widest.join(", ")})`);
  await page.evaluate((html) => {
    const box = document.createElement("div");
    box.id = "lb-selftest";
    box.innerHTML = html;
    // Every case is measured inside this box, which clips sideways: a bad case that sticks out on
    // purpose (a word wider than its column, a 30rem paragraph on a 390px phone) never makes the
    // PAGE scroll sideways, which every measure reports as page-overflow — CI 2026-10-11 charged
    // "scrollWidth 480 > 390" to all six good cases. The text checks look at each case's own
    // boxes, never at this one, so the box hides nothing from them.
    box.style.overflowX = "clip";
    // The one case that must widen the page: measured on its own, last, outside the box.
    const wide = box.querySelector('[data-case="page-overflow"]');
    wide.remove();
    window.__lbWide = wide;
    (document.querySelector("main") ?? document.body).prepend(box);
    return true;
  }, fixture);
  await settle(page);
  // Size each data-fit paragraph from its own pieces, measured on one line; then put it back in
  // the page, so the fallback's observer sees it (as it sees any new text).
  const sized = await page.evaluate(() => {
    const out = [];
    const r = document.createRange();
    const width = (from, to) => {
      r.setStartBefore(from);
      if (to) r.setEndBefore(to);
      else r.setEndAfter(from);
      return r.getBoundingClientRect().width;
    };
    const textWidth = (node, a, b) => {
      r.setStart(node, a);
      r.setEnd(node, b);
      return r.getBoundingClientRect().width;
    };
    for (const p of document.querySelectorAll("#lb-selftest [data-fit]")) {
      p.style.width = "max-content";
      const fit = p.getAttribute("data-fit");
      let w = 0;
      let whole = 0;
      if (fit === "unit") {
        const outer = p.querySelector('[data-lb="unit"]');
        const inner = outer.querySelector('[data-lb="unit"]');
        r.setStart(p, 0);
        r.setEndBefore(outer);
        const before = r.getBoundingClientRect().width;
        const lead = width(outer.firstChild, inner);
        r.setStartAfter(outer);
        r.setEnd(p, p.childNodes.length);
        const afterW = r.getBoundingClientRect().width;
        const seam = inner.getBoundingClientRect().width;
        w = Math.max(before + lead, seam + afterW) + 2;
        whole = lead + seam;
      } else if (fit === "glue") {
        const t = p.querySelector('[data-lb="glue"]').firstChild;
        const cut = t.data.indexOf("-") + 1;
        w = Math.max(textWidth(t, 0, cut), textWidth(t, cut, t.data.length)) + 2;
        whole = textWidth(t, 0, t.data.length);
      } else if (fit === "arabic") {
        // A line for its widest word and the « » around the quotation: it wraps between words.
        const bdi = p.querySelector("bdi");
        const t = bdi.firstChild;
        let at = 0;
        let widest = 0;
        for (const word of t.data.split(" ")) {
          widest = Math.max(widest, textWidth(t, at, at + word.length));
          at += word.length + 1;
        }
        const marks = [bdi.previousSibling, bdi.nextSibling].reduce((sum, n) => sum + (n ? width(n) : 0), 0);
        w = widest + marks + 8;
        whole = bdi.parentElement.getBoundingClientRect().width;
      }
      p.style.width = `${Math.ceil(w)}px`;
      // Plain greedy lines here (no "pretty" rebalancing): which word ends a line is then known.
      p.style.textWrap = "wrap";
      out.push({ fit, w: Math.round(w), whole: Math.round(whole), case: p.closest("[data-case]").getAttribute("data-case") });
      const parent = p.parentNode;
      const next = p.nextSibling;
      parent.removeChild(p);
      parent.insertBefore(p, next);
    }
    return out;
  });
  for (const s of sized)
    if (!(s.w < s.whole)) throw new Error(`self-test: ${s.case} could not be sized wider than its line (${s.w}px for ${s.whole}px)`);
  await settle(page);
  const withCases = await pageWidth();
  if (withCases.over)
    throw new Error(`self-test: the cases make the page scroll sideways (${withCases.scrollWidth} > ${withCases.innerWidth}: ${withCases.widest.join(", ")}) — each case must stay inside #lb-selftest`);

  const cases = await page.locator("#lb-selftest > [data-case]").evaluateAll((els) =>
    els.map((el) => ({ name: el.getAttribute("data-case"), expect: (el.getAttribute("data-expect") ?? "").split(/\s+/).filter(Boolean) })),
  );
  const failures = [];
  const caught = new Set();
  const run = async (c, box = "#lb-selftest") => {
    const { offenders } = await page.evaluate(measure, { scope: `${box} [data-case="${c.name}"]` });
    const got = new Set(offenders.map((o) => o.kind));
    if (c.expect.length) {
      const missing = c.expect.filter((k) => !got.has(k));
      if (missing.length) failures.push(`${c.name}: not caught: ${missing.join(", ")} (got ${[...got].join(", ") || "nothing"})`);
      c.expect.forEach((k) => got.has(k) && caught.add(k));
    } else if (offenders.length) failures.push(`${c.name}: the markup as it ships was reported: ${JSON.stringify(offenders)}`);
  };
  for (const c of cases) await run(c);
  // The fallback itself: laid out in the flow, sharing its lines with the words around it.
  const flow = await page.evaluate(() => {
    const p = document.querySelector('#lb-selftest [data-case="unit-in-flow"] p');
    const outer = p.querySelector('[data-lb="unit"]');
    const inner = outer.querySelector('[data-lb="unit"]');
    const r = document.createRange();
    const mid = (box) => (box.top + box.bottom) / 2;
    /** The boxes of the text between two points (set on r by `select`), empty ones left out. */
    const boxes = (select) => {
      select();
      return Array.from(r.getClientRects()).filter((x) => x.width > 0);
    };
    // "kata " — its last box; the term's first word, "jumlah "; " lagi" — its first box.
    const before = boxes(() => (r.setStart(p, 0), r.setEndBefore(outer))).pop();
    const lead = boxes(() => (r.setStartBefore(outer.firstChild), r.setEndBefore(inner)))[0];
    const after = boxes(() => (r.setStartAfter(outer), r.setEnd(p, p.childNodes.length)))[0];
    const seam = inner.getBoundingClientRect();
    const same = (a, b) => !!a && !!b && Math.abs(mid(a) - mid(b)) < Math.min(a.height, b.height) / 2;
    const glue = document.querySelector('#lb-selftest [data-case="glue-in-flow"] [data-lb="glue"]');
    return {
      flowed: outer.hasAttribute("data-lb-flow"),
      innerFlowed: inner.hasAttribute("data-lb-flow"),
      before: same(before, lead),
      after: same(seam, after),
      glue: glue.hasAttribute("data-lb-flow"),
    };
  });
  if (!flow.flowed || flow.innerFlowed || !flow.before || !flow.after || !flow.glue)
    failures.push(`unit-in-flow: the fallback did not lay the unit out in the flow: ${JSON.stringify(flow)}`);
  // Last, the page that scrolls sideways: in a box of its own after the clipped one, so it does
  // widen the page (the check must still see a page that scrolls sideways).
  await page.evaluate(() => {
    const out = document.createElement("div");
    out.id = "lb-selftest-wide";
    out.append(window.__lbWide);
    document.getElementById("lb-selftest").after(out);
    return true;
  });
  await run({ name: "page-overflow", expect: ["page-overflow"] }, "#lb-selftest-wide");
  await page.evaluate(() => {
    document.getElementById("lb-selftest-wide")?.remove();
    return true;
  });

  const probe = await page.evaluate(() => {
    const p = document.createElement("p");
    p.innerHTML = `aaa <span style="display:inline-block">bbb</span>, ccc`;
    (document.querySelector("main") ?? document.body).prepend(p);
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEndAfter(p.children[0]);
    p.style.width = `${Math.ceil(r.getBoundingClientRect().width)}px`;
    const comma = document.createRange();
    comma.setStart(p.lastChild, 0);
    comma.setEnd(p.lastChild, 1);
    const broke = comma.getBoundingClientRect().top > p.children[0].getBoundingClientRect().bottom - 1;
    p.remove();
    return broke;
  });
  console.log(`probe: Chromium ${probe ? "DOES" : "does not"} break between an inline-block and a "," after it`);

  const uncovered = KINDS.filter((k) => k !== "check-error" && !caught.has(k));
  if (uncovered.length) failures.push(`no case caught: ${uncovered.join(", ")}`);
  if (failures.length) throw new Error(`self-test failed:\n  ${failures.join("\n  ")}`);
  console.log(
    `self-test ok: ${cases.filter((c) => c.expect.length).length + 1} bad cases caught (${[...caught].join(", ")}); ` +
      `${cases.filter((c) => !c.expect.length).length} good cases pass; a unit wider than its line breaks in the flow (${sized.map((s) => `${s.case} ${s.w}px`).join(", ")})`,
  );
  await page.goto("about:blank");
}

/** The ink self-test's cases, laid out in the real page (its Amiri, its CSS: .arabic-inline,
 *  .compose-ar, ar-clear): a case with data-expect must report those kinds, one without nothing.
 *  The operator's tile (label "isim" over رَبُّ at line height 1.8, as the composition drew it
 *  until 2026-10-17) and the same with ar-clear, outside and inside a composition figure (its own
 *  room, globals.css); a chip whose border the shaddah + dhammah cross, and with ar-clear; the
 *  tile's "rabbu · “Tuhan”" in a right-to-left row, without and with its LTR isolate; ٱلنَّفَّٰثَٰتِ
 *  inline under a line of Latin, without and with ar-tall (CI 2026-10-17); and two things a
 *  clipping ancestor hides, which must not count: a long ayah scrolled under a footer (the ayah
 *  dialog), a "+" narrowed to nothing over a tile (a join). Its {{…}}
 *  slots are content bytes (inkFixture), never Arabic typed into a test. */
const INK_CASES = `
  <div data-ink-case="tile-overlap" data-expect="ink-overlap" style="display:flex;flex-direction:column;align-items:center;width:12rem;background:#fff">
    <span style="font-size:14px;line-height:1.25">isim</span>
    <span style="display:block"><bdi lang="ar" dir="rtl" class="arabic-inline" style="--ar-lh:1.8;line-height:1.8;font-size:32px">{{RABBU}}</bdi></span>
    <span dir="ltr" style="font-size:16px;line-height:1.25">rabbu</span>
  </div>
  <div data-ink-case="tile-clear" style="display:flex;flex-direction:column;align-items:center;width:12rem;background:#fff">
    <span style="font-size:14px;line-height:1.25">isim</span>
    <bdi lang="ar" dir="rtl" class="arabic-inline ar-clear inline-block" style="--ar-lh:1.8;line-height:1.8;font-size:32px">{{RABBU}}</bdi>
    <span dir="ltr" style="font-size:16px;line-height:1.25">rabbu</span>
  </div>
  <div data-ink-case="compose-clear">
    <div data-autoplay="composition" style="display:flex;flex-direction:column;align-items:center;width:12rem;background:#fff">
      <span style="font-size:14px;line-height:1.25">isim</span>
      <bdi lang="ar" dir="rtl" class="arabic-inline compose-ar ar-clear inline-block" style="font-size:32px">{{RABBU}}</bdi>
      <span dir="ltr" style="font-size:16px;line-height:1.25">rabbu</span>
    </div>
  </div>
  <div data-ink-case="chip-border" data-expect="ink-border" style="padding:2rem 1rem;background:#fff">
    <bdi lang="ar" dir="rtl" class="arabic-inline" style="display:inline-block;--ar-lh:1.6;line-height:1.6;font-size:24px;border:1px solid #0e5a3c;border-radius:6px;padding-inline:6px">{{BU}}</bdi>
  </div>
  <div data-ink-case="chip-clear" style="padding:2rem 1rem;background:#fff">
    <bdi lang="ar" dir="rtl" class="arabic-inline ar-clear" style="display:inline-block;--ar-lh:1.6;line-height:1.6;font-size:24px;border:1px solid #0e5a3c;border-radius:6px;padding-inline:6px">{{BU}}</bdi>
  </div>
  <div data-ink-case="quote-rtl" data-expect="quote-order" dir="rtl" style="font-size:16px"><span style="display:block">rabbu · “Tuhan”</span></div>
  <div data-ink-case="quote-ltr" dir="rtl" style="font-size:16px"><span dir="ltr" style="display:block">rabbu · “Tuhan”</span></div>
  <p data-ink-case="inline-tall" data-expect="ink-overlap" style="width:16rem;font-size:16px;line-height:1.5;background:#fff">bergantung pada<br><bdi lang="ar" dir="rtl" class="arabic-inline text-ar-sm">{{NAFFATHAT}}</bdi> lagi</p>
  <p data-ink-case="inline-tall-clear" style="width:16rem;font-size:16px;line-height:1.5;background:#fff">bergantung pada<br><bdi lang="ar" dir="rtl" class="arabic-inline ar-tall text-ar-sm">{{NAFFATHAT}}</bdi> lagi</p>
  <div data-ink-case="clipped" style="display:flex;flex-direction:column;width:12rem;height:9rem;background:#fff">
    <div style="flex:1 1 0;min-height:0;overflow-y:auto"><p lang="ar" dir="rtl" class="quran" style="font-size:36px">{{LONG}}</p></div>
    <p style="border-top:1px solid #e7e4da;font-size:16px;line-height:1.5">Putar bacaan imam</p>
  </div>
  <div data-ink-case="collapsed-plus" style="padding:1rem;background:#fff"><bdi lang="ar" dir="rtl" class="arabic-inline ar-clear inline-block" style="font-size:32px">{{RABBU}}</bdi><span style="display:inline-block;width:0;overflow-x:clip;margin-left:-3rem;font-size:24px">+</span></div>`;

/** Amiri's ink, known (HarfBuzz on the served font, 2026-10-17), in em: what the canvas must give
 *  for these slots — رَبُّ's shaddah + dhammah, ٱلرَّحِيمِ's kasrah under its mim, a bare ب. */
const AMIRI_INK = [
  { slot: "RABBU", above: 1.287 },
  { slot: "RAHIM", below: 0.759 },
  { slot: "BA", above: 0.386 },
];

/** The ink self-test's Arabic, from the content: the bentuk dasar rabbu of Al-Fatihah 2 word 3
 *  and the piece of its chip (content/compose), word 4 of ayah 1 and the primer's bare letter,
 *  word 3 of Al-Falaq 4 and the whole of Al-Fatihah 7. */
async function inkFixture() {
  const read = async (rel) => JSON.parse(await readFile(path.join(BELAJAR_DIR, rel), "utf8"));
  const compose = await read("content/compose/al-fatihah.json");
  const lesson = await read("content/al-fatihah.json");
  const falaq = await read("content/al-falaq.json");
  const rabb = compose.words?.["1:2:3"];
  const values = {
    RABBU: rabb?.forms?.rabbu?.ar,
    BU: rabb?.frames?.find((f) => f.chips?.length)?.chips[0]?.from,
    RAHIM: lesson.ayat.find((a) => a.ayah === 1)?.words.find((w) => w.loc === "1:1:4")?.ar,
    BA: compose.primer?.forms?.ba?.ar,
    // the tallest stack the module draws: QS 113:4 word 3
    NAFFATHAT: falaq.ayat.find((a) => a.ayah === 4)?.words.find((w) => w.loc === "113:4:3")?.ar,
    LONG: lesson.ayat.find((a) => a.ayah === 7)?.ar,
  };
  const missing = Object.entries(values).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`ink self-test: the content no longer has ${missing.join(", ")} (content/compose/al-fatihah.json, content/al-fatihah.json)`);
  return values;
}

/**
 * The ink check measures what it claims (inkMeasure), in a real page with its real fonts and CSS:
 *   1. the canvas gives Amiri's known ink, in the page's own Amiri family at 100px — measureText's
 *      actualBoundingBox, or else the inked rows of the drawn run (INK_MODE: the first that does;
 *      neither fails the run: no ink measured is no check);
 *   2. the baseline it derives (a text box's top + the font's ascent) lies within a pixel of a
 *      probe laid on the baseline (an empty inline-block);
 *   3. every case of INK_CASES reports the kinds it expects and the markup as it ships nothing —
 *      the bad tile (the operator's), the bad chip, the RTL gloss — and every kind is caught.
 */
async function inkSelfTest(page, values) {
  if (!(await open(page, "phone", "/belajar/id/quran/al-fatihah/1"))) throw new Error("ink self-test: page did not load");
  const family = await page.evaluate(() => {
    const el = document.querySelector(".quran, .arabic-inline");
    return el ? getComputedStyle(el).fontFamily : null;
  });
  if (!family) throw new Error("ink self-test: no Arabic on the page to take Amiri's family from");
  const cal = await page.evaluate(inkMeasure, { calibrate: AMIRI_INK.map((k) => ({ text: values[k.slot], font: `normal 400 100px ${family}`, size: 100 })) });
  const off = (how) =>
    AMIRI_INK.flatMap((k, i) => [
      k.above !== undefined && Math.abs(cal[i][how].above / 100 - k.above) > 0.05 ? `${k.slot} ${(cal[i][how].above / 100).toFixed(3)}em above (Amiri: ${k.above})` : null,
      k.below !== undefined && Math.abs(cal[i][how].below / 100 - k.below) > 0.05 ? `${k.slot} ${(cal[i][how].below / 100).toFixed(3)}em below (Amiri: ${k.below})` : null,
    ]).filter(Boolean);
  const [byMetrics, byPixels] = [off("metrics"), off("pixels")];
  INK_MODE = !byMetrics.length ? "metrics" : !byPixels.length ? "pixels" : null;
  const shown = cal.map((c, i) => `${AMIRI_INK[i].slot} ${(c.metrics.above / 100).toFixed(3)}/${(c.metrics.below / 100).toFixed(3)} (pixels ${(c.pixels.above / 100).toFixed(3)}/${(c.pixels.below / 100).toFixed(3)})`).join(", ");
  if (!INK_MODE) throw new Error(`ink self-test: the canvas gives neither measureText (${byMetrics.join("; ")}) nor the drawn pixels (${byPixels.join("; ")}) Amiri's ink — ${shown}`);
  console.log(`ink self-test: canvas ink in ${family.split(",")[0]} (above/below, em): ${shown} — measuring by ${INK_MODE}${byMetrics.length ? ` (measureText is off: ${byMetrics.join("; ")})` : ""}`);

  await page.evaluate((html) => {
    const box = document.createElement("div");
    box.id = "ink-selftest";
    box.innerHTML = html;
    (document.querySelector("main") ?? document.body).prepend(box);
    return document.fonts.ready.then(() => true);
  }, INK_CASES.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k]));
  await settle(page);
  const failures = [];
  // 2. The baseline: a text box's top + the font's ascent, against an empty inline-block on it.
  const base = await page.evaluate(() => {
    const bdi = document.querySelector('#ink-selftest [data-ink-case="tile-clear"] bdi');
    const text = [...bdi.childNodes].find((n) => n.nodeType === 3);
    const r = document.createRange();
    r.selectNodeContents(text);
    const top = [...r.getClientRects()].find((x) => x.height > 0)?.top;
    const s = getComputedStyle(bdi);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const ascent = ctx.measureText(text.data).fontBoundingBoxAscent;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    bdi.prepend(probe);
    const onBaseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    return { derived: top + ascent, onBaseline };
  });
  if (!(Math.abs(base.derived - base.onBaseline) <= 1))
    failures.push(`baseline: a text box's top + the font's ascent is ${base.derived.toFixed(2)}, the probe on the baseline ${base.onBaseline.toFixed(2)}`);
  // 3. The cases.
  const cases = await page.locator("#ink-selftest > [data-ink-case]").evaluateAll((els) =>
    els.map((el) => ({ name: el.getAttribute("data-ink-case"), expect: (el.getAttribute("data-expect") ?? "").split(/\s+/).filter(Boolean) })),
  );
  const caught = new Set();
  for (const c of cases) {
    const { offenders, counts } = await page.evaluate(inkMeasure, { scope: `#ink-selftest [data-ink-case="${c.name}"]`, mode: INK_MODE });
    const got = new Set(offenders.map((o) => o.kind));
    if (c.expect.length) {
      const missing = c.expect.filter((k) => !got.has(k));
      if (missing.length) failures.push(`${c.name}: not caught: ${missing.join(", ")} (got ${[...got].join(", ") || "nothing"}; ${counts.runs} runs, ${counts.quotes} quotes)`);
      c.expect.forEach((k) => got.has(k) && caught.add(k));
    } else if (offenders.length) failures.push(`${c.name}: the markup as it ships was reported: ${JSON.stringify(offenders)}`);
  }
  const uncovered = INK_KINDS.filter((k) => k !== "check-error" && !caught.has(k));
  if (uncovered.length) failures.push(`no case caught: ${uncovered.join(", ")}`);
  await page.evaluate(() => {
    document.getElementById("ink-selftest")?.remove();
    return true;
  });
  if (failures.length) throw new Error(`ink self-test failed:\n  ${failures.join("\n  ")}`);
  console.log(`ink self-test ok: ${[...caught].join(", ")} caught; ar-clear (outside and inside a composition), ar-tall and dir="ltr" pass, clipped text is not counted; baseline within ${Math.abs(base.derived - base.onBaseline).toFixed(2)}px of its probe`);
  await page.goto("about:blank");
}

async function runViewport(browser, vp, viewport, index, composed) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "id-ID" });
  const page = await ctx.newPage();
  try {
    await staticPages(page, vp);
    await ayahDialogs(page, vp);
    await lessonPages(page, vp, index, composed);
  } finally {
    await ctx.close();
  }
}

const t0 = Date.now();
await mkdir("shots", { recursive: true });
const index = await narrationIndex();
const composed = await composedByLesson();
const fixture = await loadFixture(BELAJAR_DIR);
const browser = await chromium.launch();
try {
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[0][1], deviceScaleFactor: 1, locale: "id-ID" });
    try {
      await selfTest(await ctx.newPage(), fixture);
      await inkSelfTest(await ctx.newPage(), await inkFixture());
    } finally {
      await ctx.close();
    }
  }
  // Phone and desktop side by side: two pages of one browser.
  await Promise.all(VIEWPORTS.map(([vp, viewport]) => runViewport(browser, vp, viewport, index, composed)));
} finally {
  await browser.close();
}

await writeFile(REPORT, JSON.stringify({ tally, offenders: all }, null, 2));
console.log(
  `line breaks${SURAHS_ON ? " (every surah listed)" : ""}: ${tally.measures} measures (${SIZES.length} text sizes × ${VIEWPORTS.length} viewports), ${tally.containers} text blocks, ` +
    `${tally.lines} lines, ${tally.units} units, ${tally.glued} kept words, ${tally.flowed} laid out in the flow, ${tally.arabic} inline Arabic runs, ` +
    `${tally.karaoke} karaoke words, ${tally.markers} ayah markers, ${tally.exercises} exercises answered; ink of the marks (${INK_MODE}) on ${tally.inkRuns} boxes of Arabic ` +
    `(${tally.inkTiles} in composition tiles, ${tally.inkInline} inline in a Latin line), ${tally.inkQuotes} quoted glosses in reading order — ${Math.round((Date.now() - t0) / 1000)}s`,
);
if (all.length) {
  for (const o of all.slice(0, MAX_PRINTED))
    console.error(`✗ ${o.kind} · ${o.page} · ${o.viewport} · ${o.size} · ${o.where} · ${o.detail}${o.text ? ` · "${o.text}"` : ""}`);
  if (all.length > MAX_PRINTED) console.error(`  … and ${all.length - MAX_PRINTED} more (${REPORT})`);
  const byKind = Object.entries(all.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {}));
  console.error(`✗ ${all.length} line-break offender(s): ${byKind.map(([k, n]) => `${k} ${n}`).join(", ")} — full list in ${REPORT}`);
  process.exit(1);
}
console.log("✓ no line-break offenders");
