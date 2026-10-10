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
 * to Indonesian.
 */
import type { Ayah, SurahContent } from "@/content/schema";
import { availableExercises, buildAutoplaySequence, timedWords, type AutoplaySequence } from "@/lib/autoplay";
import { conceptsIntroducedIn, getLexeme } from "@/lib/library";

import { narrationFor, SHARED_NARRATION } from "./manifests";
import { autoplayTexts } from "./texts";

/** The language the narration manifests are written in. */
export const NARRATION_LOCALE = "id";

export function stageSequence(s: SurahContent, a: Ayah, locale: string): AutoplaySequence {
  return buildAutoplaySequence({
    slug: s.slug,
    surahName: s.name_id,
    ayahCount: s.ayat.length,
    ayah: a,
    introduced: conceptsIntroducedIn(a.loc),
    // The same rule as the exercises' own "render nothing" checks, so the
    // lesson only ever waits at an exercise that appears.
    exercises: availableExercises({ words: a.words, timed: timedWords(a), lexeme: getLexeme }),
    texts: autoplayTexts(locale),
    narration: locale === NARRATION_LOCALE ? narrationFor(s.slug) : null,
    shared: locale === NARRATION_LOCALE ? SHARED_NARRATION : null,
  });
}
