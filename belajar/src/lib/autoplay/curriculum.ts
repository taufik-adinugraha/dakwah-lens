/**
 * THE BASIC CURRICULUM: where each topic of the course is taught (operator-approved 2026-10-13,
 * docs/belajar-research/kurikulum-dasar.md decisions 1–9; plan L26): "we distribute the lessons
 * into these ayats" — "let's focus on the basic first" — at most three new steps per lesson, in the
 * teaching order lesson zero → Al-Fatihah → An-Nas → Al-Falaq → Al-Ikhlas → Ayat al-Kursi — "next
 * ayat, should review pervious lesson if exist in that ayat" — "so the knowledge is accummulating
 * and repeated" — "but separate new vs already knows concept, this is what new, this is what we've
 * learnt so far".
 *
 * Until then a Konsep was "introduced" in the ayah of its FIRST EXAMPLE — a rule written three
 * times (pipeline/validate_narration.py introduced_concepts, pipeline/lessonmap.py taught_at,
 * src/lib/library.ts conceptsIntroducedIn). All three now read ONE file, content/curriculum.json
 * (pipeline/build_curriculum.py, from pipeline/authored/curriculum.json): `taughtIn` below is what
 * conceptsIntroducedIn was — the "Konsep baru" lines of an ayah's lesson — and `deriveLesson` is the
 * twin of pipeline/curriculum.py derive (the four lists of an ayah's card), compared with the built
 * file on every lesson at build time (curriculumProblems; src/lib/curriculum.ts) and in the tests.
 *
 * A STEP is taught from a whole Konsep record (its line is "concept:${recordId}", the id it always
 * had, so an unchanged text keeps its audio), from its own text (`teach`: a part of a record —
 * majrur, marfu', manshub of the i'rab record — or a step with no record, alif lam; its line is
 * "concept:${stepId}"), or from nothing yet (not written; no line). A NEXT-LEVEL record ("tingkat
 * lanjut", decision 6: all sharaf, and the advanced nahwu) is named on a card and never taught.
 *
 * Where a step OCCURS in an ayah (pipeline/curriculum.py occurs): `occurs.case` — the words in that
 * i'rab state; `occurs.qac` — the words with a QAC segment of that tag, read from the QAC line of
 * the word's own sources; `occurs.always` — every word; a whole record without `occurs` — the words
 * tagged with it and the words of its structure groups; a basics step (harakat) — nowhere.
 *
 * "Earlier" and "later" are places in the curriculum's lesson order, never mushaf order.
 *
 * Pure (type imports only): scripts/autoplay-check.ts runs it under tsx without node_modules.
 */
import type { Ayah, Concept } from "@/content/schema";

export type CurriculumSource = { kitab: string; ref: string; url: string };

/** One step of content/curriculum.json. */
export type CurriculumStep = {
  id: string;
  /** The lesson that teaches it: "0" (no ayah), "1:4" (an ayah), "2:255/3" (a segment). */
  lesson: string;
  /** Its name as a caption shows it: dictionary terms with their Arabic, "Majrur (مَجْرُور)". */
  name: string;
  /** The same name as prose. */
  latin: string;
  /** The Konsep record it is taught from (whole), or is a part of (with `part`). */
  concept?: string;
  part?: number;
  /** A Dasar membaca record (the harakat primer). */
  basics?: string;
  occurs?: { case?: string; qac?: string; always?: boolean };
  /** The part of its narration line id ("concept:…"), or null: no "Konsep baru" text of its own. */
  line: string | null;
  /** Its own text: plain prose, the marked twin (terms by id) and its kitab sources. */
  teach?: { title: string; summary: string; marked: { title: string; summary: string }; sources: CurriculumSource[] };
  /** LESSON ZERO's slide before its line, and the examples its card shows after it, each with the
   *  narrator's line (pipeline/curriculum.py LEAD_KEYS; operator 2026-10-15). */
  lead?: CurriculumLead;
  examples?: { loc: string; say: string; about: string }[];
  terms: string[];
};

/** A slide said before a step's "Konsep baru" line: its text, its cards, its sources. */
export type CurriculumLead = {
  say: string;
  cards: { lang: "ar" | "id"; means: string; word?: string; term?: { id: string; latin: string; ar: string } }[];
  sources: CurriculumSource[];
};

/** The four lists of a lesson's card (decision 9: new and already-learnt are always apart). */
export type CurriculumMap = {
  /** The lesson's steps, in the order their lines are said. */
  new: string[];
  /** EVERY step of every earlier lesson, in teaching order; `here`: it occurs in this ayah. */
  learnt: { id: string; here: boolean }[];
  /** Steps of later lessons that occur in this ayah, in teaching order. */
  later: string[];
  /** Next-level Konsep records tagged on this ayah, in the library's order. */
  lanjut: string[];
};

/** A "Konsep baru" line of a lesson: its id part, its step, the words of the ayah it lights. */
export type CurriculumLine = { line: string; step: string; words: number[] };

export type CurriculumLesson = {
  id: string;
  unit: string;
  surah?: number;
  ayah?: number;
  segment?: number;
  words?: number[];
  steps: string[];
  /** Steps learnt before / after this lesson (the running count). */
  before: number;
  after: number;
  /** Only for a lesson whose ayah is on disk. */
  lines?: CurriculumLine[];
  map?: CurriculumMap;
};

export type CurriculumUnit = { id: string; name: string; surah?: number; ayah?: number; slug?: string };

/** content/curriculum.json (zod: src/content/curriculum-schema.ts). */
export type CurriculumFile = {
  version: number;
  units: CurriculumUnit[];
  lessons: CurriculumLesson[];
  steps: CurriculumStep[];
  free: string[];
  lanjut: string[];
};

/** Decision 7: at most three new steps per lesson (pipeline/curriculum.py MAX_STEPS). */
export const MAX_STEPS_PER_LESSON = 3;

/** The curriculum's lesson with no ayah, which opens the course (decision 1). */
export const LESSON_ZERO = "0";

/** The lesson id of a whole ayah: "1:4" — and of "ayah 0", the place of lesson zero's lines in
 *  the surah that hosts it (ids.ts ZERO_AYAH; pipeline/curriculum.py ayah_lesson). */
export const ayahLessonId = (surah: number, ayah: number): string => (ayah === 0 ? LESSON_ZERO : `${surah}:${ayah}`);

/** (surah, ayah) of a lesson that is one whole ayah; null for the lesson with no ayah and for a
 *  segment of a long ayah. */
export function lessonAyah(lessonId: string): { surah: number; ayah: number } | null {
  const m = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/.exec(lessonId);
  return m ? { surah: Number(m[1]), ayah: Number(m[2]) } : null;
}

type CurriculumWord = Pick<Ayah["words"][number], "concepts" | "case" | "sources">;
export type CurriculumAyah = { surah: number; ayah: number; words: readonly CurriculumWord[]; structure?: Ayah["structure"] };

const QAC_KITAB = "Quranic Arabic Corpus";

/** The QAC 0.4 segment tags of a lesson word (DET, N, P, V …): the first field of each segment in
 *  the QAC line of its sources ("… kelas kata: DET|PREFIX|Al+ + ADJ|STEM|…"); [] without one. */
export function qacTags(word: Pick<CurriculumWord, "sources">): string[] {
  for (const s of word.sources ?? []) {
    if (!s.kitab.startsWith(QAC_KITAB)) continue;
    const m = /kelas kata: (.+)$/.exec(s.ref ?? "");
    if (m) return m[1].split(" + ").map((seg) => seg.split("|", 1)[0]);
  }
  return [];
}

/** The words (1-based) of an ayah that carry a Konsep record: tagged with it, or in a structure
 *  group of it (the idhafah of bismi + Allāhi is [1, 2] although only Allāhi is tagged). */
export function recordWords(ayah: Pick<CurriculumAyah, "words" | "structure">, record: string): number[] {
  const n = ayah.words.length;
  const out = new Set(ayah.words.flatMap((w, i) => ((w.concepts ?? []).includes(record) ? [i + 1] : [])));
  for (const g of ayah.structure?.groups ?? []) {
    if (g.concept === record) for (const x of g.words) if (Number.isInteger(x) && x >= 1 && x <= n) out.add(x);
  }
  return [...out].sort((a, b) => a - b);
}

type OccurStep = Pick<CurriculumStep, "concept" | "part" | "basics" | "occurs">;

/** The words (1-based) of `ayah` a step occurs on (the rules at the head of this file). */
export function stepOccurs(step: OccurStep, ayah: Pick<CurriculumAyah, "words" | "structure">): number[] {
  if (step.basics) return [];
  const rule = step.occurs;
  if (rule) {
    if (rule.always === true) return ayah.words.map((_, i) => i + 1);
    if (rule.case !== undefined) return ayah.words.flatMap((w, i) => (w.case.state === rule.case ? [i + 1] : []));
    if (rule.qac !== undefined) return ayah.words.flatMap((w, i) => (qacTags(w).includes(rule.qac as string) ? [i + 1] : []));
    return [];
  }
  return step.concept && step.part === undefined ? recordWords(ayah, step.concept) : [];
}

/** The Konsep record ids an ayah carries: its words' tags, then the ones only a group names. */
export function taggedRecords(ayah: Pick<CurriculumAyah, "words" | "structure">): string[] {
  const out: string[] = [];
  for (const w of ayah.words) for (const c of w.concepts ?? []) if (!out.includes(c)) out.push(c);
  for (const g of ayah.structure?.groups ?? []) if (g.concept && !out.includes(g.concept)) out.push(g.concept);
  return out;
}

type CurriculumLike = Pick<CurriculumFile, "lessons" | "steps" | "lanjut">;

/** lesson id → its place in the teaching order. */
export function lessonRanks(file: Pick<CurriculumFile, "lessons">): Map<string, number> {
  return new Map(file.lessons.map((l, i) => [l.id, i]));
}

/**
 * The lines and the four lists of the lesson of one ayah, derived from the content (the twin of
 * pipeline/curriculum.py derive); null when the ayah is no lesson of the curriculum.
 */
export function deriveLesson(
  file: CurriculumLike,
  ayah: CurriculumAyah,
  concepts: readonly Pick<Concept, "id">[],
): { lines: CurriculumLine[]; map: CurriculumMap } | null {
  const rank = lessonRanks(file);
  const id = ayahLessonId(ayah.surah, ayah.ayah);
  const here = rank.get(id);
  if (here === undefined) return null;
  const at = (s: CurriculumStep) => rank.get(s.lesson) ?? Number.MAX_SAFE_INTEGER;
  const own = file.steps.filter((s) => s.lesson === id);
  const carried = new Set(taggedRecords(ayah));
  const nextLevel = new Set(file.lanjut);
  return {
    lines: own.flatMap((s) => (s.line ? [{ line: s.line, step: s.id, words: stepOccurs(s, ayah) }] : [])),
    map: {
      new: own.map((s) => s.id),
      learnt: file.steps.filter((s) => at(s) < here).map((s) => ({ id: s.id, here: stepOccurs(s, ayah).length > 0 })),
      later: file.steps.filter((s) => at(s) > here && stepOccurs(s, ayah).length > 0).map((s) => s.id),
      lanjut: concepts.filter((c) => nextLevel.has(c.id) && carried.has(c.id)).map((c) => c.id),
    },
  };
}

/** The lesson surahs with their ayat (any order: the curriculum has its own). */
export type CurriculumSurahs = readonly { ayat: readonly CurriculumAyah[] }[];

/**
 * What the built file says against the lessons and the library (empty when fine): its steps are in
 * teaching order, each in a lesson that exists, at most three per lesson; every ayah on disk is a
 * lesson with its derived lines and lists, and these equal the derivation; no other lesson has any;
 * the running counts add up; a step's line is its record's id (a whole record) or its own.
 */
export function curriculumProblems(
  file: CurriculumFile,
  surahs: CurriculumSurahs,
  concepts: readonly Pick<Concept, "id">[],
  /** Lesson zero has a page (a surah's harakat primer is played there: zero.ts hostsZero): it
   *  is then a written lesson too, with the lists an "ayah" of no word gives. */
  zero = false,
): string[] {
  const out: string[] = [];
  const where = "content/curriculum.json";
  const rank = lessonRanks(file);
  if (rank.size !== file.lessons.length) out.push(`${where}: a lesson id is listed twice`);
  const known = new Set(concepts.map((c) => c.id));
  let last = -1;
  const ids = new Set<string>();
  for (const s of file.steps) {
    const r = rank.get(s.lesson);
    if (ids.has(s.id)) out.push(`${where}: step ${s.id} is listed twice`);
    ids.add(s.id);
    if (r === undefined) out.push(`${where}: step ${s.id} is taught in ${s.lesson}, which is not a lesson`);
    else if (r < last) out.push(`${where}: step ${s.id} is not in teaching order`);
    last = Math.max(last, r ?? last);
    if (s.concept && !known.has(s.concept)) out.push(`${where}: step ${s.id} names the record ${s.concept}, which the library does not have`);
    const line = s.teach ? `concept:${s.id}` : s.concept && s.part === undefined ? `concept:${s.concept}` : null;
    if (s.line !== line) out.push(`${where}: step ${s.id}: its line is ${line}, not ${s.line}`);
  }
  for (const c of file.lanjut) if (!known.has(c)) out.push(`${where}: lanjut names ${c}, which the library does not have`);
  const ayat = new Map<string, CurriculumAyah>(surahs.flatMap((s) => s.ayat.map((a) => [ayahLessonId(a.surah, a.ayah), a] as const)));
  if (zero) ayat.set(LESSON_ZERO, { surah: 0, ayah: 0, words: [] });
  for (const id of ayat.keys()) if (!rank.has(id)) out.push(`${where}: ${id} is ${id === LESSON_ZERO ? "the lesson with no ayah, which has a page," : "an ayah with a lesson on disk"} and no lesson of the curriculum`);
  let count = 0;
  for (const l of file.lessons) {
    const own = file.steps.filter((s) => s.lesson === l.id).map((s) => s.id);
    if (JSON.stringify(l.steps) !== JSON.stringify(own)) out.push(`${where}: lesson ${l.id}: steps ${JSON.stringify(l.steps)} are not the steps taught there (${JSON.stringify(own)})`);
    if (own.length > MAX_STEPS_PER_LESSON) out.push(`${where}: lesson ${l.id} teaches ${own.length} new steps, more than ${MAX_STEPS_PER_LESSON}`);
    if (l.before !== count || l.after !== count + own.length) out.push(`${where}: lesson ${l.id}: learnt before / after is ${count} / ${count + own.length}`);
    count += own.length;
    const a = ayat.get(l.id);
    if (!a) {
      if (l.map || l.lines) out.push(`${where}: lesson ${l.id} has derived lists and no page (no ayah on disk; lesson zero: no primer played there)`);
      continue;
    }
    const want = deriveLesson(file, a, concepts);
    if (!l.map || !l.lines) out.push(`${where}: lesson ${l.id} has a page and no derived lists`);
    else if (want) {
      for (const g of ["new", "learnt", "later", "lanjut"] as const) {
        if (JSON.stringify(l.map[g]) !== JSON.stringify(want.map[g])) {
          out.push(`${where}: lesson ${l.id}: ${g} ${JSON.stringify(l.map[g])} is not what the lessons give (${JSON.stringify(want.map[g])})`);
        }
      }
      if (JSON.stringify(l.lines) !== JSON.stringify(want.lines)) out.push(`${where}: lesson ${l.id}: lines are not what the lessons give (${JSON.stringify(want.lines)})`);
    }
  }
  return out;
}

/**
 * One thing an ayah's lesson teaches as a "Konsep baru": a whole Konsep record, or a step's own
 * text. What `conceptsIntroducedIn` returned Concept records for until 2026-10-13.
 */
export type Taught = {
  /** The narration line "concept:${id}", the autoplay step "concept:${id}": a record's id (a
   *  whole record) or a step's (its own text). */
  id: string;
  /** The curriculum step. */
  step: string;
  /** Plain prose (the engine's own caption; the narration's line is built from the same text). */
  title: string;
  summary: string;
  /** The Konsep record it is (`whole`) or is a part of — the page to link — or null: no record. */
  concept: string | null;
  /** true: the record's own title and summary; false: the step's own text. */
  whole: boolean;
  /** The marked twin of a step's own text (terms by id), and its sources. */
  marked: { title: string; summary: string } | null;
  sources: readonly CurriculumSource[];
  /** The words (1-based) of this ayah the step occurs on: what its line lights. */
  words: number[];
  /** Its examples, the one in THIS ayah first (examples.ts takes the first as the example beat):
   *  a record's own examples, its example in this ayah moved to the front; for a step with its
   *  own text, or a record with no example here, the words it occurs on in this ayah. In lesson
   *  zero, a step that lists its examples (`CurriculumStep.examples`) has exactly those, each with
   *  the narrator's line about it (`say`; the line "concept:${id}:ex:${k}"). */
  examples: { loc: string; note: string; say?: string }[];
  /** Lesson zero: the slide said before its line ("concept:${id}:lead"), or null. */
  lead: CurriculumLead | null;
};

type TaughtConcept = Pick<Concept, "id" | "title" | "summary" | "examples">;

/** The "Konsep baru" items of the lesson of `ayah`, in the order their lines are said (at most
 *  three; none for an ayah that is no lesson, or whose lesson teaches nothing with a text). */
export function taughtIn(file: Pick<CurriculumFile, "lessons" | "steps">, concepts: readonly TaughtConcept[], ayah: CurriculumAyah): Taught[] {
  const id = ayahLessonId(ayah.surah, ayah.ayah);
  const lesson = file.lessons.find((l) => l.id === id);
  const out: Taught[] = [];
  for (const line of lesson?.lines ?? []) {
    const step = file.steps.find((s) => s.id === line.step);
    if (!step) continue;
    const record = step.concept ? concepts.find((c) => c.id === step.concept) : undefined;
    const loc = (w: number) => `${id}:${w}`;
    // A word the step occurs on, as an example: for an i'rab state the example is about the
    // word's ending, which its sign names ("kasrah"), so the stage can name the mark beside it.
    const own = line.words.map((w) => ({ loc: loc(w), note: step.occurs?.case ? (ayah.words[w - 1]?.case.sign ?? "") : "" }));
    if (step.teach) {
      out.push({
        id: line.line.slice("concept:".length),
        step: step.id,
        title: step.teach.title,
        summary: step.teach.summary,
        concept: step.concept ?? null,
        whole: false,
        marked: step.teach.marked,
        sources: step.teach.sources,
        words: line.words,
        examples: own,
        lead: null,
      });
    } else if (record) {
      const here = record.examples.filter((e) => e.loc.startsWith(`${id}:`));
      const rest = record.examples.filter((e) => !e.loc.startsWith(`${id}:`));
      out.push({
        id: line.line.slice("concept:".length),
        step: step.id,
        title: record.title,
        summary: record.summary,
        concept: record.id,
        whole: true,
        marked: null,
        sources: [],
        words: line.words,
        // Lesson zero's own list (each with the narrator's line), else the record's order.
        examples: step.examples?.length
          ? step.examples.map((e) => ({ loc: e.loc, note: record.examples.find((x) => x.loc === e.loc)?.note ?? e.about, say: e.say }))
          : [...(here.length ? here : own), ...rest].map((e) => ({ loc: e.loc, note: e.note })),
        lead: step.lead ?? null,
      });
    }
  }
  return out;
}

/**
 * The step that TAUGHT what a Konsep tag on a word shows, when an EARLIER lesson did: the whole
 * record's step, or — for a record that arrives in parts (i'rab) — the part this word shows (its
 * i'rab state). An ayah (`surah`, `ayah`), or `zero`: lesson zero, the lesson with no ayah (the
 * three kinds of word; only while it is written, i.e. the built file carries its lists). null:
 * taught in this lesson or later, a next-level record, or a lesson with no page. For the word
 * card's "sudah dipelajari di ayat N" / "… di Pengantar" under a concept chip.
 */
export type TaughtEarlier = { step: string; surah: number; ayah: number; zero?: undefined } | { step: string; zero: true };
export function taughtEarlier(
  file: Pick<CurriculumFile, "lessons" | "steps">,
  ayah: Pick<CurriculumAyah, "surah" | "ayah">,
  word: Pick<CurriculumWord, "case">,
  record: string,
): TaughtEarlier | null {
  const rank = lessonRanks(file);
  const here = rank.get(ayahLessonId(ayah.surah, ayah.ayah));
  if (here === undefined) return null;
  const steps = file.steps.filter((s) => s.concept === record);
  const step = steps.find((s) => s.part === undefined) ?? steps.find((s) => s.occurs?.case !== undefined && s.occurs.case === word.case.state);
  if (!step || (rank.get(step.lesson) ?? here) >= here) return null;
  if (step.lesson === LESSON_ZERO) return file.lessons.find((l) => l.id === LESSON_ZERO)?.map ? { step: step.id, zero: true } : null;
  const at = lessonAyah(step.lesson);
  return at ? { step: step.id, ...at } : null;
}
