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
 * A karaoke caption carries each word's emphasis (operator 2026-10-11,
 * narration rule 18: its meanings, the term taught, a harakah's sound),
 * found in the line's display text and matched to its words
 * (src/lib/emphasis.ts alignEmphasis) here in the browser: the manifest,
 * the narration and the audio stay as they are. A text caption carries its
 * part's slice of the whole line's emphasis (partEmphasis): a caption
 * emphasises every meaning of its line (operator 2026-10-13, plan L22; its
 * first one only until then), a quiz explanation its answer and its
 * meanings; and what a quotation comes after ("Terjemahannya:") may stand in
 * the part before, so a part is never read alone.
 *
 * A LESSON-MAP line (operator 2026-10-13, plan L23: what an ayah brings, what
 * it taught) is a list read beside its card, and on a phone the card needs
 * the room: its karaoke caption shows ONE ≤180-character part at a time —
 * the part with the word being said, its words lit as on any karaoke caption
 * (karaokeParts) — as a text caption does, instead of the whole line (ayah
 * 2's opening is three sentences, a dozen rows on a 390px screen).
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
 * screen is said over. The last line is said over the last frame — the joined
 * word — which stays to the step's end. The imam does not recite the word
 * again there (operator 2026-10-13, plan L24: he said it when its step
 * opened) — except an ayah's last word, after the line that says he stops on
 * it: while he recites it (and in his settle pause), the last frame, "recited".
 *
 * An example beat (stageExample; operator 2026-10-12, plan L20: "each
 * explanation should be followed by examples (visual + voice)"): which beat
 * of the step is on screen — while the imam recites it, in the pause before
 * its second hearing ("Pelan") and in the pause after it; on a concept's
 * example step also before its first beat and after its last ("Tunggu saya",
 * a paused step) — whether he is reciting it now, and whether its recording
 * failed. The mushaf line marks the example's word when it is this ayah's;
 * a composition keeps the frame the beat belongs to (its `base` frame).
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
  parseLineId,
  partAt,
  viewAutoplay,
  withoutArabic,
  type Activity,
  type AutoplaySequence,
  type AutoplayState,
  type Cue,
  type ExampleBeat,
  type KaraokeWord,
} from "@/lib/autoplay";
import { alignEmphasis, partEmphasis, type Emphasis, type EmphasisKind } from "@/lib/emphasis";
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
  /** `emphasis`: the part's spans (offsets in `text`). */
  | { kind: "text"; text: string; emphasis: readonly Emphasis[]; voiced: boolean }
  /** `emph[i]`: what word i emphasises, or null. */
  | { kind: "karaoke"; words: readonly KaraokeWord[]; emph: readonly (EmphasisKind | null)[]; now: number; said: number; voiced: true };

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
  // An example beat's caption is no narration line.
  return "s" in ref ? (seq.shared[ref.s] ?? null) : null;
}

/** The example beat on screen: the beat, whether the imam is reciting it right now, and whether
 *  its recording could not be played (it is then shown a moment longer, and the lesson goes on). */
export type StageExampleView = { beat: ExampleBeat; reciting: boolean; failed: boolean };

/**
 * The example beat of the current step to show, or null (rules: the head of this file). It
 * follows the plan: the beat being recited; the one just recited while its pause runs, or while
 * the gap before its second hearing runs; on a concept's example step — which is nothing but its
 * beats — the next one still to come (a paused step, "Kita lanjutkan."), else its last.
 */
export function stageExample(seq: AutoplaySequence, state: AutoplayState): StageExampleView | null {
  if (!state.started || state.phase === "idle" || state.phase === "finished") return null;
  const step = seq.steps[state.idx];
  const beats = step?.examples;
  if (!beats?.length) return null;
  const plan = state.plan;
  const at = (i: number) => {
    const a = plan[i];
    return a?.t === "example" ? a : null;
  };
  const here = plan[state.at];
  let a = at(state.at);
  if (!a && here?.t === "settle" && here.after === "example") a = at(state.at - 1);
  if (!a && here?.t === "hold" && at(state.at - 1) && at(state.at + 1)) a = at(state.at - 1);
  if (!a && step.kind === "example") {
    for (let i = state.at; i < plan.length && !a; i++) a = at(i);
    for (let i = Math.min(state.at, plan.length) - 1; i >= 0 && !a; i--) a = at(i);
  }
  const beat = a ? beats[a.x] : step.kind === "example" ? beats[0] : undefined;
  if (!beat) return null;
  const act = state.activity;
  const reciting = act?.kind === "recite" && act.target !== "ayah" && act.example === beat.id;
  return { beat, reciting, failed: a?.failed === true };
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

/** The emphasis of each karaoke word of a cue, per audio file: its display text aligned with the
 *  words of all its files at once (a split line's emphasis may start in one part and end in the
 *  next), then cut per file. Once per cue: the caption is rebuilt every frame. */
const KARAOKE_EMPHASIS = new WeakMap<Cue, (EmphasisKind | null)[][]>();
function karaokeEmphasis(cue: Cue): (EmphasisKind | null)[][] {
  let per = KARAOKE_EMPHASIS.get(cue);
  if (!per) {
    const words = cue.audio.flatMap((f) => (f.words ?? []).map(([t]) => t));
    const kinds = cue.display !== null ? alignEmphasis(cue.display, words) : words.map(() => null);
    let at = 0;
    per = cue.audio.map((f) => {
      const from = at;
      at += f.words?.length ?? 0;
      return kinds.slice(from, at);
    });
    KARAOKE_EMPHASIS.set(cue, per);
  }
  return per;
}

/** The words of a caption text: what a karaoke word's text is counted in (a dictionary term is
 *  one karaoke word of several: "huruf jar (حَرْف جَرّ),"). */
const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length;

/**
 * The karaoke words of each caption part of a line, as [from, to) into `words` — or null when
 * the line is one part, or its words do not line up with its parts (a karaoke word across two
 * parts, another count of words): then the whole line is shown, as before. The parts are the
 * cue's own (splitCaption of its display, ≤180 characters, cut at sentence and clause ends); the
 * karaoke words are that display word for word (the pipeline checks a line's tokens join to it).
 */
export function karaokeParts(parts: readonly string[], words: readonly KaraokeWord[]): [number, number][] | null {
  if (parts.length < 2) return null;
  const out: [number, number][] = [];
  let w = 0;
  for (const part of parts) {
    const from = w;
    let left = wordCount(part);
    while (left > 0 && w < words.length) left -= wordCount(words[w++][0]);
    if (left !== 0 || w === from) return null;
    out.push([from, w]);
  }
  return w === words.length ? out : null;
}

/** Is `line` a lesson-map line ("…:map:new", "…:map:learnt", "…:map:later", "…:learned"), whose
 *  karaoke caption goes part by part? */
const byParts = (line: string) => {
  const id = parseLineId(line);
  return id?.kind === "ayah" && (id.part.startsWith("map:") || id.part === "learned");
};

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
    return textCaption(parts, part, false);
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
    const emph = karaokeEmphasis(cue)[cue.audio.indexOf(seg)] ?? seg.words.map(() => null);
    // A lesson-map line (one file): the part with the word being said — the first before any
    // word, the last once all are said — with the karaoke position counted inside it.
    const cut = byParts(cue.line) && cue.audio.length === 1 ? karaokeParts(cue.parts, seg.words) : null;
    if (cut) {
      const at = pos.now >= 0 ? pos.now : Math.min(pos.said, seg.words.length) - 1;
      const [from, to] = cut.find(([a, b]) => at >= a && at < b) ?? cut[0];
      return {
        kind: "karaoke",
        words: seg.words.slice(from, to),
        emph: emph.slice(from, to),
        now: pos.now >= from && pos.now < to ? pos.now - from : -1,
        said: Math.max(0, Math.min(pos.said, to) - from),
        voiced: true,
      };
    }
    return { kind: "karaoke", words: seg.words, emph, now: pos.now, said: pos.said, voiced: true };
  }
  const parts = cue.display !== null ? cue.parts : splitCaption(cue.spoken ?? cue.caption);
  let part = 0;
  if (playing) {
    part = partAt(parts, clock?.token === playing.token ? clock.ms : playing.offsetMs, playing.totalMs);
  } else if (clock?.line === cue.line) {
    part = partAt(parts, clock.ms, clock.totalMs);
  }
  return textCaption(parts, part, true);
}

/** The text caption of part `part` of `parts`, with its emphasis — cached per line: the caption
 *  is rebuilt every frame. */
const TEXT_EMPHASIS = new Map<string, Emphasis[][]>();
function textCaption(parts: readonly string[], part: number, voiced: boolean): StageCaption {
  const k = Math.min(part, parts.length - 1);
  const key = parts.join("\n");
  let per = TEXT_EMPHASIS.get(key);
  if (!per) {
    if (TEXT_EMPHASIS.size > 64) TEXT_EMPHASIS.clear();
    per = parts.map((_, i) => partEmphasis(parts, i));
    TEXT_EMPHASIS.set(key, per);
  }
  return { kind: "text", text: parts[k] ?? "", emphasis: per[k] ?? [], voiced };
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
  // An example beat: its word when it is this ayah's (lit as the imam recites it), else the word
  // the step explains. A concept's example has a card of its own (LessonStage), a bentuk dasar
  // its composition.
  const ex = stageExample(seq, state);
  if (ex) {
    const word = ex.beat.word ?? step.word ?? null;
    return { marked: word === null ? [] : [word], focus: ex.beat.of === "base" ? (step.word ?? null) : null };
  }
  // The imam recites the ayah (and its settle pause): his current word only.
  // A compose step's recitation (the ayah's last word) is its own word, the composition on screen.
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
 *  whether the imam is reciting the result (the composition of an ayah's last
 *  word, after its last line; no other step: plan L24). */
export type StageFrame = { step: "primer" | "compose"; word: number | null; frame: number; recited: boolean };

/**
 * The frame of a primer / compose step to show (null on any other step,
 * before the start and after the end). It follows the plan: the line being
 * said (or the one a shared line like "Kita lanjutkan." comes before), the
 * line that just ended while its settle pause runs, and the last frame — a
 * word's joined form — once the step's lines are through ("Tunggu saya"
 * waiting for Lanjut): "recited" while the imam recites it and after, on the
 * one composition that ends with him (an ayah's last word). A step shown
 * paused before its first line shows its first frame.
 */
export function stageFrame(seq: AutoplaySequence, state: AutoplayState): StageFrame | null {
  if (!state.started || state.phase === "idle" || state.phase === "finished") return null;
  const step = seq.steps[state.idx];
  if (!step || (step.kind !== "primer" && step.kind !== "compose") || !step.frames) return null;
  const last = step.frames;
  const frameOf = (c: number) => step.cues[c]?.frame ?? 1;
  const plan = state.plan;
  /** The frame action i is said or recited over: a line's (its cue's), or an example beat's own
   *  (the `base` frame whose bentuk dasar the imam recites); null for anything else. */
  const frameAt = (i: number): number | null => {
    const a = plan[i];
    if (a?.t === "example") return step.examples?.[a.x]?.frame ?? null;
    return a?.t === "say" && "c" in a.ref ? frameOf(a.ref.c) : null;
  };
  const word = step.word ?? null;
  const reciting = (i: number) => {
    const a = plan[i];
    return a?.t === "recite" || a?.t === "gap" || (a?.t === "settle" && a.after === "recite");
  };
  if (state.at >= plan.length) return { step: step.kind, word, frame: last, recited: step.recite !== undefined };
  if (reciting(state.at)) return { step: step.kind, word, frame: last, recited: true };
  const here = frameAt(state.at);
  if (here !== null) return { step: step.kind, word, frame: here, recited: false };
  // A settle pause after a line or an example, the gap before an example's second hearing, or a
  // shared line: the frame of the step's line (or example) before it, else the one after it.
  for (let i = state.at - 1; i >= 0; i--) {
    const f = frameAt(i);
    if (f !== null) return { step: step.kind, word, frame: f, recited: false };
    if (reciting(i)) return { step: step.kind, word, frame: last, recited: true };
  }
  for (let i = state.at + 1; i < plan.length; i++) {
    const f = frameAt(i);
    if (f !== null) return { step: step.kind, word, frame: f, recited: false };
    // "Kita lanjutkan." before the imam's word (resumed there): the joined word, not yet recited.
    if (reciting(i)) return { step: step.kind, word, frame: last, recited: false };
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
