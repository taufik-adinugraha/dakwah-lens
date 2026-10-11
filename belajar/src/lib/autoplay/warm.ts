/**
 * The imam's recitation, fetched EARLY — so it is ready when its step comes (operator 2026-10-11:
 * "how to reduce the loading time? upgrade VM?"; measured that day: the VM is idle, the wait is the
 * download. The recitation streams from the reciter's CDN, whose node for Indonesia answers from
 * Germany: three round trips, 0.53 s, before the first byte and ~1.1 s for an ayah on broadband,
 * several times that on mobile data. "do all three": this is the first of the three).
 *
 * WHEN — only once the lesson has STARTED ("Mulai", "Lanjutkan dari langkah N", or the hand-off
 * from the previous ayah), never on a page view alone: learners on mobile data pay for every byte
 * and must not pay for a lesson they did not start. Before "Mulai" the page still warms only the
 * first narration line and the connection (loading.ts idlePreloadUrl; useAutoplay's preconnect).
 *  - THIS ayah's recording, by the reciter chosen: from the start, while the narrator speaks the
 *    opening line. The lesson plays it in its second step whatever the connection is, so it is
 *    asked for whatever the connection says. Another reciter chosen in "Pengaturan" is asked for
 *    when chosen.
 *  - The NEXT ayah's recording: from the recap on (NEXT_AYAH_WARM_STEPS), because the lesson goes
 *    on there by itself. Within the surah only (`nav.kind === "ayah"`: a surah's last ayah ends at
 *    its end card and moves nowhere by itself, so nothing of another surah, published or not, is
 *    fetched). The file the next page plays first — its default reciter's: the choice of reciter
 *    belongs to the ayah page and starts over on each one (useSegmentPlayer). Not when the browser
 *    asks to save data (loading.ts savesData, the idle preload's rule): the lesson may yet be
 *    paused or left before it gets there.
 *
 * HOW (useAutoplay runs the plan; the two fetchers are in useSegmentPlayer.ts):
 *  - `current` on the stage's OWN player (its `warm`): the Audio element that will play the ayah
 *    starts loading it, so the recitation later starts from that element's buffer — the same
 *    element, no cache in between.
 *  - `next` on a spare element that is never played (`warmRecitation`), each file once in a visit
 *    (askOnce): it fills the browser's media cache, which the stage's player reads when the next
 *    page points it at the same address; that page then warms its own player again, from its start.
 * The recordings still stream from the provider and are stored nowhere on our server (the Kredit
 * page's promise): only the moment the learner's browser asks for them moved.
 *
 * Pure (no React, no DOM): unit-tested (warm.test.ts).
 */
import { type ConnectionHints, savesData } from "./loading";
import type { NavIntent, StepKind } from "./types";

/** The steps that end an ayah (sequence.ts): the recap — a line, then the imam recites the whole
 *  ayah once more — and the line that announces the next ayah. Together ten seconds and more, in
 *  which the next ayah's recording is fetched. */
export const NEXT_AYAH_WARM_STEPS: readonly StepKind[] = ["recap", "next"];

export type RecitationWarmInput = {
  /** The lesson has started (AutoplayState.started): a click on "Mulai" / "Lanjutkan dari langkah
   *  N", or the hand-off from the previous ayah. False on a page that is only looked at. */
  started: boolean;
  /** This ayah's recording by the reciter chosen now (the stage player's `source.url`). */
  currentUrl: string | null;
  /** The step on screen (AutoplayStep.kind). */
  step: StepKind;
  /** Where the lesson goes by itself after this ayah (AutoplaySequence.nav). */
  nav: NavIntent;
  /** The recording the next ayah's page plays first (its default reciter's); null when the page
   *  has none to offer (a surah's last ayah). */
  nextUrl: string | null;
  /** navigator.connection, where the browser has it. */
  conn?: ConnectionHints | null;
};

/** The recordings to have fetched by now; null: nothing (yet). */
export type RecitationWarmPlan = {
  /** This ayah's, on the stage's own player. */
  current: string | null;
  /** The next ayah's, on the spare element. */
  next: string | null;
};

/** What a lesson in this state wants fetched ahead (rules: the head of this file). */
export function recitationWarmPlan(i: RecitationWarmInput): RecitationWarmPlan {
  if (!i.started) return { current: null, next: null };
  const nearEnd = NEXT_AYAH_WARM_STEPS.includes(i.step);
  const next = nearEnd && i.nav.kind === "ayah" && !savesData(i.conn) ? i.nextUrl || null : null;
  return { current: i.currentUrl || null, next };
}

/**
 * Each file is asked for once in a visit: true the first time `url` is seen — `asked` then
 * remembers it — and false ever after. For the spare element: a recap replayed, or an ayah come
 * back to, does not download the next ayah's recording a second time (the browser's cache, or the
 * next page's own player, has it). `asked` also takes the files the stage's player fetched itself.
 */
export function askOnce(asked: Set<string>, url: string): boolean {
  if (asked.has(url)) return false;
  asked.add(url);
  return true;
}
