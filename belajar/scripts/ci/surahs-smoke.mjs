// CI-only: smoke checks of the Qur'an track's surah switch on the REAL image (the workflow starts
// it on :3300). BELAJAR_SURAHS (operator, 2026-10-10: "let's focus on alfatihah first, show cards
// for other surah as 'segera hadir', but not clickable"; src/lib/features.ts, docs/belajar-plan.md
// L14) lists the published surahs; unset, as in production, only Al-Fatihah.
//
// CI runs this twice, on two containers of the same image:
//   - `--hidden`, on the production-like container (no BELAJAR_SURAHS): checkHidden() below;
//   - no flag, on a container started with every surah listed: checkShown().
//
// Both also read the curriculum page (/quran/kurikulum; docs/belajar-plan.md L30), which NAMES
// every unit of the basic curriculum, the hidden surahs and Ayat Kursi too: curriculumPage()
// below holds it to content/curriculum.json and to the switch — a lesson is a link only when its
// surah is published, every other lesson is plain text marked "Belum tersedia", and nothing on
// the page, rendered or in the RSC payload, leads into a hidden surah.
//
// And the cheat sheet (/quran/rumus, "Rumus singkat"; plan L32), which lists every STEP of that
// curriculum: rumusPage() holds it to content/rumus.json and to the switch — a step of an
// available lesson shows its formula (or says it has none), every other step is named and marked
// "Belum tersedia", and no byte of a hidden surah's formula, quoted sentence or example link is in
// the response, rendered or in the RSC payload.
//
// Text checks read the VISIBLE text: <script>, <style> and <template> bodies are removed first,
// because next-intl serialises the whole message catalogue ("Segera hadir" included) into every
// page's scripts. Link checks read the whole response: an <a href="/belajar/id/quran/al-ikhlas">,
// or the path in the RSC payload, "/quran/al-ikhlas" as the code writes it (lib/routes.ts) or
// "/id/quran/al-ikhlas" as next-intl's Link hands it to the client <BaseLink>.
//
// Every problem is listed, then the script exits 1. Node 20+ (global fetch), no dependencies.
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const BELAJAR = new URL("../../", import.meta.url);
const readText = (rel) => readFile(new URL(rel, BELAJAR), "utf8");
const readJson = async (rel) => JSON.parse(await readText(rel));

const problems = [];
const fail = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.log(`✗ ${where}: ${msg}`);
};

// The lesson list has one home (lib/routes.ts); read it rather than retype it.
const routesSrc = await readText("src/lib/routes.ts");
const SLUGS = [...(/export const SURAH_SLUGS = \[([^\]]*)\]/.exec(routesSrc)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (SLUGS.length < 2) fail("setup", "could not read SURAH_SLUGS from src/lib/routes.ts");
/** The production default (lib/features.ts DEFAULT_SURAHS). */
const DEFAULT = ["al-fatihah"];
const MUAWWIDZAT = ["al-ikhlas", "al-falaq", "an-nas"];

const SURAH = Object.fromEntries(await Promise.all(SLUGS.map(async (slug) => [slug, await readJson(`content/${slug}.json`)])));
const BY_NUMBER = Object.fromEntries(SLUGS.map((slug) => [SURAH[slug].surah, slug]));
const LIBRARY = await readJson("content/library.json");
const CURRICULUM = await readJson("content/curriculum.json");
const RUMUS = await readJson("content/rumus.json");
// LESSON ZERO ("Pengantar", src/lib/routes.ts introHref): the surah that hosts it is the one whose
// harakat primer is played there (content/compose/<slug>.json `primer.lesson` "0"; src/lib/
// curriculum.ts ZERO_HOST), and its page may be linked only while that surah is published
// (introOpen: the one gate of its card on the track page and its row on the curriculum page).
const INTRO_SEGMENT = /export const INTRO_SEGMENT = "([^"]+)"/.exec(routesSrc)?.[1];
if (!INTRO_SEGMENT) fail("setup", "could not read INTRO_SEGMENT from src/lib/routes.ts");
const ZERO_HOST =
  (await Promise.all(SLUGS.map(async (slug) => [slug, await readJson(`content/compose/${slug}.json`).catch(() => null)]))).find(([, c]) => c?.primer?.lesson === "0")?.[0] ?? null;
const MSG = { id: await readJson("messages/id.json"), en: await readJson("messages/en.json") };
const fmt = (template, values) => template.replace(/\{(\w+)\}/g, (all, k) => (k in values ? String(values[k]) : all));

// The curriculum's units that are no surah of the module (today Ayat Kursi, 2:255): listed as
// "Segera hadir" on the hub (by their short name, a pill) and on the track page (a card named
// "Ayat Kursi (Al-Baqarah: 255)"), whatever surahs are published (operator 2026-10-14). Read
// from the curriculum file and the ayat data, never typed; src/lib/comingUnits.ts is the app's.
const AYAT_NAMES = (await readJson("content/ayat/locations.json")).names;
const COMING_UNITS = CURRICULUM.units
  .filter((u) => u.surah !== undefined && !(u.surah in BY_NUMBER))
  .map((u) => ({ id: u.id, name: u.name, surah: u.surah, ayah: u.ayah ?? null }));
const unitLabel = (locale, u) =>
  AYAT_NAMES[String(u.surah)] && u.ayah !== null ? fmt(MSG[locale].Quran.coming_unit, { name: u.name, surah: AYAT_NAMES[String(u.surah)], ayah: u.ayah }) : u.name;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, " ");
}
const mainOf = (html) => /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? "";
/**
 * The module's own 404 page (src/app/[locale]/not-found.tsx) answered: its title in the visible
 * server HTML, or its `data-not-found` marker anywhere in the response. Next sends this page in
 * the RSC payload, not as server HTML (CI 2026-10-11: every hidden URL answered 404, yet its title
 * was in no visible text), and it serialises the locale layout's not-found boundary there; no
 * message carries the marker, so the next-intl messages payload (which holds the title on every
 * page) cannot pass this. With the 404 status checked beside it, the marker says the module's
 * page answered, not Next's bare default 404; that the browser draws its title is checked on the
 * real page by screenshots.mjs (the hidden surah's 404 shot).
 */
const moduleNotFound = (locale, html) => visibleText(html).includes(MSG[locale].NotFound.title) || html.includes("data-not-found");
const count = (text, s) => text.split(s).length - 1;

/** A link into surah `slug`'s lesson pages, rendered or in the RSC payload (see the top). */
const linkInto = (slug) => new RegExp(`(?:/belajar|\\\\?")/(?:(?:id|en)/)?quran/${slug}(?![A-Za-z0-9-])`);
function noLinkInto(where, html, slugs) {
  for (const slug of slugs) {
    const hit = linkInto(slug).exec(html);
    if (hit) fail(where, `links into the hidden ${slug}: "…${html.slice(Math.max(0, hit.index - 60), hit.index + 40)}…"`);
  }
}

/**
 * The fact cards' location chips open the ayah in a popup (operator 2026-10-12: they opened
 * quran.com in a new tab or app): a surah or lesson page links nowhere on quran.com, and every
 * place its fact cards locate (the surah page: all its facts; an ayah page: the facts of that
 * ayah) is a chip BUTTON in the server HTML. Pages of a hidden surah are not checked (they 404).
 */
function chipsNotLinks(where, html, slug, ayah = null) {
  if (/href="https?:\/\/(?:www\.)?quran\.com\//.test(html)) fail(where, "links to quran.com (the fact cards' chips open the ayah in a popup)");
  const s = SURAH[slug];
  const facts = s.facts.filter((f) => ayah === null || f.locations.includes(`${s.surah}:${ayah}`));
  const want = new Set(facts.flatMap((f) => f.locations));
  const chips = new Set([...html.matchAll(/<button\b[^>]*\bdata-ayah-chip="([^"]+)"/g)].map((m) => m[1]));
  const missing = [...want].filter((l) => !chips.has(l));
  if (missing.length) fail(where, `${missing.length} fact location(s) without a chip button (${missing.slice(0, 3).join(", ")}…)`);
  return want.size;
}

/**
 * ONE imam everywhere, and no reciter setting (operator 2026-10-13: "better to use alafasy for all?
 * no need to give option to user to change"; docs/belajar-plan.md L21). Read from the WHOLE
 * response of a lesson's ayah page — server HTML, RSC payload and the message catalogue next-intl
 * puts into every page's scripts:
 *   - the content gives the ayah exactly one recitation, our copy of Mishary Alafasy's EveryAyah
 *     file (since 2026-10-15), and the page carries that address (what the stage plays) and no
 *     other reciter's recording;
 *   - nothing names the reciter the lessons carried beside him until that day (Husary Mu'allim):
 *     no option, no note, no message, no recording;
 *   - the page has no dropdown (the reciter choice was the module's only <select>) and the stage
 *     no reciter attribute.
 * That the "⚙ Pengaturan" panel as a browser draws it offers no such choice is checked by
 * screenshots.mjs (autoplayShots). Returns 1 when the page was checked.
 */
const IMAM = "Alafasy_128kbps";
function oneImam(where, html, slug, ayah) {
  const a = SURAH[slug].ayat.find((x) => x.ayah === ayah);
  const recs = a?.recitation ?? [];
  // Our unaltered copy of the imam's EveryAyah file (operator 2026-10-15; pipeline/host_media.py).
  const want = `/belajar/media/narration/alafasy/${String(SURAH[slug].surah).padStart(3, "0")}${String(ayah).padStart(3, "0")}.mp3`;
  if (recs.length !== 1 || recs[0].reciter !== IMAM || recs[0].url !== want) {
    fail(where, `content/${slug}.json gives ayah ${ayah} ${JSON.stringify(recs.map((r) => r.url))}, expected exactly [${want}] (one imam)`);
    return 0;
  }
  if (!html.includes(want)) fail(where, `the page does not carry the imam's recording of this ayah (${want})`);
  // No other reciter's file, ours or EveryAyah's (a lesson page carries no EveryAyah address at all now).
  const others = [...new Set([...html.matchAll(/https:\/\/everyayah\.com\/data\/[A-Za-z0-9_]+\/\d{6}\.mp3|\/belajar\/media\/narration\/(?!alafasy\/|quran-com\/|kang-nandar\/)[a-z-]+\/\d{6}\.mp3/g)].map((m) => m[0]))];
  if (others.length) fail(where, `carries a recording that is not the imam's copy: ${others.slice(0, 3).join(", ")}`);
  const named = /husary|mu.?allim/i.exec(html);
  if (named) fail(where, `names another reciter: "…${html.slice(Math.max(0, named.index - 50), named.index + 40)}…"`);
  if (/<select\b|<option\b/i.test(html)) fail(where, "has a dropdown (<select>): the reciter choice is back");
  if (html.includes("data-reciter")) fail(where, "the stage carries a reciter attribute (data-reciter)");
  return 1;
}

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { redirect: "manual", headers });
  return { status: res.status, location: res.headers.get("location"), html: await res.text() };
}

/** The pages of a surah's lesson: its list of ayat and every ayah. */
const lessonPaths = (locale, slug) => [
  `/belajar/${locale}/quran/${slug}`,
  ...SURAH[slug].ayat.map((a) => `/belajar/${locale}/quran/${slug}/${a.ayah}`),
];

/** A place in a lesson as the concept and word pages label it ("Al-Ikhlas · ayat 1, kata ke-2"). */
function placeLabel(template, loc) {
  const [surah, ayah, word] = loc.split(":").map(Number);
  return fmt(template, { surah: SURAH[BY_NUMBER[surah]].name_id, ayah, word });
}

/** Every lexeme → the places it appears in the lessons, by surah slug. */
const APPEARANCES = {};
for (const slug of SLUGS) {
  for (const a of SURAH[slug].ayat) {
    for (const w of a.words) {
      if (!w.lemma_id) continue;
      (APPEARANCES[w.lemma_id] ??= []).push({ slug, loc: w.loc });
    }
  }
}

/**
 * The curriculum page (/belajar/{locale}/quran/kurikulum) with `published` surahs visible and
 * `hidden` ones not, both locales:
 *   - every lesson of content/curriculum.json is listed once, in the file's order (the page marks
 *     each one data-lesson, with data-available);
 *   - a lesson is available exactly when it is a written ayah (the built file carries its derived
 *     lists) of a published surah, and then the page links that ayah's lesson page — or lesson
 *     "0" (the introduction) while it is written and the surah that hosts it is published, and
 *     then the page links /quran/pengantar; the segments of Ayat Kursi and every lesson of a
 *     hidden surah are not available;
 *   - "Belum tersedia" (messages, Curriculum.unavailable) is in the visible text once per lesson
 *     that is not available: the state is said in words;
 *   - the page links nowhere into a hidden surah (noLinkInto: the server HTML and the RSC payload),
 *     while it does name every unit, as plain text.
 */
async function curriculumPage(published, hidden) {
  const slugOf = Object.fromEntries(CURRICULUM.units.map((u) => [u.id, u.slug ?? null]));
  const reachable = (l) => {
    if (l.id === "0") return !!l.map && ZERO_HOST !== null && published.includes(ZERO_HOST);
    const slug = slugOf[l.unit];
    return !!slug && published.includes(slug) && l.ayah !== undefined && l.segment === undefined && !!l.map;
  };
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}/quran/kurikulum`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    const rows = [...html.matchAll(/<li\b[^>]*\bdata-lesson="([^"]+)" data-available="(true|false)"/g)].map((m) => ({ id: m[1], available: m[2] === "true" }));
    const want = CURRICULUM.lessons.map((l) => l.id);
    if (JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(want)) {
      fail(path, `lists ${rows.length} lesson(s), not the ${want.length} of content/curriculum.json in its order`);
    }
    let linked = 0;
    for (const l of CURRICULUM.lessons) {
      const row = rows.find((r) => r.id === l.id);
      if (!row) continue;
      const open = reachable(l);
      if (row.available !== open) fail(path, `lesson ${l.id} is ${row.available ? "available" : "not available"}, expected ${open ? "a link" : "plain text"}`);
      if (!open) continue;
      const href = l.id === "0" ? `href="/belajar/${locale}/quran/${INTRO_SEGMENT}"` : `href="/belajar/${locale}/quran/${slugOf[l.unit]}/${l.ayah}"`;
      if (html.includes(href)) linked++;
      else fail(path, `no link to lesson ${l.id} (${href})`);
    }
    if (linked === 0) fail(path, "links no lesson at all");
    noLinkInto(path, html, hidden);
    const text = visibleText(mainOf(html));
    const mark = MSG[locale].Curriculum.unavailable;
    const closed = CURRICULUM.lessons.filter((l) => !reachable(l)).length;
    if (count(text, mark) !== closed) fail(path, `"${mark}" shown ${count(text, mark)} time(s), expected ${closed}`);
    for (const u of CURRICULUM.units) if (u.surah !== undefined && !text.includes(u.name)) fail(path, `does not name the unit ${u.name}`);
    console.log(`  ${linked} lesson(s) linked, ${closed} marked "${mark}"`);
  }
}

/**
 * The cheat sheet (/belajar/{locale}/quran/rumus) with `published` surahs visible and `hidden` ones
 * not, both locales:
 *   - every step of content/curriculum.json is listed once, in the file's order (data-rumus-step);
 *   - a step is "shown" when its lesson is available (the curriculum page's rule: curriculumPage's
 *     `reachable`) and content/rumus.json has its formula, "none" when it is available and the
 *     file has none ("Rumus belum tersedia"), "locked" when its lesson is not available;
 *   - a shown step's formula, its example's link and every quoted sentence of its sources are in
 *     the visible text, byte for byte; "Belum tersedia" is there once per locked step;
 *   - no locked step's formula or quoted sentence is anywhere in the response (rendered text, and
 *     the RSC payload by the opening of each sentence), and nothing links into a hidden surah.
 */
async function rumusPage(published, hidden) {
  const slugOf = Object.fromEntries(CURRICULUM.units.map((u) => [u.id, u.slug ?? null]));
  const lessonOf = Object.fromEntries(CURRICULUM.lessons.map((l) => [l.id, l]));
  const reachable = (l) => {
    if (l.id === "0") return !!l.map && ZERO_HOST !== null && published.includes(ZERO_HOST);
    const slug = slugOf[l.unit];
    return !!slug && published.includes(slug) && l.ayah !== undefined && l.segment === undefined && !!l.map;
  };
  const entry = Object.fromEntries(RUMUS.steps.map((e) => [e.step, e]));
  const plain = (s) => s.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1");
  const open = RUMUS.steps.filter((e) => reachable(lessonOf[e.lesson]));
  const openQuotes = open.flatMap((e) => e.sumber.flatMap((s) => s.quotes));
  const openProse = open.map((e) => plain(`${e.rumus} ${e.awas ?? ""}`));
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}/quran/rumus`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    const rows = [...html.matchAll(/<li\b[^>]*\bdata-rumus-step="([^"]+)" data-rumus-state="(shown|none|locked)"/g)].map((m) => ({ id: m[1], state: m[2] }));
    const want = CURRICULUM.steps.map((s) => s.id);
    if (JSON.stringify(rows.map((r) => r.id)) !== JSON.stringify(want)) {
      fail(path, `lists ${rows.length} step(s), not the ${want.length} of content/curriculum.json in its order`);
    }
    const text = visibleText(mainOf(html));
    let shown = 0;
    let locked = 0;
    for (const s of CURRICULUM.steps) {
      const row = rows.find((r) => r.id === s.id);
      if (!row) continue;
      const e = entry[s.id];
      const expected = !reachable(lessonOf[s.lesson]) ? "locked" : e ? "shown" : "none";
      if (row.state !== expected) fail(path, `step ${s.id} is ${row.state}, expected ${expected}`);
      if (expected === "locked") locked++;
      if (expected !== "shown" || !e) continue;
      shown++;
      for (const src of e.sumber) {
        for (const q of src.quotes) if (!text.includes(q)) fail(path, `step ${s.id}: the quoted sentence of ${src.page} is not on the page byte for byte`);
        if (!html.includes(`href="${src.url}"`)) fail(path, `step ${s.id}: no link to ${src.url}`);
      }
      if (e.example) {
        const [surah, ayah] = e.example.loc.split(":");
        const slug = CURRICULUM.units.find((u) => String(u.surah) === surah && u.slug)?.slug;
        const href = `href="/belajar/${locale}/quran/${slug}/${ayah}#w-${e.example.loc.replaceAll(":", "-")}"`;
        if (!html.includes(href)) fail(path, `step ${s.id}: no example link (${href})`);
      }
    }
    if (shown === 0) fail(path, "shows no formula at all");
    noLinkInto(path, html, hidden);
    const mark = MSG[locale].Curriculum.unavailable;
    if (count(text, mark) !== locked) fail(path, `"${mark}" shown ${count(text, mark)} time(s), expected ${locked}`);
    // The locked steps' words are nowhere: not rendered, not in the payload.
    let leaks = 0;
    for (const e of RUMUS.steps) {
      if (reachable(lessonOf[e.lesson])) continue;
      for (const src of e.sumber) {
        for (const q of src.quotes) {
          if (openQuotes.some((o) => o.includes(q))) continue;
          if (text.includes(q) || (!openQuotes.some((o) => o.includes(q.slice(0, 24))) && html.includes(q.slice(0, 24)))) {
            fail(path, `step ${e.step}: a quoted sentence of its unavailable lesson is in the response (${src.page})`);
            leaks++;
          }
        }
      }
      const lead = plain(e.rumus.split("[[")[0]).trim();
      if (locale === "id" && lead.length >= 15 && !openProse.some((p) => p.includes(lead)) && text.includes(lead)) {
        fail(path, `step ${e.step}: its formula ("${lead}…") is on the page though its lesson is not available`);
        leaks++;
      }
    }
    console.log(`  ${shown} formula(s) shown, ${locked} step(s) marked "${mark}"${leaks ? `, ${leaks} LEAK(S)` : ", none of an unavailable lesson's"}`);
  }
}

async function api(expected) {
  const res = await fetch(`${BASE}/belajar/api/surahs`);
  const body = await res.json().catch(() => null);
  console.log(`/belajar/api/surahs -> ${res.status} ${JSON.stringify(body)}`);
  if (res.status !== 200) fail("/belajar/api/surahs", `status ${res.status}, expected 200`);
  if (JSON.stringify(body?.published) !== JSON.stringify(expected)) {
    fail("/belajar/api/surahs", `published ${JSON.stringify(body?.published)}, expected ${JSON.stringify(expected)}`);
  }
  if (!/no-store/.test(res.headers.get("cache-control") ?? "")) fail("/belajar/api/surahs", "not cache-control: no-store");
}

// ---------------------------------------------------------------------------------------------
// --hidden (production: BELAJAR_SURAHS unset, Al-Fatihah only).
// ---------------------------------------------------------------------------------------------
async function checkHidden() {
  await api(DEFAULT);
  const hidden = SLUGS.filter((s) => !DEFAULT.includes(s));
  for (const slug of MUAWWIDZAT) if (!hidden.includes(slug)) fail("setup", `${slug} is not among the hidden surahs`);
  const ayatOf = (slug) => SURAH[slug].ayat.map((a) => a.ar);
  const leaks = (slug, body) => ayatOf(slug).filter((ar) => body.includes(ar)).length;

  // 1. Every page of a hidden surah, both locales: the module's own 404, nothing of the lesson in it.
  for (const slug of hidden) {
    for (const locale of ["id", "en"]) {
      for (const path of lessonPaths(locale, slug)) {
        const { status, html } = await get(path);
        console.log(`${path} -> ${status}`);
        if (status !== 404) fail(path, `status ${status}, expected 404 (${slug} is not published)`);
        if (!moduleNotFound(locale, html)) fail(path, "not the module's 404 page");
        if (html.includes('data-autoplay="start"')) fail(path, "the 404 carries the lesson stage");
        if (leaks(slug, html)) fail(path, `the 404 carries ${leaks(slug, html)} ayah(s) of ${slug}`);
      }
    }
    // Fetched as the App Router does on a client-side navigation.
    const path = `/belajar/id/quran/${slug}/1`;
    const res = await fetch(BASE + path, { headers: { RSC: "1" } });
    const body = await res.text();
    console.log(`${path} (RSC request) -> ${res.status}`);
    if (leaks(slug, body)) fail(`${path} (RSC request)`, `the response carries ${slug}'s ayat`);
  }

  // 2. Encoded spellings, and the ones next-intl cleans into the page's own path (src/proxy.ts).
  for (const path of [
    "/belajar/id/quran/al-%69khlas",
    "/belajar/en/quran%2Fan-nas",
    "/belajar/id/quran/an-nas%2F3",
    "/belajar/id/quran/al-ikh%09las/1",
    "/belajar/en/quran%0A/al-falaq/1",
    "/belajar/i%0Dd/quran/an-nas/2",
    "/belajar/id/quran/al-ikhlas%20",
    "/belajar/id/quran/al-fatihah/..%2Fal-ikhlas",
  ]) {
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 404) fail(path, `status ${status}, expected 404`);
    for (const slug of hidden) if (leaks(slug, html)) fail(path, `the 404 carries ${slug}'s ayat`);
  }

  // 3. The pre-hub URLs still answer their permanent redirect (next.config.ts, fixed at build
  //    time), and where it leads is the 404.
  for (const [from, to] of [
    ["/belajar/id/al-ikhlas", "/belajar/id/quran/al-ikhlas"],
    ["/belajar/en/an-nas/2", "/belajar/en/quran/an-nas/2"],
    ["/belajar/al-falaq", "/belajar/id/quran/al-falaq"],
    ["/belajar/al-falaq/3", "/belajar/id/quran/al-falaq/3"],
  ]) {
    const { status, location } = await get(from);
    const path = location ? new URL(location, BASE).pathname : "";
    console.log(`${from} -> ${status} ${path}`);
    if (status !== 308 || path !== to) {
      fail(from, `${status} ${path}, expected 308 ${to}`);
      continue;
    }
    const next = await get(to);
    console.log(`  ${to} -> ${next.status}`);
    if (next.status !== 404) fail(to, `status ${next.status} after the redirect, expected 404`);
  }

  // 4. The track page: Al-Fatihah is a link; every hidden surah a "Segera hadir" card that is no
  //    link, and no ayah chip into it.
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}/quran`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    for (const slug of DEFAULT) {
      if (!html.includes(`href="/belajar/${locale}/quran/${slug}"`)) fail(path, `no card link to ${slug}`);
      if (!html.includes(`href="/belajar/${locale}/quran/${slug}/1"`)) fail(path, `no ayah chip into ${slug}`);
    }
    for (const slug of hidden) {
      const tag = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bdata-coming-soon="${slug}"`).exec(html)?.[1];
      if (!tag) fail(path, `no "Segera hadir" card for ${slug}`);
      else if (tag.toLowerCase() === "a") fail(path, `the "Segera hadir" card of ${slug} is a link`);
    }
    noLinkInto(path, html, hidden);
    const text = visibleText(mainOf(html));
    const soon = MSG[locale].Quran.coming_soon;
    // One "Segera hadir" per hidden surah, and one per unit with no lessons (Ayat Kursi).
    const expectedSoon = hidden.length + COMING_UNITS.length;
    if (count(text, soon) !== expectedSoon) fail(path, `"${soon}" shown ${count(text, soon)} time(s), expected ${expectedSoon}`);
    for (const slug of hidden) if (!text.includes(SURAH[slug].name_id)) fail(path, `the card of ${slug} does not name it`);
    for (const u of COMING_UNITS) {
      const tag = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bdata-coming-unit="${u.id}"`).exec(html)?.[1];
      if (!tag) fail(path, `no "Segera hadir" card for ${u.id}`);
      else if (tag.toLowerCase() === "a") fail(path, `the "Segera hadir" card of ${u.id} is a link`);
      if (!text.includes(unitLabel(locale, u))) fail(path, `the card of ${u.id} does not say "${unitLabel(locale, u)}"`);
    }
    // … and it links the curriculum page (plan L30) and the cheat sheet (plan L32).
    if (!html.includes(`href="/belajar/${locale}/quran/kurikulum"`)) fail(path, "no link to the curriculum page");
    if (!html.includes(`href="/belajar/${locale}/quran/rumus"`)) fail(path, "no link to the cheat sheet");
  }

  // 4b. The curriculum page names the hidden surahs as plain text: no lesson of theirs is a link.
  await curriculumPage(DEFAULT, hidden);
  await rumusPage(DEFAULT, hidden);

  // 5. The hub: "Tersedia sekarang" names the published surahs only, "Segera hadir" the others.
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) fail(path, `status ${status}, expected 200`);
    const hub = MSG[locale].Hub;
    // The two notes are rows of coloured pills (StatusPill): a label, then one pill per name.
    const text = visibleText(html);
    if (!text.includes(hub.status_available)) fail(path, `"${hub.status_available}" not shown`);
    for (const s of DEFAULT) {
      const pill = fmt(hub.surah_ayat, { name: SURAH[s].name_id, ayat: SURAH[s].ayat.length });
      if (!text.includes(pill)) fail(path, `"${pill}" not shown`);
    }
    if (!text.includes(hub.status_coming)) fail(path, `"${hub.status_coming}" not shown`);
    for (const name of [...hidden.map((s) => SURAH[s].name_id), ...COMING_UNITS.map((u) => u.name)]) {
      if (!text.includes(name)) fail(path, `"${name}" not shown among the coming ones`);
    }
    for (const slug of hidden) {
      const listed = fmt(hub.surah_ayat, { name: SURAH[slug].name_id, ayat: SURAH[slug].ayat.length });
      if (text.includes(listed)) fail(path, `lists the hidden ${slug} as available ("${listed}")`);
    }
    noLinkInto(path, html, hidden);
  }

  // 6. Everything else that names lesson places: concept examples and word appearances in a hidden
  //    surah are plain text, never a link; the Al-Fatihah pages and the credits link nowhere into
  //    a hidden surah (the credits do not even name one).
  let plainExamples = 0;
  for (const c of LIBRARY.concepts) {
    const path = `/belajar/id/konsep/${c.id}`;
    const { status, html } = await get(path);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    noLinkInto(path, html, hidden);
    const text = visibleText(html);
    for (const ex of c.examples ?? []) {
      const slug = BY_NUMBER[Number(ex.loc.split(":")[0])];
      if (!slug || !hidden.includes(slug)) continue;
      const label = placeLabel(MSG.id.Concept.example_loc, ex.loc);
      if (text.includes(label)) plainExamples++;
      else fail(path, `the example "${label}" is missing (expected as plain text)`);
    }
  }
  console.log(`konsep: ${LIBRARY.concepts.length} page(s), ${plainExamples} example(s) in a hidden surah shown as plain text`);
  if (plainExamples === 0) fail("konsep", "no concept example in a hidden surah was found as plain text");
  let plainPlaces = 0;
  for (const l of LIBRARY.lexicon) {
    const path = `/belajar/id/kosakata/${l.id}`;
    const { status, html } = await get(path);
    if (status !== 200) {
      fail(path, `status ${status}, expected 200`);
      continue;
    }
    noLinkInto(path, html, hidden);
    const text = visibleText(html);
    for (const { slug, loc } of APPEARANCES[l.id] ?? []) {
      if (!hidden.includes(slug)) continue;
      const label = placeLabel(MSG.id.Lexeme.loc_label, loc);
      if (text.includes(label)) plainPlaces++;
      else fail(path, `the place "${label}" is missing (expected as plain text)`);
    }
  }
  console.log(`kosakata: ${LIBRARY.lexicon.length} page(s), ${plainPlaces} place(s) in a hidden surah shown as plain text`);
  if (plainPlaces === 0) fail("kosakata", "no word place in a hidden surah was found as plain text");
  let chipped = 0;
  let imam = 0;
  for (const path of [...DEFAULT.flatMap((s) => lessonPaths("id", s)), "/belajar/id/konsep", "/belajar/id/kredit", "/belajar/en/kredit"]) {
    const { status, html } = await get(path);
    if (status !== 200) fail(path, `status ${status}, expected 200`);
    noLinkInto(path, html, hidden);
    const lesson = /^\/belajar\/id\/quran\/([^/]+)(?:\/(\d+))?$/.exec(path);
    if (lesson) chipped += chipsNotLinks(path, html, lesson[1], lesson[2] ? Number(lesson[2]) : null);
    if (lesson?.[2]) imam += oneImam(path, html, lesson[1], Number(lesson[2]));
    if (path.endsWith("/kredit")) {
      const text = visibleText(mainOf(html));
      for (const slug of hidden) if (text.includes(SURAH[slug].name_id)) fail(path, `names the hidden ${slug}`);
      // The recitation credits are derived from the content: one imam, one line (plan L21).
      const credit = SURAH[DEFAULT[0]].ayat[0].recitation[0]?.credit ?? "";
      if (!credit.includes("Mishary Rashid Alafasy") || !visibleText(html).includes(credit)) fail(path, `the imam's credit line is not shown ("${credit}")`);
      if (/husary|mu.?allim/i.test(html)) fail(path, "credits a reciter no lesson plays (Husary Mu'allim)");
    }
  }
  console.log(`fact cards: ${chipped} location chip(s) on the published lesson pages, buttons, no quran.com link`);
  if (chipped === 0) fail("fact cards", "no location chip found on the published lesson pages");
  console.log(`one imam: ${imam} published ayah page(s) carry Alafasy's recording of their ayah and no other reciter, no dropdown; the Kredit pages credit him alone`);
  if (imam !== DEFAULT.reduce((n, s) => n + SURAH[s].ayat.length, 0)) fail("one imam", `checked ${imam} ayah page(s), not every published one`);
}

// ---------------------------------------------------------------------------------------------
// Every surah listed (BELAJAR_SURAHS=al-fatihah,al-ikhlas,al-falaq,an-nas): the Mu'awwidzat as
// they ship when shown.
// ---------------------------------------------------------------------------------------------
async function checkShown() {
  await api(SLUGS);
  let chipped = 0;
  let imam = 0;
  for (const slug of SLUGS) {
    for (const path of [...lessonPaths("id", slug), `/belajar/en/quran/${slug}`, `/belajar/en/quran/${slug}/1`]) {
      const { status, html } = await get(path);
      console.log(`${path} -> ${status}`);
      if (status !== 200) {
        fail(path, `status ${status}, expected 200`);
        continue;
      }
      const ayah = /\/quran\/[^/]+\/(\d+)$/.exec(path);
      chipped += chipsNotLinks(path, html, slug, ayah ? Number(ayah[1]) : null);
      if (!ayah) continue;
      // One imam, no reciter choice (plan L21): on every ayah page of every surah, both locales.
      imam += oneImam(path, html, slug, Number(ayah[1]));
      // The autoplay lesson: the single "Mulai pelajaran" button and the one-line hint, server
      // rendered; "klik", never "ketuk" (operator, 2026-10-10).
      if (!html.includes('data-autoplay="start"')) fail(path, "no autoplay start button");
      if (path.startsWith("/belajar/id/")) {
        if (!html.includes(`<span>${MSG.id.Guided.start}</span>`)) fail(path, `"${MSG.id.Guided.start}" label missing`);
        if (html.includes("Klik sekali; pelajaran berjalan sendiri")) fail(path, "the removed one-click hint is back (operator 2026-10-12)");
        if (/\b(ketuk|mengetuk|diketuk)\b/i.test(html)) fail(path, "says ketuk (use klik)");
      }
    }
  }
  console.log(`fact cards: ${chipped} location chip(s) on every surah's pages, buttons, no quran.com link`);
  if (chipped === 0) fail("fact cards", "no location chip found on any lesson page");
  console.log(`one imam: ${imam} ayah page(s) carry Alafasy's recording of their ayah and no other reciter, no dropdown`);
  if (imam < SLUGS.reduce((n, s) => n + SURAH[s].ayat.length, 0)) fail("one imam", `checked ${imam} ayah page(s), fewer than every lesson ayah`);
  // An unknown ayah is still the module's 404.
  for (const path of ["/belajar/id/quran/an-nas/7", "/belajar/id/quran/al-ikhlas/5"]) {
    const { status } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 404) fail(path, `status ${status}, expected 404`);
  }
  for (const [from, to] of [
    ["/belajar/id/al-ikhlas", "/belajar/id/quran/al-ikhlas"],
    ["/belajar/al-falaq/3", "/belajar/id/quran/al-falaq/3"],
  ]) {
    const { status, location } = await get(from);
    const path = location ? new URL(location, BASE).pathname : "";
    console.log(`${from} -> ${status} ${path}`);
    if (status !== 308 || path !== to) fail(from, `${status} ${path}, expected 308 ${to}`);
    else if ((await get(to)).status !== 200) fail(to, "not 200 after the redirect");
  }
  // The curriculum page links every written lesson now; Ayat Kursi and the introduction stay plain.
  await curriculumPage(SLUGS, []);
  await rumusPage(SLUGS, []);
  for (const locale of ["id", "en"]) {
    const track = await get(`/belajar/${locale}/quran`);
    if (/\bdata-coming-soon=/.test(track.html)) fail(`/belajar/${locale}/quran`, 'a "Segera hadir" card of a surah with every surah published');
    for (const slug of SLUGS) {
      if (!track.html.includes(`href="/belajar/${locale}/quran/${slug}"`)) fail(`/belajar/${locale}/quran`, `no card link to ${slug}`);
    }
    // Every surah published: "Segera hadir" is only the units with no lessons (Ayat Kursi).
    const soon = MSG[locale].Quran.coming_soon;
    const shown = count(visibleText(mainOf(track.html)), soon);
    if (shown !== COMING_UNITS.length) fail(`/belajar/${locale}/quran`, `"${soon}" shown ${shown} time(s), expected ${COMING_UNITS.length} (the units with no lessons)`);
    const hub = MSG[locale].Hub;
    const text = visibleText((await get(`/belajar/${locale}`)).html);
    if (!text.includes(hub.status_available)) fail(`/belajar/${locale}`, `"${hub.status_available}" not shown`);
    for (const s of SLUGS) {
      const pill = fmt(hub.surah_ayat, { name: SURAH[s].name_id, ayat: SURAH[s].ayat.length });
      if (!text.includes(pill)) fail(`/belajar/${locale}`, `"${pill}" not shown`);
    }
    for (const u of COMING_UNITS) if (!text.includes(u.name)) fail(`/belajar/${locale}`, `"${u.name}" not shown among the coming ones`);
  }
  // The library links into every lesson again.
  for (const [what, ids, prefix] of [
    ["konsep", LIBRARY.concepts.map((c) => c.id), "/belajar/id/konsep/"],
    ["kosakata", LIBRARY.lexicon.map((l) => l.id), "/belajar/id/kosakata/"],
  ]) {
    const linked = new Set();
    for (const id of ids) {
      const { status, html } = await get(prefix + id);
      if (status !== 200) fail(prefix + id, `status ${status}, expected 200`);
      for (const slug of SLUGS) if (linkInto(slug).test(html)) linked.add(slug);
    }
    console.log(`${what}: links into ${[...linked].join(", ") || "nothing"}`);
    for (const slug of MUAWWIDZAT) if (!linked.has(slug)) fail(what, `no page links into ${slug}`);
  }
}

const HIDDEN = process.argv.includes("--hidden");
if (HIDDEN) await checkHidden();
else await checkShown();

if (problems.length > 0) {
  console.log(`\n✗ surahs smoke${HIDDEN ? " (--hidden)" : ""}: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  HIDDEN
    ? "✓ surahs smoke (--hidden): only Al-Fatihah is published; every page of the others 404s, the track shows them as \"Segera hadir\" with no link, nothing links into them"
    : "✓ surahs smoke (every surah listed): every lesson 200 with its autoplay start, cards and library links back",
);
