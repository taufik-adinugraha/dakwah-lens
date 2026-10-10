/**
 * Which caption the stage shows (pure; unit-tested in caption.test.ts).
 *
 * - Caption-only line (no narration audio, or its audio failed this visit):
 *   the engine's caption part, which the machine times by reading pace.
 * - Line with narration audio: the SPOKEN text from the manifest, so the
 *   subtitles match the voice word for word (it says "kata ini", never a
 *   Qur'anic word), cut into ≤180-character parts; the part follows the
 *   audio clock while the line plays, and stays on its last part after.
 *
 * And what a screen reader is told (srAnnouncement): the visible caption may
 * carry transliteration, so a live region never reads it out — the device's
 * voice would say a Qur'anic word, and over the imam. It announces the
 * line's SPOKEN text (sanitised: "kata kedua", never the word) when a line
 * starts, and nothing while the imam recites, while narration audio speaks,
 * or for "Benar." / "Belum tepat" / "Ini jawabannya" (the exercise's own
 * status box says those).
 */
import { partAt, viewAutoplay, type Activity, type AutoplaySequence, type AutoplayState, type Cue } from "@/lib/autoplay";
import { splitCaption } from "@/lib/lessonSteps";

/** Where the narration file of a line stands (from the audio element). */
export type CaptionClock = { token: number; line: string; ms: number; totalMs: number };

/** The cue the machine's caption points at; null for a step's own caption. */
export function captionCue(seq: AutoplaySequence, state: AutoplayState): Cue | null {
  const ref = state.caption;
  if (ref === "step") return null;
  if ("c" in ref) return seq.steps[state.idx]?.cues[ref.c] ?? null;
  return seq.shared[ref.s] ?? null;
}

export function stageCaption(
  seq: AutoplaySequence,
  state: AutoplayState,
  clock: CaptionClock | null,
): { text: string; voiced: boolean } {
  const view = viewAutoplay(seq, state);
  const cue = captionCue(seq, state);
  const spoken = cue && cue.audio.length > 0 && !state.noAudio.includes(cue.line) ? cue.spoken : null;
  if (!cue || !spoken) {
    const { parts, part } = view.caption;
    return { text: parts[Math.min(part, parts.length - 1)] ?? "", voiced: false };
  }
  const parts = splitCaption(spoken);
  const a: Activity | null = state.activity;
  let part = 0;
  if (a?.kind === "narrate" && a.line === cue.line) {
    part = partAt(parts, clock?.token === a.token ? clock.ms : a.offsetMs, a.totalMs);
  } else if (clock?.line === cue.line) {
    part = partAt(parts, clock.ms, clock.totalMs);
  }
  return { text: parts[Math.min(part, parts.length - 1)] ?? "", voiced: true };
}

/** The text a polite live region announces for the stage right now ("" =
 *  nothing). `voiced`: narration audio is speaking this line. */
export function srAnnouncement(seq: AutoplaySequence, state: AutoplayState, voiced: boolean): string {
  if (voiced || state.activity?.kind === "recite") return "";
  const ref = state.caption;
  if (ref === "step") return "";
  // Feedback the exercise's own status box announces already.
  if ("s" in ref && (ref.s === "correct" || ref.s === "try_again" || ref.s === "revealed")) return "";
  const cue = captionCue(seq, state);
  if (!cue) return "";
  // A recitation step's lead line, shown while the imam recites (caption-
  // only): announced only when it is read before him, never after him.
  if (seq.steps[state.idx]?.recite && "c" in ref && ref.c === 0 && state.activity?.kind !== "read") return "";
  // Without a manifest (no Indonesian narration for this locale) the caption
  // is all there is.
  return cue.spoken ?? cue.caption;
}
