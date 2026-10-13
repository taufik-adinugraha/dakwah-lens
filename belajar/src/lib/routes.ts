/**
 * Every in-module URL is built here, so the URL shape lives in one place.
 *
 * /belajar is a hub of learning tracks (docs/belajar-plan.md L9): the
 * Qur'anic Arabic track sits under /quran, while the shared
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

/**
 * The basic curriculum, explained: which lesson teaches what, in teaching order
 * (docs/belajar-plan.md L27). A static segment beside [surah], so it wins over
 * it; no surah slug may be "kurikulum" (src/lib/routes.test.ts).
 */
export const curriculumHref = () => `/${QURAN}/kurikulum`;

/**
 * The page of ONE lesson of the basic curriculum (content/curriculum.json
 * `lessons`), or null: the lesson has no page. Every link the curriculum page
 * draws to a lesson is built here, and nowhere else.
 *
 * - An ayah lesson of a surah that has lesson pages (`slug`): that ayah's page.
 * - Lesson "0", the introduction with no ayah: NO ROUTE YET, so null, and the
 *   curriculum page shows it as "belum tersedia". Once its route exists
 *   (suggested: /quran/pengantar), return that path from the first line of
 *   the function instead of null (give it a helper of its own beside
 *   curriculumHref), and the curriculum page links it with no other change:
 *   the introduction belongs to no surah, so no surah switch hides it.
 * - A segment of a long ayah ("2:255/3", Ayat Kursi): no route.
 *
 * WHETHER a lesson may be shown as a link is not decided here (this file stays
 * free of imports): the caller asks lib/features.ts for the published surahs
 * (src/lib/curriculumOutline.ts).
 */
export function lessonHref(lesson: { id: string; slug?: string; ayah?: number; segment?: number }): string | null {
  if (lesson.id === "0") return null;
  if (!lesson.slug || lesson.ayah === undefined || lesson.segment !== undefined) return null;
  return ayahHref(lesson.slug, lesson.ayah);
}

/** The Ilmu Waris track's segment: /belajar/{locale}/waris/… (docs/waris-plan.md §9.1). */
const WARIS = "waris";

/**
 * Ilmu Waris (Faraidh) links. The report's answers travel only in the URL
 * FRAGMENT ("#j=v1.…", plan D9): never a query string, which would reach the
 * server in the Referer of every request the page makes. `hitung({ baru: true })` asks
 * the questionnaire for a fresh start ("#baru"), for "Hitung untuk beliau".
 */
export const warisHref = {
  /** Track home: /waris */
  track: () => `/${WARIS}`,
  /** The questionnaire "Hitung waris keluarga saya". */
  hitung: (opts?: { baru?: boolean }) => (opts?.baru ? `/${WARIS}/hitung#baru` : `/${WARIS}/hitung`),
  /** The report "Rekomendasi Pembagian Waris"; with a share token, its fragment link. */
  laporan: (token?: string) => (token ? `/${WARIS}/laporan#j=${token}` : `/${WARIS}/laporan`),
} as const;

/** Shared library, hub level. */
export const conceptIndexHref = () => "/konsep";
export const conceptHref = (id: string) => `/konsep/${id}`;
export const lexemeHref = (id: string) => `/kosakata/${id}`;

/** Sources & licences. */
export const creditsHref = () => "/kredit";
