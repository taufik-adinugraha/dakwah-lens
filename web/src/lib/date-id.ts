/**
 * Indonesian date-format helpers that use "Ahad" instead of "Minggu"
 * for Sunday.
 *
 * Why: in Muslim Indonesia, "Ahad" is the preferred name for Sunday
 * because "Minggu" overlaps with the word for "week" (e.g. "minggu
 * ini" = "this week"). The default `Intl.DateTimeFormat('id-ID')`
 * output is "Minggu" so we post-process it.
 *
 * Use:
 *   formatIdDate(d, { weekday: "long", year: "numeric", ... })
 *   ahadify(d.toLocaleString("id", ...))
 */

/** Replace the weekday name "Minggu" with "Ahad" when it appears as a
 *  standalone word. The `\b` word boundaries keep accidental matches
 *  inside other words from firing. Safe to call on already-Ahad
 *  strings (no double replacement). */
export function ahadify(s: string): string {
  return s.replace(/\bMinggu\b/g, "Ahad");
}

/** Format a Date in the Indonesian locale with Sunday rendered as
 *  "Ahad" instead of "Minggu". Pass the same `Intl.DateTimeFormatOptions`
 *  you'd pass to `toLocaleDateString` / `toLocaleString`. */
export function formatIdDate(
  d: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return ahadify(d.toLocaleDateString("id-ID", options));
}

/** Same as `formatIdDate` but for `toLocaleString` (which includes
 *  time components). Useful when both date and time need formatting. */
export function formatIdDateTime(
  d: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return ahadify(d.toLocaleString("id-ID", options));
}

/** Locale-aware switch: returns the Ahad-fixed Indonesian formatting
 *  when locale is "id", otherwise falls through to the standard
 *  `toLocaleDateString` for whatever locale was passed in. Lets call
 *  sites that don't know the locale ahead of time use one helper. */
export function localeAwareFormat(
  d: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const formatted = d.toLocaleDateString(locale, options);
  return locale === "id" ? ahadify(formatted) : formatted;
}

/** Same as `localeAwareFormat` but for `toLocaleString` (date+time). */
export function localeAwareFormatDateTime(
  d: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const formatted = d.toLocaleString(locale, options);
  return locale === "id" ? ahadify(formatted) : formatted;
}
