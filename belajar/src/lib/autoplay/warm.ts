/**
 * The imam's recitation, fetched EARLY — so it is ready when its step comes (operator 2026-10-11:
 * "how to reduce the loading time? upgrade VM?"; measured that day: the VM is idle, the wait is the
 * download. The recitation streams from the reciter's CDN, whose node for Indonesia answers from
 * Germany: three round trips, 0.53 s, before the first byte and ~1.1 s for an ayah on broadband,
 * several times that on mobile data. "do all three": this is the first of the three — "the lesson
 * would start downloading the ayah's recitation while the narrator is still speaking the opening
 * line").
 *
 * WHEN — only once the lesson has STARTED ("Mulai", "Lanjutkan dari langkah N", or the hand-off
 * from the previous ayah), never on a page view alone: learners on mobile data pay for every byte
 * and must not pay for a lesson they did not start. Before "Mulai" the page still warms only the
 * first narration line and the connection (loading.ts idlePreloadUrl; useAutoplay's preconnect).
 * From the start on: THIS ayah's recording, by the reciter chosen, while the narrator speaks the
 * opening line. The lesson plays it in its second step whatever the connection is, so it is asked
 * for whatever the connection says. Another reciter chosen in "Pengaturan" is asked for when chosen.
 *
 * HOW — on the stage's OWN player (useSegmentPlayer `warm`; useAutoplay runs the rule): the Audio
 * element that will play the ayah starts loading it, so the recitation later starts from that
 * element's buffer — the same element, no cache in between.
 *
 * NOT the next ayah's recording (review 2026-10-11; a first version fetched it from the recap on,
 * on a spare element). Every ayah after the first is reached by the hand-off, and its page fetches
 * its own recording from its first line: in Al-Fatihah that is 13.7–24.6 s before the imam's step
 * (the intro line plus his cue), enough for the whole file (75–212 KB) on any link faster than
 * 38–69 kbps — and a link that slow cannot stream the 64 kbps narration either. Against that
 * sliver, the spare element cost a learner who stops at the recap up to 212 KB for nothing, and
 * the file twice on a browser that does not share media between elements. So a recording is asked
 * for by the page that plays it, and by no other.
 *
 * The recordings still stream from the provider and are stored nowhere on our server (the Kredit
 * page's promise): only the moment the learner's browser asks for them moved.
 *
 * AN EXAMPLE'S CLIP FROM ANOTHER AYAH (operator 2026-10-12, plan L20; exampleToWarm) is a
 * recitation too, never narration: the look-ahead (lookahead.ts) does not list it. It is fetched
 * on the example player's own element, by the same rule of thumb as above and no sooner: only
 * while the lesson RUNS, and only the clip the CURRENT step is about to play — asked for when
 * that step begins, while the narrator says the lines before it (a composition's first lines
 * last 10 s and more) — never a later step's, never another ayah's lesson's. Unlike the ayah's own
 * recording, the lesson can go on without an example, so with Save-Data or a 2G-class connection
 * (loading.ts savesData) it is not fetched ahead at all: it loads when its beat plays, and is
 * skipped if it does not come (timing.ts EXAMPLE_LOAD_LIMIT_MS). And only once the step has been
 * the one wanting it for EXAMPLE_WARM_DELAY_MS (the runner's timer): a learner who steps through
 * the lesson with "Berikutnya ›" asks the reciters' host for nothing on the way.
 *
 * Pure (no React, no DOM): unit-tested (warm.test.ts).
 */
import { savesData, type ConnectionHints } from "./loading";
import { lessonRuns, type AutoplayState } from "./machine";
import type { AutoplaySequence } from "./types";

export type RecitationWarmInput = {
  /** The lesson has started (AutoplayState.started): a click on "Mulai" / "Lanjutkan dari langkah
   *  N", or the hand-off from the previous ayah. False on a page that is only looked at. */
  started: boolean;
  /** This ayah's recording by the reciter chosen now (the stage player's `source.url`). */
  currentUrl: string | null;
};

/** The recording a lesson in this state wants fetched ahead, on the stage's own player; null:
 *  nothing (yet). Rules: the head of this file. */
export function recitationToWarm(i: RecitationWarmInput): string | null {
  return i.started ? i.currentUrl || null : null;
}

/** How long a step must have wanted its example clip before the runner asks for it (above). */
export const EXAMPLE_WARM_DELAY_MS = 1200;

/**
 * The recording of the example clip the lesson in state `s` wants fetched ahead on the example
 * player; null: none. The next clip of another ayah that the CURRENT step still plays (an example
 * that failed is not asked for again). Rules: the head of this file.
 */
export function exampleToWarm(seq: AutoplaySequence, s: AutoplayState, conn?: ConnectionHints | null): string | null {
  if (!lessonRuns(s) || savesData(conn)) return null;
  const beats = seq.steps[s.idx]?.examples;
  if (!beats) return null;
  for (const a of s.plan.slice(s.at)) {
    if (a.t !== "example" || a.failed) continue;
    const clip = beats[a.x]?.clip;
    if (clip) return clip.url;
  }
  return null;
}
