// CI-only: Ilmu Waris end-to-end run against the REAL built image (started by the workflow on
// :3300), docs/waris-plan.md §10:
//   M2.6  three vectors (simple, 'aul, radd) driven through /belajar/id/waris/hitung screen by
//         screen; every data-share of the leading (fikih) column equals the vector's fraction,
//         court cells appear exactly where the columns differ; ZERO non-GET requests and nothing
//         but static assets, /belajar/api/me and the module's own pages (see NETWORK below).
//   M2.9  print: case 3 (driven through the UI, rupiah panel filled) rendered as print media at
//         A4: screenshot, a real Chromium PDF (page count) and the height / A4 estimate; FAIL when
//         case 3 needs more than 3 pages. Every vector the questionnaire can express is loaded
//         through its share link (#j=) and measured; the longest is recorded with its PDF.
//   M2.10 reduced motion: the questionnaire and the report under prefers-reduced-motion, with a
//         check that no animation is running on any screen, and screenshots (artifact).
//   M2.5  (browser half) after ticking the killer option (A3 k6) the storage and the address
//         contain no k6; amounts typed in the rupiah panel never reach storage or the address.
//
// Input: the plan written by scripts/ci/waris-e2e-plan.ts (pure TS, run with tsx in the
// workflow): per case the exact screens, inputs and stepper taps, and the vector's expected
// shares, already checked against the report model there. This script only follows the plan, so a
// screen the UI shows that the model would not (or the reverse) fails here, by name.
//
// Output: ./shots/waris-*.png, ./shots/waris-*.pdf and ./shots/waris-e2e-record.json (heights,
// page counts, screens, network summary). Exits 1 after the whole run when anything failed, so one
// run reports every problem. Usage: node waris-e2e.mjs waris-plan.json
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const ORIGIN = new URL(BASE).origin;
const plan = JSON.parse(await readFile(process.argv[2] ?? "waris-plan.json", "utf8"));
const SHOTS = "shots";
const T = 20_000;

/** A4 at 96 px/in, and waris.css @page { margin: 15mm 14mm } as the fallback when CSSOM has none. */
const PX_PER_MM = 96 / 25.4;
const A4 = { w: 210, h: 297 };
const MARGIN_FALLBACK = { top: 15, right: 14, bottom: 15, left: 14 };
const MAX_CASE3_PAGES = 3;

const problems = [];
const record = { base: BASE, cases: [], print: {}, survey: [], reduceMotion: {}, privacy: {}, network: {}, consoleErrors: [] };

function fail(where, msg) {
  problems.push(`${where}: ${msg}`);
  console.log(`  ✗ ${where}: ${msg}`);
}
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---------------------------------------------------------------------------------------------
// NETWORK (plan §9.4 "E2E check"): fail on any POST (any non-GET), any request body, any other
// origin, and any request other than
//   - static assets under /belajar/_next/,
//   - GET /belajar/api/me (the account chip),
//   - the module's own pages: the documents this script opens, and the App Router's GET fetches
//     of in-module pages (client navigation hitung → laporan and <Link> prefetch, "?_rsc=" only).
// A page fetch carries no answers: they travel in memory, sessionStorage or the URL FRAGMENT,
// which is never sent; every URL and header is also checked for a share token or an amount.
// ---------------------------------------------------------------------------------------------

const PAGE_PATH = /^\/belajar\/(id|en)(\/[A-Za-z0-9._~\-/]*)?$/;
const BROWSER_ICONS = new Set(["/favicon.ico", "/belajar/favicon.ico", "/belajar/apple-icon.png"]);
const secrets = new Set(["j=v1."]);
for (const c of plan.cases) {
  for (const v of Object.values(c.amounts ?? {})) secrets.add(String(v));
  secrets.add(c.token);
  if (c.tokenWithAmounts) secrets.add(c.tokenWithAmounts);
}
const netLog = [];

function classify(req) {
  const raw = req.url();
  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("about:")) return { cls: "inline" };
  const u = new URL(raw);
  // What goes on the wire: Playwright may report a navigation's #fragment, which is never sent.
  const sent = `${u.origin}${u.pathname}${u.search}`;
  if (req.method() !== "GET") return { bad: `${req.method()} request (only GET is allowed)` };
  if (req.postData() !== null) return { bad: "request with a body" };
  if (u.origin !== ORIGIN) return { bad: "request to another origin" };
  // Content-hashed asset names are not searched for amounts (a hex hash may contain "20000000").
  const searchable = u.pathname.startsWith("/belajar/_next/static/") ? u.search : sent;
  for (const s of secrets) if (searchable.includes(s)) return { bad: "URL carries a share token or an amount" };
  if (u.pathname.startsWith("/belajar/_next/")) return { cls: "static" };
  if (u.pathname === "/belajar/api/me") return { cls: "api/me" };
  // The browser's own icon fetches: the site root's guess, and the module's icon links (the main
  // site's favicon set under the basePath since 2026-10-10, src/app/favicon.ico + apple-icon.png).
  if (BROWSER_ICONS.has(u.pathname)) return { cls: "browser" };
  if (PAGE_PATH.test(u.pathname) && [...u.searchParams.keys()].every((k) => k === "_rsc")) {
    return { cls: req.isNavigationRequest() && req.resourceType() === "document" ? "document" : "page-fetch" };
  }
  return { bad: "not a static asset, /belajar/api/me or an in-module page" };
}

function watch(ctx, label) {
  const headerChecks = [];
  ctx.on("request", (req) => {
    const c = classify(req);
    const url = req.url().split("#")[0];
    netLog.push({ run: label, method: req.method(), url, type: req.resourceType(), cls: c.cls ?? "BAD" });
    if (c.bad) fail(`network ${label}`, `${c.bad}: ${req.method()} ${url} (${req.resourceType()})`);
    if (c.cls === "static" || c.cls === "inline") return;
    headerChecks.push(
      req
        .allHeaders()
        .then((h) => {
          for (const [k, v] of Object.entries(h)) for (const s of secrets) if (String(v).includes(s)) fail(`network ${label}`, `header ${k} carries a share token or an amount: ${url}`);
        })
        .catch(() => undefined),
    );
  });
  ctx.on("page", (page) => {
    page.on("websocket", (ws) => fail(`network ${label}`, `WebSocket opened: ${ws.url()}`));
    page.on("pageerror", (e) => fail(`page ${label}`, `uncaught error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") record.consoleErrors.push({ run: label, text: m.text().slice(0, 300) });
    });
  });
  return () => Promise.all(headerChecks);
}

// ---------------------------------------------------------------------------------------------
// Following the plan
// ---------------------------------------------------------------------------------------------

async function describeScreen(page) {
  return page
    .evaluate(() => {
      const h = document.querySelector("#waris-q-heading, #waris-review-heading, #waris-exit-heading, main h2, main h1");
      const names = [...document.querySelectorAll("main input[name]")].map((i) => i.getAttribute("name"));
      const ids = [...document.querySelectorAll('main [id$="-label"]')].map((e) => e.id);
      return `"${h?.textContent?.trim() ?? "(no heading)"}" inputs [${[...new Set(names)].join(", ")}] steppers [${ids.join(", ")}] at ${location.pathname}`;
    })
    .catch((e) => `(page unreadable: ${e.message})`);
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-");

async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage }).catch((e) => console.log(`  (screenshot ${name} failed: ${e.message})`));
  console.log(`  shot ${name}`);
}

async function waitText(locator, want, timeout = 5000) {
  const until = Date.now() + timeout;
  let got = null;
  while (Date.now() < until) {
    got = ((await locator.textContent().catch(() => null)) ?? "").trim();
    if (got === want) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`expected "${want}", found "${got}"`);
}

async function act(page, a) {
  if (a.do === "label") {
    // OptionRow: the native input is visually hidden inside its 56px label; click the label.
    const label = page.locator("label").filter({ has: page.locator(a.input) }).nth(a.nth);
    await label.click();
    const input = label.locator("input");
    const until = Date.now() + 3000;
    while (!(await input.isChecked())) {
      if (Date.now() > until) throw new Error(`${a.input} #${a.nth} did not become checked`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return;
  }
  // Stepper.tsx: [role=group][aria-labelledby=<id>-label] holds "−" then "+"; <output id=<id>-value>.
  // Tap one at a time and re-read, so a tap is never counted twice against a stale value.
  const group = page.locator(`[role="group"][aria-labelledby="${a.id}-label"]`);
  const minus = group.locator("button").first();
  const plus = group.locator("button").last();
  const out = page.locator(`[id="${a.id}-value"]`);
  for (let k = 0; k < 4 * Math.abs(a.to - a.from) + 4; k++) {
    const cur = Number(((await out.textContent()) ?? "").trim());
    if (cur === a.to) return;
    await (cur < a.to ? plus : minus).click();
    await page.waitForFunction(([sel, before]) => document.querySelector(sel)?.textContent?.trim() !== before, [`[id="${a.id}-value"]`, String(cur)], { timeout: 3000 }).catch(() => undefined);
  }
  await waitText(out, String(a.to), 1000);
}

/**
 * Answer every screen of a case from /waris/hitung to the report. `onScreen(i, step)` runs once
 * each question is on screen (before answering). Returns false (after recording why) when the UI
 * left the planned path.
 */
async function answerAll(page, c, where, onScreen) {
  await page.goto(BASE + plan.routes.hitung, { waitUntil: "domcontentloaded" });
  for (const [i, s] of c.steps.entries()) {
    try {
      await page.locator(s.probe).first().waitFor({ state: "attached", timeout: T });
    } catch {
      fail(where, `screen ${i + 1}/${c.steps.length}: the model asks ${s.key} (${s.probe}), the UI shows ${await describeScreen(page)}`);
      await shot(page, `waris-fail-${slug(where)}`);
      return false;
    }
    if (onScreen) await onScreen(i, s);
    try {
      for (const a of s.actions) await act(page, a);
      await page.locator(s.next).click({ timeout: T });
    } catch (e) {
      fail(where, `screen ${i + 1} (${s.key} = ${JSON.stringify(s.value)}): ${e.message.split("\n")[0]}`);
      await shot(page, `waris-fail-${slug(where)}`);
      return false;
    }
  }
  const review = page.locator('section[aria-labelledby="waris-review-heading"]');
  try {
    await review.waitFor({ timeout: T });
  } catch {
    fail(where, `after ${c.steps.length} screens the model shows the review screen, the UI shows ${await describeScreen(page)}`);
    await shot(page, `waris-fail-${slug(where)}`);
    return false;
  }
  if (onScreen) await onScreen(c.steps.length, null);
  await review.locator("button.btn-primary").click();
  try {
    await page.waitForURL(/\/waris\/laporan/, { timeout: T });
    await page.locator("[data-share]").first().waitFor({ state: "attached", timeout: T });
  } catch {
    fail(where, `"Lihat rekomendasi pembagian" did not open a report with shares: ${await describeScreen(page)}`);
    await shot(page, `waris-fail-${slug(where)}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Report checks
// ---------------------------------------------------------------------------------------------

async function checkShares(page, ex, where) {
  const cells = await page.$$eval("[data-share]", (els) =>
    els.map((e) => ({ share: e.getAttribute("data-share"), column: e.getAttribute("data-column"), heir: e.getAttribute("data-heir") })),
  );
  let bad = 0;
  const fikih = cells.filter((x) => x.column === "fikih");
  if (fikih.length === 0) {
    fail(where, "no fikih data-share cell: the fikih column must lead (D2 = A)");
    return false;
  }
  const seen = new Set();
  for (const x of fikih) {
    seen.add(x.heir);
    const want = ex.fikih[x.heir] ?? "0";
    if (x.share !== want) {
      bad++;
      fail(where, `fikih ${x.heir}: data-share ${x.share}, vector ${want}`);
    }
  }
  for (const [h, want] of Object.entries(ex.fikih)) {
    if (!seen.has(h)) {
      bad++;
      fail(where, `fikih ${h}: no data-share cell (vector ${want})`);
    }
  }
  const other = cells.filter((x) => x.column !== "fikih");
  if (ex.court) {
    const got = Object.fromEntries(other.map((x) => [x.heir, x.share]));
    for (const h of new Set([...Object.keys(got), ...Object.keys(ex.court)])) {
      if (got[h] !== ex.court[h]) {
        bad++;
        fail(where, `court ${h}: ${got[h] ?? "(no cell)"}, vector ${ex.court[h] ?? "(same as fikih: no cell)"}`);
      }
    }
  }
  if (ex.rupiah) {
    for (const [h, want] of Object.entries(ex.rupiah)) {
      const row = page.locator(`tr:has([data-share][data-column="fikih"][data-heir="${h}"])`).first();
      const text = (await row.innerText().catch(() => "")).replace(/\s+/g, " ");
      if (!text.includes(want)) {
        bad++;
        fail(where, `rupiah ${h}: row reads "${text.slice(0, 160)}", vector ${want}`);
      }
    }
  }
  return bad === 0;
}

/** The mandatory labels, and no promise of an ustadz review, in the client-rendered <main>. */
async function checkLabels(page, where) {
  const main = await page.locator("main").innerText();
  for (const s of [plan.text.chip, plan.text.label, "bukan fatwa"]) if (!main.includes(s)) fail(where, `<main> lacks "${s}"`);
  const lower = main.toLowerCase();
  for (const f of plan.text.forbidden) if (lower.includes(f)) fail(where, `<main> contains the forbidden "${f}" (no ustadz review exists, plan §2 Decisions)`);
}

async function storageDump(page) {
  return page.evaluate(() => {
    const dump = (s) => {
      const o = {};
      for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i));
      return o;
    };
    return { session: dump(window.sessionStorage), local: dump(window.localStorage), href: window.location.href };
  });
}

// ---------------------------------------------------------------------------------------------
// Print measurement (waris.css: A4 portrait, margin 15mm 14mm)
// ---------------------------------------------------------------------------------------------

/** @page margins from the CSSOM (mm), falling back to waris.css's values. */
async function pageMarginsMm(page) {
  const m = await page.evaluate(() => {
    const toMm = (v) => {
      const x = /^(-?[\d.]+)(mm|cm|in|pt|px)$/.exec((v ?? "").trim());
      if (!x) return null;
      const n = Number(x[1]);
      return { mm: n, cm: n * 10, in: n * 25.4, pt: (n * 25.4) / 72, px: (n * 25.4) / 96 }[x[2]];
    };
    const walk = (rules) => {
      for (const r of rules) {
        if (r.type === CSSRule.PAGE_RULE) {
          const s = r.style;
          return { top: toMm(s.marginTop), right: toMm(s.marginRight), bottom: toMm(s.marginBottom), left: toMm(s.marginLeft) };
        }
        if (r.cssRules) {
          const hit = walk(r.cssRules);
          if (hit) return hit;
        }
      }
      return null;
    };
    for (const sheet of document.styleSheets) {
      try {
        const hit = walk(sheet.cssRules);
        if (hit) return hit;
      } catch {
        /* cross-origin sheet */
      }
    }
    return null;
  });
  return m && [m.top, m.right, m.bottom, m.left].every((x) => typeof x === "number") ? m : MARGIN_FALLBACK;
}

/** Print media at the printable A4 width; returns height and the height / A4 estimate. */
async function measurePrint(page) {
  const mm = await pageMarginsMm(page);
  const width = Math.round((A4.w - mm.left - mm.right) * PX_PER_MM);
  const pageHeight = (A4.h - mm.top - mm.bottom) * PX_PER_MM;
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width, height: Math.round(pageHeight) });
  // The report opens every disclosure on beforeprint (WarisReport.tsx); emulation alone does not fire it.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  return { width, height, pageHeight: Math.round(pageHeight), estimate: Math.round((height / pageHeight) * 100) / 100, marginsMm: mm };
}

/** A real Chromium print (the same engine as "Simpan sebagai PDF"): page count. */
async function printPdf(page, name) {
  try {
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await writeFile(`${SHOTS}/${name}.pdf`, pdf);
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    console.log(`  pdf ${name}: ${pages} page(s)`);
    return pages > 0 ? pages : null;
  } catch (e) {
    console.log(`  (pdf ${name} failed: ${e.message.split("\n")[0]})`);
    return null;
  }
}

/** Animations still running (CSS ones under the reduce override last 0.01 ms, so > 1 ms counts). */
async function runningAnimations(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const t = a.effect?.getComputedTiming?.();
        const el = a.effect?.target;
        return {
          kind: a.constructor.name,
          name: a.animationName ?? a.transitionProperty ?? "",
          duration: typeof t?.duration === "number" ? t.duration : null,
          target: el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}` : "",
        };
      })
      .filter((a) => a.duration !== null && a.duration > 1),
  );
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

await mkdir(SHOTS, { recursive: true });
const byName = Object.fromEntries(plan.cases.map((c) => [c.name, c]));
const settle = [];
const browser = await chromium.launch();

async function openRun(label, options) {
  const ctx = await browser.newContext({ locale: "id-ID", ...options });
  settle.push(watch(ctx, label));
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  return { ctx, page };
}

try {
  // ── M2.6: three vectors through the questionnaire, phone width ────────────────────────────
  for (const name of ["sederhana", "aul", "radd"]) {
    const c = byName[name];
    if (!c) {
      fail(`e2e ${name}`, "missing from the plan");
      continue;
    }
    console.log(`\n== M2.6 ${name}: ${c.vector}, ${c.steps.length} screens — ${c.why}`);
    const before = problems.length;
    const { ctx, page } = await openRun(`e2e-${name}`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    if (await answerAll(page, c, `e2e ${name}`)) {
      ok(`${name}: the UI asked exactly the model's ${c.steps.length} screens (${c.steps.map((s) => s.key).join(" → ")})`);
      if (await checkShares(page, c.expect, `e2e ${name}`)) {
        ok(`${name}: every fikih data-share equals the vector (${Object.entries(c.expect.fikih).map(([h, f]) => `${h} ${f}`).join(", ")}); court cells as expected`);
      }
      await checkLabels(page, `e2e ${name}`);
      const store = JSON.stringify(await storageDump(page));
      if (store.includes("k6")) fail(`privacy ${name}`, "storage or the address mentions k6");
      await shot(page, `waris-phone-laporan-${name}`);
    }
    record.cases.push({ name, vector: c.vector, screens: c.steps.length, path: c.steps.map((s) => s.key), passed: problems.length === before });
    await ctx.close();
  }

  // ── M2.9: case 3 through the UI, rupiah panel filled, then printed ────────────────────────
  const c3 = byName.kasus3;
  if (!c3) fail("print kasus3", "missing from the plan");
  else {
    console.log(`\n== M2.9 case 3: ${c3.vector}, ${c3.steps.length} screens — ${c3.why}`);
    const before = problems.length;
    const { ctx, page } = await openRun("kasus3", { viewport: { width: 1280, height: 900 } });
    // Control for the reduced-motion check: with normal motion the family tree does animate.
    const control = [];
    const reached = await answerAll(page, c3, "kasus3", async (_i, s) => {
      control.push({ screen: s?.key ?? "ringkasan", running: (await runningAnimations(page)).length });
    });
    record.reduceMotion.control = control;
    if (reached) {
      await checkShares(page, c3.expect, "kasus3 fractions");
      await checkLabels(page, "kasus3");
      // RupiahPanel.tsx: open "Isi nilai harta", type the case's amounts, "Hitung dalam rupiah".
      const panel = page.locator("#rupiah");
      try {
        await panel.locator("summary").first().click();
        await panel.locator("details[open]").waitFor({ timeout: T });
        for (const [field, amount] of Object.entries(c3.amounts ?? {})) {
          const input = panel.locator(`input[id$="-${field}"]`);
          if ((await input.count()) === 0) {
            fail("kasus3", `the rupiah panel has no ${field} field`);
            continue;
          }
          await input.fill(amount);
        }
        await panel.getByRole("button", { name: plan.text.rpHitung, exact: true }).click();
        const first = Object.entries(c3.expectWithAmounts.rupiah)[0];
        await page
          .locator(`tr:has([data-share][data-column="fikih"][data-heir="${first[0]}"])`)
          .filter({ hasText: first[1] })
          .first()
          .waitFor({ timeout: T });
        if (await checkShares(page, c3.expectWithAmounts, "kasus3 rupiah")) {
          ok(`case 3: fractions and rupiah equal the vector (${Object.entries(c3.expectWithAmounts.rupiah).map(([h, r]) => `${h} ${r}`).join(", ")})`);
        }
      } catch (e) {
        fail("kasus3", `rupiah panel: ${e.message.split("\n")[0]}`);
      }
      // M2.5: amounts stay in the page's memory: never in storage, never in the address.
      const store = JSON.stringify(await storageDump(page));
      const leaked = Object.values(c3.amounts ?? {}).filter((v) => store.includes(v));
      record.privacy.amountsInStorage = leaked;
      if (leaked.length > 0) fail("privacy kasus3", `amounts in storage or the address: ${leaked.join(", ")}`);
      else ok("case 3: no amount in sessionStorage, localStorage or the address");
      await shot(page, "waris-desktop-laporan-kasus3");

      const m = await measurePrint(page);
      await shot(page, "waris-print-kasus3");
      const pdfPages = await printPdf(page, "waris-print-kasus3");
      const pages = pdfPages ?? Math.ceil(m.estimate);
      record.print.kasus3 = { vector: c3.vector, withRupiah: true, ...m, pdfPages, pages, limit: MAX_CASE3_PAGES };
      const line = `case 3 prints on ${pages} A4 page(s): PDF ${pdfPages ?? "n/a"}, estimate ${m.estimate} (${m.height}px / ${m.pageHeight}px at ${m.width}px)`;
      if (pages > MAX_CASE3_PAGES) fail("print kasus3", `${line}; the target is ≤ ${MAX_CASE3_PAGES} (plan §6, M2.9)`);
      else ok(line);
      await page.emulateMedia({ media: "screen" });
    }
    record.cases.push({ name: "kasus3", vector: c3.vector, screens: c3.steps.length, path: c3.steps.map((s) => s.key), passed: problems.length === before });
    await ctx.close();
  }

  // ── Share links (#j=) for every expressible vector + the print-length survey ──────────────
  {
    const { ctx, page } = await openRun("share-links", {});
    const inCases = new Set(plan.cases.map((c) => c.vector));
    const items = [
      ...plan.cases.map((c) => ({ id: c.vector, token: c.token, expect: c.expect })),
      ...plan.cases.filter((c) => c.tokenWithAmounts).map((c) => ({ id: `${c.vector} (+rupiah)`, token: c.tokenWithAmounts, expect: c.expectWithAmounts })),
      ...plan.survey.filter((s) => !inCases.has(s.vector)).map((s) => ({ id: s.vector, token: s.token, expect: s.expect })),
    ];
    console.log(`\n== Share links + print-length survey: ${items.length} reports from #j= links`);
    let passed = 0;
    for (const it of items) {
      const where = `link ${it.id}`;
      const before = problems.length;
      try {
        await page.goto("about:blank");
        await page.emulateMedia({ media: "screen" });
        await page.goto(`${BASE}${plan.routes.laporan}#j=${it.token}`, { waitUntil: "load" });
        await page.locator("[data-share]").first().waitFor({ state: "attached", timeout: T });
      } catch {
        fail(where, `no report with shares: ${await describeScreen(page)}`);
        continue;
      }
      await checkShares(page, it.expect, where);
      const m = await measurePrint(page);
      record.survey.push({ vector: it.id, token: it.token, height: m.height, estimate: m.estimate, passed: problems.length === before });
      if (problems.length === before) passed++;
    }
    if (passed === items.length) ok(`all ${items.length} share-link reports show the vector's fikih shares (and court cells where they differ)`);
    else console.log(`  ${passed}/${items.length} share-link reports passed`);

    const longest = [...record.survey].sort((a, b) => b.height - a.height)[0];
    if (longest) {
      await page.goto("about:blank");
      await page.emulateMedia({ media: "screen" });
      await page.goto(`${BASE}${plan.routes.laporan}#j=${longest.token}`, { waitUntil: "load" });
      await page.locator("[data-share]").first().waitFor({ state: "attached", timeout: T });
      const m = await measurePrint(page);
      await shot(page, "waris-print-longest");
      const pdfPages = await printPdf(page, "waris-print-longest");
      record.print.longest = { vector: longest.vector, ...m, pdfPages };
      ok(`longest report in the vector set: ${longest.vector}, ${m.height}px in print = estimate ${m.estimate} A4 pages, PDF ${pdfPages ?? "n/a"} (recorded, no limit)`);
    }
    await ctx.close();
  }

  // ── M2.10: reduced motion, questionnaire + report ─────────────────────────────────────────
  {
    const c = byName.aul ?? plan.cases[0];
    console.log(`\n== M2.10 reduced motion: ${c.vector} through the questionnaire`);
    const { ctx, page } = await openRun("reduce", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const animated = [];
    const reached = await answerAll(page, c, "reduce", async (i, s) => {
      const r = await runningAnimations(page);
      if (r.length > 0) animated.push({ screen: s?.key ?? "ringkasan", running: r });
      if (i === 0) await shot(page, "waris-reduce-hitung-awal", false);
      else if (s === null) await shot(page, "waris-reduce-hitung-ringkasan");
      else if (i === c.steps.length - 1) await shot(page, "waris-reduce-hitung-pohon");
    });
    if (reached) {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const r = await runningAnimations(page);
      if (r.length > 0) animated.push({ screen: "laporan", running: r });
      await shot(page, "waris-reduce-laporan");
    }
    for (const a of animated) fail("reduced motion", `${a.screen}: ${a.running.length} animation(s) still running: ${JSON.stringify(a.running).slice(0, 240)}`);
    if (reached && animated.length === 0) ok(`no animation running on any of ${c.steps.length + 2} screens under prefers-reduced-motion (final frames only)`);
    const seen = (record.reduceMotion.control ?? []).filter((x) => x.running > 0).length;
    if (seen === 0) console.log("  note: the normal-motion control saw no running animation either; the check above may not see the tree animation");
    else ok(`control: with normal motion, animations were running on ${seen} screen(s), so the check can see them`);
    record.reduceMotion = { ...record.reduceMotion, vector: c.vector, animated, reached };
    await ctx.close();
  }

  // ── M2.5 (browser half): the killer option leaves no trace ────────────────────────────────
  {
    const c = plan.cases[0];
    console.log("\n== M2.5 the killer answer (A3 k6) is never stored");
    const { ctx, page } = await openRun("k6", { viewport: { width: 390, height: 844 } });
    const [a1, a2, a3] = c.steps;
    if (!a1 || !a2 || !a3 || a1.key !== "A1" || a2.key !== "A2" || a3.key !== "A3") fail("k6", "the plan does not start A1 → A2 → A3");
    else {
      try {
        await page.goto(BASE + plan.routes.hitung, { waitUntil: "domcontentloaded" });
        for (const s of [a1, a2]) {
          await page.locator(s.probe).first().waitFor({ state: "attached" });
          for (const a of s.actions) await act(page, a);
          await page.locator(s.next).click();
        }
        await page.locator(a3.probe).first().waitFor({ state: "attached" });
        await act(page, { do: "label", input: 'input[type="checkbox"][name="A3-k6"]', nth: 0 });
        await page.locator(a3.next).click();
        await page.locator('section[aria-labelledby="waris-exit-heading"]').waitFor();
        const store = await storageDump(page);
        record.privacy.afterK6 = store;
        if (JSON.stringify(store).includes("k6")) fail("privacy k6", `k6 found: ${JSON.stringify(store)}`);
        else ok("after k6: the E-BUNUH page shows and neither storage nor the address holds k6");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(a3.probe).first().waitFor({ state: "attached" });
        if (await page.locator('input[type="checkbox"][name="A3-k6"]').isChecked()) fail("privacy k6", "k6 is ticked again after a reload");
        else ok("after a reload the questionnaire resumes at A3 with k6 not ticked");
      } catch (e) {
        fail("k6", e.message.split("\n")[0]);
        await shot(page, "waris-fail-k6");
      }
    }
    await ctx.close();
  }
} finally {
  await Promise.all(settle.map((f) => f()));
  await browser.close();
}

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------

const byClass = {};
for (const n of netLog) byClass[n.cls] = (byClass[n.cls] ?? 0) + 1;
const pageFetches = [...new Set(netLog.filter((n) => n.cls === "page-fetch" || n.cls === "document").map((n) => `${n.cls} ${n.url.split("?")[0]}`))].sort();
record.network = { total: netLog.length, byClass, nonGet: netLog.filter((n) => n.method !== "GET").length, pages: pageFetches };
console.log(`\n== Network: ${netLog.length} requests ${JSON.stringify(byClass)}; non-GET ${record.network.nonGet}`);
for (const p of pageFetches) console.log(`   ${p}`);
if (record.network.nonGet === 0) ok("zero POST (zero non-GET) requests in every run");
if (record.consoleErrors.length > 0) {
  console.log(`\n== Console errors (recorded, not failed): ${record.consoleErrors.length}`);
  for (const e of record.consoleErrors.slice(0, 20)) console.log(`   [${e.run}] ${e.text}`);
}
record.problems = problems;
await writeFile(`${SHOTS}/waris-e2e-record.json`, `${JSON.stringify(record, null, 2)}\n`);

if (problems.length > 0) {
  console.log(`\n✗ waris e2e: ${problems.length} problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\n✓ waris e2e: all checks passed");
