import type { Metadata } from "next";

/**
 * Canonical public origin for absolute URLs in SEO surfaces
 * (metadataBase, sitemap, robots, OG images). Override per-env with
 * NEXT_PUBLIC_SITE_URL; defaults to the production domain. No trailing slash.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://dakwah-lens.id"
).replace(/\/+$/, "");

const LOCALES = ["id", "en"] as const;

/**
 * Build `alternates` (canonical + hreflang) for a page's metadata.
 *
 * `canonicalPath` is the ONE preferred path for this content, WITHOUT the
 * locale prefix (e.g. `/d/2026-07-24-hukum-keadilan/khutbah`). Pass the
 * page's own path for a self-referential canonical, or a different path to
 * dedup a duplicate route onto its canonical home (e.g. `/briefings/{slug}`
 * → `/d/{slug}`). `hasEn` asserts the English hreflang only when an English
 * version actually exists (most briefings are Indonesian-only).
 */
export function localeAlternates(opts: {
  locale: string;
  canonicalPath: string;
  hasEn?: boolean;
}): Metadata["alternates"] {
  const { locale, canonicalPath } = opts;
  const hasEn = opts.hasEn ?? true;
  const abs = (l: string, p: string) => `${SITE_URL}/${l}${p}`;

  const languages: Record<string, string> = {
    id: abs("id", canonicalPath),
    "x-default": abs("id", canonicalPath),
  };
  if (hasEn) languages.en = abs("en", canonicalPath);

  const self = LOCALES.includes(locale as (typeof LOCALES)[number])
    ? locale
    : "id";
  return {
    canonical: abs(self, canonicalPath),
    languages,
  };
}
