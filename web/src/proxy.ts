import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { routing } from "@/i18n/routing";

const intl = createIntlMiddleware(routing);

const PROTECTED_PREFIXES = ["/dashboard", "/briefs", "/segments", "/admin"];

// Routes that match a PROTECTED_PREFIX but should NOT require auth — public
// surfaces nested under an otherwise-private root. Order matters: the public
// exemption is checked first so it short-circuits the prefix check.
const PUBLIC_OVERRIDES = ["/briefs/public"];

// Routes that require auth but must NOT trigger the onboarding redirect —
// the wizard itself, login, and logout. Adding /admin would defeat the
// whole gate, so it's deliberately not here.
const ONBOARDING_EXEMPT = ["/onboarding", "/login", "/logout"];

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(en|id)(?=\/|$)/, "") || "/";
}

function isProtected(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  // Public override wins — e.g. /briefs is protected, but /briefs/public
  // is explicitly carved out.
  if (
    PUBLIC_OVERRIDES.some(
      (p) => stripped === p || stripped.startsWith(`${p}/`),
    )
  ) {
    return false;
  }
  return PROTECTED_PREFIXES.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const stripped = stripLocale(pathname);

  if (isProtected(pathname) && !req.auth) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed-in regular user who hasn't completed the wizard → send them there
  // first. Admins / superadmins are exempt so they aren't blocked from
  // managing the system on a fresh account.
  const session = req.auth;
  const isExempt = ONBOARDING_EXEMPT.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
  if (
    session?.user &&
    !session.user.onboarded &&
    session.user.role === "user" &&
    !isExempt
  ) {
    const target = new URL("/onboarding", req.nextUrl);
    return NextResponse.redirect(target);
  }

  return intl(req as NextRequest);
});

export const config = {
  matcher: [
    // Skip API routes, Next internals, static files.
    "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
  ],
};
