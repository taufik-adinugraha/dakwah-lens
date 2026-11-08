/**
 * What a page view reports to the anonymous visit counts (migrations/0003_visit_counts.sql). Pure: the
 * server's route validates against it, and the tests read it, without a browser.
 *
 * Nothing that could tell two visitors apart leaves the browser. The browser remembers which sections it was
 * already counted for, and reports only yes or no: is this its first view of this section today, or ever?
 */

/**
 * The parts of Belajar a visit is counted for. They are the only values the route accepts.
 *
 * Ilmu Waris is not one of them, and its pages send nothing at all: the track handles family and financial
 * details and promises "no server path" (docs/waris-plan.md §9.4), and its CI run fails on any POST
 * (scripts/ci/waris-e2e.mjs, which caught this count when it was first written).
 */
export const VISIT_SECTIONS = ["hub", "quran", "konsep", "kosakata-bertahap", "kosakata-daftar", "kredit"] as const;
export type VisitSection = (typeof VISIT_SECTIONS)[number];

/** The row of the module as a whole. Sections do not add up to it: one browser can visit several in a day. */
export const WHOLE_MODULE = "semua";

/**
 * Where a page view came from, in one word (operator 2026-11-08: "count visits that arrive from the main
 * site"): `hero` came through the homepage's Belajar button, `main` from another page of the main site,
 * `other` is everything else, including every page view after the first of a visit. The route turns it
 * into two numbers (from_main, from_hero); the word says nothing about who sent it.
 */
export const ARRIVALS = ["hero", "main", "other"] as const;
export type Arrival = (typeof ARRIVALS)[number];

/** The module's address under the main site: pages of Belajar are not "the main site". */
const BASE_PATH = "/belajar";

/**
 * The homepage button's link carries these two (web/src/components/landing/Hero.tsx; a test reads that file,
 * so the two cannot drift apart). Both must be there, with a referrer on the main site, to count as `hero`:
 * a copied address that still holds them, opened from a chat, is not a click on the button.
 */
export const HERO_UTM = { utm_source: "dakwah-lens", utm_medium: "hero" } as const;

/**
 * Where the page the browser has just opened came from. `referrer` is document.referrer, `origin` the page's
 * own, `navigationType` what Navigation Timing says ("navigate", "reload", "back_forward"), `search` the
 * address's query. Only a fresh navigation counts: a reload or Back keeps the old referrer, and the visit it
 * belonged to has been counted already. Pure.
 */
export function arrivalOf(i: { referrer: string; origin: string; navigationType?: string; search: string }): Arrival {
  if (i.navigationType === "reload" || i.navigationType === "back_forward") return "other";
  let from: URL;
  try {
    from = new URL(i.referrer);
  } catch {
    return "other";
  }
  if (from.origin !== i.origin) return "other";
  if (from.pathname === BASE_PATH || from.pathname.startsWith(`${BASE_PATH}/`)) return "other";
  const q = new URLSearchParams(i.search);
  const hero = Object.entries(HERO_UTM).every(([k, v]) => q.get(k) === v);
  return hero ? "hero" : "main";
}

/**
 * What an address asks of the counting, so the owner can leave their own browsers out (operator 2026-11-08):
 * `?kunjungan=tidak` stops counting in this browser, `?kunjungan=ya` starts again, anything else asks for
 * nothing. The browser keeps the choice; the server never hears of it.
 */
export const OPT_OUT_PARAM = "kunjungan";
export function optOutRequest(search: string): "off" | "on" | null {
  const v = new URLSearchParams(search).get(OPT_OUT_PARAM);
  return v === "tidak" ? "off" : v === "ya" ? "on" : null;
}

export type VisitReport = {
  section: VisitSection;
  firstToday: boolean;
  firstEver: boolean;
  /** The same two questions of the module as a whole. */
  firstTodayAll: boolean;
  firstEverAll: boolean;
  /** Where this page view came from. */
  arrival: Arrival;
};

/** What the browser remembers. */
export type VisitMemory = { day: string; today: string[]; ever: string[] };

/**
 * The section of a page's path, as usePathname gives it (the locale first, no basePath), or null for a page
 * that sends nothing: Ilmu Waris (above), or a mistyped address.
 */
export function sectionOf(pathname: string): VisitSection | null {
  const [first, second] = pathname.split("/").filter(Boolean).slice(1);
  switch (first) {
    case undefined:
      return "hub";
    case "quran":
    case "konsep":
    case "kredit":
      return first;
    case "kosakata":
      return second === "bertahap" ? "kosakata-bertahap" : "kosakata-daftar";
    default:
      return null;
  }
}

/** The day as the table counts it: a learner's day in WIB, whatever their browser's time zone. */
export function jakartaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

/** What was stored, or null if there is nothing usable: a browser that cannot be told from a new one is new. */
export function parseVisitMemory(raw: string | null): VisitMemory | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VisitMemory> | null;
    const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
    if (!v || typeof v.day !== "string" || !strings(v.today) || !strings(v.ever)) return null;
    return { day: v.day, today: v.today, ever: v.ever };
  } catch {
    return null;
  }
}

/** A page view that cannot be remembered (blocked storage): a view, and no visitor, or each page would be a new one. */
export const viewOnly = (section: VisitSection, arrival: Arrival = "other"): VisitReport => ({ section, firstToday: false, firstEver: false, firstTodayAll: false, firstEverAll: false, arrival });

/** This view's report, and what the browser remembers after it. */
export function countVisit(memory: VisitMemory | null, section: VisitSection, day: string, arrival: Arrival = "other"): { report: VisitReport; memory: VisitMemory } {
  const today = memory?.day === day ? memory.today : [];
  const ever = memory?.ever ?? [];
  const add = (list: string[]) => (list.includes(section) ? list : [...list, section]);
  return {
    report: {
      section,
      firstToday: !today.includes(section),
      firstEver: !ever.includes(section),
      firstTodayAll: today.length === 0,
      firstEverAll: ever.length === 0,
      arrival,
    },
    memory: { day, today: add(today), ever: add(ever) },
  };
}
