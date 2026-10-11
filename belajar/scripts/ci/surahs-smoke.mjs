// CI-only: smoke checks of the Qur'an track's surah switch on the REAL image (the workflow starts
// it on :3300). BELAJAR_SURAHS (operator, 2026-10-10: "let's focus on alfatihah first, show cards
// for other surah as 'segera hadir', but not clickable"; src/lib/features.ts, docs/belajar-plan.md
// L14) lists the published surahs; unset, as in production, only Al-Fatihah.
//
// CI runs this twice, on two containers of the same image:
//   - `--hidden`, on the production-like container (no BELAJAR_SURAHS): checkHidden() below;
//   - no flag, on a container started with every surah listed: checkShown().
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
const MSG = { id: await readJson("messages/id.json"), en: await readJson("messages/en.json") };
const fmt = (template, values) => template.replace(/\{(\w+)\}/g, (all, k) => (k in values ? String(values[k]) : all));

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
    if (count(text, soon) !== hidden.length) fail(path, `"${soon}" shown ${count(text, soon)} time(s), expected ${hidden.length}`);
    for (const slug of hidden) if (!text.includes(SURAH[slug].name_id)) fail(path, `the card of ${slug} does not name it`);
  }

  // 5. The hub: "Tersedia sekarang" names the published surahs only, "Segera hadir" the others.
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}`;
    const { status, html } = await get(path);
    console.log(`${path} -> ${status}`);
    if (status !== 200) fail(path, `status ${status}, expected 200`);
    const hub = MSG[locale].Hub;
    const available = fmt(hub.quran_available, {
      list: DEFAULT.map((s) => fmt(hub.surah_ayat, { name: SURAH[s].name_id, ayat: SURAH[s].ayat.length })).join(", "),
    });
    const coming = fmt(hub.quran_coming, { list: hidden.map((s) => SURAH[s].name_id).join(", ") });
    const text = visibleText(html);
    if (!text.includes(available)) fail(path, `"${available}" not shown`);
    if (!text.includes(coming)) fail(path, `"${coming}" not shown`);
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
  for (const path of [...DEFAULT.flatMap((s) => lessonPaths("id", s)), "/belajar/id/konsep", "/belajar/id/kredit", "/belajar/en/kredit"]) {
    const { status, html } = await get(path);
    if (status !== 200) fail(path, `status ${status}, expected 200`);
    noLinkInto(path, html, hidden);
    if (path.endsWith("/kredit")) {
      const text = visibleText(mainOf(html));
      for (const slug of hidden) if (text.includes(SURAH[slug].name_id)) fail(path, `names the hidden ${slug}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Every surah listed (BELAJAR_SURAHS=al-fatihah,al-ikhlas,al-falaq,an-nas): the Mu'awwidzat as
// they ship when shown.
// ---------------------------------------------------------------------------------------------
async function checkShown() {
  await api(SLUGS);
  for (const slug of SLUGS) {
    for (const path of [...lessonPaths("id", slug), `/belajar/en/quran/${slug}`, `/belajar/en/quran/${slug}/1`]) {
      const { status, html } = await get(path);
      console.log(`${path} -> ${status}`);
      if (status !== 200) {
        fail(path, `status ${status}, expected 200`);
        continue;
      }
      if (!/\/quran\/[^/]+\/\d+$/.test(path)) continue;
      // The autoplay lesson: the single "Mulai pelajaran" button and the one-line hint, server
      // rendered; "klik", never "ketuk" (operator, 2026-10-10).
      if (!html.includes('data-autoplay="start"')) fail(path, "no autoplay start button");
      if (path.startsWith("/belajar/id/")) {
        if (!html.includes(`<span>${MSG.id.Guided.start}</span>`)) fail(path, `"${MSG.id.Guided.start}" label missing`);
        if (!html.includes(MSG.id.Guided.start_hint)) fail(path, "one-click hint missing");
        if (/\b(ketuk|mengetuk|diketuk)\b/i.test(html)) fail(path, "says ketuk (use klik)");
      }
    }
  }
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
  for (const locale of ["id", "en"]) {
    const track = await get(`/belajar/${locale}/quran`);
    if (track.html.includes("data-coming-soon")) fail(`/belajar/${locale}/quran`, 'a "Segera hadir" card with every surah published');
    for (const slug of SLUGS) {
      if (!track.html.includes(`href="/belajar/${locale}/quran/${slug}"`)) fail(`/belajar/${locale}/quran`, `no card link to ${slug}`);
    }
    if (visibleText(mainOf(track.html)).includes(MSG[locale].Quran.coming_soon)) fail(`/belajar/${locale}/quran`, '"Segera hadir" shown');
    const hub = MSG[locale].Hub;
    const available = fmt(hub.quran_available, {
      list: SLUGS.map((s) => fmt(hub.surah_ayat, { name: SURAH[s].name_id, ayat: SURAH[s].ayat.length })).join(", "),
    });
    const text = visibleText((await get(`/belajar/${locale}`)).html);
    if (!text.includes(available)) fail(`/belajar/${locale}`, `"${available}" not shown`);
    if (text.includes(fmt(hub.quran_coming, { list: "" }).trim())) fail(`/belajar/${locale}`, "a coming-soon line with every surah published");
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
