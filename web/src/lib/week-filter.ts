/**
 * Week-picker helpers for /khutbah-kultum.
 *
 * A week is named by its Monday as a WIB calendar date ("YYYY-MM-DD"),
 * the same value Postgres yields for
 *   date_trunc('week', generated_at AT TIME ZONE 'Asia/Jakarta')
 * so the URL param, the picker options and the SQL range all agree.
 * WIB-anchored like month-filter: a briefing saved at 2026-10-04 23:30
 * UTC (= Monday 06:30 WIB) belongs to the week of 2026-10-05.
 */

import { localeAwareFormat } from "@/lib/date-id";

const WIB_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86_400_000;

/** Parse `?week=YYYY-MM-DD` into that week's Monday ("YYYY-MM-DD").
 *  Any day of the week is accepted and snapped back to its Monday.
 *  Null for missing / malformed / impossible dates (2026-02-31). */
export function parseWeekParam(
  raw: string | string[] | undefined,
): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const date = new Date(ms);
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(ms - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The WIB week ("YYYY-MM-DD" Monday) an instant falls in. */
export function wibWeekOf(d: Date): string {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const ms = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The weeks an occasion edition belongs to: the weeks whose Friday its
 *  khutbah was written for. Occasion briefings are saved ahead of the
 *  event and speak to the Fridays before it ("Empat hari lagi, tepatnya
 *  Selasa 25 Agustus …" — Maulid 1448, saved Sun 08-16 for Tue 08-25,
 *  written for Fri 08-21). So an edition belongs to every week whose
 *  Friday falls on or after its save day and on or before its event day:
 *
 *  - from the first week whose Friday is not already past at save time
 *    (a Saturday/Sunday save starts the following week),
 *  - through the week of the last Friday on or before the event (a
 *    Monday–Thursday event ends the week before it).
 *  - An event before the next Friday (saved Sunday for a Monday event)
 *    leaves no such week: it files under that next week alone.
 *  - Saved after its event (a correction re-saved later — the save path
 *    replaces the row, so it carries the new date): the week of the last
 *    Friday before the event, as if saved on time.
 *  - Never past `notAfter` (the current week); an edition whose first
 *    Friday is still ahead shows in its save week meanwhile, so an
 *    upcoming occasion is never hidden.
 *  - An absent, malformed or implausible event date (more than 60 days
 *    after the save, or 180 before it — a wrong year) keeps it in its save
 *    week only. */
export function occasionWeeks(
  savedAt: Date,
  eventDate: unknown,
  notAfter: string,
): string[] {
  const saveWeek = wibWeekOf(savedAt);
  if (typeof eventDate !== "string" || !parseWeekParam(eventDate)) {
    return [saveWeek];
  }
  const eventMs = Date.parse(`${eventDate}T00:00:00Z`);
  const wib = new Date(savedAt.getTime() + WIB_OFFSET_MS);
  const saveDayMs = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate());
  if (eventMs > saveDayMs + 60 * DAY_MS || eventMs < saveDayMs - 180 * DAY_MS) {
    return [saveWeek];
  }
  const weekOf = (ms: number) =>
    parseWeekParam(new Date(ms).toISOString().slice(0, 10)) as string;
  // Monday + 4 = Friday: the week of (day − 4) holds the last Friday on or
  // before that day; the week of (day + 2) the first Friday on or after it.
  const lastFriday = weekOf(eventMs - 4 * DAY_MS);
  const first = saveDayMs > eventMs ? lastFriday : weekOf(saveDayMs + 2 * DAY_MS);
  const out: string[] = [];
  for (let ms = Date.parse(`${first}T00:00:00Z`); out.length < 12; ms += 7 * DAY_MS) {
    const wk = new Date(ms).toISOString().slice(0, 10);
    if (wk > lastFriday || wk > notAfter) break;
    out.push(wk);
  }
  if (out.length > 0) return out;
  return [first <= notAfter ? first : saveWeek];
}

/** `[startUtc, endExclusiveUtc)` for the WIB week starting on the given
 *  Monday: Monday 00:00 WIB through the next Monday 00:00 WIB. */
export function weekRangeUtc(weekStart: string): {
  startUtc: Date;
  endUtc: Date;
} {
  const wibMidnightMs = Date.parse(`${weekStart}T00:00:00Z`);
  const startUtc = new Date(wibMidnightMs - WIB_OFFSET_MS);
  return { startUtc, endUtc: new Date(startUtc.getTime() + 7 * DAY_MS) };
}

/** Human label for a week: "5–11 Okt 2026", "28 Sep – 4 Okt 2026",
 *  "29 Des 2025 – 4 Jan 2026" (en: "Oct 5 – 11, 2026" style left to Intl).
 *  Spaces inside each date are no-break spaces, so a narrow phone wraps
 *  the label only at the dash, never inside a date ("4 | Jan"). */
export function formatWeekLabel(weekStart: string, locale: string): string {
  return keepDatesWhole(rawWeekLabel(weekStart, locale));
}

function keepDatesWhole(label: string): string {
  const nb = (part: string) => part.replace(/[ \u2009\u202F]/g, "\u00A0");
  const m = label.match(/^(.*?)([ \u2009\u202F]*)([–—])([ \u2009\u202F]*)(.*)$/);
  if (!m) return nb(label);
  const [, left, before, dash, after, right] = m;
  return before || after
    ? `${nb(left)} ${dash} ${nb(right)}`
    : `${nb(left)}${dash}${nb(right)}`;
}

function rawWeekLabel(weekStart: string, locale: string): string {
  const start = new Date(Date.parse(`${weekStart}T00:00:00Z`));
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    localeAwareFormat(d, locale, { ...o, timeZone: "UTC" });
  const full: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (locale !== "id") {
    // English reads month-first; let Intl build the range ("Oct 5 – 11, 2026").
    return new Intl.DateTimeFormat(locale, { ...full, timeZone: "UTC" })
      .formatRange(start, end);
  }
  if (sameMonth) return `${start.getUTCDate()}–${fmt(end, full)}`;
  const left = fmt(
    start,
    sameYear ? { day: "numeric", month: "short" } : full,
  );
  return `${left} – ${fmt(end, full)}`;
}
