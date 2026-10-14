/**
 * The autoplay sequence of one ayah as the lesson page builds it (on the
 * server, at build time): the engine's buildAutoplaySequence fed with the
 * validated content, the page's exercise list, the locale's captions and
 * the narration manifests. Kept apart from the page so the vitest suite can
 * check exactly what the page ships (stage.test.ts).
 *
 * The narration is Indonesian, so only the Indonesian pages get it: an
 * English page stays caption-only (its own captions, reading-time paced)
 * until English narration exists, rather than switching voice and subtitles
 * to Indonesian. The word compositions (content/compose) go to every page.
 *
 * The example beats (operator 2026-10-12: "each explanation should be followed
 * by examples (visual + voice)"; plan L20; src/lib/autoplay/examples.ts) go to
 * every page too: they are the imam's recitation and an on-screen caption in
 * the page's locale, never narration. lessonExamplesFor derives them from the
 * content; the sequence takes what it needs of them (no Arabic), the stage
 * their drawing (stageExamples: the content's bytes, by beat id).
 */
import type { Ayah, SurahContent } from "@/content/schema";
import { availableExercises, buildAutoplaySequence, lessonExamples, questionNumbers, zeroAyah, type AutoplaySequence, type ExampleGap, type LessonExample } from "@/lib/autoplay";
import { composeFor, composeInput } from "@/lib/compose-content";
import { SURAHS } from "@/lib/content";
import { taughtAt, taughtInZero } from "@/lib/curriculum";
import { LIBRARY } from "@/lib/library";
import { lessonMapInput } from "@/lib/map-content";
import { quizAyah } from "@/lib/quiz-content";

import { narrationFor, SHARED_NARRATION } from "./manifests";
import { autoplayTexts } from "./texts";

/** The language the narration manifests are written in. */
export const NARRATION_LOCALE = "id";

/** Every lesson word, by loc: a concept's example may stand in another ayah, or another surah. */
const WORDS = new Map(SURAHS.flatMap((x) => x.ayat.flatMap((y) => y.words.map((w) => [w.loc, w] as const))));

/** The example beats of one ayah's lesson (which, and why: src/lib/autoplay/examples.ts), and the
 *  rules it explains without one, each with its reason. */
export function lessonExamplesFor(s: SurahContent, a: Ayah): { examples: LessonExample[]; gaps: ExampleGap[] } {
  return lessonExamples({
    ayah: a,
    introduced: taughtAt(a),
    compose: composeFor(s.slug),
    clips: LIBRARY.clips,
    wordAt: (loc) => WORDS.get(loc),
  });
}

export function stageSequence(s: SurahContent, a: Ayah, locale: string): AutoplaySequence {
  const quiz = quizAyah(s.slug, a.ayah);
  return buildAutoplaySequence({
    slug: s.slug,
    surahName: s.name_id,
    ayahCount: s.ayat.length,
    ayah: a,
    introduced: taughtAt(a),
    // The ayah's quiz (content/quiz): the exercises the page renders, so the lesson only ever
    // waits at an exercise that appears, and each question's explanation line.
    exercises: availableExercises(quiz),
    questions: questionNumbers(quiz),
    texts: autoplayTexts(locale),
    narration: locale === NARRATION_LOCALE ? narrationFor(s.slug) : null,
    shared: locale === NARRATION_LOCALE ? SHARED_NARRATION : null,
    // Word compositions and the harakat primer (rule 14): on every locale —
    // an English page shows their Indonesian lines as captions, as it shows
    // the words' Indonesian explanations.
    compose: composeInput(s.slug, a),
    examples: lessonExamplesFor(s, a).examples,
    // The lesson map (operator 2026-10-13, plan L23 and L26): in a surah that has one (content/map),
    // what the ayah brings is said after the imam's recitation, one step per group of its card, and
    // what it taught before the recap; on every locale — the card lists the steps, the caption
    // follows the narration when there is one.
    map: lessonMapInput(s.slug, a.ayah),
  });
}

/**
 * LESSON ZERO (the basic curriculum's lesson with no ayah, src/lib/autoplay/zero.ts), for the
 * surah that hosts it (src/lib/curriculum.ts ZERO_HOST): the example beats of the steps it
 * teaches — the kalimah record's first examples, each the imam's clip of its own ayah (there is
 * no ayah here whose own recording could give them) …
 */
export function zeroExamplesFor(s: SurahContent): { examples: LessonExample[]; gaps: ExampleGap[] } {
  return lessonExamples({
    ayah: zeroAyah(s.surah),
    zero: true,
    introduced: taughtInZero(),
    compose: composeFor(s.slug),
    clips: LIBRARY.clips,
    wordAt: (loc) => WORDS.get(loc),
  });
}

/** … and its autoplay sequence, as its page builds it: its opening line, the harakat primer, the
 *  "Konsep baru" line of the three kinds of word with those examples, and the hand-over to the
 *  surah's first ayah. No recitation of an ayah, no exercise, no lesson map. */
export function zeroSequence(s: SurahContent, locale: string): AutoplaySequence {
  const zero = zeroAyah(s.surah);
  return buildAutoplaySequence({
    slug: s.slug,
    surahName: s.name_id,
    ayahCount: s.ayat.length,
    ayah: zero,
    zero: true,
    introduced: taughtInZero(),
    exercises: [],
    texts: autoplayTexts(locale),
    narration: locale === NARRATION_LOCALE ? narrationFor(s.slug) : null,
    shared: locale === NARRATION_LOCALE ? SHARED_NARRATION : null,
    compose: composeInput(s.slug, zero),
    examples: zeroExamplesFor(s).examples,
    map: null,
  });
}
