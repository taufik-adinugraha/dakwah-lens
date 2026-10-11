// CI-only: smoke checks of the Dakwah-Lens brand, the bridges to the main site and the share
// cards on the REAL image (the workflow starts it on :3300, production-like: no BELAJAR_WARIS).
// Operator, 2026-10-10: "we hope this feature can increase traffic to main app dakwah-lens.id. at
// least we should put logo there".
//
// What the server renders (the rendered DOM, layout and clicks are scripts/ci/screenshots.mjs):
//   - the header: an <img alt="Dakwah-Lens"> of the logo, served by next/image (fetched: 200, an
//     image); the head: the main site's favicon and apple-touch icon under /belajar, the same bytes;
//   - the footer: "Bagian dari Dakwah-Lens" / "Part of Dakwah-Lens" linking to the main site's home
//     in the page's locale, UTM-tagged. Matched inside <header> / <footer> only: next-intl puts the
//     whole message catalogue into every page's scripts, so a plain grep for the words would pass
//     on any page;
//   - the bridges in the static HTML (hub, track, the two inside "Materi lengkap ayat ini") with the
//     main-site addresses verified by page title (src/lib/mainSite.ts), written out here again;
//   - og:* / twitter:* on the hub, the track and every published lesson: og:url = the canonical
//     link, the image = the page's own /og card; the pages stay noindex;
//   - every card: 200, image/png, a real PNG of 1200×630; unknown lessons' cards 404; nothing
//     hidden is shared: the waris address's 404 page carries no card and no share button, and
//     where the image lists its published surahs (/belajar/api/surahs, BELAJAR_SURAHS) an
//     unpublished lesson's page and card both answer 404.
//
// Every problem is listed, then the script exits 1. Node 20+ (global fetch), no dependencies.
import { readdir, readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3300";
const BELAJAR = new URL("../../", import.meta.url);
const SITE = "https://dakwah-lens.id";

const problems = [];
const fail = (where, msg) => {
  problems.push(`${where}: ${msg}`);
  console.log(`✗ ${where}: ${msg}`);
};
const ok = (msg) => console.log(`  ${msg}`);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
/** Every <tag …> of a kind in `html`, its attributes decoded. */
const tags = (html, name) =>
  [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)])),
  );
const region = (html, name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(html)?.[1] ?? "";
/** Visible text of an HTML fragment (tags dropped, entities decoded). */
const text = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const meta = (html, key) => tags(html, "meta").find((m) => m.property === key || m.name === key)?.content;
const utm = (campaign) => `utm_source=belajar&utm_medium=referral&utm_campaign=${campaign}`;

// Fetched as WhatsApp's link-preview crawler asks: the real consumer of the og: tags. Next sends
// HTML-limited bots (WhatsApp, facebookexternalhit, Twitterbot …) the metadata in <head>; a plain
// client of a request-time page (the hub) would get it streamed into <body> instead. Meta and
// link tags are matched anywhere in the document either way (the RSC payload carries them as
// JSON, never as <meta>/<link> markup).
const UA = "WhatsApp/2.24.1 A";

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { "user-agent": UA } });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
}
async function page(path) {
  const r = await get(path);
  if (r.status !== 200) fail(path, `status ${r.status}`);
  return r.body.toString("utf8");
}

/** A PNG of exactly 1200×630: signature, then the IHDR width and height. */
function pngSize(buf) {
  const sig = buf.subarray(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a" || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const LABELS = {
  id: { part_of: "Bagian dari Dakwah-Lens", ayah: "Ayat", track: "Belajar Bahasa Arab Al-Qur'an" },
  en: { part_of: "Part of Dakwah-Lens", ayah: "Ayah", track: "Learn Qur'anic Arabic" },
};

// ── Header, head icons, footer: on every kind of page, both locales ──────────────────────────
async function chrome(path, locale) {
  const html = await page(path);
  const header = region(html, "header");
  const logo = tags(header, "img").find((i) => i.alt === "Dakwah-Lens");
  if (!logo) fail(path, 'no <img alt="Dakwah-Lens"> in <header>');
  else {
    const src = logo.src ?? "";
    if (!src.startsWith("/belajar/_next/image?url=%2Fbelajar%2Fdakwah-lens-logo-short-removebg.png")) {
      fail(path, `header logo src is not the next/image rendition of the logo: ${src}`);
    } else {
      const img = await get(src);
      if (img.status !== 200 || !img.type.startsWith("image/")) fail(path, `header logo ${src} → ${img.status} ${img.type}`);
    }
    if (!/Dakwah-Lens/.test(text(header))) fail(path, "the header shows no 'Dakwah-Lens' words beside the logo");
  }
  const links = tags(html, "link");
  const icon = links.find((l) => l.rel === "icon")?.href ?? "";
  const apple = links.find((l) => l.rel === "apple-touch-icon")?.href ?? "";
  if (!icon.startsWith("/belajar/favicon.ico")) fail(path, `<link rel="icon"> is ${icon || "missing"}`);
  if (!apple.startsWith("/belajar/apple-icon.png")) fail(path, `<link rel="apple-touch-icon"> is ${apple || "missing"}`);

  const footer = region(html, "footer");
  const want = `${SITE}/${locale}?${utm("footer")}`;
  const a = tags(footer, "a").find((t) => t["data-main-site"] === "footer");
  if (!a) fail(path, 'no <a data-main-site="footer"> in <footer>');
  else if (a.href !== want) fail(path, `footer link href ${a.href}, expected ${want}`);
  const part = new RegExp(`<a\\b[^>]*data-main-site="footer"[^>]*>([\\s\\S]*?)</a>`).exec(footer)?.[1] ?? "";
  if (text(part) !== LABELS[locale].part_of) fail(path, `footer link text "${text(part)}", expected "${LABELS[locale].part_of}"`);
  if (locale === "id" && !text(footer).includes("Dibantu AI, bukan fatwa otoritatif")) fail(path, "the footer's AI label is gone");
  return html;
}

// ── Share metadata and the card it names ─────────────────────────────────────────────────────
async function shareMeta(path, html, { card, title }) {
  const canonical = tags(html, "link").find((l) => l.rel === "canonical")?.href;
  const ogUrl = meta(html, "og:url");
  if (!canonical || ogUrl !== canonical) fail(path, `og:url ${ogUrl} ≠ canonical ${canonical}`);
  if (canonical !== `${SITE}${path}`) fail(path, `canonical ${canonical}, expected ${SITE}${path}`);
  const image = meta(html, "og:image");
  if (image !== `${SITE}${card}`) fail(path, `og:image ${image}, expected ${SITE}${card}`);
  if (meta(html, "og:image:width") !== "1200" || meta(html, "og:image:height") !== "630") fail(path, "og:image size is not 1200×630");
  if (meta(html, "twitter:card") !== "summary_large_image") fail(path, `twitter:card ${meta(html, "twitter:card")}`);
  if (meta(html, "twitter:image") !== `${SITE}${card}`) fail(path, `twitter:image ${meta(html, "twitter:image")}`);
  if (title && meta(html, "og:title") !== title) fail(path, `og:title "${meta(html, "og:title")}", expected "${title}"`);
  if (!meta(html, "og:description")) fail(path, "no og:description");
  // The module stays a noindex beta (lib/flags.ts); sharing must not change that.
  if (!/noindex/.test(meta(html, "robots") ?? "")) fail(path, `robots is "${meta(html, "robots")}", expected noindex`);
}

async function cardImage(card) {
  const r = await get(card);
  const size = pngSize(r.body);
  if (r.status !== 200 || !r.type.startsWith("image/png") || !size || size[0] !== 1200 || size[1] !== 630) {
    fail(card, `→ ${r.status} ${r.type} ${size ? size.join("×") : "not a PNG"} (expected 200 image/png 1200×630)`);
    return false;
  }
  return true;
}

/** A bridge in the page's static HTML: a <p data-main-site=id> holding one <a> to `want`. */
function bridge(path, html, id, want) {
  const p = new RegExp(`<p\\b[^>]*data-main-site="${id}"[^>]*>([\\s\\S]*?)</p>`).exec(region(html, "main"))?.[1];
  if (!p) return fail(path, `no bridge data-main-site="${id}" in <main>`);
  const href = tags(p, "a")[0]?.href;
  if (href !== want) fail(path, `bridge ${id} → ${href}, expected ${want}`);
  if (!text(p)) fail(path, `bridge ${id} has no words`);
}

/** The "Bagikan" button with its WhatsApp fallback link, UTM-tagged, for `url`. */
function shareButton(path, html, url) {
  const main = region(html, "main");
  if (!/data-share-toggle=""/.test(main)) return fail(path, "no Bagikan button (data-share-toggle) in <main>");
  const wa = tags(main, "a").find((a) => "data-share-whatsapp" in a)?.href ?? "";
  let sent = "";
  try {
    sent = new URL(wa).searchParams.get("text") ?? "";
  } catch {
    sent = "";
  }
  if (!wa.startsWith("https://wa.me/?text=") || !sent.endsWith(`${url}?utm_source=share&utm_medium=whatsapp`)) {
    fail(path, `WhatsApp link ${wa} does not carry ${url}?utm_source=share&utm_medium=whatsapp`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

const all = [];
for (const name of (await readdir(new URL("content/", BELAJAR))).filter((n) => /^[a-z-]+\.json$/.test(n) && n !== "library.json")) {
  const c = JSON.parse(await readFile(new URL(`content/${name}`, BELAJAR), "utf8"));
  if (!Array.isArray(c.ayat)) continue;
  for (const a of c.ayat) all.push({ slug: c.slug, name: c.name_id, ayah: a.ayah });
}
if (all.length === 0) fail("setup", "no lessons read from content/");

// Which surahs visitors can reach: /belajar/api/surahs where the image has it (BELAJAR_SURAHS,
// feat/belajar-fatihah-first: Al-Fatihah only by default), else every surah in content/. A
// lesson that is not published must show nothing, its share card included: both 404.
let published = null;
{
  const r = await get("/belajar/api/surahs");
  if (r.status === 200) {
    try {
      published = new Set(JSON.parse(r.body.toString("utf8")).published);
    } catch {
      fail("/belajar/api/surahs", "not the expected JSON { published: [...] }");
    }
  }
}
const lessons = published ? all.filter((l) => published.has(l.slug)) : all;
const hidden = published ? all.filter((l) => !published.has(l.slug)) : [];
console.log(`${lessons.length} published lesson(s)${hidden.length ? `, ${hidden.length} hidden` : ""}`);

for (const locale of ["id", "en"]) {
  console.log(`— ${locale}`);
  const hubPath = `/belajar/${locale}`;
  const hub = await chrome(hubPath, locale);
  await shareMeta(hubPath, hub, { card: `${hubPath}/og` });
  bridge(hubPath, hub, "hub", `${SITE}/${locale}?${utm("hub")}`);

  const trackPath = `/belajar/${locale}/quran`;
  const track = await chrome(trackPath, locale);
  await shareMeta(trackPath, track, { card: `${trackPath}/og` });
  bridge(trackPath, track, "track", `${SITE}/${locale}/kitab?${utm("track")}`);
  shareButton(trackPath, track, `${SITE}${trackPath}`);

  for (const card of [`${hubPath}/og`, `${trackPath}/og`]) if (await cardImage(card)) ok(`${card}: 1200×630 PNG`);

  // Every lesson: its og tags name its own card, and the card is drawn.
  let cards = 0;
  for (const { slug, name, ayah } of lessons) {
    const path = `/belajar/${locale}/quran/${slug}/${ayah}`;
    const card = `${path}/og`;
    if (await cardImage(card)) cards++;
    // Header, footer, bridges and the share button on two lessons; og tags on all of them.
    const html = slug === "al-fatihah" && (ayah === 1 || ayah === 7) ? await chrome(path, locale) : await page(path);
    await shareMeta(path, html, { card, title: `${name} · ${LABELS[locale].ayah} ${ayah} · ${LABELS[locale].track}` });
    if (slug === "al-fatihah" && ayah === 1) {
      bridge(path, html, "ayah_kitab", `${SITE}/${locale}/kitab?${utm("ayah-materials")}`);
      bridge(path, html, "ayah_khutbah", `${SITE}/${locale}/khutbah-kultum?${utm("ayah-materials")}`);
      shareButton(path, html, `${SITE}${path}`);
    }
  }
  ok(`${cards}/${lessons.length} lesson cards drawn (${locale})`);
}

// Icons: the main site's own files, served under the basePath.
for (const [path, file, type] of [
  ["/belajar/favicon.ico", "src/app/favicon.ico", /^image\/(x-icon|vnd\.microsoft\.icon)/],
  ["/belajar/apple-icon.png", "src/app/apple-icon.png", /^image\/png/],
]) {
  const r = await get(path);
  const want = await readFile(new URL(file, BELAJAR));
  if (r.status !== 200 || !type.test(r.type) || !r.body.equals(want)) fail(path, `→ ${r.status} ${r.type}, ${r.body.length} bytes (expected ${file}, ${want.length} bytes)`);
  else ok(`${path}: ${r.type}, ${r.body.length} bytes`);
}

// No card for what does not exist, and none for hidden content.
for (const path of ["/belajar/id/quran/al-fatihah/8/og", "/belajar/id/quran/al-baqarah/1/og", "/belajar/en/quran/an-nas/7/og"]) {
  const r = await get(path);
  if (r.status !== 404) fail(path, `status ${r.status}, expected 404`);
}
for (const path of ["/belajar/id/waris", "/belajar/en/waris/hitung"]) {
  const r = await get(path);
  const html = r.body.toString("utf8");
  if (r.status !== 404) fail(path, `status ${r.status}, expected 404 (the track is hidden)`);
  if (meta(html, "og:image") || meta(html, "twitter:image")) fail(path, "the hidden track's 404 page carries a share card");
  if (/data-share-toggle/.test(region(html, "main"))) fail(path, "the hidden track's 404 page carries a share button");
}
for (const { slug, ayah } of hidden) {
  for (const locale of ["id", "en"]) {
    const path = `/belajar/${locale}/quran/${slug}/${ayah}`;
    const [pg, card] = [await get(path), await get(`${path}/og`)];
    const html = pg.body.toString("utf8");
    if (pg.status !== 404 || card.status !== 404) fail(path, `unpublished lesson: page ${pg.status}, card ${card.status} (expected 404, 404)`);
    if (meta(html, "og:image") || /data-share-toggle/.test(region(html, "main"))) fail(path, "an unpublished lesson's 404 carries a share card or button");
  }
}
if (hidden.length) ok(`${hidden.length} unpublished lesson(s): page and card 404 in id + en`);

if (problems.length) {
  console.log(`\n✗ ${problems.length} brand / bridge / share problem(s) (listed above)`);
  process.exit(1);
}
console.log("✓ brand, bridges and share cards ok");
