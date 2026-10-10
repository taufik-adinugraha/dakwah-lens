/**
 * Autoplay pacing. Without narration audio the lesson moves at a READING
 * pace (captionMs, senior-ux §3.5: 10 / 6 characters per second after a
 * settle time, no upper cap); with audio it follows the audio and adds a
 * short settle pause. "Tunggu saya" never moves on by itself (WCAG 2.2.1).
 */
import { captionMs, type AutoPace, type Pace } from "../lessonSteps";

/** Reading pace used for a timed caption under any pace setting. "Tunggu
 *  saya" holds narration captions for "Lanjut", but the short lines that are
 *  never held (exercise prompts, feedback, "Kita lanjutkan") read at Biasa. */
export const readPace = (pace: Pace): AutoPace => (pace === "pelan" ? "pelan" : "biasa");

/** How long a caption stays when no narration audio plays it. */
export function readMs(text: string, pace: Pace): number {
  return captionMs(text, readPace(pace));
}

/** Pause after a narration line ends, before the next thing starts. */
export function settleAfterNarrationMs(pace: Pace): number {
  return pace === "pelan" ? 1000 : 600;
}

/** Pause after the imam stops, so the next line never clips the recitation. */
export function settleAfterReciteMs(pace: Pace): number {
  return pace === "pelan" ? 1200 : 800;
}

/** "Pelan": the imam says each word a second time after this gap. */
export const WORD_REPEAT_GAP_MS = 1500;

/**
 * A settled exercise question (answered right, or its answer shown) stays
 * this long after its feedback line before the next question comes by
 * itself — longer when the answer was shown, so the right option and its
 * reason can be read. "Tunggu saya" never moves on by itself: the learner
 * taps the exercise's own "Lanjut" (WCAG 2.2.1).
 */
export function advanceHoldMs(pace: Pace, right: boolean): number {
  const slow = pace === "pelan";
  return right ? (slow ? 4000 : 2500) : slow ? 8000 : 5000;
}

/** Silent waiting time (ms) at which an exercise's gentle reminders fire. */
export const REMINDER_AT_MS = [20_000, 40_000, 60_000] as const;
/** At most this many reminders between two actions of the learner. */
export const MAX_REMINDERS = REMINDER_AT_MS.length;
/** Suggested interval of the UI's `idle_tick` while an exercise waits. */
export const IDLE_TICK_MS = 1000;

/**
 * Which caption part to show `elapsedMs` into a narration line of `totalMs`
 * that speaks all `parts` in order: proportional to the characters, so a
 * longer part stays longer. Pure, for the UI's audio clock.
 */
export function partAt(parts: readonly string[], elapsedMs: number, totalMs: number): number {
  if (parts.length <= 1 || totalMs <= 0) return 0;
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total === 0) return 0;
  const at = (Math.max(0, Math.min(elapsedMs, totalMs)) / totalMs) * total;
  let seen = 0;
  for (let i = 0; i < parts.length; i++) {
    seen += parts[i].length;
    if (at < seen) return i;
  }
  return parts.length - 1;
}
