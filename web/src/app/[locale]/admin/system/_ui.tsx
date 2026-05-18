import { ChevronRight, Info } from "lucide-react";
import type { ReactNode } from "react";

/* Shared layout primitives used across every system-admin page. Keeping them
 * inline (not in /components/) signals these are not reusable design system
 * pieces — they're admin-only styling shortcuts. */

export function PageHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <header className="mb-6 border-b border-slate-200 pb-4">
      {badge && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          {badge}
        </span>
      )}
      <h2 className="mt-1.5 text-xl font-bold text-slate-900 sm:text-2xl">
        {title}
      </h2>
      <p className="mt-1 text-pretty text-sm text-slate-600">{subtitle}</p>
    </header>
  );
}

/**
 * Collapsed-by-default explainer. Native `<details>` so it works without JS
 * and keyboard/screen-reader behavior comes for free. Click anywhere on the
 * summary row (or hit Enter when focused) to toggle.
 */
export function HelpCallout({
  children,
  title = "How this works",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <details className="group mb-6 rounded-2xl border border-blue-100 bg-blue-50/60 text-sm text-slate-700 [&[open]>summary>svg.chev]:rotate-90">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <Info className="h-4 w-4 shrink-0 text-blue-700" />
        <span className="flex-1">{title}</span>
        <ChevronRight className="chev h-4 w-4 text-slate-400 transition-transform" />
      </summary>
      <div className="space-y-1 px-4 pb-4 pl-11 leading-relaxed">
        {children}
      </div>
    </details>
  );
}

export function Card({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {title && (
        <header className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {hint && (
            <span className="text-[11px] tabular-nums text-slate-500">
              {hint}
            </span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "emerald" | "amber" | "rose" | "brand";
}) {
  const tone =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-700"
        : accent === "rose"
          ? "text-rose-700"
          : accent === "brand"
            ? "text-brand-700"
            : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Fallback rate when callers don't pass a live one. Should rarely fire in
 *  production: every admin page is an async server component and reads the
 *  current rate via `getUsdToIdr()` first. */
export const DEFAULT_USD_TO_IDR = 16_300;

/** USD → IDR display helper. Pass a `rate` from `getUsdToIdr()` so the
 *  number reflects the superadmin-edited setting. Returns the IDR string,
 *  rounded to whole rupiah. */
export function formatIdr(usd: number, rate: number = DEFAULT_USD_TO_IDR): string {
  const idr = Math.round(usd * rate);
  return `Rp ${idr.toLocaleString("id-ID")}`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatRelative(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString();
}
