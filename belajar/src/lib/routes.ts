/**
 * Every in-module URL is built here, so the URL shape lives in one place.
 *
 * /belajar is a hub of learning tracks (docs/belajar-plan.md L9): the
 * Qur'anic Arabic + light tafsir track sits under /quran, while the shared
 * Konsep / Kosakata library stays at hub level because later tracks reuse
 * it. Paths here are locale-less and basePath-less: hand them to the
 * next-intl <Link> from "@/i18n/navigation", which adds both.
 *
 * Keep this file free of imports: next.config.ts reads SURAH_SLUGS to build
 * the redirects from the pre-hub URL shape, and the config must not pull app
 * code (content JSON, zod schemas) in with it.
 */

/** The Qur'an track's segment: /belajar/{locale}/quran/… */
const QURAN = "quran";

/**
 * Slug of every surah that has a lesson, in mushaf order. When you add a
 * surah's content file, add its slug here too: next.config.ts redirects the
 * pre-hub URLs /{locale}/{slug}[/{ayah}] for these slugs into the track,
 * src/lib/routes.test.ts fails CI unless this list equals the loaded surahs
 * (same order), and belajar/pipeline/validate.py checks it against content/.
 * Lowercase letters, digits and hyphens only (the slugs go into a redirect
 * pattern unescaped).
 */
export const SURAH_SLUGS = ["al-fatihah", "al-ikhlas", "al-falaq", "an-nas"] as const;

/** The hub: /belajar/{locale} */
export const hubHref = () => "/";

/** The Qur'an track's landing page (surah list). */
export const quranHref = () => `/${QURAN}`;

/** One surah: its list of ayat. */
export const surahHref = (slug: string) => `/${QURAN}/${slug}`;

/**
 * One ayah's lesson; with `wordLoc` ("1:2:3"), straight to that word's card
 * ("#w-1-2-3", the id WordCard renders).
 */
export function ayahHref(slug: string, ayah: number, wordLoc?: string) {
  const path = `/${QURAN}/${slug}/${ayah}`;
  return wordLoc ? `${path}#${wordAnchorId(wordLoc)}` : path;
}

/** DOM id of a word card, from its loc: "1:2:3" → "w-1-2-3". */
export const wordAnchorId = (loc: string) => `w-${loc.replaceAll(":", "-")}`;

/** Shared library, hub level. */
export const conceptIndexHref = () => "/konsep";
export const conceptHref = (id: string) => `/konsep/${id}`;
export const lexemeHref = (id: string) => `/kosakata/${id}`;

/** Sources & licences. */
export const creditsHref = () => "/kredit";
