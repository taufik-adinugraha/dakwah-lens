"use client";

import { ArrowLeft } from "lucide-react";

import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Dynamic "back" control — a FLOATING fixed pill at the top-left, just
 * below the sticky header (conventional "back" placement). The
 * BackToTop button floats at the bottom-right, so the two never collide.
 *
 * It mirrors the browser's own back button — `router.back()` returns the
 * user to whatever page they actually came from, so the destination is
 * dynamic rather than a hard-coded parent route.
 *
 * Hidden on routes where "back" makes no sense:
 *   - the locale home page (`/`) — there's nothing before it in-app
 *   - `/onboarding` — onboarding is mandatory; a back affordance there
 *     would imply it can be dismissed
 *
 * `usePathname()` from next-intl returns the path WITHOUT the locale
 * prefix, so the checks compare against unprefixed paths.
 *
 * Direct-entry fallback: when there's no prior history entry in this tab
 * (e.g. the page was opened from a shared link in a fresh tab), going
 * "back" would leave the site — so we route home instead.
 */
export function BackButton({ label }: { label: string }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/" || pathname.startsWith("/onboarding")) return null;

  const onClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="fixed left-4 top-20 z-40 inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white shadow-lg shadow-ink/25 transition hover:bg-forest sm:left-6"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
