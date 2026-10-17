/**
 * The autoplay sequence of one ayah, derived from the content (never
 * written per ayah), in the order a learner meets it:
 *
 *   intro → recite_ayah (imam, whole ayah; mushaf words follow the imam)
 *   → map:new → map:learnt → map:later (only in a surah with a lesson map,
 *     content/map/${slug}.json: what this ayah brings, ONE step per group of
 *     its card, each with its lines (lessonMap.ts MAP_LINES, one sentence per
 *     line) — what is new; everything learnt so far, then what of it comes up
 *     again here (once something was learnt); what is here and taught later,
 *     and how many next-level topics, then the reassurance that none of it
 *     needs learning now (when there is any) — every counted step named
 *     (operator 2026-10-15); operator 2026-10-13, plan L23 and L26)
 *   → primer (the harakat primer, when content/compose opens this ayah with
 *     it: each mark on a dotted circle, its sound, an example from the ayah)
 *   → the warm-up (ex:word-kind, when the ayah's quiz has it — every ayah of
 *     a surah with a lesson map: "isim, fi'il, atau huruf?" for each part of
 *     each word; operator 2026-10-13, types.ts OPENING_EXERCISES). It WAITS
 *     for the learner like every exercise
 *   → for every word: recite_word (that word, the narrator's recording of it
 *     — wordVoices, operator 2026-10-14; the one time it is heard, but for
 *     the ayah's last word: operator 2026-10-13, plan L24) +
 *     explain (w${n}: the gloss and the word's why — or, when the word has a
 *     composition, the gloss and its lead) + compose (w${n}:compose, only for a
 *     word with a composition: one line per sentence of its frames, the
 *     animation in the word card's slot, the last line over the joined word;
 *     operator 2026-10-10, narration rule 14) — then straight to the next
 *     word. The ayah's LAST word alone is heard once more, at the end of its
 *     composition: its last line says the recitation stops on it and what is
 *     not heard there (composition.ts STOP_NOTE), and no next word follows
 *   → concept (each step the CURRICULUM teaches in this ayah's lesson that
 *     has a text — a whole Konsep record or a step's own — at most three;
 *     operator-approved 2026-10-13, plan L26, curriculum.ts), each followed by
 *     its example step (its example in this ayah, heard as the narrator's
 *     recording of it; operator 2026-10-12, plan L20, examples.ts) → structure
 *     (the lesson page's order, and the narration's: the structure line
 *     uses the terms the concept lines introduce)
 *   → the other exercises the page renders, in page order (each WAITS for the learner;
 *     content/quiz/<slug>.json decides them, and each question's correct
 *     answer has its explanation line, said after "Benar." or "Ini
 *     jawabannya.": operator 2026-10-10)
 *   → learned (with a lesson map: what this ayah taught, then the running
 *     total with every step named — two lines, one card)
 *   → recap (imam again) → next (to ayah + 1) | done (end of the surah)
 *
 * Every step carries its narration line ids (contract in types.ts), the
 * captions to show, what the mushaf line highlights and the word card shows,
 * and the spotlight. Narration audio (with its word timings, for the karaoke
 * caption) is attached from the manifests when present; without it the
 * sequence is caption-only and the machine paces it by reading time. Pure
 * and deterministic.
 *
 * EXAMPLE BEATS (operator 2026-10-12: "each explanation should be followed by
 * examples (visual + voice)"; which ones: examples.ts lessonExamples) ride on
 * the steps: a compose step's bentuk dasar after the last line of its `base`
 * frame, and a concept's example(s) as an "example" step right after the concept
 * step. A beat has a caption (AutoplayTexts.example) and what is heard (a
 * word's recording); no narration line, so no manifest and no render knows of it.
 */
import type { Ayah } from "@/content/schema";

import type { ComposeInput } from "../composition";
import { latinSentences, splitCaption, stripArabic } from "../lessonSteps";
import type { ExampleInput } from "./examples";
import { canonicalExercises, exerciseProgressId } from "./exercises";
import { MAP_LINES, mapHere, mapLaterNames, mapOpening, mapSaidName, type LessonMapInput, type MapGroup } from "./lessonMap";
import { explainLineId, lineId, manifestParts, parseLineId, promptLineId, sharedLineId, type LinePart } from "./ids";
import { lineDisplay, lineMarks, lineSegments, lineText, unmarkNamed, wordRefs } from "./narration";
import {
  OPENING_EXERCISES,
  PARTS_OF,
  SHARED_KEYS,
  type AutoplaySequence,
  type AutoplayStep,
  type AutoplayTexts,
  type Cue,
  type ExampleBeat,
  type ExampleClip,
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
  ayah: Pick<Ayah, "ayah" | "words" | "structure">;
  /** LESSON ZERO (the basic curriculum's lesson with no ayah, decision 1: "A 'lesson zero' with
   *  no ayah opens the course. It teaches harakat and the three kinds of word"): `ayah` is then
   *  its place in the manifest — number 0, no word — and the sequence has no recitation of an
   *  ayah and no recap: its opening line, the harakat primer, the "Konsep baru" line of each
   *  step it teaches with the examples the imam recites, and the hand-over to ayah 1. */
  zero?: boolean;
  /** A named word's transliteration by its markup's reference ("1:1:1/bi", "1:6:2"; the authored
   *  `say` names words as {{…}}: pipeline/validate_narration.py "named words"), for the caption a
   *  line without a narration display shows — that caption has no Arabic, so the word is its
   *  transliteration. Without it, a marked word shows as its reference. */
  named?: (ref: string) => string | undefined;
  /** What this ayah's lesson teaches as "Konsep baru", in the order said (curriculum.ts taughtIn):
   *  a whole Konsep record (`id` its id) or a step's own text (`id` the step's); `words`: the
   *  words of the ayah its line lights (else: the words tagged with a record of that id). */
  introduced: readonly TaughtInput[];
  /** Exercises the page renders for this ayah (availableExercises). */
  exercises: readonly ExerciseKey[];
  /** Each exercise's question numbers (questionNumbers, content/quiz): the
   *  explanation line of question n is "${slug}:${ayah}:ex:${key}:${n}:why". */
  questions?: Partial<Record<ExerciseKey, readonly number[]>>;
  texts: AutoplayTexts;
  /** content/narration/${slug}.json, when it exists. */
  narration?: NarrationManifest | null;
  /** content/narration/shared.json, when it exists. */
  shared?: NarrationManifest | null;
  /** This ayah's word compositions and harakat primer (content/compose/,
   *  without their Arabic: lines and frames only), when it has any. */
  compose?: ComposeInput | null;
  /** This ayah's example beats (examples.ts lessonExamples), when it has any. */
  examples?: readonly ExampleInput[] | null;
  /** This ayah's lesson map (lessonMap.ts lessonMapInputOf), when its surah has one: then the
   *  sequence gets its map steps and its "learned" step (plan L23, L26). */
  map?: LessonMapInput | null;
  /** The narrator's recording of a word's Arabic (src/lib/wordvoice.ts wordVoice): what every step
   *  that plays one word of this ayah plays (wordVoices). Absent: no word has one. */
  voice?: ((ar: string) => ExampleClip | null) | null;
};

/** What the sequence reads of a taught item (curriculum.ts Taught; a Konsep record fits too).
 *  Lesson zero only: `lead`, the slide said before its line, and `examples` with the narrator's
 *  line about each (`say`; operator 2026-10-15). */
export type TaughtInput = {
  id: string;
  title: string;
  summary: string;
  words?: readonly number[];
  lead?: { say: string } | null;
  examples?: readonly { loc: string; say?: string }[];
};

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
   *  structure and the recap; the word a w${n} line explains; for a taught
   *  step, the words it occurs on (the curriculum's `words`: every majrur
   *  word for the step majrur) — or, for a record given without them, the
   *  words tagged with it (Word.concepts) and the words of the ayah's
   *  structure groups of that concept (the idhafah of bismi + Allāhi is
   *  [1, 2] although only Allāhi is tagged; validate_narration.concept_words);
   *  else the places the line names. */
  const kindHighlight = (part: string, refs: number[]): number[] => {
    if (part === "intro" || part === "recite" || part === "structure" || part === "recap") return every;
    const w = explained(part);
    if (w !== null) return [w];
    // An item of the structure: the words it is about.
    const item = /^structure:([1-9][0-9]*)$/.exec(part);
    if (item) return (ayah.structure?.items?.[Number(item[1]) - 1]?.words ?? []).filter((x) => x >= 1 && x <= words);
    if (part.startsWith("concept:")) {
      const id = part.slice("concept:".length);
      const own = input.introduced.find((c) => c.id === id)?.words;
      if (own) return [...new Set(own)].filter((w) => w >= 1 && w <= words).sort((a, b) => a - b);
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
    const text = display !== null ? clean(display) : clean(stripArabic(unmarkNamed(caption, input.named)));
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
  /** The example beats of step `id` (examples.ts), each after the cue `after` gives it (null:
   *  dropped — its cue is not there). The caption says what is shown and heard, in Latin only. */
  const beatsOf = (id: string, after: (e: ExampleInput) => number | null): ExampleBeat[] =>
    (input.examples ?? []).flatMap((e) => {
      const at = e.step === id ? after(e) : null;
      if (at === null || (e.word === null) === (e.clip === null)) return [];
      const where = e.place ? { translit: e.translit, surah: e.place.surah, ayah: e.place.ayah } : null;
      const lead =
        e.of === "base"
          ? where
            ? texts.example.base(where)
            : texts.example.form({ translit: e.translit })
          : e.word !== null
            ? texts.example.word({ n: e.word, translit: e.translit })
            : e.about !== null
              ? texts.example.zero({ translit: e.translit, surah: e.place?.surah ?? 0, ayah: e.place?.ayah ?? 0, about: e.about })
              : texts.example.other(where ?? { translit: e.translit, surah: 0, ayah: 0 });
      const caption = clean(stripArabic([lead, e.washal ? texts.example.washal({ heard: e.washal.heard }) : "", e.waqf ? texts.example.waqf : ""].filter(Boolean).join(" ")));
      return [{ id: e.id, of: e.of, after: at, key: e.key, word: e.word, clip: e.clip, frame: e.frame, caption, parts: splitCaption(caption) }];
    });
  const withBeats = (beats: ExampleBeat[]) => (beats.length ? { examples: beats } : {});

  const zero = input.zero === true;
  // No ayah on the stage of lesson zero: nothing for the spotlight to point at.
  const onAyah = zero ? [] : [line];
  const steps: AutoplayStep[] = [];
  steps.push(
    step({
      id: "intro",
      kind: "intro",
      cues: [cue(p("intro"), zero ? texts.zeroIntro({ surah: input.surahName }) : texts.intro({ surah: input.surahName, ayah: n, total: input.ayahCount }), onAyah)],
      guides: onAyah,
    }),
  );
  if (!zero) {
    steps.push(
      step({
        id: "recite",
        kind: "recite_ayah",
        cues: [cue(p("recite"), texts.recite, [line])],
        guides: [line],
        recite: { target: "ayah" },
      }),
    );
  }

  // What this ayah brings, before its words (plan L23, L26): ONE step per group of the card, in
  // step with the narrator (each waits for "Lanjut" in the "Tunggu saya" pace, and "↺ Ulangi"
  // plays that one group again), each with its lines (MAP_LINES: one sentence per line since
  // 2026-10-15). The engine's own captions (a page without narration) say what the narration
  // says, every counted step named (operator 2026-10-15: "always re-mention what they are").
  const map = input.map ?? null;
  const said = (items: readonly { name: string }[]) => items.map((it) => mapSaidName(it.name));
  if (map) {
    const again = said(mapHere(map));
    const captions: Record<(typeof MAP_LINES)[MapGroup][number], string> = {
      "map:new": texts.lessonMap.new({ new: said(map.new) }),
      "map:learnt": texts.lessonMap.learnt({ learnt: said(map.learnt) }),
      "map:again": texts.lessonMap.again({ again }),
      "map:later": texts.lessonMap.later({ later: mapLaterNames(map), lanjut: map.lanjut.length }),
      "map:focus": texts.lessonMap.focus({ later: map.later.length, lanjut: map.lanjut.length, new: said(map.new), again }),
    };
    for (const g of mapOpening(map)) {
      steps.push(step({ id: `map:${g}`, kind: "map", cues: MAP_LINES[g].map((part) => cue(p(part), captions[part])), guides: [] }));
    }
  }

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

  /** One exercise's step: its introduction, the prompt of each control, and the explanation of
   *  each question's correct answer. */
  const exerciseStep = (key: ExerciseKey): AutoplayStep => {
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
    // The explanation of each question's correct answer, from the manifest only (its words come
    // from the narration build; a page without narration says just "Benar.").
    const explain: Partial<Record<number, number>> = {};
    for (const q of input.questions?.[key] ?? []) {
      const id = explainLineId(slug, n, key, q);
      if (!input.narration || !manifestParts(input.narration, id)) continue;
      explain[q] = cues.length;
      cues.push(cue(id, ""));
    }
    return step({
      id: `ex:${key}`,
      kind: "exercise",
      cues,
      guides: [partGuide(key, parts[0])],
      exercise: { key, progressId: exerciseProgressId(lessonKey, key), parts, lead, promptCue, guides, explain },
    });
  };
  const asked = canonicalExercises(input.exercises);
  // The warm-up (operator 2026-10-13: "in every ayat we identify first each words fall into which
  // category: ismu, fi'il or harf. it's kind of exercise, kind of warming up"): asked before the
  // first word, after what the ayah brings. It WAITS for the learner like every exercise.
  for (const key of asked) if (OPENING_EXERCISES.includes(key)) steps.push(exerciseStep(key));

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
      const cues = comp.lines.map((l, k) => cue(p(`w${wn}:compose:${k + 1}`), l.say, [card]));
      // The bentuk dasar: recited once the lines of its `base` frame are said, the frame still on screen.
      const lastCueOf = (frame: number | null) => (frame === null ? -1 : cues.reduce((at, c, k) => (c.frame === frame ? k : at), -1));
      steps.push(
        step({
          id: `w${wn}:compose`,
          kind: "compose",
          cues,
          guides: [card, wordGuide],
          word: wn,
          loc: w.loc,
          // The ayah's last word, after the line that says the recitation stops on it: heard once
          // more, that line still the caption. No other composition ends with its word (L24).
          ...(comp.stop ? { recite: { target: "word" as const, word: wn } } : {}),
          frames: comp.frames,
          ...withBeats(
            beatsOf(`w${wn}:compose`, (e) => {
              const at = lastCueOf(e.frame);
              return at === -1 ? null : at;
            }),
          ),
        }),
      );
    }
  });

  for (const c of input.introduced) {
    const summary = latinSentences(c.summary);
    const title = stripArabic(c.title);
    // Lesson zero: the slide before the line (operator 2026-10-15: "we need another page/slide to
    // explain that kalimah in Arabic is different: kalimah in Arabic means word, while in bahasa it
    // means sentence/kalimat"), a step of its own with its cards on the stage (LessonStage).
    if (zero && c.lead) {
      const id = `concept:${c.id}:lead` as const;
      steps.push(step({ id, kind: "concept", cues: [cue(p(id), stripArabic(c.lead.say))], guides: [] }));
    }
    steps.push(
      step({
        id: `concept:${c.id}`,
        kind: "concept",
        cues: [cue(p(`concept:${c.id}`), summary ? texts.concept(title, summary) : texts.conceptBrief(title))],
        guides: [],
      }),
    );
    // "Each explanation should be followed by examples (visual + voice)": the concept's example
    // in this ayah (and at most one more), a step of its own so that "↺ Ulangi" plays it again.
    // Lesson zero: the narrator explains each example (operator 2026-10-15: "ṣirāṭ, yang artinya
    // jalan, adalah sebuah isim, yaitu nama benda"): line k, said over example k's card, then its
    // recording — beat k after cue k.
    const said = zero ? (c.examples ?? []).filter((e) => !!e.say) : [];
    const exId = `concept:${c.id}:ex` as const;
    const beats = said.length
      ? beatsOf(exId, (e) => {
          const k = said.findIndex((x) => x.loc === e.key);
          return k === -1 ? null : k;
        }).sort((a, b) => a.after - b.after)
      : beatsOf(exId, () => -1);
    if (beats.length) {
      // The line of example n is "<id>:ex:<n>" (n: its place in the curriculum's list).
      const cues = said.length ? beats.map((b) => cue(p(`${exId}:${b.after + 1}`), stripArabic(said[b.after]?.say ?? ""))) : [];
      steps.push(step({ id: exId, kind: "example", cues, caption: beats[0].caption, guides: [], examples: said.length ? beats.map((b, k) => ({ ...b, after: k })) : beats }));
    }
  }

  // The sentence structure. Told ITEM BY ITEM where the ayah has items (operator 2026-10-13: "can
  // we make this kind of explanation in items: harfjar in one item, idhafah in next item etc, it's
  // kind of confusing which for which in this paragraph"): one step per item, so "↺ Ulangi"
  // replays that item and "Tunggu saya" waits after each; its line lights the item's words and
  // the stage shows them (LessonStage). Else the one line of its summary, the whole ayah lit.
  const items = ayah.structure?.items ?? [];
  items.forEach((it, i) => {
    const k = i + 1;
    const own = stripArabic(it.say);
    steps.push(
      step({
        id: `structure:${k}`,
        kind: "structure",
        cues: [cue(p(`structure:${k}`), k === 1 ? texts.structureItems(own) : own, [line])],
        guides: [line],
        item: { n: k, of: items.length, words: [...it.words] },
      }),
    );
  });
  if (ayah.structure && !items.length) {
    const summary = latinSentences(ayah.structure.summary);
    const caption = summary ? texts.structure(summary) : texts.structureBrief;
    steps.push(step({ id: "structure", kind: "structure", cues: [cue(p("structure"), caption, [line])], guides: [line] }));
  }

  for (const key of asked) if (!OPENING_EXERCISES.includes(key)) steps.push(exerciseStep(key));

  // … and what it taught, then the running total with every step named, before the imam recites
  // the ayah once more.
  if (map) {
    const closing: Record<(typeof MAP_LINES)["learned"][number], string> = {
      learned: texts.learned({ new: said(map.new), again: said(mapHere(map)) }),
      "map:total": texts.total({ total: said([...map.learnt, ...map.new]), fresh: map.new.length > 0 }),
    };
    steps.push(step({ id: "learned", kind: "learned", cues: MAP_LINES.learned.map((part) => cue(p(part), closing[part])), guides: [] }));
  }

  if (!zero) {
    steps.push(
      step({ id: "recap", kind: "recap", cues: [cue(p("recap"), texts.recap, [line])], guides: [line], recite: { target: "ayah" } }),
    );
  }

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
    const said = zero ? texts.zeroNext({ surah: input.surahName }) : texts.next({ ayah: n + 1 });
    steps.push(step({ id: "next", kind: "next", cues: [cue(p("next"), said)], guides: [] }));
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
    // Every word heard on its own is the narrator's recording of it (operator 2026-10-14).
    wordVoices: ayah.words.map((w) => input.voice?.(w.ar) ?? null),
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
