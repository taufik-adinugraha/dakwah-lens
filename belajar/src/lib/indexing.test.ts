import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { INDEXED_LOCALES, routing } from "@/i18n/routing";

import { SURAHS } from "./content";
import { type IndexingRuntime, indexingRuntime, layoutRobots, localeIndexed, noindexReason } from "./indexing";
import { listAddress, pageCount } from "./kosakata-core";
import { LEXEMES } from "./lexemes";
import { LIBRARY } from "./library";
import { SURAH_SLUGS } from "./routes";
import { NOINDEX, NOINDEX_HEADER, shorten } from "./seo";
import { sitemapEntries, type SitemapInput } from "./sitemap-paths";

// WHAT SEARCH ENGINES MAY INDEX (docs/belajar-plan.md L42; operator 2026-11-26: "publish belajar so
// google can see"). One question — lib/indexing.ts noindexReason — is asked by the proxy (a header),
// the sitemap and the pages' tags; here it is held to the list the operator gave, and to every switch
// that hides something, so a hidden feature cannot leak into the index. That the real pages and the
// real headers agree with it is CI's (scripts/ci/seo-smoke.mjs, on the image).

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

/** The production switches: Al-Fatihah published, the learning path listed, the word pages not taken. */
const rt = (over: Partial<IndexingRuntime> = {}): IndexingRuntime => ({
  public: true,
  locales: ["id"],
  published: new Set(["al-fatihah"]),
  waris: false,
  pathListed: true,
  kosakataEnglish: false,
  wordsIndexed: false,
  // As the proxy has it: it does not know how many pages the list has.
  listPages: null,
  lexemeSurahs: null,
  ...over,
});
const EVERY_SURAH = new Set<string>(SURAH_SLUGS);
const reason = (path: string, query = "", over: Partial<IndexingRuntime> = {}) =>
  noindexReason(path, new URLSearchParams(query), rt(over));

const WORDS = (JSON.parse(read("content/kosakata/index.json")) as { rows: unknown[] }).rows.length;
const PAGES = pageCount(WORDS);

const BASE = "https://dakwah-lens.id/belajar/id";
const CONCEPTS = [...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)];
/** The lesson words' entries a set of published surahs makes indexable (an entry nobody published uses is not). */
const lexemesOf = (published: ReadonlySet<string>) => LEXEMES.filter((l) => l.surahs.some((s) => published.has(s))).map((l) => l.id);
/** Counted from content/*.json by hand: the entries Al-Fatihah's words use (52 in all; 29 are used only by Al-Ikhlas, Al-Falaq or An-Nas). */
const LEXEME_PRODUCTION = 23;
const LEXEME_SURAHS = new Map(LEXEMES.map((l) => [l.id, l.surahs] as const));
const input = (over: Partial<IndexingRuntime> = {}): SitemapInput => ({
  rt: rt(over),
  allLocales: routing.locales,
  defaultLocale: routing.defaultLocale,
  surahs: SURAHS.map((s) => ({ slug: s.slug, ayat: s.ayat.map((a) => a.ayah) })),
  concepts: CONCEPTS,
  lexemes: LEXEMES,
  kosakataWords: WORDS,
});
const urls = (over: Partial<IndexingRuntime> = {}) => sitemapEntries(input(over)).map((e) => e.url);

const saved = process.env.BELAJAR_PUBLIC;
afterEach(() => {
  if (saved === undefined) delete process.env.BELAJAR_PUBLIC;
  else process.env.BELAJAR_PUBLIC = saved;
});

describe("what is indexable: the Indonesian pages that are live and published", () => {
  it("says yes to every kind of page the operator listed", () => {
    for (const path of [
      "/id",
      "/id/quran",
      "/id/quran/al-fatihah",
      "/id/quran/al-fatihah/1",
      "/id/quran/al-fatihah/7",
      "/id/quran/pengantar",
      "/id/quran/kurikulum",
      "/id/quran/rumus",
      "/id/konsep",
      "/id/konsep/harakat",
      "/id/konsep/huruf-jar",
      "/id/kosakata/allah",
      "/id/kosakata/bertahap",
      "/id/kredit",
    ]) {
      expect(reason(path), path).toBeNull();
    }
    // The Kosakata list: its pages, and tracking tags that leave the page what it is.
    for (const query of ["", "hal=1", "hal=49", "hal=2&utm_source=share&utm_medium=whatsapp"]) {
      expect(reason("/id/kosakata", query), query).toBeNull();
    }
  });

  it("is indifferent to a trailing slash and to how the path is spelled", () => {
    expect(reason("/id/quran/al-fatihah/1/")).toBeNull();
    expect(reason("/id/quran/al-f%61tihah")).toBeNull();
  });

  it("has no opinion of a path that is no page of the module (a redirect, a 404)", () => {
    for (const path of ["/", "/foo", "/foo/quran", "/fr/quran", ""]) expect(reason(path), path).toBeNull();
  });
});

describe("what is not: hidden or unfinished things, however the switches are set", () => {
  it("English, while English is a translated shell around Indonesian lessons (INDEXED_LOCALES)", () => {
    expect([...INDEXED_LOCALES]).toEqual(["id"]);
    expect(localeIndexed("id")).toBe(true);
    expect(localeIndexed("en")).toBe(false);
    for (const path of ["/en", "/en/quran", "/en/quran/al-fatihah/1", "/en/konsep/harakat", "/en/kredit", "/en/kosakata/allah"]) {
      expect(reason(path), path).toMatch(/not indexed/);
    }
  });

  it("Ilmu Waris, even when the operator shows it", () => {
    for (const waris of [false, true]) {
      for (const path of ["/id/waris", "/id/waris/hitung", "/id/waris/laporan", "/id/waris/lainnya"]) {
        expect(reason(path, "", { waris }), `${path} waris=${waris}`).toMatch(/Waris/);
      }
    }
    // Also spelled so that something decodes it on the way.
    expect(reason("/id/w%61ris/hitung")).toMatch(/Waris/);
    expect(reason("/id/waris%2Fhitung")).toMatch(/Waris/);
  });

  it("every share card, which is an image", () => {
    for (const path of ["/id/og", "/id/quran/og", "/id/quran/kurikulum/og", "/id/quran/rumus/og", "/id/quran/al-fatihah/1/og"]) {
      expect(reason(path), path).toMatch(/share card/);
    }
  });

  it("a surah that is not published, listed or not: Al-Ikhlas answers at its address and still stays out", () => {
    for (const slug of ["al-ikhlas", "al-falaq", "an-nas"]) {
      for (const path of [`/id/quran/${slug}`, `/id/quran/${slug}/1`, `/id/quran/${slug}/2/og`, `/id/quran/${slug}/`]) {
        expect(reason(path), path).not.toBeNull();
      }
    }
    expect(reason("/id/quran/al-ikhlas/1")).toMatch(/not published/);
    expect(reason("/id/quran/al-%69khlas/1")).toMatch(/not published/);
  });

  it("…and follows BELAJAR_SURAHS: a published surah is indexable at once, the rest is not", () => {
    const some = { published: new Set(["al-fatihah", "al-falaq"]) };
    expect(reason("/id/quran/al-falaq/3", "", some)).toBeNull();
    expect(reason("/id/quran/al-falaq", "", some)).toBeNull();
    expect(reason("/id/quran/al-ikhlas/3", "", some)).not.toBeNull();
    expect(reason("/id/quran/an-nas", "", some)).not.toBeNull();
    for (const slug of SURAH_SLUGS) expect(reason(`/id/quran/${slug}/1`, "", { published: EVERY_SURAH }), slug).toBeNull();
    // A slug that is no lesson is the lesson routes' own 404, not a surah the switch hides.
    expect(reason("/id/quran/al-baqarah", "", { published: new Set() })).toBeNull();
  });

  it("lesson zero, while the surah that hosts it is not published", () => {
    expect(reason("/id/quran/pengantar", "", { published: new Set(["an-nas"]) })).toMatch(/lesson zero/);
    expect(reason("/id/quran/pengantar", "", { published: new Set(["al-fatihah"]) })).toBeNull();
  });

  it("the Kosakata list's searches and every address that is only the first page again", () => {
    for (const query of ["q=tangan", "q=", "q=rahim&hal=2", "hal=0", "hal=01", "hal=abc", "hal=", "hal=-1", "hal=1&hal=2", "hal=12345"]) {
      expect(reason("/id/kosakata", query), query).toMatch(/search or a variant/);
    }
    // The proxy cannot count the list's pages, so a page past the last is left to the page's own robots tag
    // (see page-metadata.test.ts); asked by one that can count, as the sitemap is, it is no page either.
    expect(reason("/id/kosakata", "hal=50")).toBeNull();
    expect(reason("/id/kosakata", "hal=50", { listPages: PAGES })).toMatch(/search or a variant/);
    expect(reason("/id/kosakata", "hal=49", { listPages: PAGES })).toBeNull();
  });

  it("the learning path's cards and tests, and its overview while the path is not listed", () => {
    for (const path of ["/id/kosakata/bertahap/1/1", "/id/kosakata/bertahap/0/3", "/id/kosakata/bertahap/1/1/tes", "/id/kosakata/bertahap/1/tes"]) {
      expect(reason(path), path).toMatch(/cards and tests/);
      expect(reason(path, "", { pathListed: false }), path).not.toBeNull();
    }
    expect(reason("/id/kosakata/bertahap")).toBeNull();
    expect(reason("/id/kosakata/bertahap", "", { pathListed: false })).toMatch(/not listed/);
  });

  it("a lesson word's entry, while no published surah's lesson uses the word (the page's tag and the sitemap ask; the proxy cannot)", () => {
    const withMap = { lexemeSurahs: LEXEME_SURAHS };
    const fatihah = LEXEMES.find((l) => l.surahs.includes("al-fatihah"))!.id;
    expect(reason(`/id/kosakata/${fatihah}`, "", withMap)).toBeNull();
    let checked = 0;
    for (const slug of ["al-falaq", "an-nas", "al-ikhlas"]) {
      const id = LEXEMES.find((l) => l.surahs.length === 1 && l.surahs[0] === slug)?.id;
      if (!id) continue;
      checked++;
      expect(reason(`/id/kosakata/${id}`, "", withMap), id).toMatch(/no published surah/);
      // Published, its words are indexable at once.
      expect(reason(`/id/kosakata/${id}`, "", { ...withMap, published: new Set(["al-fatihah", slug]) }), id).toBeNull();
      // The proxy has no content: it says nothing, and the page's own robots tag decides.
      expect(reason(`/id/kosakata/${id}`), id).toBeNull();
    }
    expect(checked).toBeGreaterThan(1);
    // The path is another page.
    expect(reason("/id/kosakata/bertahap", "", withMap)).toBeNull();
  });

  it("the word pages, unless the operator takes them (BELAJAR_KOSAKATA_WORDS_INDEXED)", () => {
    expect(reason("/id/kosakata/kata/1")).toMatch(/word pages/);
    expect(reason("/id/kosakata/kata/4832")).toMatch(/word pages/);
    expect(reason("/id/kosakata/kata/1", "", { wordsIndexed: true })).toBeNull();
    // The lesson words' entries are another page and are indexable either way.
    expect(reason("/id/kosakata/rahim")).toBeNull();
    expect(reason("/id/kosakata/rahim", "", { wordsIndexed: true })).toBeNull();
  });

  it("everything, while the module is not public (BELAJAR_PUBLIC): the kill switch", () => {
    for (const path of ["/id", "/id/quran", "/id/quran/al-fatihah/1", "/id/konsep/harakat", "/id/kredit", "/id/kosakata/kata/1"]) {
      expect(reason(path, "", { public: false }), path).toMatch(/not public/);
    }
    expect(urls({ public: false })).toEqual([]);
  });

  it("the Kosakata list in English too, were English ever indexed while the list is hidden in it", () => {
    const both = { locales: ["id", "en"] };
    expect(reason("/en/kosakata", "hal=1", both)).toMatch(/hidden/);
    expect(reason("/en/kosakata/bertahap", "", both)).toMatch(/hidden/);
    expect(reason("/en/kosakata/kata/1", "", { ...both, wordsIndexed: true })).toMatch(/hidden/);
    expect(reason("/en/kosakata", "hal=1", { ...both, kosakataEnglish: true })).toBeNull();
    // A lesson word's English entry is not the list, and stays.
    expect(reason("/en/kosakata/rahim", "", both)).toBeNull();
  });
});

describe("the layout's robots tag", () => {
  it("is none for an indexed locale of a public module, and noindex,follow for everything else", () => {
    process.env.BELAJAR_PUBLIC = "true";
    expect(layoutRobots("id")).toBeUndefined();
    expect(layoutRobots("en")).toEqual(NOINDEX);
    for (const value of [undefined, "", "false", "TRUE", "1", "on"]) {
      if (value === undefined) delete process.env.BELAJAR_PUBLIC;
      else process.env.BELAJAR_PUBLIC = value;
      expect(layoutRobots("id"), JSON.stringify(value)).toEqual(NOINDEX);
    }
    expect(NOINDEX).toEqual({ index: false, follow: true });
    expect(NOINDEX_HEADER).toBe("noindex, follow");
  });

  it("reads the switches of the process as they are now", () => {
    process.env.BELAJAR_PUBLIC = "true";
    expect(indexingRuntime()).toMatchObject({ public: true, locales: ["id"], waris: false, pathListed: false, wordsIndexed: false });
    expect([...indexingRuntime().published]).toEqual(["al-fatihah"]);
  });
});

describe("the Kosakata list's address (lib/kosakata-core.ts listAddress)", () => {
  it("is a page for no hal (the first), or one plain number up to the last page, and no search", () => {
    expect(listAddress([], [], null)).toEqual({ page: 1 });
    expect(listAddress(["1"], [], PAGES)).toEqual({ page: 1 });
    expect(listAddress([String(PAGES)], [], PAGES)).toEqual({ page: PAGES });
    expect(listAddress(["7"], [], null)).toEqual({ page: 7 });
  });

  it("is nothing else: a search, a repeated or malformed hal, and a page past the last", () => {
    const cases: [string[], string[]][] = [
      [[], ["x"]],
      [["2"], [""]],
      [["1", "2"], []],
      [["0"], []],
      [["01"], []],
      [["a"], []],
      [[""], []],
      [[String(PAGES + 1)], []],
    ];
    for (const [hal, q] of cases) expect(listAddress(hal, q, PAGES), JSON.stringify([hal, q])).toBeNull();
    // Where the number of pages is not at hand only the shape is judged.
    expect(listAddress([String(PAGES + 1)], [], null)).toEqual({ page: PAGES + 1 });
  });
});

describe("the sitemap lists exactly what is indexable (the lesson of 'Submitted URL marked noindex')", () => {
  const conceptUrls = CONCEPTS.map((id) => `${BASE}/konsep/${id}`);
  const lexemeUrls = lexemesOf(new Set(["al-fatihah"])).map((id) => `${BASE}/kosakata/${id}`);
  const listUrls = Array.from({ length: PAGES }, (_, i) => `${BASE}/kosakata?hal=${i + 1}`);
  const lesson = (slug: string) => [`${BASE}/quran/${slug}`, ...SURAHS.find((s) => s.slug === slug)!.ayat.map((a) => `${BASE}/quran/${slug}/${a.ayah}`)];

  /** What the operator listed, written out from the data and not from the code under test. */
  const PRODUCTION = [
    BASE,
    `${BASE}/quran`,
    ...lesson("al-fatihah"),
    `${BASE}/quran/pengantar`,
    `${BASE}/quran/kurikulum`,
    `${BASE}/quran/rumus`,
    `${BASE}/konsep`,
    ...conceptUrls,
    `${BASE}/kosakata/bertahap`,
    ...lexemeUrls,
    ...listUrls,
    `${BASE}/kredit`,
  ];

  it("is, in production, the hub, the track, Al-Fatihah and its 7 ayat, the introduction, the curriculum, the cheat sheet, the Konsep pages, the Kosakata path, lesson words and list, and the credits", () => {
    expect(urls()).toEqual(PRODUCTION);
    // The sizes the operator can check against what he sees: 1 + 1 + (1 + 7) + 3 + (1 + 38) + 1 + (lesson words of Al-Fatihah) + 49 + 1.
    expect(CONCEPTS).toHaveLength(38);
    expect(LEXEMES).toHaveLength(52);
    expect(lexemeUrls).toHaveLength(LEXEME_PRODUCTION);
    expect(WORDS).toBe(4832);
    expect(PAGES).toBe(49);
    expect(urls()).toHaveLength(1 + 1 + 8 + 3 + 39 + 1 + LEXEME_PRODUCTION + 49 + 1);
  });

  it("is absolute, canonical, unique, and in the Indonesian locale only, with no hreflang while only Indonesian is indexed", () => {
    const entries = sitemapEntries(input());
    expect(new Set(urls()).size).toBe(urls().length);
    for (const e of entries) {
      expect(e.url, e.url).toMatch(/^https:\/\/dakwah-lens\.id\/belajar\/id(?:\/[a-z0-9-]+)*(?:\?hal=\d+)?$/);
      expect(e.languages, e.url).toBeUndefined();
    }
  });

  it("never lists a hidden feature, whatever the switches are", () => {
    for (const over of [{}, { waris: true }, { published: new Set<string>() }, { pathListed: false }, { wordsIndexed: false }]) {
      for (const url of urls(over)) {
        expect(url, JSON.stringify(over)).not.toMatch(/\/waris|\/og$|\/belajar\/en|\?q=|\/bertahap\/\d|[?&]hal=(?:0|\d{3,})|\/kosakata\/kata\/|al-ikhlas|al-falaq|an-nas/);
      }
    }
  });

  it("follows the switches: surahs published, the path, the word pages, lesson zero", () => {
    const set = (list: string[]) => new Set(list);
    // Every surah published: the other three come in beside Al-Fatihah.
    const moreWords = lexemesOf(EVERY_SURAH)
      .filter((id) => !lexemesOf(new Set(["al-fatihah"])).includes(id))
      .map((id) => `${BASE}/kosakata/${id}`);
    expect(moreWords).toHaveLength(52 - LEXEME_PRODUCTION);
    expect(set(urls({ published: EVERY_SURAH }))).toEqual(set([...PRODUCTION, ...lesson("al-ikhlas"), ...lesson("al-falaq"), ...lesson("an-nas"), ...moreWords]));
    // The path not listed: its overview goes.
    expect(set(urls({ pathListed: false }))).toEqual(set(PRODUCTION.filter((u) => u !== `${BASE}/kosakata/bertahap`)));
    // Only An-Nas published: Al-Fatihah and lesson zero, which it hosts, go; An-Nas comes in.
    // The lesson words go the same way: only those An-Nas uses are listed.
    const nasWords = lexemesOf(new Set(["an-nas"])).map((id) => `${BASE}/kosakata/${id}`);
    const gone = set([...lesson("al-fatihah"), `${BASE}/quran/pengantar`, ...lexemeUrls]);
    expect(set(urls({ published: new Set(["an-nas"]) }))).toEqual(set([...PRODUCTION.filter((u) => !gone.has(u)), ...lesson("an-nas"), ...nasWords]));
    // The word pages taken: all 4,832 come in.
    const withWords = urls({ wordsIndexed: true });
    expect(withWords).toHaveLength(PRODUCTION.length + WORDS);
    expect(withWords.filter((u) => u.includes("/kosakata/kata/"))).toHaveLength(WORDS);
    expect(withWords).toContain(`${BASE}/kosakata/kata/1`);
    expect(withWords).toContain(`${BASE}/kosakata/kata/${WORDS}`);
  });

  it("lists every address the policy says yes to, in every configuration, and none it says no to", () => {
    /** Every page the app can serve, in both locales, written out here beside the sitemap's own list of candidates. */
    const everything = (): string[] => {
      const out: string[] = [];
      for (const locale of routing.locales) {
        const base = `/${locale}`;
        out.push(base, `${base}/quran`, `${base}/quran/pengantar`, `${base}/quran/kurikulum`, `${base}/quran/rumus`, `${base}/konsep`, `${base}/kredit`, `${base}/og`, `${base}/quran/og`);
        for (const s of SURAHS) out.push(`${base}/quran/${s.slug}`, ...s.ayat.flatMap((a) => [`${base}/quran/${s.slug}/${a.ayah}`, `${base}/quran/${s.slug}/${a.ayah}/og`]));
        for (const id of CONCEPTS) out.push(`${base}/konsep/${id}`);
        for (const l of LEXEMES) out.push(`${base}/kosakata/${l.id}`);
        out.push(`${base}/kosakata/bertahap`, `${base}/kosakata/bertahap/1/1`, `${base}/kosakata/bertahap/1/1/tes`, `${base}/kosakata/bertahap/1/tes`);
        out.push(`${base}/waris`, `${base}/waris/hitung`, `${base}/waris/laporan`);
        for (let page = 0; page <= PAGES + 1; page++) out.push(`${base}/kosakata?hal=${page}`);
        out.push(`${base}/kosakata?q=tangan`, `${base}/kosakata?q=`, `${base}/kosakata?hal=1&hal=2`);
        for (let rank = 1; rank <= WORDS; rank++) out.push(`${base}/kosakata/kata/${rank}`);
      }
      return out;
    };
    // Asked as the sitemap asks, which knows how many pages the list has (the proxy judges the shape of `?hal=` alone).
    const asked = (address: string, over: Partial<IndexingRuntime>) => {
      const [path, query = ""] = address.split("?");
      return noindexReason(path, new URLSearchParams(query), rt({ ...over, listPages: PAGES, lexemeSurahs: LEXEME_SURAHS }));
    };
    const configs: Partial<IndexingRuntime>[] = [
      {},
      { published: EVERY_SURAH },
      { published: new Set(["al-ikhlas"]) },
      { published: new Set() },
      { waris: true },
      { pathListed: false },
      { wordsIndexed: true },
      { public: false },
      { locales: ["id", "en"] },
      { locales: ["id", "en"], kosakataEnglish: true, wordsIndexed: true, published: EVERY_SURAH, waris: true },
    ];
    const candidates = everything();
    for (const over of configs) {
      // The sitemap names a page by its canonical address; for these every address is its own (the list's first page is ?hal=1).
      const wanted = new Set(candidates.filter((address) => asked(address, over) === null).map((address) => `https://dakwah-lens.id/belajar${address}`));
      const listed = new Set(urls(over));
      for (const url of listed) expect(wanted.has(url), `${JSON.stringify(over)}: ${url} is listed but not indexable`).toBe(true);
      for (const url of wanted) expect(listed.has(url), `${JSON.stringify(over)}: ${url} is indexable but not listed`).toBe(true);
    }
  });

  it("writes hreflang alternates only for a page indexed in every locale", () => {
    const both = sitemapEntries(input({ locales: ["id", "en"], kosakataEnglish: true }));
    const hub = both.filter((e) => e.url.endsWith("/belajar/id") || e.url.endsWith("/belajar/en"));
    expect(hub.map((e) => e.url)).toEqual([BASE, "https://dakwah-lens.id/belajar/en"]);
    for (const e of hub) {
      expect(e.languages).toEqual({ id: BASE, en: "https://dakwah-lens.id/belajar/en", "x-default": BASE });
    }
    // The English list is hidden unless shown: no English address of it, so no alternate for the Indonesian one either.
    const hidden = sitemapEntries(input({ locales: ["id", "en"], kosakataEnglish: false }));
    const list = hidden.filter((e) => /\/kosakata\?hal=1$/.test(e.url));
    expect(list.map((e) => e.url)).toEqual([`${BASE}/kosakata?hal=1`]);
    expect(list[0].languages).toBeUndefined();
  });
});

describe("every page of the app is classified (a new page would be indexable by default)", () => {
  // A page with no robots tag is indexable. So a new page.tsx must be put here on purpose: said to be
  // listed in the sitemap (lib/sitemap-paths.ts candidates), or kept out (a tag of its own, or the
  // proxy's header: lib/indexing.ts noindexReason). The route list is written out, never derived.
  const LISTED = [
    "[locale]/page.tsx",
    "[locale]/quran/page.tsx",
    "[locale]/quran/[surah]/page.tsx",
    "[locale]/quran/[surah]/[ayah]/page.tsx",
    "[locale]/quran/pengantar/page.tsx",
    "[locale]/quran/kurikulum/page.tsx",
    "[locale]/quran/rumus/page.tsx",
    "[locale]/konsep/page.tsx",
    "[locale]/konsep/[id]/page.tsx",
    "[locale]/kosakata/page.tsx",
    "[locale]/kosakata/[id]/page.tsx",
    "[locale]/kosakata/bertahap/page.tsx",
    "[locale]/kredit/page.tsx",
  ];
  const KEPT_OUT = [
    // a robots tag of their own, and the proxy's header
    "[locale]/waris/page.tsx",
    "[locale]/waris/hitung/page.tsx",
    "[locale]/waris/laporan/page.tsx",
    "[locale]/kosakata/kata/[rank]/page.tsx",
    "[locale]/kosakata/bertahap/[level]/[batch]/page.tsx",
    "[locale]/kosakata/bertahap/[level]/[batch]/tes/page.tsx",
    "[locale]/kosakata/bertahap/[level]/tes/page.tsx",
    // not a page: the 404
    "[locale]/[...rest]/page.tsx",
  ];

  it("lists them all", () => {
    const pages = readdirSync(join(BELAJAR, "src/app"), { recursive: true, encoding: "utf8" })
      .map((f) => f.split("\\").join("/"))
      .filter((f) => /(^|\/)page\.tsx$/.test(f))
      .sort();
    expect(pages).toEqual([...LISTED, ...KEPT_OUT].sort());
  });

  it("keeps the pages that are kept out of the index out, each by a robots tag of its own", () => {
    for (const f of KEPT_OUT.filter((p) => !p.includes("[...rest]") && !p.includes("kata/[rank]"))) {
      expect(read(`src/app/${f}`), f).toMatch(/robots: (NOINDEX|\{ index: false)/);
    }
    // The word page's tag follows the switch. Never `robots: undefined`: Next reads that as "none" and drops
    // the locale layout's noindex for the English pages, so the key is left out when the page may be indexed.
    expect(read("src/app/[locale]/kosakata/kata/[rank]/page.tsx")).toContain("...(kosakataWordsIndexed() ? {} : { robots: NOINDEX })");
    // Every other page sets no robots tag of its own: the locale layout decides (Indonesian: none).
    for (const f of LISTED) {
      const src = read(`src/app/${f}`);
      if (f === "[locale]/kosakata/bertahap/page.tsx") expect(src).toContain("...(kosakataPathListed() ? {} : { robots: NOINDEX })");
      else if (f === "[locale]/kosakata/page.tsx") expect(src).toContain("robots: NOINDEX");
      else if (f === "[locale]/kosakata/[id]/page.tsx") expect(src).toContain("...(lexemeIndexable(lexemeSurahsOf(l.id), new Set(publishedSurahs())) ? {} : { robots: NOINDEX })");
      else expect(src, f).not.toMatch(/robots:/);
    }
    for (const f of [...LISTED, ...KEPT_OUT]) expect(read(`src/app/${f}`), f).not.toMatch(/robots: [^,}]*\? undefined/);
  });

  it("gives every listed page its canonical address and a description of its own", () => {
    for (const f of LISTED) {
      const src = read(`src/app/${f}`);
      expect(src, f).toMatch(/alternates: alternatesFor\(/);
      expect(src, f).toMatch(/description[:,] /);
    }
  });
});

describe("search-engine metadata helpers (lib/seo.ts)", () => {
  it("shortens a description at a word, with an ellipsis, and leaves a short one alone", () => {
    expect(shorten("  Short   text \n here ")).toBe("Short text here");
    const long = "Kata ".repeat(60).trim();
    const cut = shorten(long, 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/Kat…$/);
    expect(shorten("x".repeat(300), 50)).toHaveLength(50);
  });
});
