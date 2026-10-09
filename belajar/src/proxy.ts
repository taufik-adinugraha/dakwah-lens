import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

// Locale routing only. The module has no protected routes: learning is
// anonymous-first (progress in localStorage, merged into the account on
// sign-in — plan §7.3). Identity is read server-side where needed.
export default createIntlMiddleware(routing);

export const config = {
  // Next prefixes every matcher with the basePath. The catch-all compiles to
  // a pattern that requires a "/" after "/belajar", so the bare module URL
  // (/belajar) needs its own "/" entry — without it the proxy never runs
  // there and the visitor gets a 404 instead of a redirect to /belajar/id.
  // Skip API routes, Next internals and files with an extension.
  matcher: ["/", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
