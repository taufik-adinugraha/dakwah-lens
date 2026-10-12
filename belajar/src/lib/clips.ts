/**
 * The imam's voice of an example (operator 2026-10-12: "in explanation, for example when explaining
 * dhommah, kasrah, etc provide example + additional voice. e.g ismu (read by voice + show visual)
 * when combined with harf jar, it becomes ismi (read by voice + visual). in principel, each
 * explanation should be followed by examples (visual + voice)" — "not only for harakah, but also for
 * all rules"). Pure: no React, no DOM, unit-tested in clips.test.ts.
 *
 * - The data: library.json `clips`, one per example the static pages show, keyed by the word's
 *   location — Mishary Alafasy's EveryAyah file of that ayah and [start, end) of the word in it,
 *   from the pinned quran-align timings the lessons use (pipeline/clips.py, validate_clips.py).
 *   The server components that draw examples (ConceptCard, HarakatChart, WordParts) pick each
 *   example's clip here and hand the browser only that {url, start, end}.
 * - The player (src/hooks/useClipPlayer.ts, one Audio element per page): its state machine and
 *   what each button shows, below.
 */
import type { Clip } from "@/content/schema";

export type { Clip };

const WORD_LOC = /^\d{1,3}:\d{1,3}:\d{1,3}$/;
/** terms.ts QREF, repeated so the browser's player (useClipPlayer, ClipButton) does not pull the
 *  whole markup module into the page's script; clips.test.ts keeps the two equal. */
export const CLIP_QREF = /^q:(\d{1,3}):(\d{1,3}):(\d{1,3})(?:-(\d{1,3})|\/(\d{1,2})|#(\d{1,2}))?$/;

/**
 * The clip key of something a page shows as an example: a word loc ("1:1:1") or a word q-ref
 * ("q:55:78:2") is that word; a letter q-ref ("q:1:1:1#1", a Harakat sign's example letter) is the
 * word it is cut from — a letter alone is never recited; a run ("q:112:1:2-4") is the run. A QAC
 * segment ("q:1:1:1/1", the bi- of bismi) is null: a part of a word is never recited on its own,
 * and the joined word's clip voices it. pipeline/clips.py key_of is the same rule.
 */
export function clipKey(ref: string): string | null {
  if (WORD_LOC.test(ref)) return ref;
  const m = CLIP_QREF.exec(ref);
  if (!m || m[5]) return null;
  const loc = `${m[1]}:${m[2]}:${m[3]}`;
  return m[4] ? `${loc}-${m[4]}` : loc;
}

/** The clip of `ref` (see clipKey), or null when the example has none. */
export function clipFor(clips: Readonly<Record<string, Clip>>, ref: string): Clip | null {
  const key = clipKey(ref);
  return key ? (clips[key] ?? null) : null;
}

// ───────────────────────── the player (one Audio element per page)

/** Where the page's clip player stands: nothing asked for (or it ended, or another player took
 *  over), playing `key` (asked for: loading until the imam is heard, then heard), or `key` could
 *  not be loaded or decoded. */
export type ClipStatus = "idle" | "playing" | "failed";
export type ClipState = { key: string | null; status: ClipStatus };
export const CLIP_IDLE: ClipState = { key: null, status: "idle" };

export type ClipEvent =
  /** A press plays `key`: the first, or one replacing another clip (the page has one element, so
   *  starting one stops the other). */
  | { type: "start"; key: string }
  /** A press on the clip that plays; or the page lets go of the player. */
  | { type: "stop" }
  /** Playback reached the clip's end (or the file's). */
  | { type: "end" }
  /** The recording could not be loaded or decoded while it was asked to play. */
  | { type: "error" }
  /** Another player of the module started (the lesson, the ayah popup, the narration): it pauses
   *  this one (src/hooks/useSegmentPlayer.ts AUDIO_START_EVENT). */
  | { type: "interrupt" };

export function clipReducer(s: ClipState, e: ClipEvent): ClipState {
  switch (e.type) {
    case "start":
      return { key: e.key, status: "playing" };
    case "error":
      // Only a play under way can fail; a stale error after a stop stays quiet.
      return s.status === "playing" ? { key: s.key, status: "failed" } : s;
    case "stop":
    case "end":
    case "interrupt":
      return s.status === "idle" && s.key === null ? s : CLIP_IDLE;
  }
}

/** What pressing the button of `key` does: stop it while it plays, otherwise play it (from idle,
 *  after a failure — a retry — or while another clip plays, which then stops). */
export function pressAction(s: ClipState, key: string): "play" | "stop" {
  return s.key === key && s.status === "playing" ? "stop" : "play";
}

/** Has playback at `ms` (the element's currentTime × 1000) reached the clip's end? */
export function atClipEnd(clip: Clip, ms: number): boolean {
  return ms >= clip.end;
}

/** Where the element must stand before it plays the clip, in seconds (HTMLMediaElement.currentTime). */
export function clipStartSeconds(clip: Clip): number {
  return clip.start / 1000;
}

/** Is the element (at `ms`) outside the clip, so it must seek to its start? A play resumed inside
 *  the clip never happens (each press plays the clip from its start), so anywhere but its first
 *  `slackMs` is outside. */
export function needsSeek(clip: Clip, ms: number, slackMs = 40): boolean {
  return ms < clip.start - slackMs || ms > clip.start + slackMs;
}

/** What the loading line says (src/lib/autoplay/loading.ts stages, as the ayah popup's). */
export type ClipNotice = "loading" | "slow" | null;

/** What one example's button shows: its control (play, stop, retry) and its status line. */
export type ClipView = { mode: "play" | "stop" | "retry"; line: "loading" | "slow" | "failed" | null };

export function clipView(s: ClipState, key: string, notice: ClipNotice): ClipView {
  if (s.key !== key || s.status === "idle") return { mode: "play", line: null };
  if (s.status === "failed") return { mode: "retry", line: "failed" };
  return { mode: "stop", line: notice };
}
