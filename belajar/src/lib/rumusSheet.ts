/**
 * THE CHEAT SHEET AS ITS PAGE READS IT (operator 2026-10-13: "we can make some 'cheat sheet' to
 * explain the rules … this cheat sheet is explained also along with formal explanation"; "of course
 * we need to refer to valid kitab"; docs/belajar-plan.md L32).
 *
 * content/rumus.json holds, per step of the basic curriculum, a formula and the kitab sentence it
 * restates; `rumusSheet` lays it out the way /quran/rumus draws it — the units in teaching order,
 * each step with its name, its formula, its example, its limit and its basis — and decides, per
 * step, what the page may SHOW:
 *
 *   shown   the step's lesson is available (lib/curriculumOutline.ts lessonLink: written, and its
 *           surah published — the introduction by lib/curriculum.ts introOpen, the same rule as the
 *           curriculum page's links) AND the file has a formula for it: its formula, example and
 *           basis are in the result;
 *   none    the lesson is available and the file has no formula: "Rumus belum tersedia" (no kitab
 *           sentence is pinned for it yet);
 *   locked  the lesson is not available (a surah that is not published, a lesson not written): the
 *           step is named and nothing else — its formula and sources are NOT in the result, so a
 *           hidden surah's formulas are in no HTML and no RSC payload.
 *
 * Nothing is typed here: every name, order, count and example is the files'. Pure (type imports and
 * the route helpers only), like ./curriculumOutline.ts.
 */
import type { CurriculumFile } from "./autoplay/curriculum";
import { lessonLink } from "./curriculumOutline";
import { ayahHref } from "./routes";
import type { RumusFile, RumusSource } from "@/content/rumus-schema";

type SheetCurriculum = Pick<CurriculumFile, "units" | "lessons" | "steps">;

export type SheetExample = {
  /** The word's loc, "1:1:1": the page draws its Arabic, transliteration and meaning from the lesson. */
  loc: string;
  surah: number;
  ayah: number;
  /** The unit's name ("Al-Fatihah") — what a link says. */
  unit: string;
  /** The ayah's page, the word's card (ayahHref with the word's anchor). */
  href: string;
};

export type SheetStep = {
  id: string;
  /** As the lesson card shows it: "Majrur (مَجْرُور)". */
  name: string;
  lesson: string;
  kind: "intro" | "ayah" | "segment";
  /** The ayah or the segment of the step's lesson; null for the introduction. */
  n: number | null;
  state: "shown" | "none" | "locked";
  /** Only when `shown`: */
  rumus?: string;
  awas?: string;
  example?: SheetExample;
  sumber?: RumusSource[];
};

export type SheetUnit = {
  id: string;
  /** The file's name of the unit ("Al-Fatihah", "Pengantar"). */
  name: string;
  /** false for the unit of the lesson with no ayah. */
  surah: boolean;
  steps: SheetStep[];
  shown: number;
};

export type Sheet = {
  units: SheetUnit[];
  /** Totals, each counted from the files. */
  steps: number;
  shown: number;
  none: number;
  locked: number;
};

/** The unit whose surah number a loc ("1:1:1") names, among the units that are a whole surah. */
function unitOfLoc(units: SheetCurriculum["units"], loc: string) {
  const surah = Number(loc.split(":")[0]);
  return units.find((u) => u.surah === surah && u.ayah === undefined && u.slug !== undefined);
}

/**
 * @param published slugs of the surahs visitors can reach (lib/features.ts visibleSurahs()).
 * @param intro may the introduction be shown (lib/curriculum.ts introOpen).
 */
export function rumusSheet(
  file: Pick<RumusFile, "steps">,
  curriculum: SheetCurriculum,
  { published, intro }: { published: ReadonlySet<string>; intro: boolean },
): Sheet {
  const byStep = new Map(file.steps.map((e) => [e.step, e]));
  const units = new Map(curriculum.units.map((u) => [u.id, u]));
  const steps = new Map(curriculum.steps.map((s) => [s.id, s]));
  const out: SheetUnit[] = [];
  const totals = { steps: 0, shown: 0, none: 0, locked: 0 };
  for (const l of curriculum.lessons) {
    if (l.steps.length === 0) continue;
    const unit = units.get(l.unit);
    let group = out.at(-1);
    if (!group || group.id !== l.unit) {
      group = { id: l.unit, name: unit?.name ?? l.unit, surah: unit?.surah !== undefined, steps: [], shown: 0 };
      out.push(group);
    }
    const open = lessonLink(l, unit, { published, intro }) !== null;
    const kind = l.surah === undefined ? "intro" : l.segment !== undefined ? "segment" : "ayah";
    for (const id of l.steps) {
      const step = steps.get(id);
      if (!step) continue;
      const base = { id, name: step.name, lesson: l.id, kind, n: kind === "segment" ? (l.segment ?? null) : kind === "ayah" ? (l.ayah ?? null) : null } as const;
      const e = byStep.get(id);
      totals.steps++;
      if (!open) {
        group.steps.push({ ...base, state: "locked" });
        totals.locked++;
      } else if (!e) {
        group.steps.push({ ...base, state: "none" });
        totals.none++;
      } else {
        let example: SheetExample | undefined;
        if (e.example) {
          const u = unitOfLoc(curriculum.units, e.example.loc);
          const [surah, ayah] = e.example.loc.split(":").map(Number);
          if (u?.slug) example = { loc: e.example.loc, surah, ayah, unit: u.name, href: ayahHref(u.slug, ayah, e.example.loc) };
        }
        group.steps.push({ ...base, state: "shown", rumus: e.rumus, awas: e.awas, example, sumber: e.sumber });
        group.shown++;
        totals.shown++;
      }
    }
  }
  return { units: out, ...totals };
}
