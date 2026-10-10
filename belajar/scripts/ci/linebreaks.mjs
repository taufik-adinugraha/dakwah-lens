// CI-only: where Chromium REALLY breaks the lines of the real image (operator, 2026-10-10: "make
// sure the line break is clean and easy to read, sometime i see wrong line break especially for
// arabic words"). Started by the workflow against a container on :3300, like screenshots.mjs.
//
// Every page a learner reaches by its links — the hub, the track, each surah and ayah it links
// (every ayah closed, then with every disclosure open), the Konsep index and every concept, every
// Kosakata entry linked from those — and the autoplay lesson stage step by step (Al-Fatihah 1 with
// its narration, so the KARAOKE caption; Al-Fatihah 2 and 7 caption-only), each kind of exercise
// answered once (a wrong pick, then the answer or "Tunjukkan jawaban") so its feedback is laid out
// too, on a phone (390) and a desktop (1280), each at the three text sizes (Normal, Besar, Sangat
// besar). In the page it takes the box of every character (Range.getClientRects), groups them into
// the lines the browser drew, and reports each bad seam (the "offenders", kinds below), printed
// one per line and written to shots/linebreaks.json (uploaded with the screenshots). Any offender
// fails the step.
//
//   term-split           "huruf jar ⏎ (حَرْف جَرّ)" — a term and its Arabic on two lines; also an
//                        Arabic word and the gloss after it, "«مَلِكِ» ⏎ (raja)"
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
//
// Before the real run, a self-test lays out linebreaks-fixture.html in a real page: one known-bad
// case of every kind must be caught, the markup as it ships must not be, and a unit wider than its
// line must break in the paragraph's flow, the words around it sharing its lines.
//
// Every page call is page.evaluate / locator.evaluateAll with a FUNCTION (CDP callFunctionOn):
// never page.waitForFunction, whose predicate Playwright runs through eval, which the module's CSP
// (no 'unsafe-eval') refuses. Waits are locator waits, fixed timeouts, or animation frames awaited
// inside page.evaluate.
import { mkdir, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

// The in-page measurement (tested in linebreaks-measure.test.mjs), the self-test fixture and the
// routed narration audio shared with screenshots.mjs; the workflow copies them next to this script.
import { loadFixture } from "./linebreaks-fixture.mjs";
import { KINDS, measure } from "./linebreaks-measure.mjs";
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
const LESSONS = [
  ["/belajar/id/quran/al-fatihah/1", true],
  ["/belajar/id/quran/al-fatihah/2", false],
  ["/belajar/id/quran/al-fatihah/7", false],
];
const MAX_PRINTED = 600;
/** Pages also shot at each size: the surah page (its "Tahukah Anda?" facts hold the longest
 *  inline Arabic) and an ayah page with every disclosure open (word cards, Rujukan). */
const SHOTS = { "surah al-fatihah": "surah", "ayah al-fatihah/2 (open)": "ayah-2-open" };
const SURAH_PATH = /^\/belajar\/id\/quran\/[^/]+$/;
const AYAH_PATH = /^\/belajar\/id\/quran\/[^/]+\/\d+$/;

// ───────────────────────────── Node side ─────────────────────────────

const all = [];
const tally = { measures: 0, containers: 0, lines: 0, units: 0, glued: 0, flowed: 0, arabic: 0, karaoke: 0, markers: 0, exercises: 0 };
const record = (o) => all.push(o);

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
 *  shot is at the Normal size only. */
async function measureAllSizes(page, vp, label, scope = null, shot = null) {
  for (const size of SIZES) {
    await setSize(page, size);
    const { counts, offenders } = await page.evaluate(measure, { scope });
    tally.measures++;
    for (const k of Object.keys(counts)) tally[k] += counts[k];
    if (counts.containers === 0) offenders.push({ kind: "nothing-measured", where: scope ?? "body", detail: "no text found", text: "" });
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

/** The pages a learner reaches by links: the hub, the track, every surah and ayah the track and
 *  surah pages link (a surah behind a runtime switch is not linked, so not visited), the Konsep
 *  index and every concept, then every Kosakata entry those pages link. */
async function staticPages(page, vp) {
  const pages = [
    ["hub", "/belajar/id"],
    ["track", "/belajar/id/quran"],
  ];
  const surahs = [];
  const ayat = new Set();
  if (await open(page, vp, "/belajar/id/quran"))
    for (const p of await paths(page, 'main a[href*="/quran/"]')) {
      if (SURAH_PATH.test(p)) surahs.push(p);
      else if (AYAH_PATH.test(p)) ayat.add(p);
    }
  for (const s of surahs) {
    if (!(await open(page, vp, s))) continue;
    for (const p of await paths(page, 'main a[href*="/quran/"]')) if (AYAH_PATH.test(p)) ayat.add(p);
  }
  const byAyah = (a, b) => {
    const [sa, na] = a.split("/").slice(-2);
    const [sb, nb] = b.split("/").slice(-2);
    return surahs.findIndex((s) => s.endsWith(`/${sa}`)) - surahs.findIndex((s) => s.endsWith(`/${sb}`)) || Number(na) - Number(nb);
  };
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
 *  plays and the KARAOKE caption shows (routed narration, as in screenshots.mjs). */
async function lessonPages(page, vp, index) {
  const answered = new Set();
  for (const [urlPath, narrated] of LESSONS) {
    const served = [];
    const handler = narrationRoute(index, served);
    if (narrated) await page.route(isNarration, handler);
    let karaoke = 0;
    let cards = 0;
    let steps = 0;
    try {
      if (!(await open(page, vp, urlPath))) continue;
      await measureAllSizes(page, vp, `${urlPath} before Mulai`, STAGE);
      await press(page.locator('[data-autoplay="start"]'));
      await page.locator('[data-autoplay="step"]').first().waitFor({ state: "visible", timeout: 10_000 });
      const start = page.url();
      for (let guard = 0; guard < 60; guard++) {
        await page.waitForTimeout(300);
        if (page.url() !== start) break;
        const at = await stepOf(page);
        if (!at) break;
        let shot = null;
        if (narrated) {
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
        await measureAllSizes(page, vp, `${urlPath} step ${at[0]}/${at[1]}`, STAGE, shot);
        steps++;
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
        await press(page.locator('[data-autoplay="next"]'));
      }
    } catch (e) {
      record({ page: urlPath, viewport: vp, size: "-", kind: "check-error", where: "stage", detail: String(e?.stack ?? e), text: "" });
    } finally {
      if (narrated) await page.unroute(isNarration, handler);
    }
    console.log(`  ${vp}: ${urlPath} — ${steps} steps measured${narrated ? `, karaoke on ${karaoke}` : ""}`);
    if (steps === 0) record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "stage", detail: "no lesson step was measured", text: "" });
    // Not vacuous: the narrated ayah must have shown its karaoke words.
    if (narrated && karaoke === 0)
      record({ page: urlPath, viewport: vp, size: "-", kind: "nothing-measured", where: "caption", detail: "the karaoke caption never showed", text: "" });
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
  await page.evaluate((html) => {
    const box = document.createElement("div");
    box.id = "lb-selftest";
    box.innerHTML = html;
    // The page scrolls sideways while this one is in: measured on its own, last.
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

  const cases = await page.locator("#lb-selftest > [data-case]").evaluateAll((els) =>
    els.map((el) => ({ name: el.getAttribute("data-case"), expect: (el.getAttribute("data-expect") ?? "").split(/\s+/).filter(Boolean) })),
  );
  const failures = [];
  const caught = new Set();
  const run = async (c) => {
    const { offenders } = await page.evaluate(measure, { scope: `#lb-selftest [data-case="${c.name}"]` });
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
  // Last, the page that scrolls sideways.
  await page.evaluate(() => {
    document.getElementById("lb-selftest").append(window.__lbWide);
    return true;
  });
  await run({ name: "page-overflow", expect: ["page-overflow"] });
  await page.evaluate(() => {
    document.querySelector('#lb-selftest [data-case="page-overflow"]')?.remove();
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

async function runViewport(browser, vp, viewport, index) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "id-ID" });
  const page = await ctx.newPage();
  try {
    await staticPages(page, vp);
    await lessonPages(page, vp, index);
  } finally {
    await ctx.close();
  }
}

const t0 = Date.now();
await mkdir("shots", { recursive: true });
const index = await narrationIndex();
const fixture = await loadFixture(BELAJAR_DIR);
const browser = await chromium.launch();
try {
  {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[0][1], deviceScaleFactor: 1, locale: "id-ID" });
    try {
      await selfTest(await ctx.newPage(), fixture);
    } finally {
      await ctx.close();
    }
  }
  // Phone and desktop side by side: two pages of one browser.
  await Promise.all(VIEWPORTS.map(([vp, viewport]) => runViewport(browser, vp, viewport, index)));
} finally {
  await browser.close();
}

await writeFile(REPORT, JSON.stringify({ tally, offenders: all }, null, 2));
console.log(
  `line breaks${SURAHS_ON ? " (every surah listed)" : ""}: ${tally.measures} measures (${SIZES.length} text sizes × ${VIEWPORTS.length} viewports), ${tally.containers} text blocks, ` +
    `${tally.lines} lines, ${tally.units} units, ${tally.glued} kept words, ${tally.flowed} laid out in the flow, ${tally.arabic} inline Arabic runs, ` +
    `${tally.karaoke} karaoke words, ${tally.markers} ayah markers, ${tally.exercises} exercises answered — ${Math.round((Date.now() - t0) / 1000)}s`,
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
