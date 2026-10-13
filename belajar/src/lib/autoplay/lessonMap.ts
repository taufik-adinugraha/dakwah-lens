/**
 * The LESSON MAP of an ayah (operator 2026-10-13, plan L23: "at the beginning of the ayat, better
 * to inform what concept we will learn in this ayat, also explain maybe we skip some concept and
 * will visit later in next ayat instead of explaining all concepts in 1 ayat … so at the beginning
 * we inform what will be learnt, in the end recap what we've learnt"; "if some concept already done
 * in previous ayat, we say we repeat what we've learnt before").
 *
 * Which Konsep are NEW in an ayah, which are REPEATED from an earlier one and which are present
 * but taught LATER is derived, never written per ayah (pipeline/lessonmap.py has the rules):
 *   present(ayah)  the concept ids its words are tagged with, and those its structure groups name;
 *   taught(id)     the ayah of the concept's FIRST example (library.conceptsIntroducedIn);
 *   new            the concepts taught in this ayah, in the library's order (its "Konsep baru" lines);
 *   review         present here, taught in an EARLIER ayah of the lessons;
 *   later          present here, taught in a LATER ayah (the lessons postpone these).
 * review and later are in the order they are taught, then the library's.
 *
 * The pipeline writes the result to content/map/${slug}.json (build_map.py) with each concept's
 * NAME — the name its "Konsep baru: …" caption opens with (src/lib/emphasis.ts conceptName) — for
 * every surah that is switched on (pipeline/authored/${slug}.map.json; Al-Fatihah only today).
 * This module derives the same lists from the content (deriveLessonMap), so the file is held to
 * the lessons at build time (lessonMapProblems; src/lib/map-content.ts) and in the tests, and
 * turns one ayah's entry into what the lesson needs (lessonMapInputOf): two steps of the autoplay
 * sequence — "map" right after the imam's recitation, "learned" right before the recap — and the
 * card the stage shows with them (src/components/lesson/LessonMapCard.tsx).
 *
 * Besides the derived lists an ayah's `later` may hold a TOPIC, an authored item that is no Konsep
 * (operator 2026-10-13: "in ayat-1, it mentions 'bentuk tertentu' but no explanation about marfu'
 * itself, better to inform it will be learnt later"): ayah 1 shows that a base form ends in
 * dhammah, and the state is named marfu' only by a word's line of ayah 2. The pipeline holds it to
 * that line (it exists, lies in a later ayah, names the thing); here it is a record with
 * `from: "topic"`, a `note` (what the learner is left wondering) and its `line`.
 *
 * The file is data to reuse: a surah's end review is the union of its ayat's `new`.
 *
 * Pure (type imports only): scripts/autoplay-check.ts runs it under tsx without node_modules.
 */
import type { Ayah, Concept } from "@/content/schema";

/** A concept of content/map/${slug}.json: `name` its caption form (dictionary terms as "na’t
 *  (نَعْت)"), `latin` the same name as prose, `from` where the name comes from (the caption's
 *  title, or an explicit name in the authored file), `surah` / `ayah` where it is taught. */
export type LessonMapConcept = {
  name: string;
  latin: string;
  from: "title" | "authored" | "topic";
  surah: number;
  ayah: number;
  /** A topic only: what is left unexplained, in caption form, and the narration line that teaches it. */
  note?: string;
  line?: string;
};

/** One ayah of the file: concept ids. */
export type LessonMapAyah = { ayah: number; new: string[]; review: string[]; later: string[] };

/** content/map/${slug}.json (zod: src/content/map-schema.ts). */
export type LessonMapFile = {
  version: number;
  slug: string;
  surah: number;
  concepts: Record<string, LessonMapConcept>;
  ayat: LessonMapAyah[];
};

/** A concept as the card lists it: its name as the caption shows it, and where it is taught. */
export type LessonMapItem = { id: string; name: string; surah: number; ayah: number; /** A topic's note. */ note?: string };

/** One ayah's lesson map as the lesson takes it. `surah`: this ayah's surah number (an item
 *  taught in another surah is shown with that surah). */
export type LessonMapInput = {
  surah: number;
  new: LessonMapItem[];
  review: LessonMapItem[];
  later: LessonMapItem[];
};

export const LESSON_MAP_GROUPS = ["new", "review", "later"] as const;
export type LessonMapGroup = (typeof LESSON_MAP_GROUPS)[number];

/** The ayah's entry of a map file with its concepts' names, or null: no map for the surah (it is
 *  not switched on) or for that ayah. */
export function lessonMapInputOf(file: LessonMapFile | null | undefined, ayah: number): LessonMapInput | null {
  const entry = file?.ayat.find((a) => a.ayah === ayah);
  if (!file || !entry) return null;
  const item = (id: string): LessonMapItem[] => {
    const c = file.concepts[id];
    return c ? [{ id, name: c.name, surah: c.surah, ayah: c.ayah, ...(c.note ? { note: c.note } : {}) }] : [];
  };
  return { surah: file.surah, new: entry.new.flatMap(item), review: entry.review.flatMap(item), later: entry.later.flatMap(item) };
}

type MapAyah = Pick<Ayah, "surah" | "ayah" | "words" | "structure">;
/** The lesson surahs in the lessons' order (mushaf order), each with its ayat. */
export type MapSurahs = readonly { ayat: readonly MapAyah[] }[];
type MapConcept = Pick<Concept, "id" | "examples">;

const placeKey = (surah: number, ayah: number) => `${surah}:${ayah}`;

/** "1:2" of a concept's first example: where it is taught; null without one. */
const taughtAt = (c: MapConcept): string | null => c.examples[0]?.loc.split(":").slice(0, 2).join(":") ?? null;

/** The concept ids an ayah carries, in the order it meets them: its words' tags, then the ones
 *  only a structure group names (today every group's concept is tagged on a word as well). */
export function presentConcepts(a: Pick<Ayah, "words" | "structure">): string[] {
  const out: string[] = [];
  for (const w of a.words) for (const c of w.concepts ?? []) if (!out.includes(c)) out.push(c);
  for (const g of a.structure?.groups ?? []) if (g.concept && !out.includes(g.concept)) out.push(g.concept);
  return out;
}

/**
 * The new / review / later lists of every ayah of surah number `surah`, derived from the content
 * (the rules at the head of this file; the twin of pipeline/lessonmap.py derive). A concept an
 * ayah carries that no lesson introduces is left out of all three: lessonMapProblems reports it.
 */
export function deriveLessonMap(surahs: MapSurahs, concepts: readonly MapConcept[], surah: number): LessonMapAyah[] {
  const rank = new Map<string, number>();
  for (const s of surahs) for (const a of s.ayat) rank.set(placeKey(a.surah, a.ayah), rank.size);
  const index = new Map(concepts.map((c, i) => [c.id, i]));
  const taught = new Map(concepts.map((c) => [c.id, taughtAt(c)]));
  const rankOf = (id: string) => rank.get(taught.get(id) ?? "") ?? null;
  const byTaught = (a: string, b: string) => (rankOf(a) ?? 0) - (rankOf(b) ?? 0) || (index.get(a) ?? 0) - (index.get(b) ?? 0);
  const out: LessonMapAyah[] = [];
  for (const s of surahs) {
    for (const a of s.ayat) {
      if (a.surah !== surah) continue;
      const here = rank.get(placeKey(a.surah, a.ayah)) ?? 0;
      const present = presentConcepts(a).filter((id) => rankOf(id) !== null);
      out.push({
        ayah: a.ayah,
        new: concepts.filter((c) => taughtAt(c) === placeKey(a.surah, a.ayah)).map((c) => c.id),
        review: present.filter((id) => (rankOf(id) ?? 0) < here).sort(byTaught),
        later: present.filter((id) => (rankOf(id) ?? 0) > here).sort(byTaught),
      });
    }
  }
  return out;
}

/**
 * What a map file says against the lessons and the library (empty when fine): its ayat are the
 * surah's, each list equals the derivation (so NEW is the ayah's concept lines, REVIEW is taught
 * earlier and LATER later, and every concept of the ayah is in exactly one of them), and every
 * listed concept has its record with the ayah that teaches it. A topic is set aside from the
 * derivation: it is no Konsep, is only ever under `later`, and its teaching line is a line of a
 * later ayah of this surah (that the line exists and names it is the pipeline's check).
 */
export function lessonMapProblems(file: LessonMapFile, surahs: MapSurahs, concepts: readonly MapConcept[]): string[] {
  const out: string[] = [];
  const where = `content/map/${file.slug}.json`;
  const want = deriveLessonMap(surahs, concepts, file.surah);
  if (!want.length) return [`${where}: no lesson has surah ${file.surah}`];
  if (JSON.stringify(file.ayat.map((a) => a.ayah)) !== JSON.stringify(want.map((a) => a.ayah))) {
    return [`${where}: its ayat are not the lesson's ayat, each once, in order`];
  }
  const known = new Set(concepts.map((c) => c.id));
  for (const s of surahs) {
    for (const a of s.ayat) {
      if (a.surah !== file.surah) continue;
      const lost = presentConcepts(a).filter((id) => !known.has(id) || !concepts.some((c) => c.id === id && c.examples.length));
      if (lost.length) out.push(`${where} ayah ${a.ayah}: ${lost.join(", ")} tagged on a word and never introduced`);
    }
  }
  const taught = new Map(concepts.map((c) => [c.id, taughtAt(c)]));
  const isTopic = (id: string) => file.concepts[id]?.from === "topic";
  const listed = new Set<string>();
  file.ayat.forEach((entry, i) => {
    for (const g of LESSON_MAP_GROUPS) {
      for (const id of entry[g]) listed.add(id);
      const derived = entry[g].filter((id) => !isTopic(id));
      if (JSON.stringify(derived) !== JSON.stringify(want[i][g])) {
        out.push(`${where} ayah ${entry.ayah}: ${g} ${JSON.stringify(derived)} is not what the lessons give (${JSON.stringify(want[i][g])})`);
      }
      for (const id of entry[g].filter(isTopic)) {
        const c = file.concepts[id];
        if (g !== "later") out.push(`${where} ayah ${entry.ayah}: topic ${id} is listed as ${g} (a topic is only ever taught later)`);
        else if (c.surah !== file.surah || c.ayah <= entry.ayah) out.push(`${where} ayah ${entry.ayah}: topic ${id} is taught in ${c.surah}:${c.ayah}, which is not a later ayah`);
      }
    }
  });
  for (const id of listed) {
    const c = file.concepts[id];
    if (!c) out.push(`${where}: ${id} is listed and has no record in concepts`);
    else if (c.from === "topic") {
      if (known.has(id)) out.push(`${where}: topic ${id} has the id of a Konsep`);
      if (!c.note || !c.line?.startsWith(`${file.slug}:${c.ayah}:`)) out.push(`${where}: topic ${id} needs its note and a teaching line of ayah ${c.ayah}`);
    } else if (placeKey(c.surah, c.ayah) !== taught.get(id)) out.push(`${where}: ${id} is taught in ${taught.get(id)}, not ${c.surah}:${c.ayah}`);
  }
  for (const id of Object.keys(file.concepts)) if (!listed.has(id)) out.push(`${where}: ${id} has a record and no ayah lists it`);
  return out;
}
