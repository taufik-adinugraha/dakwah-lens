import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/auth";
import { routing } from "@/i18n/routing";

const intl = createIntlMiddleware(routing);

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/briefs",
  "/admin",
  // Onboarding is sign-in-required even though it's also in ONBOARDING_EXEMPT
  // below — those serve different concerns. Here it gates anonymous traffic;
  // the exempt list prevents already-signed-in-but-not-onboarded users from
  // being redirected to themselves.
  "/onboarding",
];

// Routes that match a PROTECTED_PREFIX but should NOT require auth — public
// surfaces nested under an otherwise-private root. Order matters: the public
// exemption is checked first so it short-circuits the prefix check.
const PUBLIC_OVERRIDES = ["/briefs/public"];

// Routes that require an admin (or superadmin) role even when the user is
// signed in + approved. Personalized brief generation is gated behind this
// while the feature is still experimental — only admins should be able to
// create / list / view briefs. /briefs/public is exempt via PUBLIC_OVERRIDES.
const ADMIN_ONLY_PREFIXES = ["/briefs"];

// Routes that require auth but must NOT trigger the onboarding redirect —
// the wizard itself, login, and logout. Adding /admin would defeat the
// whole gate, so it's deliberately not here.
const ONBOARDING_EXEMPT = ["/onboarding", "/login", "/logout"];

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(en|id)(?=\/|$)/, "") || "/";
}

function isPublicOverride(stripped: string): boolean {
  return PUBLIC_OVERRIDES.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
}

function isProtected(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  // Public override wins — e.g. /briefs is protected, but /briefs/public
  // is explicitly carved out.
  if (isPublicOverride(stripped)) return false;
  return PROTECTED_PREFIXES.some(
    (p) => stripped === p || stripped.startsWith(`${p}/`),
  );
}

function isAdminOnly(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  if (isPublicOverride(stripped)) return false;
  return ADMIN_ONLY_PREFIXES.some(
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

  // Admin-only gate. /briefs/* is currently admin/superadmin only —
  // brief generation is still experimental, regular users shouldn't be
  // able to reach the create / list / detail views. Bounce them to
  // /insights with a notice they can see.
  if (isAdminOnly(pathname)) {
    const role = req.auth?.user?.role;
    if (role !== "admin" && role !== "superadmin") {
      const target = new URL("/insights", req.nextUrl);
      target.searchParams.set("notice", "briefs-admin-only");
      return NextResponse.redirect(target);
    }
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

  // Approved user landing on the marketing home page → bounce to
  // /dashboard with a real HTTP 307. The same check exists inside
  // page.tsx as a fallback, but doing it here in middleware happens
  // BEFORE the layout starts rendering. When the redirect is called
  // from the page after the layout has started streaming (which it
  // always does, since the layout has its own server components like
  // Header that await auth()), Next.js 16 falls back to embedding
  // <meta http-equiv="refresh"> in the body — visible to the user as
  // a brief "page can't load" flash before navigating to /dashboard.
  // Middleware redirect is always a clean 307, no rendering, no flash.
  //
  // The `?view=marketing` opt-out (used by header "Features" /
  // "How it works" / "Donate" links) still bypasses this — approved
  // users CAN view marketing intentionally, just not as the default.
  if (
    session?.user?.status === "approved" &&
    (stripped === "/" || stripped === "") &&
    req.nextUrl.searchParams.get("view") !== "marketing"
  ) {
    const target = new URL("/dashboard", req.nextUrl);
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
