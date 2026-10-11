import { connection } from "next/server";

import { SURAH_SLUGS } from "./routes";

/**
 * BELAJAR_WARIS — the Ilmu Waris (Faraidh) track is hidden on the live site for now (operator,
 * 2026-10-10: "let's hide warisan at the moment"; docs/belajar-plan.md L12). Its code, content
 * and CI checks stay; only what visitors can reach changes:
 *   - src/proxy.ts answers every /{locale}/waris… URL with the module's own 404, so nothing of
 *     the track renders (not its pages, not their titles);
 *   - the hub lists no Ilmu Waris card.
 *
 * `BELAJAR_WARIS=on` shows it again, with no rebuild: unlike BELAJAR_PUBLIC (lib/flags.ts) it is
 * read per request. On the VM, add the line to /srv/dakwah-lens/belajar.env (deploys keep it;
 * deploy.sh rewrites that file only when it must recreate the database credential, and the track
 * is then hidden again) and recreate the container so it reads the file again:
 *   flock -w 1800 /srv/dakwah-lens/.deploy.lock \
 *     docker compose -f /srv/dakwah-lens/belajar/current/docker-compose.yml up -d --force-recreate
 * (a plain `docker restart` keeps the old environment). Any other value, or none (the production
 * default), hides it. CI runs the waris smoke, screenshot and end-to-end checks on a container
 * started with the switch on, and checks that the default container hides the track.
 */
export function warisSwitchOn(): boolean {
  return process.env.BELAJAR_WARIS === "on";
}

/**
 * The switch, for a page: waits for the request first (connection()), so the page renders at
 * request time and never bakes the build machine's value into a prerendered page.
 */
export async function warisVisible(): Promise<boolean> {
  await connection();
  return warisSwitchOn();
}

/**
 * BELAJAR_SURAHS — the surahs of the Qur'an track visitors can reach (operator, 2026-10-10:
 * "let's focus on alfatihah first, show cards for other surah as 'segera hadir', but not
 * clickable"; docs/belajar-plan.md L14). A comma-separated list of lesson slugs
 * (lib/routes.ts SURAH_SLUGS); unset (the production default) publishes Al-Fatihah only. A surah
 * the list leaves out keeps its code, content and CI checks; only what visitors can reach changes:
 *   - src/proxy.ts answers every /{locale}/quran/{slug}… URL of it with the module's own 404 (the
 *     pre-hub /{locale}/{slug} URLs too, once next.config.ts has redirected them there);
 *   - the track page shows it as a "Segera hadir" card that is not a link, and the hub's
 *     "Tersedia sekarang" leaves it out;
 *   - nothing links into it: not the track's ayah chips, not the end of the surah before it
 *     (which asks /belajar/api/surahs, the lesson pages being prerendered), not a concept's
 *     examples or a word's "Muncul dalam pelajaran" list (they show the place as plain text).
 *
 * Read per request, like BELAJAR_WARIS, so showing a surah is an env change, not a rebuild: on
 * the VM, set the line in /srv/dakwah-lens/belajar.env to every surah to show, e.g.
 *   BELAJAR_SURAHS=al-fatihah,al-ikhlas,al-falaq,an-nas
 * and recreate the container with the command above (deploys keep the line, except when deploy.sh
 * must rewrite the file for a new database credential: only Al-Fatihah shows again). Each slug is
 * trimmed and lower-cased, and one that names no lesson is ignored; a value naming no lesson at
 * all counts as unset, so a typo cannot empty the track. CI runs the Mu'awwidzat smoke and
 * screenshot checks on a container started with every surah listed, and checks that the default
 * container hides them.
 */
export const DEFAULT_SURAHS: readonly string[] = ["al-fatihah"];

/** Slugs of the published surahs, in mushaf order (SURAH_SLUGS order). */
export function publishedSurahs(): string[] {
  const listed = new Set((process.env.BELAJAR_SURAHS ?? "").split(",").map((s) => s.trim().toLowerCase()));
  const known = SURAH_SLUGS.filter((slug) => listed.has(slug));
  return known.length > 0 ? known : [...DEFAULT_SURAHS];
}

/**
 * Is this surah's lesson published? Synchronous, for server components inside a page that has
 * already awaited visibleSurahs() (src/components/library/ConceptCard.tsx); in a page that has
 * not, the build machine's value would be prerendered.
 */
export function surahPublished(slug: string): boolean {
  return publishedSurahs().includes(slug);
}

/**
 * The published surahs, for a page: after connection(), so the page renders at request time and
 * never bakes the build machine's value into a prerendered page (as warisVisible()).
 */
export async function visibleSurahs(): Promise<string[]> {
  await connection();
  return publishedSurahs();
}
