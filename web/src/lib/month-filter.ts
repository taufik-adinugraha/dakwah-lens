/**
 * Month-picker + pagination helpers used by /briefs and /flyers/mine.
 *
 * Filter & pagination state lives in URL search params:
 *   - `month` = "YYYY-MM" or "all" (default "all")
 *   - `page`  = positive integer (default 1)
 *
 * The page query selects distinct YYYY-MM values from the relevant
 * table (scoped to the current user) so the dropdown only shows months
 * that actually have content. WIB-anchored — a row created at
 * 2026-05-01 03:00 UTC (= 10:00 WIB on 2026-05-01) lands in May 2026,
 * matching the user's local-clock intuition.
 */

import { localeAwareFormat } from "@/lib/date-id";

const WIB_OFFSET_MIN = 7 * 60;

/** Parse `?month=YYYY-MM` into a numeric (year, month). Returns null
 *  for "all" / missing / invalid input. */
export function parseMonthParam(
  raw: string | string[] | undefined,
): { year: number; month: number } | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v === "all") return null;
  const m = v.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

/** Parse `?page=N` into an integer ≥ 1. Bad input collapses to 1. */
export function parsePageParam(
  raw: string | string[] | undefined,
): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(1000, Math.floor(n));
}

/** Return `[startUtc, endExclusiveUtc)` for a (year, month) interpreted
 *  in WIB. A row's createdAt UTC timestamp is inside this range iff its
 *  WIB-local date falls in the named month. */
export function monthRangeUtc(year: number, month: number): {
  startUtc: Date;
  endUtc: Date;
} {
  // First moment of the WIB month, expressed in UTC.
  const wibStartMs = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const startUtc = new Date(wibStartMs - WIB_OFFSET_MIN * 60_000);
  // First moment of the NEXT month (exclusive upper bound).
  const wibEndMs = Date.UTC(
    month === 12 ? year + 1 : year,
    month === 12 ? 0 : month,
    1,
    0,
    0,
    0,
  );
  const endUtc = new Date(wibEndMs - WIB_OFFSET_MIN * 60_000);
  return { startUtc, endUtc };
}

/** Human label for the dropdown ("Mei 2026" for id, "May 2026" for en). */
export function formatMonthLabel(
  year: number,
  month: number,
  locale: string,
): string {
  // Use day=15 (mid-month) so timezone wobble never bumps us to an
  // adjacent month.
  return localeAwareFormat(new Date(year, month - 1, 15), locale, {
    month: "long",
    year: "numeric",
  });
}

/** Iso month string ("YYYY-MM") — used as the URL value. */
export function monthIsoKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
