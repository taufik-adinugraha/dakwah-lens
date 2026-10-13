/**
 * THE BASIC CURRICULUM AS ITS PAGE READS IT (operator 2026-10-13: "we should also explain this
 * curriculum in the page"; docs/belajar-plan.md L30, the curriculum itself: L26 and
 * docs/belajar-research/kurikulum-dasar.md decisions 1–9).
 *
 * content/curriculum.json says which lesson teaches what; `curriculumOutline` turns it into what
 * /quran/kurikulum draws — the units in teaching order, each lesson with what is NEW in it and
 * the running total learnt after it (decision 9: new and already-learnt are always apart, and
 * "learnt so far" is cumulative), and for a lesson with nothing new the steps that come up again
 * in its ayah, where the built file has that list (a lesson that is written). Nothing is typed
 * here: every name, order and count is the file's.
 *
 * AVAILABILITY is decided here, from the data, in one place: a lesson is a link only when
 *   - lib/routes.ts lessonHref gives it a page (no page today for lesson "0", the introduction,
 *     and for the segments of Ayat Kursi), and
 *   - it belongs to no surah (the introduction, once it has a route), or its surah is one
 *     BELAJAR_SURAHS publishes (`published`: lib/features.ts visibleSurahs(), the same switch that
 *     turns a surah's card on the track page into "Segera hadir") AND the lesson is written (the
 *     built file carries its derived lists only for an ayah that is on disk).
 * Every other lesson has `href: null`; the page shows it as plain text marked "belum tersedia",
 * and its path is never built, so it is in no HTML and no RSC payload.
 *
 * Pure (type imports and the route helpers only), like ./autoplay/curriculum.ts.
 */
import type { CurriculumFile } from "./autoplay/curriculum";
import { lessonHref } from "./routes";

/** A step as the page lists it. */
export type OutlineStep = {
  id: string;
  /** Its name as the lesson's card shows it: dictionary terms with their Arabic, "Majrur (مَجْرُور)". */
  name: string;
  /** The Konsep page that explains it — the record it is taught from or is a part of, or the Dasar
   *  membaca record (harakat) — or null: no page (a step with a text of its own and no record, or a
   *  step that is not written yet). */
  page: string | null;
};

export type OutlineLesson = {
  /** "0" (the lesson with no ayah), "1:4" (an ayah), "2:255/3" (a segment of a long ayah). */
  id: string;
  kind: "intro" | "ayah" | "segment";
  /** The ayah of an ayah lesson, the number of a segment; null for the introduction. */
  n: number | null;
  /** What this lesson teaches for the first time, in the order its lines are said (at most three). */
  new: OutlineStep[];
  /** How many steps are learnt once this lesson is through (the file's running count). */
  after: number;
  /** The steps learnt earlier that come up again in this lesson's ayah, in teaching order; null
   *  when the built file has no derived lists for it (it is not written): then nobody knows yet. */
  again: OutlineStep[] | null;
  /** The lesson's page, or null: not available (see the head of this file). */
  href: string | null;
};

export type OutlineUnit = {
  id: string;
  /** The file's name of the unit ("Al-Fatihah", "Ayat Kursi", "Pengantar"). */
  name: string;
  /** false for the unit of the lesson with no ayah. */
  surah: boolean;
  lessons: OutlineLesson[];
  /** New steps taught in this unit. */
  steps: number;
};

export type Outline = {
  /** In teaching order: consecutive lessons of one unit. */
  units: OutlineUnit[];
  /** Totals, each counted from the file. */
  lessons: number;
  steps: number;
  /** The most new steps any one lesson teaches. */
  maxNew: number;
  /** The next-level Konsep records ("tingkat lanjut") that have a page, in the file's order. */
  lanjut: string[];
};

type OutlineFile = Pick<CurriculumFile, "units" | "lessons" | "steps" | "lanjut">;

/**
 * @param published slugs of the surahs visitors can reach (lib/features.ts visibleSurahs()).
 * @param pages ids that have a Konsep page (the library's concepts and basics).
 */
export function curriculumOutline(file: OutlineFile, { published, pages }: { published: ReadonlySet<string>; pages: ReadonlySet<string> }): Outline {
  const steps = new Map(file.steps.map((s) => [s.id, s]));
  const units = new Map(file.units.map((u) => [u.id, u]));
  const step = (id: string): OutlineStep[] => {
    const s = steps.get(id);
    if (!s) return [];
    return [{ id, name: s.name, page: [s.concept, s.basics].find((p): p is string => p !== undefined && pages.has(p)) ?? null }];
  };
  const out: OutlineUnit[] = [];
  for (const l of file.lessons) {
    const unit = units.get(l.unit);
    let group = out.at(-1);
    if (!group || group.id !== l.unit) {
      group = { id: l.unit, name: unit?.name ?? l.unit, surah: unit?.surah !== undefined, lessons: [], steps: 0 };
      out.push(group);
    }
    const kind = l.surah === undefined ? "intro" : l.segment !== undefined ? "segment" : "ayah";
    const page = lessonHref({ id: l.id, slug: unit?.slug, ayah: l.ayah, segment: l.segment });
    const open = page !== null && (kind === "intro" || (unit?.slug !== undefined && published.has(unit.slug) && l.map !== undefined));
    group.lessons.push({
      id: l.id,
      kind,
      n: kind === "segment" ? (l.segment ?? null) : kind === "ayah" ? (l.ayah ?? null) : null,
      new: l.steps.flatMap(step),
      after: l.after,
      again: l.map ? l.map.learnt.filter((x) => x.here).flatMap((x) => step(x.id)) : null,
      href: open ? page : null,
    });
    group.steps += l.steps.length;
  }
  return {
    units: out,
    lessons: file.lessons.length,
    steps: file.steps.length,
    maxNew: file.lessons.reduce((n, l) => Math.max(n, l.steps.length), 0),
    lanjut: file.lanjut.filter((id) => pages.has(id)),
  };
}
