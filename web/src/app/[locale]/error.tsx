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
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(90rem 42rem at 50% -12rem, rgba(14, 90, 60, 0.42), transparent 68%)," +
              "radial-gradient(64rem 36rem at 88% 108%, rgba(14, 90, 60, 0.26), transparent 68%)",
          }}
        />
      </div>

      <div className="mx-auto w-full max-w-md px-4 text-center sm:px-6">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {t("error_title")}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-ink-muted sm:text-base">
          {t("error_body")}
        </p>
        {error.digest && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-paper-deep px-3 py-1 font-mono text-xs text-ink-muted">
            {t("error_digest_label")}: {error.digest}
          </p>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-forest px-5 text-sm font-semibold text-white shadow transition hover:bg-forest-hover"
          >
            <RotateCw className="h-4 w-4" />
            {t("error_cta_retry")}
          </button>
          <Link
            href="/briefings"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-hairline bg-white px-5 text-sm font-semibold text-ink-muted shadow-sm transition hover:border-forest/40"
          >
            <Compass className="h-4 w-4" />
            {t("error_cta_insights")}
          </Link>
        </div>
      </div>
    </section>
  );
}
