/**
 * The autoplay sequence of one ayah, derived from the content (never
 * written per ayah), in the order a learner meets it:
 *
 *   intro → recite_ayah (imam, whole ayah; mushaf words follow the imam)
 *   → for every word: recite_word (imam, that word) + explain (w${n})
 *   → concept (each concept FIRST introduced in this ayah) → structure
 *     (the lesson page's order, and the narration's: the structure line
 *     uses the terms the concept lines introduce)
 *   → exercises the page renders, in page order (each WAITS for the learner)
 *   → recap (imam again) → next (to ayah + 1) | done (end of the surah)
 *
 * Every step carries its narration line ids (contract in types.ts), the
 * captions to show and the spotlight. Narration audio is attached from the
 * manifests when present; without it the sequence is caption-only and the
 * machine paces it by reading time. Pure and deterministic.
 */
import type { Ayah, Concept } from "@/content/schema";

import { latinSentences, splitCaption, stripArabic } from "../lessonSteps";
import { canonicalExercises, exerciseProgressId } from "./exercises";
import { lineId, manifestParts, parseLineId, promptLineId, sharedLineId, type LinePart } from "./ids";
import { lineSegments, lineText, wordRefs } from "./narration";
import {
  PARTS_OF,
  SHARED_KEYS,
  type AutoplaySequence,
  type AutoplayStep,
  type AutoplayTexts,
  type Cue,
  type ExerciseKey,
  type Guide,
  type GuidePart,
  type NarrationManifest,
  type SharedKey,
} from "./types";

export type SequenceInput = {
  slug: string;
  /** Display name of the surah, e.g. "Al-Fatihah". */
  surahName: string;
  /** Number of ayat in the surah (the last one ends with "done"). */
  ayahCount: number;
  ayah: Ayah;
  /** Concepts FIRST introduced in this ayah (library.conceptsIntroducedIn). */
  introduced: readonly Concept[];
  /** Exercises the page renders for this ayah (availableExercises). */
  exercises: readonly ExerciseKey[];
  texts: AutoplayTexts;
  /** content/narration/${slug}.json, when it exists. */
  narration?: NarrationManifest | null;
  /** content/narration/shared.json, when it exists. */
  shared?: NarrationManifest | null;
};

/** Concepts whose FIRST example lies in `ayahLoc` ("1:2"). Same rule as
 *  library.conceptsIntroducedIn (parity-tested), without its zod import. */
export function introducedConcepts<C extends Pick<Concept, "examples">>(concepts: readonly C[], ayahLoc: string): C[] {
  return concepts.filter((c) => {
    const first = c.examples[0]?.loc;
    return first ? first.split(":").slice(0, 2).join(":") === ayahLoc : false;
  });
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildAutoplaySequence(input: SequenceInput): AutoplaySequence {
  const { slug, ayah, texts } = input;
  const n = ayah.ayah;
  const lessonKey = `${slug}/${n}`;
  const p = (part: LinePart) => lineId(slug, n, part);

  const manifestOf = (line: string) => (line.startsWith("shared:") ? input.shared : input.narration);
  const words = ayah.words.length;
  const cue = (line: string, caption: string, guides: Guide[] = []): Cue => {
    const text = clean(stripArabic(caption));
    const m = manifestOf(line);
    const spoken = lineText(m, line);
    // Only this ayah's own lines name its word places.
    const refs = spoken && !line.startsWith("shared:") ? wordRefs(spoken).filter((w) => w <= words) : [];
    return { line, caption: text, parts: splitCaption(text), guides, audio: lineSegments(m, line), spoken, refs };
  };
  const line: Guide = { target: "mushaf-line", label: texts.guide.mushafLine };
  const partGuide = (key: ExerciseKey, part: GuidePart): Guide => ({
    target: `exercise:${key}:${part}`,
    label: texts.guide.part[part],
  });
  const step = (s: Omit<AutoplayStep, "lines" | "caption"> & { caption?: string }): AutoplayStep => ({
    ...s,
    lines: s.cues.map((c) => c.line),
    caption: s.caption ?? s.cues[0]?.caption ?? "",
  });

  const steps: AutoplayStep[] = [];
  steps.push(
    step({
      id: "intro",
      kind: "intro",
      cues: [cue(p("intro"), texts.intro({ surah: input.surahName, ayah: n, total: input.ayahCount }), [line])],
      guides: [line],
    }),
  );
  steps.push(
    step({
      id: "recite",
      kind: "recite_ayah",
      cues: [cue(p("recite"), texts.recite, [line])],
      guides: [line],
      recite: { target: "ayah" },
    }),
  );

  ayah.words.forEach((w, i) => {
    const wn = i + 1;
    const wordGuide: Guide = { target: `mushaf-word:${wn}`, label: texts.guide.mushafWord(wn) };
    const a = { n: wn, translit: w.translit, gloss: stripArabic(w.gloss) };
    steps.push(
      step({
        id: `w${wn}:recite`,
        kind: "recite_word",
        cues: [],
        caption: clean(stripArabic(texts.wordIntro(a))),
        guides: [wordGuide],
        word: wn,
        loc: w.loc,
        recite: { target: "word", word: wn },
      }),
    );
    const why = latinSentences(w.why);
    steps.push(
      step({
        id: `w${wn}`,
        kind: "explain",
        cues: [cue(p(`w${wn}`), `${texts.meaning(a)} ${why}`, [{ target: "word-card", label: texts.guide.wordCard }])],
        guides: [{ target: "word-card", label: texts.guide.wordCard }, wordGuide],
        word: wn,
        loc: w.loc,
      }),
    );
  });

  for (const c of input.introduced) {
    const summary = latinSentences(c.summary);
    const title = stripArabic(c.title);
    steps.push(
      step({
        id: `concept:${c.id}`,
        kind: "concept",
        cues: [cue(p(`concept:${c.id}`), summary ? texts.concept(title, summary) : texts.conceptBrief(title))],
        guides: [],
      }),
    );
  }

  if (ayah.structure) {
    const summary = latinSentences(ayah.structure.summary);
    const caption = summary ? texts.structure(summary) : texts.structureBrief;
    steps.push(step({ id: "structure", kind: "structure", cues: [cue(p("structure"), caption, [line])], guides: [line] }));
  }

  for (const key of canonicalExercises(input.exercises)) {
    const t = texts.exercise[key];
    const parts = PARTS_OF[key];
    const cues: Cue[] = [cue(p(`ex:${key}:intro`), t.intro)];
    const lead = [0];
    const promptCue: Partial<Record<GuidePart, number>> = {};
    const guides: Partial<Record<GuidePart, Guide>> = {};
    for (const part of parts) {
      guides[part] = partGuide(key, part);
      const text = t[part];
      if (!text) continue;
      promptCue[part] = cues.length;
      // The ayah's own prompt when its manifest has one, else the shared one.
      const own = p(`ex:${key}:${part}`);
      const id = input.narration && manifestParts(input.narration, own) ? own : promptLineId(key, part);
      cues.push(cue(id, text, [partGuide(key, part)]));
    }
    steps.push(
      step({
        id: `ex:${key}`,
        kind: "exercise",
        cues,
        guides: [partGuide(key, parts[0])],
        exercise: { key, progressId: exerciseProgressId(lessonKey, key), parts, lead, promptCue, guides },
      }),
    );
  }

  steps.push(
    step({ id: "recap", kind: "recap", cues: [cue(p("recap"), texts.recap, [line])], guides: [line], recite: { target: "ayah" } }),
  );

  const last = n >= input.ayahCount;
  if (last) {
    steps.push(
      step({
        id: "done",
        kind: "done",
        cues: [cue(p("done"), texts.done({ surah: input.surahName })), cue(sharedLineId("surah_done"), texts.shared.surah_done)],
        guides: [],
      }),
    );
  } else {
    steps.push(step({ id: "next", kind: "next", cues: [cue(p("next"), texts.next({ ayah: n + 1 }))], guides: [] }));
  }

  const skipGuide: Guide = { target: "skip", label: texts.guide.skip };
  const shared = Object.fromEntries(
    SHARED_KEYS.map((k) => [k, cue(sharedLineId(k), texts.shared[k], k === "skip_offer" ? [skipGuide] : [])]),
  ) as Record<SharedKey, Cue>;

  const hasAudio = steps.some((s) => s.cues.some((c) => c.audio.length > 0)) || SHARED_KEYS.some((k) => shared[k].audio.length > 0);
  return {
    v: 1,
    slug,
    ayah: n,
    lessonKey,
    steps,
    shared,
    skipGuide,
    lanjutGuide: { target: "lanjut", label: texts.guide.lanjut },
    nav: last ? { kind: "surah_end", slug } : { kind: "ayah", slug, ayah: n + 1 },
    hasAudio,
  };
}

/** Every narration line id a sequence can play (steps + shared lines it
 *  may speak), sorted; contract ids, never split parts. */
export function sequenceLineIds(seq: AutoplaySequence): string[] {
  const ids = new Set<string>();
  for (const s of seq.steps) for (const l of s.lines) ids.add(l);
  for (const k of SHARED_KEYS) ids.add(seq.shared[k].line);
  return [...ids].filter((id) => parseLineId(id) !== null).sort();
}
