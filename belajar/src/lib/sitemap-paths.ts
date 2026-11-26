import { type IndexingRuntime, noindexReason } from "./indexing";
import { pageCount } from "./kosakata-core";
import {
  ayahHref,
  conceptHref,
  conceptIndexHref,
  creditsHref,
  curriculumHref,
  hubHref,
  introHref,
  kosakataHref,
  kosakataPathHref,
  kosakataWordHref,
  lexemeHref,
  quranHref,
  rumusHref,
  surahHref,
} from "./routes";
import { pageUrl } from "./share";

/**
 * The module's sitemap (src/app/sitemap.ts, served at /belajar/sitemap.xml and named in the main site's
 * robots.txt, web/src/app/robots.ts), as a pure function of the data and the runtime switches
 * (docs/belajar-plan.md L42). It lists exactly the addresses lib/indexing.ts says may be indexed, and
 * nothing else: every page the module can serve is a candidate below, and each one is asked
 * `noindexReason` — the same question the proxy's header and the pages' tags answer — so the sitemap
 * cannot list a page that is `noindex` (Search Console: "Submitted URL marked noindex") or leave out one
 * that is not. The switches therefore keep a hidden feature out of the sitemap with no rule of its own.
 * This file holds the one thing the question cannot give: which pages exist, and in what order.
 *
 * The address of a page is its canonical one: `https://dakwah-lens.id/belajar/{locale}{path}`, no
 * trailing slash, and for the Kosakata list `?hal=N` (the first page is `?hal=1`: the bare address is
 * the learning path while that is listed). No `lastmod`, `changefreq` or `priority`: nothing here knows
 * when a page last changed, and a made-up date teaches a crawler to ignore the real ones.
 */
export type SitemapInput = {
  /** The switches, and in them the locales to list (INDEXED_LOCALES). The list's page count is the sitemap's own: `kosakataWords`. */
  rt: Omit<IndexingRuntime, "listPages" | "lexemeSurahs">;
  /** Every locale the module has, and its default: hreflang alternates are written only when `rt.locales` is all of them. */
  allLocales: readonly string[];
  defaultLocale: string;
  /** Every surah with a lesson, published or not: the switches decide which are listed. */
  surahs: readonly { slug: string; ayat: readonly number[] }[];
  /** Ids of the Konsep pages, the Harakat page included. */
  concepts: readonly string[];
  /** The lesson words' entries, /kosakata/{id}, each with the surahs whose lessons use the word (src/lib/lexemes.ts). */
  lexemes: readonly { id: string; surahs: readonly string[] }[];
  /** How many words the Kosakata list has. */
  kosakataWords: number;
};

export type SitemapEntry = { url: string; languages?: Record<string, string> };

/** Every page the module can serve for one locale, as a locale-less path, with its query where it has one. */
function candidates(input: SitemapInput): string[] {
  const { surahs, concepts, lexemes, kosakataWords } = input;
  const out: string[] = [hubHref(), quranHref()];
  for (const s of surahs) out.push(surahHref(s.slug), ...s.ayat.map((n) => ayahHref(s.slug, n)));
  out.push(introHref(), curriculumHref(), rumusHref(), conceptIndexHref(), ...concepts.map(conceptHref));
  out.push(kosakataPathHref(), ...lexemes.map((l) => lexemeHref(l.id)));
  for (let page = 1; page <= pageCount(kosakataWords); page++) out.push(`${kosakataHref()}?hal=${page}`);
  for (let rank = 1; rank <= kosakataWords; rank++) out.push(kosakataWordHref(rank));
  out.push(creditsHref());
  return out;
}

export function sitemapEntries(input: SitemapInput): SitemapEntry[] {
  const { allLocales, defaultLocale } = input;
  // The sitemap knows how many pages the list has, which the proxy does not: a page past the last is no page, and an entry nobody published uses is none.
  const rt = {
    ...input.rt,
    listPages: pageCount(input.kosakataWords),
    lexemeSurahs: new Map(input.lexemes.map((l) => [l.id, l.surahs] as const)),
  };
  const alternates = rt.locales.length === allLocales.length && rt.locales.length > 1;
  const entries: SitemapEntry[] = [];
  for (const path of candidates(input)) {
    const [pathname, query = ""] = path.split("?");
    const listed = rt.locales.filter((locale) => noindexReason(`/${locale}${pathname}`, new URLSearchParams(query), rt) === null);
    for (const locale of listed) {
      const entry: SitemapEntry = { url: pageUrl(locale, path) };
      // Written only for a page that is listed in every locale: an alternate must be an indexable page too.
      if (alternates && listed.length === rt.locales.length) {
        entry.languages = { ...Object.fromEntries(listed.map((l) => [l, pageUrl(l, path)])), "x-default": pageUrl(defaultLocale, path) };
      }
      entries.push(entry);
    }
  }
  return entries;
}
