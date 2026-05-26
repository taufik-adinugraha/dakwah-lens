"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Compass, RotateCw } from "lucide-react";

import { Link } from "@/i18n/navigation";

/**
 * Locale-scoped error boundary. App Router calls this when a server
 * component (or its children) throws during render. Replaces the
 * generic Next.js error screen with an on-brand page + a retry button
 * + a path forward.
 *
 * Must be a Client Component — Next.js wires the `reset` callback
 * through React's error boundary, which only exists client-side.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");

  useEffect(() => {
    // Log to the browser console so devs can grab the digest from a
    // user report. Server-side errors already log to structlog; this
    // is purely a client-side hook.
    console.error("Page error boundary:", error);
  }, [error]);

  return (
    <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute top-1/3 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-rose-200 opacity-40 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-md px-4 text-center sm:px-6">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          {t("error_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
          {t("error_body")}
        </p>
        {error.digest && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-mono text-[11px] text-slate-600">
            {t("error_digest_label")}: {error.digest}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow transition hover:bg-slate-800"
          >
            <RotateCw className="h-4 w-4" />
            {t("error_cta_retry")}
          </button>
          <Link
            href="/insights"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300"
          >
            <Compass className="h-4 w-4" />
            {t("error_cta_insights")}
          </Link>
        </div>
      </div>
    </section>
  );
}
