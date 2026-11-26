import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";
import { kosakataEnglishOn, kosakataPathListed, reachableSurahs, warisSwitchOn } from "@/lib/features";
import { indexingRuntime, noindexReason } from "@/lib/indexing";
import { kosakataPathHref, SURAH_SLUGS } from "@/lib/routes";
import { NOINDEX_HEADER } from "@/lib/seo";

// Locale routing, plus the runtime switches of what is hidden. The module has
// no protected routes and no sign-in (plan L16, §7.3): progress stays in the
// learner's browser (localStorage).
const intl = createIntlMiddleware(routing);

const LOCALE = `(${routing.locales.join("|")})`;
/** /{locale}/waris and every path under it, as request.nextUrl gives it (no basePath). */
const WARIS = new RegExp(`^/${LOCALE}/waris(?:/|$)`);
/** /{locale}/quran/{slug} and every path under it; not the track page /{locale}/quran itself. */
const SURAH = new RegExp(`^/${LOCALE}/quran/([^/]+)(?:/|$)`);
/**
 * The Kosakata list's own pages in English: /en/kosakata, and /kata and /bertahap under it. Not
 * /en/kosakata/{id}, a lesson word's full entry, which the English lessons link to.
 */
const KOSAKATA_EN = /^\/(en)\/kosakata(?:\/?$|\/(?:kata|bertahap)(?:\/|$))/;
/** The Kosakata section's own address (Next has already answered a trailing "/" with its own 308). */
const KOSAKATA_HOME = new RegExp(`^/${LOCALE}/kosakata$`);
/** The surahs that have a lesson (an unknown slug is left to the lesson routes' own 404). */
const LESSONS: ReadonlySet<string> = new Set(SURAH_SLUGS);

/**
 * Where a hidden page's URLs are rewritten: a path no page claims (a folder
 * named "_…" is private, outside routing; only a "%5F…" folder could take
 * it), which the [locale] catch-all ([...rest]/page.tsx) answers with the
 * module's own localized 404.
 */
const NOT_FOUND = "/_tersembunyi";

/**
 * What a visitor may not reach, each part behind its own runtime switch
 * (lib/features.ts), all of it gated by the one check below:
 *   - Ilmu Waris, unless BELAJAR_WARIS=on (operator, 2026-10-10): every
 *     /{locale}/waris… URL;
 *   - the Kosakata list in English, unless BELAJAR_KOSAKATA_EN=on (operator, 2026-11-03);
 *   - every surah that is neither published (BELAJAR_SURAHS; operator, 2026-10-10:
 *     Al-Fatihah first, the others "segera hadir") nor unlisted (BELAJAR_UNLISTED:
 *     answers at its address, linked from nowhere; operator, 2026-10-20): its
 *     /{locale}/quran/{slug}… URLs. A pre-hub /{locale}/{slug} URL is redirected there first
 *     (next.config.ts, 308) and gated when the redirected request comes back.
 *
 * Gated here, before anything renders, rather than with notFound() in a
 * layout: the App Router renders a segment's page alongside its layout, not
 * inside it, so a layout-level 404 would still render the hidden page and its
 * metadata and ship them in the 404 response's RSC payload (for /waris/hitung,
 * the whole rule pack; for a lesson, its ayat). The rewrite keeps the
 * address, answers a real 404 status with the styled page, and leaves the
 * hidden pages prerendered, so showing them again is only an env change.
 *
 * Two paths are checked: the one the request arrived with, and the one
 * next-intl rewrites it to, which is the path Next then serves. next-intl
 * cleans the address on the way (decodeURI, drops TAB/LF/CR, collapses
 * "//"; new URL() trims a trailing space or NUL), so /id/wa%09ris or
 * /id/waris%20 arrive looking like no hidden path and are rewritten to
 * /belajar/id/waris itself. A redirect needs no check: the redirected
 * request comes back through here.
 *
 * What is reachable is not always for search engines either: after the gate, a page that must stay out
 * of the index is answered with an X-Robots-Tag header (withRobots below; lib/indexing.ts says which).
 */
export default function proxy(request: NextRequest) {
  const response = intl(request);
  const hidden = hiddenNow();
  const locale =
    hiddenLocale(request.nextUrl.pathname, hidden) ??
    hiddenLocale(rewrittenPathname(request, response), hidden);
  if (!locale) return kosakataOpening(request) ?? withRobots(request, response);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${NOT_FOUND}`;
  return NextResponse.rewrite(url);
}

/**
 * Search engines (docs/belajar-plan.md L42): a page that is reachable but must not be indexed — the
 * English pages, an unlisted surah, Ilmu Waris when it is shown, a share card, the Kosakata search ... —
 * is answered with `X-Robots-Tag: noindex, follow`, beside any robots tag in its own HTML. Everything
 * lib/indexing.ts says yes to is left without the header. The header is the layer that follows the runtime
 * switches (BELAJAR_SURAHS, BELAJAR_PUBLIC ...) with no rebuild, and it reaches the prerendered lesson
 * pages, whose own tags were fixed at build time. Asked for the address as it arrived and for the path
 * next-intl serves, like the gate above, so a spelling cleaned on its way to the page cannot slip past. A
 * redirect is no page, and a hidden page (404) is answered before this.
 */
function withRobots(request: NextRequest, response: NextResponse): NextResponse {
  if (response.status >= 300 && response.status < 400) return response;
  const rt = indexingRuntime();
  const { searchParams } = request.nextUrl;
  const asked = [request.nextUrl.pathname, rewrittenPathname(request, response)].filter(Boolean);
  if (asked.some((path) => noindexReason(path, searchParams, rt) !== null)) {
    response.headers.set("X-Robots-Tag", NOINDEX_HEADER);
  }
  return response;
}

/**
 * While the learning path is listed (BELAJAR_KOSAKATA_BERTAHAP=on), the Kosakata section opens on it
 * (operator 2026-11-03: "set belajar bertahap as first/default tab"): /{locale}/kosakata, with neither
 * a page nor a search, goes to the path. The list stays at ?hal= and ?q=, so its pager, a search and
 * a link to either keep working. A temporary redirect, because the switch can go back. Checked after
 * the gate above, so the English list stays hidden. Null for any other request.
 */
function kosakataOpening(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl;
  const home = KOSAKATA_HOME.exec(pathname);
  if (!home || !kosakataPathListed() || searchParams.has("hal") || searchParams.has("q")) return null;
  const url = request.nextUrl.clone();
  url.pathname = `/${home[1]}${kosakataPathHref()}`;
  return NextResponse.redirect(url);
}

/** What is hidden on this request (both switches are read per request). */
type Hidden = { waris: boolean; kosakataEn: boolean; published: ReadonlySet<string> };

function hiddenNow(): Hidden {
  return { waris: !warisSwitchOn(), kosakataEn: !kosakataEnglishOn(), published: new Set(reachableSurahs()) };
}

/**
 * The locale of a hidden path, checked raw and percent-decoded, the way Next
 * matches the proxy itself: an encoded spelling (/id/w%61ris,
 * /en/waris%2Fhitung, /id/quran/al-%69khlas) must not slip past the gate if
 * anything on the way decodes it into the page's path.
 */
function hiddenLocale(pathname: string, hidden: Hidden): string | null {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed: only the raw spelling can match, as in Next's own check.
  }
  return hiddenIn(pathname, hidden) ?? hiddenIn(decoded, hidden);
}

/**
 * `path`'s locale when it is under the waris track while that is hidden, on the
 * Kosakata list's English pages while those are, or under the lesson of a surah
 * that is not published; null for any other path.
 */
function hiddenIn(path: string, hidden: Hidden): string | null {
  const waris = hidden.waris ? WARIS.exec(path) : null;
  if (waris) return waris[1];
  const kosakata = hidden.kosakataEn ? KOSAKATA_EN.exec(path) : null;
  if (kosakata) return kosakata[1];
  const surah = SURAH.exec(path);
  if (surah && LESSONS.has(surah[2]) && !hidden.published.has(surah[2])) return surah[1];
  return null;
}

/**
 * Where next-intl sends the request (NextResponse.rewrite's
 * x-middleware-rewrite header), without the basePath, like
 * request.nextUrl.pathname; "" when it does not rewrite (a redirect, or
 * NextResponse.next() for an address it cannot decode).
 */
function rewrittenPathname(request: NextRequest, response: NextResponse): string {
  const target = response.headers.get("x-middleware-rewrite");
  if (!target) return "";
  const { pathname } = new URL(target, request.url);
  const { basePath } = request.nextUrl;
  return basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
}

export const config = {
  // Next prefixes every matcher with the basePath. The catch-all compiles to
  // a pattern that requires a "/" after "/belajar", so the bare module URL
  // (/belajar) needs its own "/" entry — without it the proxy never runs
  // there and the visitor gets a 404 instead of a redirect to /belajar/id.
  // Skip API routes, Next internals and files with an extension.
  matcher: ["/", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
