import { defineRouting } from "next-intl/routing";

const LOCALES = ["id", "en"] as const;

/**
 * The locales a search engine may index (operator, 2026-11-26: "publish belajar so google can see";
 * docs/belajar-plan.md L42). Only Indonesian, because English is not yet a complete version of any
 * page that has a lesson in it: the chrome is translated, but the lessons' own content (glosses,
 * explanations, the narrator) stays Indonesian in v1 (plan B12), and the Kosakata list is hidden in
 * English (L37). So, while this list is just "id":
 *   - every /en page is `noindex, follow` (lib/indexing.ts layoutRobots, and an X-Robots-Tag header
 *     from src/proxy.ts), and is not in the sitemap (src/app/sitemap.ts);
 *   - no page carries an hreflang alternate (lib/share.ts alternatesFor), and next-intl's `Link`
 *     header, which says "this page also exists in English", is off (alternateLinks below). Before
 *     this it named an `x-default` that was no page, and pointed at pages that must not be indexed.
 * Add "en" here only when every page type is complete in English: the alternates, the header, the
 * sitemap's `en` entries and the expectations in scripts/ci/seo-smoke.mjs (which reads this line) all
 * follow, and the English pages' own checks must be read again first.
 */
export const INDEXED_LOCALES: readonly (typeof LOCALES)[number][] = ["id"];

// Mirrors web/src/i18n/routing.ts so a learner moving between the main site
// (/id/…) and the module (/belajar/id/…) keeps the same locale shape.
// Content is Indonesian-first; English chrome exists but lessons stay
// Indonesian in v1 (plan §3, B12).
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "id",
  localePrefix: "always",
  localeDetection: false,
  alternateLinks: INDEXED_LOCALES.length === LOCALES.length,
});

export type Locale = (typeof routing.locales)[number];
