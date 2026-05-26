"use client";

import { ArrowLeft } from "lucide-react";

import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Dynamic "back" control rendered globally just under the header.
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
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {label}
      </button>
    </div>
  );
}
