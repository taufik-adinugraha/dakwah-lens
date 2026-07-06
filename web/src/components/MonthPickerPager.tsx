import { ChevronLeft, ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import {
  formatMonthLabel,
  monthIsoKey,
} from "@/lib/month-filter";

/**
 * Header strip with a month-picker dropdown + pagination controls.
 * Pure server-side rendering — selection navigates to a new URL with
 * the updated query string. Used by /briefs and /flyers/mine.
 */
export function MonthPickerPager({
  baseHref,
  monthsAvailable,
  selectedMonth,
  page,
  totalPages,
  locale,
  labels,
  extraParams,
}: {
  /** Path WITHOUT query string — e.g. "/briefs" or "/flyers/mine". The
   *  picker preserves it and only swaps `?month=...&page=...`. */
  baseHref: "/briefs" | "/flyers/mine" | "/flyers/public";
  /** Distinct (year, month) tuples that have at least one row for this
   *  user. Newest first. The "All time" option is always prepended. */
  monthsAvailable: Array<{ year: number; month: number }>;
  selectedMonth: { year: number; month: number } | null;
  page: number;
  totalPages: number;
  locale: string;
  labels: {
    monthLabel: string;
    allTime: string;
    /** Fully formatted pagination label, e.g. "Halaman 2 dari 5". The
     *  caller is responsible for the substitution because next-intl's
     *  t() throws when ICU variables are missing — so doing the
     *  replacement here would force every caller to either pass dummy
     *  vars or end up with the raw "namespace.key" fallback in the UI. */
    pageOf: string;
    prev: string;
    next: string;
  };
  /** Other active filters (e.g. type / source / topic) to PRESERVE across
   *  month-picker + pagination navigation. Falsy values are dropped. Without
   *  this, paging or switching month silently resets the active filter. */
  extraParams?: Record<string, string | undefined>;
}) {
  const extra = Object.entries(extraParams ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");

  const allTimeHref = `${baseHref}?month=all&page=1${extra}`;

  const linkFor = (year: number, month: number) =>
    `${baseHref}?month=${monthIsoKey(year, month)}&page=1${extra}`;

  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const monthParam = selectedMonth
    ? monthIsoKey(selectedMonth.year, selectedMonth.month)
    : "all";

  return (
    <div className="my-4 flex flex-wrap items-center justify-between gap-3">
      <details className="relative">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:border-hairline hover:bg-paper-deep [&::-webkit-details-marker]:hidden">
          <span className="text-ink-faint">{labels.monthLabel}:</span>
          <span>
            {selectedMonth
              ? formatMonthLabel(
                  selectedMonth.year,
                  selectedMonth.month,
                  locale,
                )
              : labels.allTime}
          </span>
          <ChevronRight className="h-3 w-3 rotate-90 text-ink-faint" />
        </summary>
        <div className="absolute left-0 top-full z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-hairline bg-white shadow-lg">
          <Link
            href={allTimeHref}
            className={`block px-3 py-1.5 text-xs font-medium transition ${
              monthParam === "all"
                ? "bg-forest-tint text-forest"
                : "text-ink-muted hover:bg-paper-deep"
            }`}
          >
            {labels.allTime}
          </Link>
          {monthsAvailable.map(({ year, month }) => {
            const key = monthIsoKey(year, month);
            return (
              <Link
                key={key}
                href={linkFor(year, month)}
                className={`block px-3 py-1.5 text-xs transition ${
                  monthParam === key
                    ? "bg-forest-tint font-semibold text-forest"
                    : "text-ink-muted hover:bg-paper-deep"
                }`}
              >
                {formatMonthLabel(year, month, locale)}
              </Link>
            );
          })}
        </div>
      </details>

      {totalPages > 1 && (
        <div className="inline-flex items-center gap-1 text-xs text-ink-muted">
          <Link
            href={`${baseHref}?month=${monthParam}&page=${prevPage}${extra}`}
            aria-label={labels.prev}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-white transition ${
              page <= 1
                ? "pointer-events-none opacity-40"
                : "hover:border-hairline hover:bg-paper-deep"
            }`}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
          <span className="px-2 tabular-nums">{labels.pageOf}</span>
          <Link
            href={`${baseHref}?month=${monthParam}&page=${nextPage}${extra}`}
            aria-label={labels.next}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-hairline bg-white transition ${
              page >= totalPages
                ? "pointer-events-none opacity-40"
                : "hover:border-hairline hover:bg-paper-deep"
            }`}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
