// CI-only: search-engine smoke checks on the REAL image (the workflow starts it on :3300). The module is
// public since 2026-11-26 (operator: "publish belajar so google can see"; docs/belajar-plan.md L42), so
// what Google may index, and what it must never see, is tested on the image that ships, never on a
// second configuration: the Dockerfile's default makes it public, and no job passes a flag for that.
//
// The expectations are written here from the DATA (content/*.json, the route and feature files read as
// text), not from the app's own code, so a drift in lib/indexing.ts, in the sitemap or in a page's tags
// is caught by the disagreement. Four things are held:
//   1. THE SITEMAP, /belajar/sitemap.xml: exactly the pages the operator listed (hub, track, the published
//      surahs and their ayat, lesson zero, curriculum, cheat sheet, the Konsep pages, the Kosakata list's
//      pages and the learning path's overview, the lesson words' entries a published surah uses, the credits) and no other:
//      nothing English, nothing of Ilmu Waris, no unpublished surah, no share card, no search or
//      variant of the list, no learning-path card or test, no word page unless taken (--words).
//   2. EVERY URL IN IT, fetched: 200; no noindex in the robots tags or in an X-Robots-Tag header (a
//      listed URL that is noindex is Search Console's "Submitted URL marked noindex"); its canonical link is
//      itself, absolute; a title and a meta description of its own (no two pages share one); og:url, where
//      there is one, is the canonical; no hreflang (only Indonesian is indexed, src/i18n/routing.ts), no
//      `Link` header for it; the AI-assisted label and the "bukan fatwa" line in the footer; and nowhere
//      a promise of a human review (there is none, plan L11: the same phrases publishable.ts holds the content to).
//   3. WHAT MUST STAY OUT, fetched: the English pages; Ilmu Waris (404 while hidden, noindex when shown:
//      --waris); an unlisted surah (Al-Ikhlas answers 200 and says noindex in a header); the Kosakata list's
//      search and every variant address (noindex, no canonical); the learning path's cards and tests
//      (noindex), its overview while the path is not listed; the word pages (noindex unless --words);
//      every share card and the JSON endpoints (X-Robots-Tag: noindex). None of them is in the sitemap.
//   4. THE CONFIGURATION: the surahs the container publishes are the ones its flags say (the default,
//      Al-Fatihah only, or every surah with --surahs), so a wrong expectation is named as such.
//
// Which switches the container was started with, the script is told: no flag is production's defaults (the
// "image" smoke step); --bertahap BELAJAR_KOSAKATA_BERTAHAP=on (the shots job, which is production's
// own); --surahs every surah listed (BELAJAR_SURAHS); --words BELAJAR_KOSAKATA_WORDS_INDEXED=on;
// --waris BELAJAR_WARIS=on. A kill switch (BELAJAR_PUBLIC=false) is held by unit tests (src/proxy.test.ts).
//
// Every problem is listed, then the script exits 1. Node 20+ (global fetch), no dependencies.
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const BELAJAR = new URL("../../", import.meta.url);
const SITE = "https://dakwah-lens.id";
const MOD = `${SITE}/belajar`;
const flags = new Set(process.argv.slice(2));
const SURAHS_ON = flags.has("--surahs");
const WORDS_ON = flags.has("--words");
const WARIS_ON = flags.has("--waris");
const PATH_ON = flags.has("--bertahap");

const problems = [];
const fail = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.log(`✗ ${where}: ${msg}`);
};
const ok = (msg) => console.log(`  ${msg}`);

const readText = (rel) => readFile(new URL(rel, BELAJAR), "utf8");
const readJson = async (rel) => JSON.parse(await readText(rel));

// ── What the files say (never typed here) ────────────────────────────────────────────────────
const routesSrc = await readText("src/lib/routes.ts");
const featuresSrc = await readText("src/lib/features.ts");
const routingSrc = await readText("src/i18n/routing.ts");
const coreSrc = await readText("src/lib/kosakata-core.ts");
const publishableSrc = await readText("src/lib/publishable.ts");
const list = (src, re) => [...(re.exec(src)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const SLUGS = list(routesSrc, /export const SURAH_SLUGS = \[([^\]]*)\]/);
const DEFAULT_SURAHS = list(featuresSrc, /export const DEFAULT_SURAHS[^=]*= \[([^\]]*)\]/);
const DEFAULT_UNLISTED = list(featuresSrc, /export const DEFAULT_UNLISTED[^=]*= \[([^\]]*)\]/);
const INDEXED = list(routingSrc, /export const INDEXED_LOCALES[^=]*= \[([^\]]*)\]/);
const INTRO_HOST = /export const INTRO_HOST = "([^"]+)"/.exec(routesSrc)?.[1];
const PAGE_SIZE = Number(/export const PAGE_SIZE = (\d+);/.exec(coreSrc)?.[1]);
const REVIEW_SRC = /export const REVIEW_PROMISE = \/(.+)\/i;/.exec(publishableSrc)?.[1];
if (SLUGS.length < 2) fail("setup", "could not read SURAH_SLUGS from src/lib/routes.ts");
if (DEFAULT_SURAHS.length < 1) fail("setup", "could not read DEFAULT_SURAHS from src/lib/features.ts");
if (!INTRO_HOST || !SLUGS.includes(INTRO_HOST)) fail("setup", "could not read INTRO_HOST from src/lib/routes.ts");
if (!PAGE_SIZE) fail("setup", "could not read PAGE_SIZE from src/lib/kosakata-core.ts");
if (!REVIEW_SRC) fail("setup", "could not read REVIEW_PROMISE from src/lib/publishable.ts");
if (INDEXED.join() !== "id") {
  fail("setup", `INDEXED_LOCALES is [${INDEXED}]: this script holds Indonesian-only indexing (no hreflang, no English page in the sitemap). Read its checks again before English is added.`);
}
const REVIEW_PROMISE = new RegExp(REVIEW_SRC ?? "$^", "i");

const SURAH = Object.fromEntries(await Promise.all(SLUGS.map(async (slug) => [slug, await readJson(`content/${slug}.json`)])));
const LIBRARY = await readJson("content/library.json");
const WORDS = (await readJson("content/kosakata/index.json")).rows.length;
const PAGES = Math.max(1, Math.ceil(WORDS / PAGE_SIZE));
const CONCEPTS = [...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)];
// The lesson words' entries and the surahs whose lessons use each word (a word's lemma_id): an entry is
// indexable only while one of them is published (src/lib/indexing.ts lexemeIndexable).
const LEXEMES = LIBRARY.lexicon.map((l) => ({
  id: l.id,
  surahs: SLUGS.filter((slug) => SURAH[slug].ayat.some((a) => a.words.some((w) => w.lemma_id === l.id))),
}));

// ── HTTP and HTML ───────────────────────────────────────────────────────────────────────────
// As Google's crawler asks. Next sends an HTML-limited bot its metadata in <head> and any other client of a
// request-time page the same tags streamed into <body>; meta and link tags are matched anywhere in the
// document either way (the RSC payload carries them as JSON, never as <meta> / <link> markup).
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { "user-agent": UA } });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type") ?? "", headers: res.headers, body, html: body.toString("utf8") };
}
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
/** Every <tag …> of a kind, its attribute names lower-cased (React writes hrefLang) and its values decoded. */
const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k.toLowerCase(), decode(v)])),
  );
const region = (html, name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(html)?.[1] ?? "";
const text = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const metaTags = (html) => tags(html, "meta");
const metaContent = (html, key) => metaTags(html).find((m) => m.name === key || m.property === key)?.content;
const robotsMeta = (html) => metaTags(html).filter((m) => m.name === "robots").map((m) => m.content ?? "");
const canonicals = (html) => tags(html, "link").filter((l) => l.rel === "canonical").map((l) => l.href);
const titleOf = (html) => decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
const NOINDEX = /noindex/i;
const headerNoindex = (res) => NOINDEX.test(res.headers.get("x-robots-tag") ?? "");
const metaNoindex = (res) => robotsMeta(res.html).some((c) => NOINDEX.test(c));

// ── 4. The configuration ───────────────────────────────────────────────────────────────────
let published = new Set(SURAHS_ON ? SLUGS : DEFAULT_SURAHS);
{
  const r = await get("/belajar/api/surahs");
  try {
    const got = new Set(JSON.parse(r.html).published);
    if ([...got].sort().join() !== [...published].sort().join()) {
      fail("/belajar/api/surahs", `the container publishes [${[...got]}], this run expected [${[...published]}] (${SURAHS_ON ? "--surahs" : "production's default"})`);
    }
    published = got;
  } catch {
    fail("/belajar/api/surahs", `not the expected JSON { published: [...] } (status ${r.status})`);
  }
}
console.log(`published surahs: ${[...published]}${PATH_ON ? " · path listed" : ""}${WORDS_ON ? " · word pages taken" : ""}${WARIS_ON ? " · waris on" : ""}`);
const unlisted = SLUGS.filter((s) => !published.has(s) && DEFAULT_UNLISTED.includes(s) && !SURAHS_ON);
const hidden = SLUGS.filter((s) => !published.has(s) && !unlisted.includes(s));

// ── 1. The sitemap ─────────────────────────────────────────────────────────────────────────
/** What the operator listed, from the data: the same set the policy (src/lib/indexing.ts) says yes to. */
function expectedUrls() {
  const id = `${MOD}/id`;
  const out = [id, `${id}/quran`];
  for (const slug of SLUGS) {
    if (!published.has(slug)) continue;
    out.push(`${id}/quran/${slug}`, ...SURAH[slug].ayat.map((a) => `${id}/quran/${slug}/${a.ayah}`));
  }
  if (published.has(INTRO_HOST)) out.push(`${id}/quran/pengantar`);
  out.push(`${id}/quran/kurikulum`, `${id}/quran/rumus`, `${id}/konsep`, ...CONCEPTS.map((c) => `${id}/konsep/${c}`));
  if (PATH_ON) out.push(`${id}/kosakata/bertahap`);
  out.push(...LEXEMES.filter((l) => l.surahs.some((slug) => published.has(slug))).map((l) => `${id}/kosakata/${l.id}`));
  for (let p = 1; p <= PAGES; p++) out.push(`${id}/kosakata?hal=${p}`);
  if (WORDS_ON) for (let rank = 1; rank <= WORDS; rank++) out.push(`${id}/kosakata/kata/${rank}`);
  out.push(`${id}/kredit`);
  return out;
}

const sm = await get("/belajar/sitemap.xml");
let listed = [];
if (sm.status !== 200) fail("/belajar/sitemap.xml", `status ${sm.status}, expected 200`);
else {
  if (!/xml/.test(sm.type)) fail("/belajar/sitemap.xml", `content-type ${sm.type}, expected XML`);
  if (!/<urlset\b/.test(sm.html)) fail("/belajar/sitemap.xml", "no <urlset>");
  listed = [...sm.html.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]).trim());
  if (headerNoindex(sm)) fail("/belajar/sitemap.xml", "answers with X-Robots-Tag noindex");
}
const want = expectedUrls();
const listedSet = new Set(listed);
const wantSet = new Set(want);
if (listedSet.size !== listed.length) fail("/belajar/sitemap.xml", `${listed.length - listedSet.size} address(es) listed twice`);
for (const url of listed) if (!wantSet.has(url)) fail("/belajar/sitemap.xml", `lists ${url}, which is not one of the pages that may be indexed`);
for (const url of want) if (!listedSet.has(url)) fail("/belajar/sitemap.xml", `does not list ${url}, which may be indexed`);
for (const url of listed) {
  if (!url.startsWith(`${MOD}/id`)) fail("/belajar/sitemap.xml", `${url} is not an absolute Indonesian address of the module`);
  if (/\/waris|\/belajar\/en|\/og$|\?q=|\/bertahap\/\d|\/kosakata\/kata\/(?!\d)/.test(url)) fail("/belajar/sitemap.xml", `${url} is a page that must stay out of the index`);
  for (const slug of [...unlisted, ...hidden]) if (new RegExp(`/quran/${slug}(?:/|$)`).test(url)) fail("/belajar/sitemap.xml", `${url} is a page of the surah ${slug}, which is not published`);
  if (!WORDS_ON && url.includes("/kosakata/kata/")) fail("/belajar/sitemap.xml", `${url}: the word pages are not taken into the index (BELAJAR_KOSAKATA_WORDS_INDEXED)`);
}
ok(`/belajar/sitemap.xml: ${listed.length} address(es), ${want.length} expected`);

// ── 2. Every URL of the sitemap, fetched ───────────────────────────────────────────────────
const titles = new Map();
const descriptions = new Map();
const AI_LABEL = "Dibantu AI, bukan fatwa otoritatif";

/** The checks every indexable page must pass; `url` is the absolute address the sitemap lists. */
async function indexable(url) {
  const path = url.slice(SITE.length);
  const res = await get(path);
  const where = path;
  if (res.status !== 200) return fail(where, `status ${res.status}, expected 200`);
  if (!/^text\/html/.test(res.type)) fail(where, `content-type ${res.type}`);
  if (headerNoindex(res)) fail(where, `X-Robots-Tag says "${res.headers.get("x-robots-tag")}", but the sitemap lists it`);
  if (metaNoindex(res)) fail(where, `robots meta says "${robotsMeta(res.html)}", but the sitemap lists it`);
  const canonical = canonicals(res.html);
  if (canonical.length !== 1) fail(where, `${canonical.length} canonical links, expected one`);
  else if (canonical[0] !== url) fail(where, `canonical ${canonical[0]}, expected ${url}`);
  const title = titleOf(res.html);
  if (!title) fail(where, "no <title>");
  else if (titles.has(title)) fail(where, `title "${title}" is also ${titles.get(title)}`);
  else titles.set(title, where);
  const description = metaContent(res.html, "description") ?? "";
  if (metaTags(res.html).filter((m) => m.name === "description").length !== 1) fail(where, "not exactly one meta description");
  if (description.length < 40) fail(where, `meta description too short: "${description}"`);
  else if (descriptions.has(description)) fail(where, `meta description is also ${descriptions.get(description)}`);
  else descriptions.set(description, where);
  const ogUrl = metaContent(res.html, "og:url");
  if (ogUrl !== undefined && ogUrl !== url) fail(where, `og:url ${ogUrl} ≠ canonical ${url}`);
  const alternates = tags(res.html, "link").filter((l) => l.rel === "alternate" && l.hreflang);
  if (alternates.length) fail(where, `${alternates.length} hreflang alternate(s), but only Indonesian is indexed`);
  if (/hreflang/i.test(res.headers.get("link") ?? "")) fail(where, "a Link header with hreflang, but only Indonesian is indexed");
  if (!/<html[^>]*\blang="id"/i.test(res.html)) fail(where, 'no <html lang="id">');
  if (!text(region(res.html, "footer")).includes(AI_LABEL)) fail(where, `the footer does not carry "${AI_LABEL}"`);
  if (!/bukan fatwa/i.test(text(region(res.html, "footer")))) fail(where, 'the footer has no "bukan fatwa"');
  const promise = REVIEW_PROMISE.exec(res.html);
  if (promise) fail(where, `promises a human review: "${promise[0]}" (there is none, plan L11)`);
}

// The 4,832 word pages, when they are taken, are listed in full above; a sample of them is fetched.
const sweep = want.filter((u) => !u.includes("/kosakata/kata/"));
if (WORDS_ON) {
  const ranks = new Set([1, 2, 100, 101, 2000, WORDS - 1, WORDS]);
  for (let rank = 7; rank <= WORDS; rank += 197) ranks.add(rank);
  for (const rank of [...ranks].sort((a, b) => a - b)) sweep.push(`${MOD}/id/kosakata/kata/${rank}`);
}
for (const url of sweep) await indexable(url);
ok(`${sweep.length} listed page(s) fetched: 200, no noindex, their own canonical, a title and a description each, the AI label, no promise of a review`);

// ── 3. What must stay out ──────────────────────────────────────────────────────────────────
/** A page that answers 200 and says noindex: in its tags (`meta`) and in a header (`header`), as asked. */
async function staysOut(path, { meta = true, header = true, canonical } = {}) {
  const res = await get(path);
  if (res.status !== 200) return fail(path, `status ${res.status}, expected 200 (it must answer, and say noindex)`);
  if (meta && !metaNoindex(res)) fail(path, `no noindex in the robots meta (${JSON.stringify(robotsMeta(res.html))})`);
  if (header && !headerNoindex(res)) fail(path, `no noindex in the X-Robots-Tag header (${JSON.stringify(res.headers.get("x-robots-tag"))})`);
  if (canonical === false && canonicals(res.html).length) fail(path, `has a canonical link (${canonicals(res.html)}), a variant address should not`);
  const listedHere = listed.some((u) => u.slice(SITE.length) === path);
  if (listedHere) fail(path, "is in the sitemap");
  return res;
}
/** A page that does not exist for visitors. */
async function answers404(path) {
  const res = await get(path);
  if (res.status !== 404) fail(path, `status ${res.status}, expected 404 (hidden)`);
  if (listed.some((u) => u.slice(SITE.length) === path)) fail(path, "is hidden but in the sitemap");
}

// English: a translated shell around Indonesian lessons, noindex everywhere (src/i18n/routing.ts).
const englishPaths = ["/belajar/en", "/belajar/en/quran", "/belajar/en/quran/pengantar", "/belajar/en/quran/kurikulum", "/belajar/en/quran/rumus", "/belajar/en/konsep", "/belajar/en/konsep/harakat", "/belajar/en/kredit", "/belajar/en/kosakata/rahim"];
for (const slug of SLUGS.filter((s) => published.has(s))) englishPaths.push(`/belajar/en/quran/${slug}`, `/belajar/en/quran/${slug}/1`);
for (const path of englishPaths) {
  const res = await staysOut(path);
  if (res && canonicals(res.html)[0] !== `${SITE}${path}`) fail(path, `canonical ${canonicals(res.html)[0]}, expected its own address (a noindex page is never a rival of the Indonesian one)`);
}
ok(`${englishPaths.length} English page(s): 200, noindex in the tags and in the header, not listed`);

// Ilmu Waris: hidden (404) unless shown, and never indexed even when shown.
for (const path of ["/belajar/id/waris", "/belajar/id/waris/hitung", "/belajar/id/waris/laporan", "/belajar/en/waris"]) {
  if (WARIS_ON) await staysOut(path);
  else await answers404(path);
}
ok(`Ilmu Waris: ${WARIS_ON ? "200 with noindex in the tags and the header" : "404 while hidden"}, not listed`);

// A surah that is not published: unlisted answers at its address and says noindex; the others are 404.
for (const slug of unlisted) {
  for (const path of [`/belajar/id/quran/${slug}`, ...SURAH[slug].ayat.map((a) => `/belajar/id/quran/${slug}/${a.ayah}`)]) {
    // The prerendered page's own tags are fixed at build time, so only the header (src/proxy.ts) is required here.
    await staysOut(path, { meta: false });
  }
  await staysOut(`/belajar/id/quran/${slug}/1/og`, { meta: false });
}
for (const slug of hidden) for (const path of [`/belajar/id/quran/${slug}`, `/belajar/id/quran/${slug}/1`]) await answers404(path);
ok(`unpublished surahs: ${unlisted.length ? `${unlisted} answers 200 with an X-Robots-Tag noindex` : "none unlisted"}${hidden.length ? `; ${hidden} 404` : ""}; none listed`);

// The Kosakata list: a real page is one thing, every other address another.
{
  const second = await get(`/belajar/id/kosakata?hal=2&utm_source=share&utm_medium=whatsapp`);
  if (second.status !== 200) fail("?hal=2&utm…", `status ${second.status}`);
  else {
    if (metaNoindex(second) || headerNoindex(second)) fail("?hal=2&utm…", "tracking tags make a list page noindex");
    if (canonicals(second.html)[0] !== `${MOD}/id/kosakata?hal=2`) fail("?hal=2&utm…", `canonical ${canonicals(second.html)[0]}, expected the page's own address without the tags`);
  }
  // The proxy judges the shape of the address; only the page itself knows a page is past the last.
  const syntactic = ["q=tangan", "q=", "hal=0", "hal=01", "hal=abc", "hal=1&hal=2", "hal=2&q=tangan"];
  for (const query of syntactic) await staysOut(`/belajar/id/kosakata?${query}`, { canonical: false });
  await staysOut(`/belajar/id/kosakata?hal=${PAGES + 1}`, { header: false, canonical: false });
  ok(`the Kosakata list: ?hal=2 with tracking tags is page 2; ${syntactic.length + 1} search / variant addresses are noindex, with no canonical`);
  const bare = await get("/belajar/id/kosakata");
  if (PATH_ON) {
    const to = bare.headers.get("location") ?? "";
    if (bare.status !== 307 || !to.endsWith("/belajar/id/kosakata/bertahap")) fail("/belajar/id/kosakata", `${bare.status} → ${to}, expected 307 to the learning path while it is listed`);
  } else if (bare.status !== 200 || canonicals(bare.html)[0] !== `${MOD}/id/kosakata?hal=1` || metaNoindex(bare) || headerNoindex(bare)) {
    fail("/belajar/id/kosakata", `${bare.status}, canonical ${canonicals(bare.html)[0]}: expected the first page, canonical ?hal=1, indexable`);
  }
}

// The learning path: its overview follows the switch, its cards and tests are never indexed.
if (!PATH_ON) await staysOut("/belajar/id/kosakata/bertahap");
for (const path of ["/belajar/id/kosakata/bertahap/1/1", "/belajar/id/kosakata/bertahap/1/1/tes", "/belajar/id/kosakata/bertahap/1/tes"]) await staysOut(path);
ok(`the learning path: ${PATH_ON ? "overview listed" : "overview unlisted, so noindex"}; a batch card, a batch test and a level test are noindex`);

// A lesson word's entry no published surah uses: the page answers 200 with noindex in its own tag (the proxy
// has no content, so no header is asked), and it is not in the sitemap.
const unusedWords = LEXEMES.filter((l) => !l.surahs.some((slug) => published.has(slug)));
for (const l of unusedWords.slice(0, 3)) await staysOut(`/belajar/id/kosakata/${l.id}`, { header: false });
ok(`lesson words: ${unusedWords.length} entr${unusedWords.length === 1 ? "y" : "ies"} used by no published surah are noindex in their tag and not listed (${LEXEMES.length - unusedWords.length} listed)`);

// The word pages: noindex unless the operator takes them.
if (!WORDS_ON) {
  await staysOut("/belajar/id/kosakata/kata/1");
  await staysOut("/belajar/id/kosakata/kata/4832");
  ok("word pages: noindex in the tags and the header, not listed (BELAJAR_KOSAKATA_WORDS_INDEXED unset)");
}

// Share cards (images) and the JSON endpoints.
for (const path of ["/belajar/id/og", "/belajar/id/quran/og", "/belajar/id/quran/kurikulum/og", "/belajar/id/quran/rumus/og", `/belajar/id/quran/${[...published][0]}/1/og`, "/belajar/en/og"]) {
  const res = await get(path);
  if (res.status !== 200 || !res.type.startsWith("image/")) fail(path, `status ${res.status} ${res.type}, expected a card`);
  if (!headerNoindex(res)) fail(path, `no X-Robots-Tag noindex (${JSON.stringify(res.headers.get("x-robots-tag"))}): an image is kept out by a header, not a tag`);
}
for (const path of ["/belajar/api/health", "/belajar/api/surahs", "/belajar/api/ayah?loc=1:1"]) {
  const res = await get(path);
  if (res.status >= 500) fail(path, `status ${res.status}`);
  if (!headerNoindex(res)) fail(path, `no X-Robots-Tag noindex (${JSON.stringify(res.headers.get("x-robots-tag"))})`);
}
ok("share cards and the JSON endpoints answer X-Robots-Tag: noindex");

if (problems.length) {
  console.log(`\n✗ ${problems.length} search-engine problem(s) (listed above)`);
  process.exit(1);
}
console.log(`✓ seo smoke ok: ${listed.length} address(es) in the sitemap, ${sweep.length} fetched; what must stay out stays out`);
