import createIntlMiddleware from "next-intl/middleware";

import { routing } from "@/i18n/routing";

// Locale routing only. The module has no protected routes: learning is
// anonymous-first (progress in localStorage, merged into the account on
// sign-in — plan §7.3). Identity is read server-side where needed.
export default createIntlMiddleware(routing);

export const config = {
  // Paths are matched below the /belajar basePath. Skip API routes, Next
  // internals and files with an extension (fonts, audio, icons).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
