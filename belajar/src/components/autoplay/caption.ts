/**
 * What the stage shows and says, from the engine's state (pure; unit-tested
 * in caption.test.ts).
 *
 * The caption (stageCaption) shows what is SPOKEN (operator, 2026-10-10):
 * - a line with narration audio and word timings: a KARAOKE caption — the
 *   words of the file playing, the one the narrator is saying filled forest,
 *   those already said normal, those still to come muted (the position comes
 *   from the audio element, once a frame: VoicePos);
 * - a line with narration audio but no word timings: its display text
 *   (dictionary terms as "na’t (نَعْت)"), cut into ≤180-character parts, the
 *   part following the audio clock; for an older manifest without display,
 *   the spoken text;
 * - a caption-only line (no audio, or its audio failed this visit): the
 *   engine's caption part — the display text when the manifest has one —
 *   which the machine times by reading pace.
 *
 * The mushaf line and the word card (stageMarks): the words the line on
 * screen highlights (the whole ayah for the intro, the recitation lead,
 * the structure and the recap; the word explained; a concept's words), and
 * the word whose large card sits above the caption. While the imam recites,
 * only his current word is lit (the player's activeWord), plus the word of
 * a word step.
 *
 * The animation in the word card's slot (stageFrame, operator 2026-10-10,
 * narration rule 14): on a primer or compose step, the frame the line on
 * screen is said over; while the imam recites the joined word after the
 * lines (and in his settle pause), the last frame, "recited".
 *
 * And what a screen reader is told (srAnnouncement): a polite live region
 * never reads the caption's Arabic or transliteration out — the device's
 * voice would say it, and over the imam. It announces the line's text
 * without Arabic (from the display, else the sanitised spoken text) when a
 * line starts, and nothing while the imam recites, while narration audio
 * speaks, or for "Benar." / "Belum tepat" / "Ini jawabannya" (the
 * exercise's own status box says those).
 */
import {
  partAt,
  viewAutoplay,
  withoutArabic,
  type Activity,
  type AutoplaySequence,
  type AutoplayState,
  type Cue,
  type KaraokeWord,
} from "@/lib/autoplay";
import { splitCaption } from "@/lib/lessonSteps";

/** Where the narration file of a line stands (from the audio element). */
export type CaptionClock = { token: number; line: string; ms: number; totalMs: number };

/**
 * Where the narrator is in the words of one narration file: `now` the word
 * being said (-1: none), `said` how many words have started. Set by the
 * runner from the audio element (only when it changes), and to "all said"
 * when the file ends.
 */
export type VoicePos = { token: number; line: string; file: string; now: number; said: number };

export type StageCaption =
  | { kind: "text"; text: string; voiced: boolean }
  | { kind: "karaoke"; words: readonly KaraokeWord[]; now: number; said: number; voiced: true };

/** A word stays lit after it ends while no other word has started — until
 *  this long after the last word of the file. */
const LAST_WORD_HOLD_MS = 400;

/** The karaoke position `ms` into a file with these words. */
export function karaokeAt(words: readonly KaraokeWord[], ms: number): { now: number; said: number } {
  let said = 0;
  while (said < words.length && words[said][1] <= ms) said++;
  const k = said - 1;
  if (k < 0) return { now: -1, said: 0 };
  // The latest word stays lit until the next one starts (no flicker between
  // words); the last one goes out shortly after it ends.
  const now = k < words.length - 1 || ms < words[k][2] + LAST_WORD_HOLD_MS ? k : -1;
  return { now, said };
}

/** The text of a caption model (karaoke words joined). */
export const captionText = (c: StageCaption) => (c.kind === "text" ? c.text : c.words.map(([t]) => t).join(" "));

/** The cue the machine's caption points at; null for a step's own caption. */
export function captionCue(seq: AutoplaySequence, state: AutoplayState): Cue | null {
  const ref = state.caption;
  if (ref === "step") return null;
  if ("c" in ref) return seq.steps[state.idx]?.cues[ref.c] ?? null;
  return seq.shared[ref.s] ?? null;
}

/** Is this cue spoken by narration audio now (it has audio that did not fail)? */
const audible = (state: AutoplayState, cue: Cue) => cue.audio.length > 0 && !state.noAudio.includes(cue.line);

/** Is the line on screen spoken by the narration voice? null when no
 *  narration line is on screen (a word step's own caption). */
export function lineVoiced(seq: AutoplaySequence, state: AutoplayState): boolean | null {
  const cue = captionCue(seq, state);
  return cue ? audible(state, cue) : null;
}

/** The words (with times) of the narration file playing now, or null: the
 *  runner follows them once a frame. While a line plays, the machine's
 *  caption is that line. */
export function playingWords(seq: AutoplaySequence, state: AutoplayState): readonly KaraokeWord[] | null {
  const a = state.activity;
  if (a?.kind !== "narrate") return null;
  const cue = captionCue(seq, state);
  if (!cue || cue.line !== a.line) return null;
  const words = cue.audio.find((f) => f.id === a.file)?.words;
  return words && words.length > 0 ? words : null;
}

export function stageCaption(
  seq: AutoplaySequence,
  state: AutoplayState,
  clock: CaptionClock | null,
  voice: VoicePos | null = null,
): StageCaption {
  const view = viewAutoplay(seq, state);
  const cue = captionCue(seq, state);
  if (!cue || !audible(state, cue)) {
    const { parts, part } = view.caption;
    return { kind: "text", text: parts[Math.min(part, parts.length - 1)] ?? "", voiced: false };
  }
  const a: Activity | null = state.activity;
  const playing = a?.kind === "narrate" && a.line === cue.line ? a : null;
  // The file on screen: the one playing, else the one the narrator last
  // stood in (paused, or just ended), else the first.
  const file = playing ? playing.file : voice?.line === cue.line ? voice.file : cue.audio[0].id;
  const seg = cue.audio.find((f) => f.id === file) ?? cue.audio[0];
  if (seg.words && seg.words.length > 0) {
    let pos = { now: -1, said: 0 };
    if (playing) {
      if (voice && voice.token === playing.token) pos = voice;
    } else if (voice && voice.line === cue.line && voice.file === seg.id) {
      pos = voice;
    }
    return { kind: "karaoke", words: seg.words, now: pos.now, said: pos.said, voiced: true };
  }
  const parts = cue.display !== null ? cue.parts : splitCaption(cue.spoken ?? cue.caption);
  let part = 0;
  if (playing) {
    part = partAt(parts, clock?.token === playing.token ? clock.ms : playing.offsetMs, playing.totalMs);
  } else if (clock?.line === cue.line) {
    part = partAt(parts, clock.ms, clock.totalMs);
  }
  return { kind: "text", text: parts[Math.min(part, parts.length - 1)] ?? "", voiced: true };
}

/**
 * What the mushaf line marks and which word the large card shows (1-based
 * word numbers; empty / null outside a running lesson and in exercises,
 * where the mushaf line is not on screen).
 */
export function stageMarks(seq: AutoplaySequence, state: AutoplayState): { marked: number[]; focus: number | null } {
  const none = { marked: [], focus: null };
  if (!state.started || state.phase === "idle" || state.phase === "finished") return none;
  const step = seq.steps[state.idx];
  if (!step || step.kind === "exercise") return none;
  // A word step is about its word, the imam reciting it or not.
  if (step.kind === "recite_word" && step.word) return { marked: [step.word], focus: step.word };
  // The imam recites the ayah (and its settle pause): his current word only.
  // A compose step's recitation is its own word, the composition on screen.
  const here = state.plan[state.at];
  if (state.activity?.kind === "recite" || (here?.t === "settle" && here.after === "recite")) {
    return step.kind === "compose" && step.word ? { marked: [step.word], focus: step.word } : none;
  }
  // A step shown paused (‹ Sebelumnya / Berikutnya › while paused) points
  // at no line yet: it is about what its first line is about.
  const cue = captionCue(seq, state) ?? step.cues[0] ?? null;
  if (!cue) return none;
  // A shared line ("Kita lanjutkan.") keeps the explained word's card (or its
  // composition), and highlights nothing.
  if (cue.line.startsWith("shared:")) {
    return { marked: [], focus: step.kind === "explain" || step.kind === "compose" ? (step.cues[0]?.focus ?? null) : null };
  }
  return { marked: cue.highlight, focus: cue.focus };
}

/** The animation on screen: which step's frames, which frame (1-based), and
 *  whether the imam is reciting the result. */
export type StageFrame = { step: "primer" | "compose"; word: number | null; frame: number; recited: boolean };

/**
 * The frame of a primer / compose step to show (null on any other step,
 * before the start and after the end). It follows the plan: the line being
 * said (or the one a shared line like "Kita lanjutkan." comes before), the
 * line that just ended while its settle pause runs, the last frame
 * ("recited") while the imam recites the joined word and after. A step shown
 * paused before its first line shows its first frame.
 */
export function stageFrame(seq: AutoplaySequence, state: AutoplayState): StageFrame | null {
  if (!state.started || state.phase === "idle" || state.phase === "finished") return null;
  const step = seq.steps[state.idx];
  if (!step || (step.kind !== "primer" && step.kind !== "compose") || !step.frames) return null;
  const last = step.frames;
  const frameOf = (c: number) => step.cues[c]?.frame ?? 1;
  const plan = state.plan;
  const sayOf = (i: number) => {
    const a = plan[i];
    return a?.t === "say" && "c" in a.ref ? a.ref.c : null;
  };
  const word = step.word ?? null;
  const reciting = (i: number) => {
    const a = plan[i];
    return a?.t === "recite" || a?.t === "gap" || (a?.t === "settle" && a.after === "recite");
  };
  if (state.at >= plan.length) return { step: step.kind, word, frame: last, recited: step.kind === "compose" };
  if (reciting(state.at)) return { step: step.kind, word, frame: last, recited: true };
  const here = sayOf(state.at);
  if (here !== null) return { step: step.kind, word, frame: frameOf(here), recited: false };
  // A settle pause after a line, or a shared line: the frame of the step's
  // line before it, else the one after it.
  for (let i = state.at - 1; i >= 0; i--) {
    const c = sayOf(i);
    if (c !== null) return { step: step.kind, word, frame: frameOf(c), recited: false };
    if (reciting(i)) return { step: step.kind, word, frame: last, recited: true };
  }
  for (let i = state.at + 1; i < plan.length; i++) {
    const c = sayOf(i);
    if (c !== null) return { step: step.kind, word, frame: frameOf(c), recited: false };
  }
  return { step: step.kind, word, frame: 1, recited: false };
}

/** The text a polite live region announces for the stage right now ("" =
 *  nothing). `voiced`: narration audio is speaking this line. */
export function srAnnouncement(seq: AutoplaySequence, state: AutoplayState, voiced: boolean): string {
  if (voiced || state.activity?.kind === "recite") return "";
  const ref = state.caption;
  if (ref === "step") return "";
  // Feedback the exercise's own status box announces already.
  if ("s" in ref && (ref.s === "correct" || ref.s === "revealed")) return "";
  const cue = captionCue(seq, state);
  if (!cue) return "";
  // A recitation step's lead line, shown while the imam recites (caption-
  // only): announced only when it is read before him, never after him.
  if (seq.steps[state.idx]?.recite && "c" in ref && ref.c === 0 && state.activity?.kind !== "read") return "";
  // The display without its Arabic ("kasrah, karena…"); an older manifest's
  // spoken text; without a manifest (no Indonesian narration for this
  // locale) the engine's caption, which has no Arabic.
  if (cue.display !== null) return withoutArabic(cue.display);
  return cue.spoken ?? cue.caption;
}
