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
 */
import type { Ayah, SurahContent } from "@/content/schema";
import { availableExercises, buildAutoplaySequence, questionNumbers, type AutoplaySequence } from "@/lib/autoplay";
import { composeInput } from "@/lib/compose-content";
import { conceptsIntroducedIn } from "@/lib/library";
import { quizAyah } from "@/lib/quiz-content";

import { narrationFor, SHARED_NARRATION } from "./manifests";
import { autoplayTexts } from "./texts";

/** The language the narration manifests are written in. */
export const NARRATION_LOCALE = "id";

export function stageSequence(s: SurahContent, a: Ayah, locale: string): AutoplaySequence {
  const quiz = quizAyah(s.slug, a.ayah);
  return buildAutoplaySequence({
    slug: s.slug,
    surahName: s.name_id,
    ayahCount: s.ayat.length,
    ayah: a,
    introduced: conceptsIntroducedIn(a.loc),
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
  });
}
