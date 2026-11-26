import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";

import { SURAHS } from "./content";
import { type IndexingRuntime, noindexReason } from "./indexing";
import { listAddress, pageCount } from "./kosakata-core";
import { LEXEMES } from "./lexemes";
import { LIBRARY } from "./library";
import { SURAH_SLUGS } from "./routes";
import { sitemapEntries } from "./sitemap-paths";

// THE CI SEARCH-ENGINE SMOKE (scripts/ci/seo-smoke.mjs), TRIED WITHOUT A BUILD. CI runs the script on the
// real image, about forty-eight minutes into a run; this runs it here against a small model of the module
// that serves what the real one is meant to (the same policy functions the app uses, and pages shaped like
// the real ones), so a mistake in the script's own reading of HTML, headers and the sitemap shows at once,
// and so that the faults it exists to catch are planted one at a time and each is seen to fail it, with its
// own message. The model is not the app: that the real pages and headers agree with it is what the script
// finds out on the image.

const SCRIPT = fileURLToPath(new URL("../../scripts/ci/seo-smoke.mjs", import.meta.url));
const WORDS = 4832;
const PAGES = pageCount(WORDS);
const CONCEPTS = [...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)];
const SITE = "https://dakwah-lens.id";

type Reply = { status: number; headers: Record<string, string>; body: string | Buffer };
type Request = { path: string; search: URLSearchParams; locale: string };
type Model = {
  /** BELAJAR_SURAHS, and the unlisted ones (BELAJAR_UNLISTED) that answer at their address. */
  published: string[];
  unlisted?: string[];
  waris?: boolean;
  pathListed?: boolean;
  wordsIndexed?: boolean;
  /** Plant a fault: change a reply before it is sent. */
  tweak?: (request: Request, reply: Reply) => void;
  /** Plant a fault in the sitemap's addresses. */
  sitemap?: (urls: string[]) => string[];
};

function runtime(model: Model, listPages: number | null): IndexingRuntime {
  return {
    public: true,
    locales: ["id"],
    published: new Set(model.published),
    waris: !!model.waris,
    pathListed: !!model.pathListed,
    kosakataEnglish: false,
    wordsIndexed: !!model.wordsIndexed,
    listPages,
    // The page (and the sitemap) know which surahs use each lesson word; the proxy does not.
    lexemeSurahs: listPages === null ? null : new Map(LEXEMES.map((l) => [l.id, l.surahs] as const)),
  };
}

const html = (locale: string, title: string, description: string, head: string, main: string) =>
  `<!DOCTYPE html><html lang="${locale}"><head><meta charSet="utf-8"/><title>${title}</title>` +
  `<meta name="description" content="${description}"/>${head}</head><body><header>Belajar</header><main>${main}</main>` +
  `<footer><p>Dibantu AI, bukan fatwa otoritatif. Penjelasan disusun dari kitab; periksa rujukannya.</p></footer></body></html>`;

/** What the module answers for one request: the model's reading of the policy, in the shapes the real pages have. */
function answer(model: Model, url: URL): Reply {
  const path = url.pathname.replace(/^\/belajar/, "") || "/";
  const search = url.searchParams;
  const locale = path.split("/")[1];
  const json = (value: unknown): Reply => ({ status: 200, headers: { "content-type": "application/json", "x-robots-tag": "noindex" }, body: JSON.stringify(value) });
  if (path === "/api/surahs") return json({ published: model.published });
  if (path.startsWith("/api/")) return json({ ok: true });
  if (path === "/sitemap.xml") {
    const entries = sitemapEntries({
      rt: runtime(model, null),
      allLocales: routing.locales,
      defaultLocale: routing.defaultLocale,
      surahs: SURAHS.map((s) => ({ slug: s.slug, ayat: s.ayat.map((a) => a.ayah) })),
      concepts: CONCEPTS,
      lexemes: LEXEMES,
      kosakataWords: WORDS,
    });
    const urls = (model.sitemap ?? ((u) => u))(entries.map((e) => e.url));
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("")}</urlset>`;
    return { status: 200, headers: { "content-type": "application/xml" }, body: xml };
  }
  if (path.endsWith("/og")) {
    return { status: 200, headers: { "content-type": "image/png", "x-robots-tag": "noindex, follow" }, body: Buffer.from("png") };
  }
  const notFound: Reply = { status: 404, headers: { "content-type": "text/html" }, body: html("id", "Belajar", "Halaman tidak ditemukan, kembali ke beranda Belajar.", '<meta name="robots" content="noindex"/>', "404") };
  const segment = /^\/[a-z]{2}\/quran\/([a-z-]+)(?:\/|$)/.exec(path)?.[1];
  // A surah of the module (not the track's other pages: lesson zero, the curriculum, the cheat sheet).
  const surah = segment && (SURAH_SLUGS as readonly string[]).includes(segment) ? segment : undefined;
  const reachable = new Set([...model.published, ...(model.unlisted ?? [])]);
  if (surah && !reachable.has(surah)) return notFound;
  if (/^\/[a-z]{2}\/waris(?:\/|$)/.test(path) && !model.waris) return notFound;
  if (path === `/${locale}/kosakata` && model.pathListed && !search.has("hal") && !search.has("q")) {
    return { status: 307, headers: { location: `/belajar/${locale}/kosakata/bertahap` }, body: "" };
  }

  // A page: its header is what the proxy says (it cannot count the list's pages), its tags what the page says.
  const header = noindexReason(path, search, runtime(model, null)) !== null;
  let meta = noindexReason(path, search, runtime(model, PAGES)) !== null;
  // A prerendered lesson page's own tags were fixed at build time: it cannot know the switch, the header does.
  if (surah && !model.published.includes(surah)) meta = false;
  let canonical: string | null = `${SITE}/belajar${path}`;
  if (path === `/${locale}/kosakata`) {
    const address = listAddress(search.getAll("hal"), search.getAll("q"), PAGES);
    canonical = address ? `${SITE}/belajar/${locale}/kosakata?hal=${address.page}` : null;
  }
  const label = `${path}${url.search}`;
  const head =
    (meta ? '<meta name="robots" content="noindex, follow"/>' : "") + (canonical ? `<link rel="canonical" href="${canonical}"/>` : "");
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(header ? { "x-robots-tag": "noindex, follow" } : {}) },
    body: html(locale, `Halaman ${label} · Belajar · Dakwah-Lens`, `Deskripsi halaman ${label}: cukup panjang untuk lolos pemeriksaan mesin pencari.`, head, `isi ${label}`),
  };
}

let server: Server;
let model: Model = { published: ["al-fatihah"], unlisted: ["al-ikhlas"] };
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://model");
    const reply = answer(model, url);
    model.tweak?.({ path: url.pathname, search: url.searchParams, locale: url.pathname.split("/")[2] ?? "" }, reply);
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Run the CI script against the model; its output and exit code. */
function smoke(next: Model, ...flags: string[]): Promise<{ code: number | null; out: string }> {
  model = next;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, BASE_URL: base } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}
const EVERY = [...SURAH_SLUGS];
const DEFAULT: Model = { published: ["al-fatihah"], unlisted: ["al-ikhlas"] };
/** The script fails, and says this. */
async function catches(fault: Model, expected: RegExp, ...flags: string[]) {
  const { code, out } = await smoke(fault, ...flags);
  expect(code, out.slice(-1500)).toBe(1);
  expect(out).toMatch(expected);
}

describe("scripts/ci/seo-smoke.mjs passes a module that does what it should", () => {
  it("in production's defaults (the image smoke step): Al-Fatihah published, Al-Ikhlas unlisted, the path not listed", async () => {
    const { code, out } = await smoke(DEFAULT);
    expect(code, out.slice(-1500)).toBe(0);
    expect(out).toMatch(/seo smoke ok: 125 address\(es\) in the sitemap/);
    expect(out).toContain("published surahs: al-fatihah");
  }, 120_000);

  it("with the learning path listed (the shots job, production's own switches)", async () => {
    const { code, out } = await smoke({ ...DEFAULT, pathListed: true }, "--bertahap");
    expect(code, out.slice(-1500)).toBe(0);
    expect(out).toMatch(/126 address\(es\) in the sitemap/);
  }, 120_000);

  it("with every surah published and the word pages taken (the every-surah container)", async () => {
    const { code, out } = await smoke({ published: EVERY, wordsIndexed: true }, "--surahs", "--words");
    expect(code, out.slice(-1500)).toBe(0);
    // Production's 155 without the path overview (not listed in this container), plus the other three
    // surahs (1 + 4, 1 + 5 and 1 + 6 pages), plus every word page.
    expect(out).toContain(`seo smoke ok: ${155 - 1 + (1 + 4) + (1 + 5) + (1 + 6) + WORDS} address(es) in the sitemap`);
  }, 180_000);

  it("with Ilmu Waris shown (the waris container): never listed, noindex in the tag and the header", async () => {
    const { code, out } = await smoke({ ...DEFAULT, waris: true }, "--waris");
    expect(code, out.slice(-1500)).toBe(0);
    expect(out).toContain("Ilmu Waris: 200 with noindex in the tags and the header");
  }, 120_000);
});

describe("…and fails, with its own message, for each fault it is there to catch", () => {
  it("a listed page that says noindex in a header, or in a tag", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/quran") reply.headers["x-robots-tag"] = "noindex"; } }, /\/belajar\/id\/quran: X-Robots-Tag says "noindex", but the sitemap lists it/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kredit") reply.body = String(reply.body).replace("</head>", '<meta name="robots" content="noindex, follow"/></head>'); } }, /\/belajar\/id\/kredit: robots meta says/);
  }, 120_000);

  it("a canonical that is not the page's own, or missing", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/konsep/harakat") reply.body = String(reply.body).replace(/<link rel="canonical" href="[^"]*"\/>/, '<link rel="canonical" href="https://dakwah-lens.id/belajar/id/konsep"/>'); } }, /harakat: canonical https:\/\/dakwah-lens\.id\/belajar\/id\/konsep, expected/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/quran/rumus") reply.body = String(reply.body).replace(/<link rel="canonical"[^>]*>/, ""); } }, /rumus: 0 canonical links, expected one/);
  }, 120_000);

  it("pages that share a title or a description, a description that is missing", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/quran/rumus" || r.path === "/belajar/id/quran/kurikulum") reply.body = String(reply.body).replace(/<title>[^<]*<\/title>/, "<title>Sama</title>"); } }, /title "Sama" is also/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kredit" || r.path === "/belajar/id/konsep") reply.body = String(reply.body).replace(/(<meta name="description" content=")[^"]*/, "$1Deskripsi yang sama untuk dua halaman, cukup panjang untuk lolos"); } }, /meta description is also/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kredit") reply.body = String(reply.body).replace(/<meta name="description"[^>]*>/, ""); } }, /kredit: not exactly one meta description/);
  }, 120_000);

  it("hreflang, in a tag or in the Link header, while only Indonesian is indexed", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id") reply.body = String(reply.body).replace("</head>", '<link rel="alternate" hrefLang="en" href="https://dakwah-lens.id/belajar/en"/></head>'); } }, /hreflang alternate\(s\), but only Indonesian is indexed/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id") reply.headers.link = '<https://dakwah-lens.id/belajar/en>; rel="alternate"; hreflang="en"'; } }, /a Link header with hreflang/);
  }, 120_000);

  it("a promise of a review, and a footer without the AI-assisted label", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/quran/al-fatihah/3") reply.body = String(reply.body).replace("isi", "terjemahan menunggu tinjauan ustadz, isi"); } }, /al-fatihah\/3: promises a human review: "tinjauan ustadz"/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/konsep") reply.body = String(reply.body).replace("Dibantu AI, bukan fatwa otoritatif", "Belajar"); } }, /the footer does not carry "Dibantu AI, bukan fatwa otoritatif"/);
  }, 120_000);

  it("a sitemap that lists what must stay out, or leaves out what may be indexed", async () => {
    const extra = (url: string) => (urls: string[]) => [...urls, url];
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/en`) }, /lists https:\/\/dakwah-lens\.id\/belajar\/en, which is not one of the pages that may be indexed/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/waris/hitung`) }, /waris\/hitung.*(?:not one of the pages|must stay out)/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/quran/al-ikhlas/1`) }, /al-ikhlas\/1.*(?:not published|not one of the pages)/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/kosakata?q=tangan`) }, /\?q=tangan/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/kosakata/bertahap/1/1`) }, /bertahap\/1\/1/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/kosakata/kata/1`) }, /kosakata\/kata\/1.*(?:word pages|not one of the pages)/);
    await catches({ ...DEFAULT, sitemap: extra(`${SITE}/belajar/id/quran/kurikulum`) }, /listed twice/);
    await catches({ ...DEFAULT, sitemap: (urls) => urls.filter((u) => !u.endsWith("/quran/rumus")) }, /does not list https:\/\/dakwah-lens\.id\/belajar\/id\/quran\/rumus, which may be indexed/);
    await catches({ ...DEFAULT, sitemap: (urls) => urls.map((u) => u.replace("https://dakwah-lens.id", "http://dakwah-lens.id")) }, /does not list|lists http/);
  }, 120_000);

  it("what must stay out but answers without saying noindex", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/en/kredit") { delete reply.headers["x-robots-tag"]; } } }, /\/belajar\/en\/kredit: no noindex in the X-Robots-Tag header/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/en/quran") reply.body = String(reply.body).replace('<meta name="robots" content="noindex, follow"/>', ""); } }, /\/belajar\/en\/quran: no noindex in the robots meta/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/quran/al-ikhlas/1") delete reply.headers["x-robots-tag"]; } }, /al-ikhlas\/1: no noindex in the X-Robots-Tag header/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kosakata" && r.search.has("q")) { delete reply.headers["x-robots-tag"]; reply.body = String(reply.body).replace('<meta name="robots" content="noindex, follow"/>', ""); } } }, /kosakata\?q=.*no noindex/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kosakata" && r.search.get("hal") === "0") reply.body = String(reply.body).replace("</head>", '<link rel="canonical" href="https://dakwah-lens.id/belajar/id/kosakata?hal=1"/></head>'); } }, /hal=0: has a canonical link/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kosakata/bertahap/1/1/tes") delete reply.headers["x-robots-tag"]; } }, /bertahap\/1\/1\/tes: no noindex in the X-Robots-Tag header/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kosakata/kata/1") delete reply.headers["x-robots-tag"]; } }, /kata\/1: no noindex in the X-Robots-Tag header/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/og") delete reply.headers["x-robots-tag"]; } }, /\/belajar\/id\/og: no X-Robots-Tag noindex/);
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/api/health") delete reply.headers["x-robots-tag"]; } }, /api\/health: no X-Robots-Tag noindex/);
  }, 180_000);

  it("a variant address that makes a list page noindex, and a waris track that is reachable while hidden", async () => {
    await catches({ ...DEFAULT, tweak: (r, reply) => { if (r.path === "/belajar/id/kosakata" && r.search.get("utm_source") === "share") reply.headers["x-robots-tag"] = "noindex"; } }, /tracking tags make a list page noindex/);
    await catches({ ...DEFAULT, waris: true }, /waris.*status 200, expected 404 \(hidden\)/);
  }, 120_000);

  it("a container whose published surahs are not the ones the run was told", async () => {
    await catches({ published: EVERY }, /the container publishes \[al-fatihah,al-ikhlas,al-falaq,an-nas\], this run expected \[al-fatihah\]/);
    await catches({ ...DEFAULT }, /the container publishes \[al-fatihah\], this run expected \[al-fatihah,al-ikhlas,al-falaq,an-nas\]/, "--surahs");
  }, 120_000);
});
