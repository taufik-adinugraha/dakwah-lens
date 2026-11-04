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

export type VisitReport = {
  section: VisitSection;
  firstToday: boolean;
  firstEver: boolean;
  /** The same two questions of the module as a whole. */
  firstTodayAll: boolean;
  firstEverAll: boolean;
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
export const viewOnly = (section: VisitSection): VisitReport => ({ section, firstToday: false, firstEver: false, firstTodayAll: false, firstEverAll: false });

/** This view's report, and what the browser remembers after it. */
export function countVisit(memory: VisitMemory | null, section: VisitSection, day: string): { report: VisitReport; memory: VisitMemory } {
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
    },
    memory: { day, today: add(today), ever: add(ever) },
  };
}
