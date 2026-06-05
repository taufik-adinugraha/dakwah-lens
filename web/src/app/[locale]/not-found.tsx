import { getTranslations, setRequestLocale } from "next-intl/server";
import { Compass, Home } from "lucide-react";

import { Link } from "@/i18n/navigation";

/**
 * Locale-scoped 404. Replaces Next.js's plain-text default with an
 * on-brand page that gives the visitor a path forward (Insights is
 * usually the right destination — it's the lowest-friction product
 * surface).
 */
export default async function NotFound() {
  // Next.js doesn't pass the route params to `not-found.tsx`, so we
  // can't pull the locale dynamically here. Fall back to the default
  // locale; next-intl will route the user back to /id or /en correctly
  // on the next click.
  const locale = "id";
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Errors" });

  return (
    <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute top-1/3 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-amber-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-md px-4 text-center sm:px-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">
          404
        </p>
        <h1 className="mt-2 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {t("notfound_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
          {t("notfound_body")}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/briefings"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
          >
            <Compass className="h-4 w-4" />
            {t("notfound_cta_insights")}
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300"
          >
            <Home className="h-4 w-4" />
            {t("notfound_cta_home")}
          </Link>
        </div>
      </div>
    </section>
  );
}
