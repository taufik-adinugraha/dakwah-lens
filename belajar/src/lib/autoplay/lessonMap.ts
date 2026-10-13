/**
 * The LESSON MAP of an ayah, version 2 (operator 2026-10-13, plan L23: "at the beginning of the
 * ayat, better to inform what concept we will learn in this ayat, also explain maybe we skip some
 * concept and will visit later in next ayat instead of explaining all concepts in 1 ayat … so at the
 * beginning we inform what will be learnt, in the end recap what we've learnt"; "if some concept
 * already done in previous ayat, we say we repeat what we've learnt before" — and, with the basic
 * curriculum, plan L26: "so the knowledge is accummulating and repeated"; "but separate new vs
 * already knows concept, this is what new, this is what we've learnt so far").
 *
 * Four lists per ayah, of STEPS of the curriculum (./curriculum.ts; content/curriculum.json):
 *   new      what this ayah's lesson teaches, in the order its lines are said (at most three);
 *   learnt   EVERY step of every earlier lesson — the whole list so far — each with `here`: it
 *            comes up again in this ayah;
 *   later    steps of later lessons that occur in this ayah, each with where it is taught;
 *   lanjut   the next-level Konsep records on this ayah: named on the card, never taught here.
 * Version 1 listed Konsep records by their first example (new 5 / 3 / 1 / 1 / 8 / 2 / 6 on
 * Al-Fatihah) and showed the repeated ones only; nothing is derived here any more: the lists are
 * the curriculum's, copied by the pipeline (build_map.py) into content/map/${slug}.json with each
 * name, for every surah that is switched on (pipeline/authored/${slug}.map.json; Al-Fatihah only
 * today). lessonMapProblems holds a file to the curriculum at build time (src/lib/map-content.ts)
 * and in the tests; lessonMapInputOf turns one ayah's entry into what the lesson needs: the
 * opening steps of the autoplay sequence — ONE per group, in step with the narrator ("map:new",
 * "map:learnt", "map:later", right after the imam's recitation) —, the closing ("learned", right
 * before the recap), and the card the stage shows with each (LessonMapCard.tsx).
 *
 * Pure (type imports only): scripts/autoplay-check.ts runs it under tsx without node_modules.
 */
import { lessonAyah, lessonRanks, type CurriculumFile } from "./curriculum";

/** A step as content/map/${slug}.json names it: `name` its caption form (dictionary terms as
 *  "na’t (نَعْت)"), `latin` the same as prose, `lesson` the curriculum lesson that teaches it. */
export type LessonMapStep = { name: string; latin: string; lesson: string };

/** A next-level record as the file names it (from its Konsep title, or an explicit name). */
export type LessonMapRecord = { name: string; latin: string; from: "title" | "authored" };

/** One ayah of the file. */
export type LessonMapAyah = {
  ayah: number;
  new: string[];
  learnt: { id: string; here: boolean }[];
  later: string[];
  lanjut: string[];
};

/** content/map/${slug}.json (zod: src/content/map-schema.ts). */
export type LessonMapFile = {
  version: number;
  slug: string;
  surah: number;
  steps: Record<string, LessonMapStep>;
  lanjut: Record<string, LessonMapRecord>;
  ayat: LessonMapAyah[];
};

/** A step or a record as the card lists it: its name as the captions show it. */
export type LessonMapItem = { id: string; name: string };

/** One ayah's lesson map as the lesson takes it. */
export type LessonMapInput = {
  /** This ayah's surah (a step taught in another surah is shown with that surah). */
  surah: number;
  new: LessonMapItem[];
  /** The whole list learnt so far, in teaching order; `here`: it comes up again in this ayah. */
  learnt: (LessonMapItem & { here: boolean })[];
  /** Where each is taught: an ayah (`surah`, `ayah`), or null for both (a lesson that is no
   *  whole ayah). */
  later: (LessonMapItem & { surah: number | null; ayah: number | null })[];
  lanjut: LessonMapItem[];
};

/** The groups of the opening, in the order their steps are played. */
export const MAP_GROUPS = ["new", "learnt", "later"] as const;
export type MapGroup = (typeof MAP_GROUPS)[number];
/** The closing step and line. */
export const MAP_CLOSING = "learned";

/** The opening groups an ayah's map has (the twin of pipeline/validate_narration.py
 *  map_opening_parts): what is new always; what was learnt so far once something was; what is
 *  postponed or next-level when there is any. */
export function mapOpening(map: Pick<LessonMapInput, "learnt" | "later" | "lanjut">): MapGroup[] {
  return ["new", ...(map.learnt.length ? (["learnt"] as const) : []), ...(map.later.length || map.lanjut.length ? (["later"] as const) : [])];
}

/** The steps learnt so far that come up again in this ayah. */
export const mapHere = (map: Pick<LessonMapInput, "learnt">) => map.learnt.filter((x) => x.here);

/** How many steps have been learnt once this ayah's lesson is through. */
export const mapTotal = (map: Pick<LessonMapInput, "learnt" | "new">) => map.learnt.length + map.new.length;

/** Up to this many learnt steps that come up again are listed on the card in full, one per row
 *  with their Arabic — as many as the narrator names in full (validate_narration.py MAP_ALL);
 *  more are a flowing line of their names in Latin. Measured in CI on a 390×844 phone (base
 *  branch, 2026-10-13): the card has about 270px above the caption panel at the normal text size,
 *  less at the larger ones, and one heading with three names is about 265px. */
export const MAP_HERE_FULL = 3;

/** … and up to this many postponed steps, each with its ayah (the next-level topics share their
 *  card): more are a flowing line too. */
export const MAP_LATER_FULL = 2;

/** The Arabic a caption name carries in brackets after a term, with the space before it
 *  (scripts/ci/screenshots.mjs lessonMapChecks strips a name with the same pattern;
 *  lesson-map.test.ts checks they agree). */
export const MAP_ARABIC_GLOSS = / \([^()]*[\u0600-\u06FF][^()]*\)/g;

/** The Latin name a step is listed by in a flowing line: its caption name without the Arabic in
 *  brackets ("Mu’rab (مُعْرَب) dan mabni (مَبْنِيّ)" → "Mu’rab dan mabni"). */
export const mapLatinName = (name: string): string => name.replace(MAP_ARABIC_GLOSS, "");

/** The ayah's entry of a map file with its names, or null: no map for the surah (it is not
 *  switched on) or for that ayah. */
export function lessonMapInputOf(file: LessonMapFile | null | undefined, ayah: number): LessonMapInput | null {
  const entry = file?.ayat.find((a) => a.ayah === ayah);
  if (!file || !entry) return null;
  const step = (id: string): LessonMapItem[] => (file.steps[id] ? [{ id, name: file.steps[id].name }] : []);
  return {
    surah: file.surah,
    new: entry.new.flatMap(step),
    learnt: entry.learnt.flatMap((x) => step(x.id).map((it) => ({ ...it, here: x.here }))),
    later: entry.later.flatMap((id) =>
      step(id).map((it) => {
        const at = lessonAyah(file.steps[id].lesson);
        return { ...it, surah: at?.surah ?? null, ayah: at?.ayah ?? null };
      }),
    ),
    lanjut: entry.lanjut.flatMap((id) => (file.lanjut[id] ? [{ id, name: file.lanjut[id].name }] : [])),
  };
}

/**
 * What a map file says against the curriculum (empty when fine): its ayat are lessons of the
 * curriculum, each list is the one the curriculum gives for that lesson (so NEW is the lesson's
 * steps, LEARNT every earlier step with `here` where it occurs, LATER a later step that occurs,
 * LANJUT the next-level records tagged there — src/lib/curriculum.ts holds the curriculum itself
 * to the lessons); new, learnt and later are always apart; every listed step and record has its
 * name, and a step's name and lesson are the curriculum's.
 */
export function lessonMapProblems(file: LessonMapFile, curriculum: Pick<CurriculumFile, "lessons" | "steps" | "lanjut">): string[] {
  const out: string[] = [];
  const where = `content/map/${file.slug}.json`;
  if (file.version !== 2) return [`${where}: version ${file.version} is not 2 (rebuild with build_map.py)`];
  const rank = lessonRanks(curriculum);
  const steps = new Map(curriculum.steps.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const listedLanjut = new Set<string>();
  if (!file.ayat.length) return [`${where}: no ayah`];
  for (const entry of file.ayat) {
    const id = `${file.surah}:${entry.ayah}`;
    const lesson = curriculum.lessons.find((l) => l.id === id);
    const here = rank.get(id);
    if (!lesson?.map || here === undefined) {
      out.push(`${where} ayah ${entry.ayah}: ${id} is no lesson of the curriculum with derived lists`);
      continue;
    }
    const got = { new: entry.new, learnt: entry.learnt, later: entry.later, lanjut: entry.lanjut };
    for (const g of ["new", "learnt", "later", "lanjut"] as const) {
      if (JSON.stringify(got[g]) !== JSON.stringify(lesson.map[g])) {
        out.push(`${where} ayah ${entry.ayah}: ${g} ${JSON.stringify(got[g])} is not what the curriculum gives (${JSON.stringify(lesson.map[g])})`);
      }
    }
    const every = [...entry.new, ...entry.learnt.map((x) => x.id), ...entry.later];
    if (new Set(every).size !== every.length) out.push(`${where} ayah ${entry.ayah}: a step is listed twice (new, learnt and later are always apart)`);
    for (const sid of every) listed.add(sid);
    for (const cid of entry.lanjut) listedLanjut.add(cid);
    for (const sid of entry.learnt.map((x) => x.id)) {
      const at = rank.get(steps.get(sid)?.lesson ?? "");
      if (at === undefined || at >= here) out.push(`${where} ayah ${entry.ayah}: learnt lists ${sid}, which is not taught earlier`);
    }
    for (const sid of entry.later) {
      const at = rank.get(steps.get(sid)?.lesson ?? "");
      if (at === undefined || at <= here) out.push(`${where} ayah ${entry.ayah}: later lists ${sid}, which is not taught later`);
    }
  }
  for (const sid of listed) {
    const s = file.steps[sid];
    const c = steps.get(sid);
    if (!s) out.push(`${where}: ${sid} is listed and has no record in steps`);
    else if (!c) out.push(`${where}: ${sid} is no step of the curriculum`);
    else if (s.name !== c.name || s.latin !== c.latin || s.lesson !== c.lesson) out.push(`${where}: step ${sid} is not named and placed as the curriculum has it (${c.name}, ${c.lesson})`);
  }
  for (const sid of Object.keys(file.steps)) if (!listed.has(sid)) out.push(`${where}: ${sid} has a record and no ayah lists it`);
  for (const cid of listedLanjut) {
    if (!file.lanjut[cid]) out.push(`${where}: next-level record ${cid} is listed and has no name`);
    if (!curriculum.lanjut.includes(cid)) out.push(`${where}: ${cid} is listed as next-level and is not in the curriculum's lanjut`);
  }
  for (const cid of Object.keys(file.lanjut)) if (!listedLanjut.has(cid)) out.push(`${where}: next-level record ${cid} has a name and no ayah lists it`);
  return out;
}
