import { ChevronLeft, ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { formatWeekLabel } from "@/lib/week-filter";

/**
 * Week dropdown + older/newer arrows for /khutbah-kultum. Pure server
 * rendering like MonthPickerPager: every choice is a Link to the same
 * path with `?week=` swapped and the other params preserved.
 *
 * Next keeps the page's DOM across navigations that only change the
 * query string, and React never manages a <details>' `open` attribute —
 * so the dropdown is keyed on the whole view (`viewKey`: pinned week +
 * tab) and remounts, i.e. closes, on any navigation that changes it. The
 * current week is plain text, not a link, so picking it is a no-op.
 */
export function WeekPicker({
  basePath,
  weeks,
  selectedWeek,
  viewKey,
  locale,
  labels,
  extraParams,
}: {
  basePath: "/khutbah-kultum";
  /** Mondays ("YYYY-MM-DD") that have content, newest first. */
  weeks: string[];
  selectedWeek: string;
  /** Changes whenever the view does (week param, tab). */
  viewKey: string;
  locale: string;
  labels: { week: string; older: string; newer: string };
  /** Params to carry across week changes (e.g. the active tab). */
  extraParams?: Record<string, string | undefined>;
}) {
  const extra = Object.entries(extraParams ?? {})
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join("");
  const hrefFor = (wk: string) => `${basePath}?week=${wk}${extra}`;

  const idx = weeks.indexOf(selectedWeek);
  const newer = idx > 0 ? weeks[idx - 1] : null;
  const older = idx >= 0 && idx < weeks.length - 1 ? weeks[idx + 1] : null;

  const arrow =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-white text-ink-muted transition";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {older ? (
        <Link href={hrefFor(older)} aria-label={labels.older} className={`${arrow} hover:bg-paper-deep`}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-hidden className={`${arrow} opacity-40`}>
          <ChevronLeft className="h-4 w-4" />
        </span>
      )}

      <details key={viewKey} className="relative min-w-0">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-hairline bg-white px-3.5 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-paper-deep sm:whitespace-nowrap [&::-webkit-details-marker]:hidden">
          <span className="font-medium">{labels.week}:</span>
          <span className="tabular-nums">
            {formatWeekLabel(selectedWeek, locale)}
          </span>
          <ChevronRight className="h-3 w-3 rotate-90 text-ink-faint" />
        </summary>
        <div className="absolute left-1/2 top-full z-10 mt-1 max-h-72 w-60 -translate-x-1/2 overflow-y-auto rounded-xl border border-hairline bg-white shadow-lg">
          {weeks.map((wk) =>
            wk === selectedWeek ? (
              <span
                key={wk}
                aria-current="true"
                className="block bg-forest-tint px-3 py-1.5 text-xs font-semibold tabular-nums text-forest"
              >
                {formatWeekLabel(wk, locale)}
              </span>
            ) : (
              <Link
                key={wk}
                href={hrefFor(wk)}
                className="block px-3 py-1.5 text-xs tabular-nums text-ink-muted transition hover:bg-paper-deep"
              >
                {formatWeekLabel(wk, locale)}
              </Link>
            ),
          )}
        </div>
      </details>

      {newer ? (
        <Link href={hrefFor(newer)} aria-label={labels.newer} className={`${arrow} hover:bg-paper-deep`}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <span aria-hidden className={`${arrow} opacity-40`}>
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}
