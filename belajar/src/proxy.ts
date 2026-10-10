import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";
import { warisSwitchOn } from "@/lib/features";

// Locale routing, plus one switch. The module has no protected routes:
// learning is anonymous-first (progress in localStorage, merged into the
// account on sign-in — plan §7.3). Identity is read server-side where needed.
const intl = createIntlMiddleware(routing);

/** /{locale}/waris and every path under it, as request.nextUrl gives it (no basePath). */
const WARIS = new RegExp(`^/(${routing.locales.join("|")})/waris(?:/|$)`);

/**
 * Where a hidden track's URLs are rewritten: a path no page claims (a folder
 * named "_…" is private, outside routing; only a "%5F…" folder could take
 * it), which the [locale] catch-all ([...rest]/page.tsx) answers with the
 * module's own localized 404.
 */
const NOT_FOUND = "/_tersembunyi";

/**
 * Ilmu Waris is hidden unless BELAJAR_WARIS=on (operator, 2026-10-10;
 * lib/features.ts). Gated here, before anything renders, rather than with
 * notFound() in a waris layout: the App Router renders a segment's page
 * alongside its layout, not inside it, so a layout-level 404 would still
 * render the hidden page and its metadata and ship them in the 404 response's
 * RSC payload (for /waris/hitung, the whole rule pack). The rewrite keeps the
 * address, answers a real 404 status with the styled page, and leaves the
 * waris pages prerendered, so showing the track again is only an env change.
 *
 * Two paths are checked: the one the request arrived with, and the one
 * next-intl rewrites it to, which is the path Next then serves. next-intl
 * cleans the address on the way (decodeURI, drops TAB/LF/CR, collapses
 * "//"; new URL() trims a trailing space or NUL), so /id/wa%09ris or
 * /id/waris%20 arrive looking like no waris path and are rewritten to
 * /belajar/id/waris itself. A redirect needs no check: the redirected
 * request comes back through here.
 */
export default function proxy(request: NextRequest) {
  const response = intl(request);
  if (warisSwitchOn()) return response;
  const locale =
    hiddenWarisLocale(request.nextUrl.pathname) ??
    hiddenWarisLocale(rewrittenPathname(request, response));
  if (!locale) return response;
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${NOT_FOUND}`;
  return NextResponse.rewrite(url);
}

/**
 * The locale of a /{locale}/waris… path, checked raw and percent-decoded, the
 * way Next matches the proxy itself: an encoded spelling (/id/w%61ris,
 * /en/waris%2Fhitung) must not slip past the gate if anything on the way
 * decodes it into the page's path.
 */
function hiddenWarisLocale(pathname: string): string | null {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed: only the raw spelling can match, as in Next's own check.
  }
  return (WARIS.exec(pathname) ?? WARIS.exec(decoded))?.[1] ?? null;
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
