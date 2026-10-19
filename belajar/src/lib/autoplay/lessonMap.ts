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
 * "map:learnt", "map:later", right after the imam's recitation; each with its lines, MAP_LINES)
 * —, the closing ("learned", right before the recap), and the card the stage shows with each
 * (LessonMapCard.tsx).
 *
 * Pure (type imports only): scripts/autoplay-check.ts runs it under tsx without node_modules.
 */
import { lessonAyah, lessonRanks, type CurriculumFile } from "./curriculum";

/** A step as content/map/${slug}.json names it: `name` its caption form (dictionary terms as
 *  "na’t (نَعْت)"), `latin` the same as prose, `lesson` the curriculum lesson that teaches it. */
export type LessonMapStep = { name: string; latin: string; lesson: string };

/** A next-level record as the file names it (from its Konsep title, or an explicit name). */
export type LessonMapRecord = { name: string; latin: string; from: "title" | "authored" };

/** The three kinds of word, in the order the lessons name them (pipeline/quiz.py KINDS). */
export const MAP_KINDS = ["isim", "fiil", "huruf"] as const;
export type MapKind = (typeof MAP_KINDS)[number];

/** One ayah of the file. `kinds`: the kinds of word its words are made of (the QAC tag of each
 *  part, as the warm-up derives it; pipeline/lessonmap.py kinds_of). */
export type LessonMapAyah = {
  ayah: number;
  new: string[];
  learnt: { id: string; here: boolean }[];
  later: string[];
  lanjut: string[];
  kinds: MapKind[];
};

/** The file's step of the three kinds of word: its name without its members ("Tiga jenis kata")
 *  and each kind's name ("Isim (اِسْم)"). */
export type LessonMapKinds = {
  step: string;
  name: string;
  latin: string;
  members: Record<MapKind, { name: string; latin: string }>;
};

/** content/map/${slug}.json (zod: src/content/map-schema.ts). */
export type LessonMapFile = {
  version: number;
  slug: string;
  surah: number;
  steps: Record<string, LessonMapStep>;
  lanjut: Record<string, LessonMapRecord>;
  ayat: LessonMapAyah[];
  kinds: LessonMapKinds | null;
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
  /** The step of the three kinds of word and the kinds this ayah has (null: the file has no such
   *  step). Operator 2026-10-18: "we always say in this ayat we find 3 jenis kata: isim, fi'il,
   *  huruf. But actually in that ayat (example ayat-3) we only have isim" — so where a line or the
   *  card says it is met HERE, it names these, and all three only when `all`. */
  kinds?: MapKindsHere | null;
};

/** What an ayah's map says of the three kinds of word. */
export type MapKindsHere = {
  step: string;
  /** The step's name without its members: "Tiga jenis kata" (caption form, and as prose). */
  name: string;
  latin: string;
  /** All three kinds occur in this ayah. */
  all: boolean;
  /** The kinds that do, in order, each as the captions name it ("Isim (اِسْم)"). */
  here: (LessonMapItem & { latin: string })[];
};

/** The groups of the opening, in the order their steps are played. */
export const MAP_GROUPS = ["new", "learnt", "later"] as const;
export type MapGroup = (typeof MAP_GROUPS)[number];
/** The closing step and its first line. */
export const MAP_CLOSING = "learned";

/**
 * The narration lines of each map step, in play order (the twin of
 * pipeline/validate_narration.py map_opening_parts / map_closing_parts). Operator 2026-10-15: a
 * sentence that COUNTS steps also NAMES every one of them ("Dengan itu, sudah empat hal yang kita
 * pelajari, yaitu A, B, C, D" — "always re-mention what they are"), so a list of sixteen is a line
 * of its own and each such sentence is ONE line (never split): the learnt step says "map:again"
 * (which of what was learnt comes up again here; since 2026-10-17 alone — operator: "better to
 * remove this line in every ayat beginning: 'Sebelum ayat ini, kita sudah mempelajari XX hal'",
 * so the learnt-so-far count is said only in the closing's "map:total"); the later step
 * "map:later" (what is taught later, and how many next-level topics) then "map:focus" (the
 * reassurance: none of that needs learning now, focus on the new steps); the closing "learned"
 * (what was new) then "map:total" (the running total, every step named). One card per step: the
 * card stays while both its lines are said.
 */
export const MAP_LINES = {
  new: ["map:new"],
  learnt: ["map:again"],
  later: ["map:later", "map:focus"],
  learned: ["learned", "map:total"],
} as const satisfies Record<MapGroup | typeof MAP_CLOSING, readonly string[]>;

/** A step's name inside a caption sentence: its Latin name (mapLatinName) with the first letter
 *  in lower case, after a leading ‘ain too ("‘Athaf (عَطْف)" → "‘athaf") — what the narration's
 *  prose does with it (pipeline/validate_narration.py _low). */
export function mapSaidName(name: string): string {
  const latin = mapLatinName(name);
  const i = /^['‘’ʼʿʾ`´]\p{L}/u.test(latin) ? 1 : 0;
  return latin.slice(0, i) + latin.slice(i, i + 1).toLowerCase() + latin.slice(i + 1);
}

/** Step names as one list inside an Indonesian sentence: "a", "a dan b", "a, b, dan c" — and
 *  ", serta" for the last join when a name has a "dan" of its own ("dhamir, serta mu’rab dan
 *  mabni"), so the names stay apart (pipeline/build_narration.py _names). */
export function mapListId(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  const last = names.some((n) => / dan /.test(n)) ? "serta" : "dan";
  if (names.length === 2 && last === "dan") return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, ${last} ${names[names.length - 1]}`;
}

/** The reassurance's word for `n` things the ayah puts aside (operator 2026-10-15: "ketiganya /
 *  keduanya / semuanya … 1: yang satu ini"; validate_narration.py FOCUS_PRONOUN). */
export const mapPronounId = (n: number): string => (n === 1 ? "yang satu ini" : n === 2 ? "keduanya" : n === 3 ? "ketiganya" : "semuanya");

/** A postponed step as a caption names it: `ayah`, the ayah of THIS surah that teaches it, or null
 *  (another surah, or a lesson that is no whole ayah). */
export type MapLaterName = { name: string; ayah: number | null };

/** Where a caption says the postponed steps are taught (pipeline/build_narration.py map_later):
 *  null — "nanti": one of them is not taught in an ayah of this surah; a number — the one ayah of
 *  this surah that teaches them all; "each" — each with its own ayah. */
export function mapLaterWhere(later: readonly MapLaterName[]): number | "each" | null {
  if (later.some((x) => x.ayah === null)) return null;
  const at = new Set(later.map((x) => x.ayah));
  return at.size === 1 ? (later[0].ayah as number) : "each";
}

/** The postponed steps of a map as the captions name them (this surah's ayah, or none). */
export const mapLaterNames = (map: Pick<LessonMapInput, "surah" | "later">): MapLaterName[] =>
  map.later.map((it) => ({ name: mapSaidName(it.name), ayah: it.surah === map.surah ? it.ayah : null }));

/** The opening groups an ayah's map has (the twin of pipeline/validate_narration.py
 *  map_opening_parts): what is new always; what was learnt so far once something was; what is
 *  postponed or next-level when there is any. */
export function mapOpening(map: Pick<LessonMapInput, "learnt" | "later" | "lanjut">): MapGroup[] {
  return ["new", ...(map.learnt.length ? (["learnt"] as const) : []), ...(map.later.length || map.lanjut.length ? (["later"] as const) : [])];
}

/** The steps learnt so far that come up again in this ayah. */
export const mapHere = (map: Pick<LessonMapInput, "learnt">) => map.learnt.filter((x) => x.here);

/** The step of the three kinds of word comes up again in this ayah, and the ayah has fewer than
 *  all three (pipeline/lessonmap.py kinds_partial): whatever says it is met here names it bare and
 *  says which kinds occur. */
export const mapKindsPartial = (map: Pick<LessonMapInput, "learnt" | "kinds">): boolean =>
  !!map.kinds && !map.kinds.all && map.learnt.some((x) => x.here && x.id === map.kinds!.step);

/** The step names a caption gives the steps met again here (mapSaidName): the kinds step bare
 *  when the ayah has fewer than all three (pipeline/build_narration.py _said_here). */
export const mapHereSaid = (map: Pick<LessonMapInput, "learnt" | "kinds">): string[] =>
  mapHere(map).map((it) => mapSaidName(mapKindsPartial(map) && it.id === map.kinds!.step ? map.kinds!.name : it.name));

/** The caption's word for the kinds an ayah has, with the step's bare name (null: all three, or
 *  the step does not come up here): what follows a list of the steps met here,
 *  "Dari {step} itu, di ayat ini hanya ada {kinds}." (pipeline/lessonmap.py KINDS_SENTENCE). */
export type MapKindsSaid = { step: string; kinds: readonly string[] };
export const mapKindsSaid = (map: Pick<LessonMapInput, "learnt" | "kinds">): MapKindsSaid | null =>
  mapKindsPartial(map) ? { step: mapSaidName(map.kinds!.name), kinds: map.kinds!.here.map((k) => mapSaidName(k.name)) } : null;

/** A name with its first letter in lower case, its Arabic kept ("Isim (اِسْم)" → "isim (اِسْم)"). */
export const mapLowFirst = (name: string): string => name.slice(0, 1).toLowerCase() + name.slice(1);

/** How many steps have been learnt once this ayah's lesson is through. */
export const mapTotal = (map: Pick<LessonMapInput, "learnt" | "new">) => map.learnt.length + map.new.length;

/** Up to this many learnt steps that come up again are listed on the card in full, one per row
 *  with their Arabic (the narrator names every one of them since 2026-10-15, map:again; the card
 *  is held to the phone's room); more are a flowing line of their names in Latin. Measured in CI
 *  on a 390×844 phone (base branch, 2026-10-13): the card has about 270px above the caption panel
 *  at the normal text size, less at the larger ones, and one heading with three names is about
 *  265px. */
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
  const kinds = file.kinds;
  return {
    surah: file.surah,
    kinds: kinds
      ? {
          step: kinds.step,
          name: kinds.name,
          latin: kinds.latin,
          all: MAP_KINDS.every((k) => entry.kinds.includes(k)),
          here: MAP_KINDS.filter((k) => entry.kinds.includes(k)).map((k) => ({ id: k, name: kinds.members[k].name, latin: kinds.members[k].latin })),
        }
      : null,
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
    // The kinds of word of the ayah's words, in order, each once (pipeline/lessonmap.py holds them
    // to the QAC tags of the words; here: their shape).
    if (!entry.kinds.length || JSON.stringify(entry.kinds) !== JSON.stringify(MAP_KINDS.filter((k) => entry.kinds.includes(k)))) {
      out.push(`${where} ayah ${entry.ayah}: kinds ${JSON.stringify(entry.kinds)} are not kinds of word in the order ${MAP_KINDS.join(", ")}`);
    }
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
  // The step of the three kinds of word: the curriculum's step whose record is the Kalimah record.
  const kstep = curriculum.steps.find((s) => s.concept === KALIMAH_RECORD)?.id ?? null;
  if (kstep && listed.has(kstep)) {
    if (!file.kinds || file.kinds.step !== kstep) out.push(`${where}: kinds must name the step ${kstep} (the three kinds of word), which its ayat list`);
    else if (!file.steps[kstep]?.name.startsWith(file.kinds.name)) out.push(`${where}: kinds names the step “${file.kinds.name}”, not its own name without its members`);
  } else if (file.kinds) out.push(`${where}: kinds is given, and no ayah lists the step of the three kinds of word`);
  return out;
}

/** The Konsep record of the three kinds of word (pipeline/quiz.py KALIMAH_RECORD). */
export const KALIMAH_RECORD = "kalimah-isim-fiil-huruf";
