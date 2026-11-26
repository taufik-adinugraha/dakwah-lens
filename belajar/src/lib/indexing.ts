import type { Metadata } from "next";

import { INDEXED_LOCALES, routing } from "@/i18n/routing";

import { kosakataEnglishOn, kosakataPathListed, kosakataWordsIndexed, publishedSurahs, warisSwitchOn } from "./features";
import { isPublic } from "./flags";
import { listAddress } from "./kosakata-core";
import { introHref, INTRO_HOST, SURAH_SLUGS } from "./routes";
import { NOINDEX } from "./seo";

/**
 * What search engines may index, decided in ONE place (docs/belajar-plan.md L42; operator,
 * 2026-11-26: "publish belajar so google can see"). The module is public (lib/flags.ts), and what is
 * hidden or unfinished must never reach the index, so the rule is written here as a question about an
 * address and asked three times by code that cannot disagree:
 *   - src/proxy.ts puts `X-Robots-Tag: noindex, follow` on every page this says no to. It works for
 *     the prerendered lesson pages too, whose own tags are fixed at build time, and it is the layer
 *     that follows the runtime switches (BELAJAR_SURAHS, BELAJAR_WARIS ...) without a rebuild;
 *   - src/app/sitemap.ts lists exactly the addresses this says yes to (lib/sitemap-paths.ts): a URL in
 *     the sitemap that is noindex is what Search Console reports as "Submitted URL marked noindex"
 *     (web/src/app/sitemap.ts learnt that), so the sitemap is built by asking, never by a second list;
 *   - the pages' own robots tags (the locale layout, the Kosakata pages) say the same thing in the HTML,
 *     for a crawler that never reads headers; scripts/ci/seo-smoke.mjs checks that page, header and sitemap
 *     agree, on every URL of the sitemap and on every kind of page that must stay out.
 *
 * Hidden things answer 404 (src/proxy.ts) and need no tag. What is reachable but not for the index:
 *   - the English pages (INDEXED_LOCALES in src/i18n/routing.ts);
 *   - Ilmu Waris, when the operator shows it (BELAJAR_WARIS=on): a calculator and a personal report;
 *   - a surah that is not published (BELAJAR_SURAHS) but answers at its address (BELAJAR_UNLISTED:
 *     Al-Ikhlas); lesson zero too while the surah that hosts it is not published;
 *   - every share card (/og: images, not pages);
 *   - the Kosakata list's search (`?q=`) and any list address that is not a real page (lib/kosakata-core.ts
 *     listAddress), the learning path's batch cards and tests (a flashcard and a quiz, a few hundred
 *     characters each), the path's overview while the path is not listed (BELAJAR_KOSAKATA_BERTAHAP),
 *     and the 4,832 word pages unless the operator takes them (BELAJAR_KOSAKATA_WORDS_INDEXED);
 *   - a lesson word's entry (/kosakata/{id}) while no published surah's lesson uses the word;
 *   - everything, while the module is not public (BELAJAR_PUBLIC): the kill switch.
 * This file imports no content, so the proxy can use it.
 */

/** What the answer depends on, read per request (lib/features.ts, lib/flags.ts). */
export type IndexingRuntime = {
  /** BELAJAR_PUBLIC. */
  public: boolean;
  /** The locales that may be indexed (INDEXED_LOCALES). */
  locales: readonly string[];
  /** Slugs of the surahs BELAJAR_SURAHS publishes. */
  published: ReadonlySet<string>;
  /** BELAJAR_WARIS=on. */
  waris: boolean;
  /** BELAJAR_KOSAKATA_BERTAHAP=on. */
  pathListed: boolean;
  /** BELAJAR_KOSAKATA_EN=on. */
  kosakataEnglish: boolean;
  /** BELAJAR_KOSAKATA_WORDS_INDEXED=on. */
  wordsIndexed: boolean;
  /**
   * How many pages the Kosakata list has, where the caller knows (the sitemap does). The proxy does not: it
   * must not load the list, so it judges only the shape of `?hal=` and leaves a page past the last to the
   * page's own robots tag (the page knows, src/app/[locale]/kosakata/page.tsx).
   */
  listPages: number | null;
  /**
   * For each lesson word's entry (/kosakata/{id}), the slugs of the surahs whose lessons use it, where the
   * caller has the content (the sitemap and the page do; the proxy must not import it, so it is null there
   * and the page's own robots tag decides). An entry is indexable only while one of them is published.
   */
  lexemeSurahs: ReadonlyMap<string, readonly string[]> | null;
};

/** The switches as this process has them now. */
export function indexingRuntime(): IndexingRuntime {
  return {
    public: isPublic(),
    locales: INDEXED_LOCALES,
    published: new Set(publishedSurahs()),
    waris: warisSwitchOn(),
    pathListed: kosakataPathListed(),
    kosakataEnglish: kosakataEnglishOn(),
    wordsIndexed: kosakataWordsIndexed(),
    listPages: null,
    lexemeSurahs: null,
  };
}

/**
 * May a lesson word's entry be indexed? Only while a surah whose lessons use the word is published
 * (BELAJAR_SURAHS): an entry used only by a hidden surah (404) or an unlisted one would otherwise put
 * that surah's vocabulary in the index. Publishing the surah makes its words indexable with no rebuild.
 */
export function lexemeIndexable(surahs: readonly string[], published: ReadonlySet<string>): boolean {
  return surahs.some((slug) => published.has(slug));
}

/** May this locale be indexed (INDEXED_LOCALES)? */
export function localeIndexed(locale: string): boolean {
  return (INDEXED_LOCALES as readonly string[]).includes(locale);
}

/**
 * The robots tag of the locale layout, which every page inherits unless it says its own: none (so:
 * indexable) for an indexed locale of a public module, else `noindex, follow`.
 */
export function layoutRobots(locale: string): Metadata["robots"] {
  return isPublic() && localeIndexed(locale) ? undefined : NOINDEX;
}

/** The path as the page is served: percent-decoded where it can be, with no trailing slash. */
function cleanPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed: only the raw spelling can be judged.
  }
  return path.replace(/\/+$/, "") || "/";
}

/** The Kosakata list's own pages in English, which answer 404 unless BELAJAR_KOSAKATA_EN=on (src/proxy.ts KOSAKATA_EN). */
const KOSAKATA_LIST = /^\/kosakata(?:$|\/(?:kata|bertahap)(?:\/|$))/;

/**
 * Why the page at `pathname` (the path Next serves, with its locale and without the basePath, e.g.
 * "/id/quran/al-fatihah/1") and `search` must not be indexed, or null when it may be. A path that is no
 * page of the module (no locale first) is null: there is nothing to say about a redirect or a 404.
 * Pure: the switches come in as `rt`, so the tests can ask it about every combination.
 */
export function noindexReason(pathname: string, search: URLSearchParams, rt: IndexingRuntime): string | null {
  if (!rt.public) return "the module is not public (BELAJAR_PUBLIC)";
  const m = /^\/([^/]+)((?:\/.*)?)$/.exec(cleanPath(pathname));
  if (!m || !(routing.locales as readonly string[]).includes(m[1])) return null;
  const [, locale, rest] = m;

  if (!rt.locales.includes(locale)) return `the ${locale} pages are not indexed (INDEXED_LOCALES)`;
  if (rest === "/waris" || rest.startsWith("/waris/")) return "Ilmu Waris is never indexed";
  if (rest === "/og" || rest.endsWith("/og")) return "a share card is an image, not a page";

  const surah = /^\/quran\/([^/]+)(?:\/|$)/.exec(rest);
  if (surah && (SURAH_SLUGS as readonly string[]).includes(surah[1]) && !rt.published.has(surah[1])) {
    return "that surah is not published (BELAJAR_SURAHS)";
  }
  if (rest === introHref() && !rt.published.has(INTRO_HOST)) return "lesson zero's surah is not published (BELAJAR_SURAHS)";

  if (locale === "en" && !rt.kosakataEnglish && KOSAKATA_LIST.test(rest)) return "the Kosakata list in English is hidden (BELAJAR_KOSAKATA_EN)";
  if (rest === "/kosakata") {
    return listAddress(search.getAll("hal"), search.getAll("q"), rt.listPages) ? null : "a search or a variant address of the Kosakata list";
  }
  const lexeme = /^\/kosakata\/([^/]+)$/.exec(rest)?.[1];
  if (lexeme && lexeme !== "bertahap" && rt.lexemeSurahs && !lexemeIndexable(rt.lexemeSurahs.get(lexeme) ?? [], rt.published)) {
    return "no published surah's lesson uses this word (BELAJAR_SURAHS)";
  }
  if (rest === "/kosakata/bertahap") return rt.pathListed ? null : "the learning path is not listed (BELAJAR_KOSAKATA_BERTAHAP)";
  if (rest.startsWith("/kosakata/bertahap/")) return "the learning path's cards and tests are a flow, not a page to find";
  if (rest.startsWith("/kosakata/kata/")) {
    return rt.wordsIndexed ? null : "the word pages are not taken into the index (BELAJAR_KOSAKATA_WORDS_INDEXED)";
  }
  return null;
}
