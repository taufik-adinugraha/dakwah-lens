/**
 * The autoplay sequence of one ayah, derived from the content (never
 * written per ayah), in the order a learner meets it:
 *
 *   intro → recite_ayah (imam, whole ayah; mushaf words follow the imam)
 *   → primer (the harakat primer, when content/compose opens this ayah with
 *     it: each mark on a dotted circle, its sound, an example from the ayah)
 *   → for every word: recite_word (imam, that word) + explain (w${n}: the
 *     gloss and the word's why — or, when the word has a composition, the
 *     gloss and the composition's lead) + compose (w${n}:compose, only for a
 *     word with a composition: one line per sentence of its frames, the
 *     animation in the word card's slot, then the imam recites the word
 *     again; operator 2026-10-10, narration rule 14)
 *   → concept (each concept FIRST introduced in this ayah) → structure
 *     (the lesson page's order, and the narration's: the structure line
 *     uses the terms the concept lines introduce)
 *   → exercises the page renders, in page order (each WAITS for the learner)
 *   → recap (imam again) → next (to ayah + 1) | done (end of the surah)
 *
 * Every step carries its narration line ids (contract in types.ts), the
 * captions to show, what the mushaf line highlights and the word card shows,
 * and the spotlight. Narration audio (with its word timings, for the karaoke
 * caption) is attached from the manifests when present; without it the
 * sequence is caption-only and the machine paces it by reading time. Pure
 * and deterministic.
 */
import type { Ayah, Concept } from "@/content/schema";

import type { ComposeInput } from "../composition";
import { latinSentences, splitCaption, stripArabic } from "../lessonSteps";
import { canonicalExercises, exerciseProgressId } from "./exercises";
import { lineId, manifestParts, parseLineId, promptLineId, sharedLineId, type LinePart } from "./ids";
import { lineDisplay, lineMarks, lineSegments, lineText, wordRefs } from "./narration";
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
  /** This ayah's word compositions and harakat primer (content/compose/,
   *  without their Arabic: lines and frames only), when it has any. */
  compose?: ComposeInput | null;
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
  const every = ayah.words.map((_, i) => i + 1);
  const placeOf = new Map(ayah.words.map((w, i) => [w.loc, i + 1]));
  /** The word a "w${n}" (or "w${n}:compose:${k}") line explains, else null. */
  const explained = (part: string): number | null => {
    const m = /^w([1-9][0-9]*)(?::compose:[1-9][0-9]*)?$/.exec(part);
    return m && Number(m[1]) <= words ? Number(m[1]) : null;
  };
  const composition = (wn: number) => input.compose?.words[ayah.words[wn - 1]?.loc ?? ""] ?? null;
  /** The animation frame a primer / compose line plays over (the content's
   *  own line plan; the manifest's `frame` says the same, validated). */
  const frameOf = (part: string): number | null => {
    const c = /^w([1-9][0-9]*):compose:([1-9][0-9]*)$/.exec(part);
    if (c) return composition(Number(c[1]))?.lines[Number(c[2]) - 1]?.frame ?? null;
    const p = /^primer:([1-9][0-9]*)$/.exec(part);
    return p ? (input.compose?.primer?.lines[Number(p[1]) - 1]?.frame ?? null) : null;
  };
  /** What a line highlights when its manifest does not say (operator,
   *  2026-10-10): the whole ayah for the intro, the recitation, the
   *  structure and the recap; the word a w${n} line explains; for a concept,
   *  the words tagged with it (Word.concepts) and the words of the ayah's
   *  structure groups of that concept (the idhafah of bismi + Allāhi is
   *  [1, 2] although only Allāhi is tagged; validate_narration.concept_words);
   *  else the places the line names. */
  const kindHighlight = (part: string, refs: number[]): number[] => {
    if (part === "intro" || part === "recite" || part === "structure" || part === "recap") return every;
    const w = explained(part);
    if (w !== null) return [w];
    if (part.startsWith("concept:")) {
      const id = part.slice("concept:".length);
      const tagged = new Set(ayah.words.flatMap((x, i) => ((x.concepts ?? []).includes(id) ? [i + 1] : [])));
      for (const g of ayah.structure?.groups ?? []) {
        if (g.concept === id) for (const x of g.words) if (Number.isInteger(x) && x >= 1 && x <= words) tagged.add(x);
      }
      if (tagged.size) return [...tagged].sort((a, b) => a - b);
    }
    return refs;
  };
  const cue = (line: string, caption: string, guides: Guide[] = []): Cue => {
    const m = manifestOf(line);
    // The manifest's display (what is spoken, dictionary terms as "na’t
    // (نَعْت)") is the caption; without one, the engine's own (no Arabic).
    const display = lineDisplay(m, line);
    const text = display !== null ? clean(display) : clean(stripArabic(caption));
    const spoken = lineText(m, line);
    const id = parseLineId(line);
    // Only this ayah's own lines name its word places, highlight its words
    // or show a word card; shared lines never do.
    const part = id?.kind === "ayah" ? id.part : null;
    const refs = spoken && part !== null ? wordRefs(spoken).filter((w) => w <= words) : [];
    const marks = lineMarks(m, line);
    let highlight: number[] = [];
    let focus: number | null = null;
    if (part !== null) {
      const h = marks.highlight;
      highlight =
        h === undefined
          ? kindHighlight(part, refs)
          : h.includes(0)
            ? every
            : [...new Set(h)].filter((w) => w >= 1 && w <= words).sort((a, b) => a - b);
      focus = marks.focus === undefined ? explained(part) : marks.focus === null ? null : (placeOf.get(marks.focus) ?? null);
    }
    const frame = part === null ? null : (marks.frame ?? frameOf(part));
    return {
      line,
      caption: text,
      display: display !== null ? text : null,
      highlight,
      focus,
      frame,
      parts: splitCaption(text),
      guides,
      audio: lineSegments(m, line),
      spoken,
      refs,
    };
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

  const primer = input.compose?.primer;
  if (primer && primer.lines.length) {
    steps.push(
      step({
        id: "primer",
        kind: "primer",
        cues: primer.lines.map((l, k) => cue(p(`primer:${k + 1}`), l.say)),
        guides: [],
        frames: primer.frames,
      }),
    );
  }

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
    const comp = composition(wn);
    // A word with a composition: its line is the gloss and the lead; the
    // frames say the why part by part.
    const why = comp ? (comp.lead ?? "") : latinSentences(w.why);
    const card: Guide = { target: "word-card", label: texts.guide.wordCard };
    steps.push(
      step({
        id: `w${wn}`,
        kind: "explain",
        cues: [cue(p(`w${wn}`), `${texts.meaning(a)} ${why}`.trim(), [card])],
        guides: [card, wordGuide],
        word: wn,
        loc: w.loc,
      }),
    );
    if (comp && comp.lines.length) {
      steps.push(
        step({
          id: `w${wn}:compose`,
          kind: "compose",
          cues: comp.lines.map((l, k) => cue(p(`w${wn}:compose:${k + 1}`), l.say, [card])),
          // While the imam recites the joined word (after the frames).
          caption: clean(stripArabic(texts.wordIntro(a))),
          guides: [card, wordGuide],
          word: wn,
          loc: w.loc,
          recite: { target: "word", word: wn },
          frames: comp.frames,
        }),
      );
    }
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
