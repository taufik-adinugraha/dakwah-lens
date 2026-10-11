/**
 * Links from Belajar to the main site, dakwah-lens.id (operator, 2026-10-10: "we hope this
 * feature can increase traffic to main app dakwah-lens.id. at least we should put logo there").
 * Every main-site address the module links to is built here, so the paths and the UTM tags live
 * in one place.
 *
 * Absolute addresses, in a plain <a>: the module is a separate app on the same origin, and a
 * next-intl <Link> would prefix /belajar and soft-navigate across apps (i18n/navigation.ts). The
 * main site uses the same locales (id, en) with the same prefix shape.
 *
 * The paths were checked against the live site by page <title>, not by status: the main app
 * answers 200 with its branded 404 for ANY unknown path (/id/tidak-ada-xyz → 200), so a typo here
 * would never show up as an error. If the main site moves a page, re-check by title, and update
 * the expected addresses in scripts/ci/brand-smoke.mjs (written out there on purpose, as a
 * second record of what was verified).
 */
export const MAIN_SITE = "https://dakwah-lens.id";

/** Main-site pages Belajar links to, locale-less. Verified 2026-10-11 by <title> (id / en). */
export const MAIN_PAGES = {
  /** "Dakwah-Lens" (Beranda / Home). */
  home: "",
  /**
   * "Briefing Publik" / "Public Briefing": its "Edisi Khusus" row carries the latest Tafsir Pekan
   * Ini. The edition itself lives at a dated address (/briefings/2026-10-01-tafsir-pekan-ini) and
   * the main site has no stable "latest tafsir" URL, so the bridge lands on the list.
   */
  briefings: "/briefings",
  /** "Pustaka Kitab" / "Kitab Library": search over the Qur'an, hadith and classical kitabs. */
  kitab: "/kitab",
  /** "Naskah Khutbah Jumat & Kultum Pekan Ini" / "This Week's Friday Khutbah & Kultum Scripts". */
  khutbahKultum: "/khutbah-kultum",
} as const;

export type MainPage = keyof typeof MAIN_PAGES;

/** Where on Belajar a link sits: its utm_campaign value. */
export type Placement = "surah-end" | "ayah-materials" | "track" | "hub" | "footer";

/**
 * A main-site address with the module's UTM tags:
 * utm_source=belajar&utm_medium=referral&utm_campaign=<placement>.
 */
export function mainSiteHref(locale: string, page: MainPage, placement: Placement): string {
  const query = new URLSearchParams({ utm_source: "belajar", utm_medium: "referral", utm_campaign: placement });
  return `${MAIN_SITE}/${locale}${MAIN_PAGES[page]}?${query.toString()}`;
}

/**
 * The bridges: one calm, labelled link each, at the moments a learner may want more
 * (components/MainSiteBridge.tsx). Their words are messages "MainSite.<id>_label" and, when it
 * exists, the lead-in "MainSite.<id>_lead".
 */
export const BRIDGES = {
  /** End of a surah's autoplay lesson (SurahEndCard): Tafsir Pekan Ini. */
  surah_end: { page: "briefings", placement: "surah-end" },
  /** Inside "Materi lengkap ayat ini": the Kitab search … */
  ayah_kitab: { page: "kitab", placement: "ayah-materials" },
  /** … and the Khutbah & Kultum library. */
  ayah_khutbah: { page: "khutbahKultum", placement: "ayah-materials" },
  /** The Qur'an track page, under "Cara kami menyusun materi". */
  track: { page: "kitab", placement: "track" },
  /** The hub, under the track cards. */
  hub: { page: "home", placement: "hub" },
} as const satisfies Record<string, { page: MainPage; placement: Placement }>;

export type BridgeId = keyof typeof BRIDGES;
