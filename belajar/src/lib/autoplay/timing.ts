/**
 * Autoplay pacing. Without narration audio the lesson moves at a READING
 * pace (captionMs, senior-ux §3.5: 10 / 6 characters per second after a
 * settle time, no upper cap); with audio it follows the audio and adds a
 * short settle pause. "Tunggu saya" never moves on by itself (WCAG 2.2.1).
 *
 * WHAT THE IMAM'S WORD WAITS FOR (operator 2026-10-13: "why there is rather long
 * pause when reciting verses word by word? loading issue?"; plan L24). It was
 * no loading: every recitation of one word was held for the reading time of
 * the caption under it, a rule from before the narration had a voice — a
 * one-second word, then five to ten seconds of silence. Now:
 *  - a word's opening step ("w${n}:recite") in a narrated lesson lasts as long
 *    as the imam's word and the pause after him: its caption only names the
 *    word the card shows, and the narrator speaks next. Where the word's line
 *    has no voice (a caption-only lesson, or its audio failed this visit) the
 *    caption is all the learner has, and keeps its reading time (readMs);
 *  - the ayah's last word, recited once more after the last line of its
 *    composition, lasts as long as the imam's word and the pause after him in
 *    every lesson: that line stays the caption, so nothing new is to be read;
 *  - an example beat's caption is text the narrator never says, so it keeps a
 *    reading time — the reading alone (exampleReadMs): no settle for the eyes
 *    and no five-second floor.
 */
import { captionMs, readingMs, type AutoPace, type Pace } from "../lessonSteps";

/** Reading pace used for a timed caption under any pace setting. "Tunggu
 *  saya" holds narration captions for "Lanjut", but the short lines that are
 *  never held (exercise prompts, feedback, "Kita lanjutkan") read at Biasa. */
export const readPace = (pace: Pace): AutoPace => (pace === "pelan" ? "pelan" : "biasa");

/** How long a caption stays when no narration audio plays it. */
export function readMs(text: string, pace: Pace): number {
  return captionMs(text, readPace(pace));
}

/**
 * How long an example beat's card stays at least, from the moment it appears (the imam's clip
 * plays inside that time; the pause after him follows): its caption's reading time at the lesson's
 * reading pace, 10 characters a second at Biasa and 6 at Pelan (senior-ux §3.5), and nothing more.
 * The captions come in two lengths (measured over the four surahs, 2026-10-13): a label of 23–32
 * characters beside a card that already shows the word ("Contoh: kata ke-1, bismi.": 2.5 s at
 * Biasa, 4.2 s at Pelan; captionMs held it 5.0 s and 7.2 s), and a label with a note on what is
 * heard, 97–112 characters (a waqf or hamzat-washal note: 9.7–11.2 s at Biasa, 16.2–18.7 s at
 * Pelan; it was 12.2–13.7 s and 19.2–21.7 s). Never shorter than the clip and the pause after it:
 * the runner ends a recitation only once its sound has ended as well. "Tunggu saya" reads at
 * Biasa wherever it is timed at all (readPace); the machine gives it no minimum (it waits for
 * "Lanjut" at the step's end).
 */
export function exampleReadMs(text: string, pace: Pace): number {
  return readingMs(text, readPace(pace));
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
 * An example beat (operator 2026-10-12, plan L20) waits this long for the imam's clip to SOUND
 * before it gives up on it: the runner then reports recite_error, and the lesson goes on (an
 * example is never a dead stop). Long enough for "Memuat bacaan imam…" to show (LOADING_SHOW_MS,
 * 0.6 s) and for a slow first byte from the reciter's CDN; shorter than LOADING_SLOW_MS (8 s),
 * whose advice — wait, or click ↺ Ulangi — is for a sound the lesson cannot go on without.
 */
export const EXAMPLE_LOAD_LIMIT_MS = 6000;

/** An example whose recording could not be played stays on screen, with its caption, this long. */
export const EXAMPLE_FAILED_HOLD_MS = 3000;

/** Has an example beat waited long enough for its sound (rules above)? `heard`: the clip played
 *  to its end; `flowing`: it is sounding right now. */
export function exampleGivesUp(waitedMs: number, sound: { heard: boolean; flowing: boolean }): boolean {
  return waitedMs >= EXAMPLE_LOAD_LIMIT_MS && !sound.heard && !sound.flowing;
}

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
/** Suggested interval of the UI's `idle_tick` while the lesson waits for the learner. */
export const IDLE_TICK_MS = 1000;

/**
 * The screen lock's time limit while the lesson waits for the learner (src/lib/autoplay/wake.ts;
 * review 2026-10-12: with no limit, a phone left at an exercise kept its screen on until the
 * battery died). An exercise's reminders end with the third, at 60 s of silence; the lock is let
 * go this much silent time after it.
 */
export const SCREEN_IDLE_AFTER_REMINDERS_MS = 60_000;
/**
 * Silent waiting time at which the screen lock is let go: the last reminder's time plus
 * SCREEN_IDLE_AFTER_REMINDERS_MS (120 s). The same for an exercise waiting (its `idleMs`, once
 * its reminders are through) and for a caption "Tunggu saya" holds for "Lanjut" (`heldMs`, which
 * has no reminders). The lesson itself does not change at this limit: only the lock is let go,
 * and the learner's next action there takes it again.
 */
export const SCREEN_IDLE_LIMIT_MS = REMINDER_AT_MS[REMINDER_AT_MS.length - 1] + SCREEN_IDLE_AFTER_REMINDERS_MS;

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
