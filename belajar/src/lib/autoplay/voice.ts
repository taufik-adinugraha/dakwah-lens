/**
 * The narration voice's player, without React or the DOM: what src/hooks/useNarrationPlayer.ts
 * runs on its two Audio elements. One element plays one same-origin narration file at a time; a
 * second, muted one warms the next file and is never played. Kept apart from the hook so that
 * what it does is unit-tested with a stand-in element (voice.test.ts).
 *
 * WHERE A FILE IS PLAYED FROM (operator 2026-10-12; plan L18; review 2026-10-12) — `held(url)`:
 * the object URL of the copy of that file the page fetched ahead and keeps (prefetch.ts), or null.
 * - A copy is held: the element is pointed at the object URL. The same bytes as the network
 *   file, already in the page: nothing is requested, on any browser.
 * - None is (not fetched, still coming, failed, let go): the network URL, exactly as before the
 *   look-ahead.
 * Decided when the line starts, never changed while it plays. Everything the lesson reads is the
 * element's own and the same either way: its events (play, waiting, playing, ended, error), its
 * currentTime (the caption clock, the karaoke), its paused state. Nothing compares the element's
 * src with a manifest URL: the file is known by the handlers of its play() call.
 *
 * A COPY THAT DOES NOT PLAY IS NEVER SILENCE — when the element fails on an object URL (its
 * "error", or play() rejecting other than for a pause or the autoplay policy), the copy is
 * reported (`onHeldFailed`: the page lets it go and does not fetch it again) and the SAME line is
 * started once more from the network URL, with the same handlers; only if that fails too is the
 * line's onError called (the lesson then shows it caption-only, as before). The second start
 * waits for the next task: the failing load's own "error" event and play() rejection are both
 * through by then, so neither can be taken for the new load's.
 *
 * Loading (operator 2026-10-11, narration rule 19) is unchanged: from "play" of a file this
 * player was asked for until "playing", and again while it stalls ("waiting") — loading.ts
 * mediaLoading over the element's events. A copy held is "playing" within a moment, so its status
 * never shows; a line retried from the network loads as any network line does.
 */
import { type AudioLoading, mediaLoading, type MediaEventType } from "./loading";

/** What one narration file reports back (each play() call gets its own). */
export type NarrationHandlers = {
  /** The file played to its end. */
  onEnd: () => void;
  /** The file could not be loaded or decoded. */
  onError: () => void;
  /** The browser wants a (new) tap before sound may play. */
  onBlocked: () => void;
  /** Another recording on the page started (e.g. the learner pressed
   *  "Dengarkan kata" in an exercise) and cut this file short. */
  onInterrupted: () => void;
  /** Playback position in ms (~4×/s, from timeupdate) for the caption clock. */
  onTime?: (ms: number) => void;
  /** Sound is flowing: the file started, or went on after a stall ("playing"). */
  onPlaying?: () => void;
};

/** The part of HTMLAudioElement the player uses. */
export type VoiceElement = {
  src: string;
  currentTime: number;
  readonly paused: boolean;
  readonly readyState: number;
  play(): Promise<void>;
  pause(): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
};

/** The copies of narration files the page holds (prefetch.ts), as the player uses them. */
export type NarrationCopies = {
  /** The object URL of the copy held of narration file `url`, or null. */
  held?: (url: string) => string | null;
  /** The copy of `url` did not play: the player goes on from the network URL. */
  onHeldFailed?: (url: string) => void;
};

export type NarrationVoice = {
  /** Plays `url` from its start; returns the function that stops it. */
  play(url: string, h: NarrationHandlers): () => void;
  /** Starts fetching `url` ahead of time on the muted element (same-origin narration only). */
  preload(url: string | null): void;
  /** `el` is this narration's element (the lesson's own sound, not the learner's). */
  owns(el: unknown): boolean;
  /** Where the file playing now is, in ms (null when none plays). */
  positionMs(): number | null;
  /** Another recording on the page started (its element): stops the narration. */
  otherStarted(el: unknown): void;
  /** Removes the listeners and stops (the hook's unmount). */
  dispose(): void;
};

/** The element events that start or end a load (loading.ts mediaLoading). */
const LOAD_EVENTS: readonly MediaEventType[] = ["play", "waiting", "playing", "pause", "ended", "error", "emptied"];

/** HTMLMediaElement.HAVE_FUTURE_DATA. */
const HAVE_FUTURE_DATA = 3;

const named = (e: unknown, name: string) => e instanceof DOMException && e.name === name;
/** play() rejects with AbortError whenever a pause or a new file interrupts it: routine. */
const isAbort = (e: unknown) => named(e, "AbortError");
/** play() rejects with NotAllowedError when the browser wants a (new) tap first. */
const isBlocked = (e: unknown) => named(e, "NotAllowedError");

/** One start of a file on the element: the line's handlers, its URL, and what the element was
 *  pointed at (the copy's object URL, or the URL itself). */
type Attempt = { h: NarrationHandlers; url: string; src: string; started: boolean };

export function createNarrationVoice(
  deps: {
    /** The element that plays (kept for the whole visit by the hook). */
    audio: VoiceElement;
    /** The muted element that only preloads. */
    pre: VoiceElement;
    /** The player's loading value (React's setState: the next value from the previous one). */
    setLoading: (next: (prev: AudioLoading | null) => AudioLoading | null) => void;
    /** The element started playing: tell the page (AUDIO_START_EVENT), so every other player pauses. */
    announce: () => void;
    now?: () => number;
  } & NarrationCopies,
): NarrationVoice {
  const a = deps.audio;
  const pre = deps.pre;
  const now = deps.now ?? (() => Date.now());
  /** The file playing now (or about to: a retry waiting for its task); null when none. */
  let current: Attempt | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const cancelRetry = () => {
    if (retry !== null) clearTimeout(retry);
    retry = null;
  };
  /** The attempt the element's events belong to: one that has been started. */
  const live = () => (current?.started ? current : null);

  const begin = (at: Attempt) => {
    at.started = true;
    a.src = at.src;
    a.currentTime = 0;
    void a.play().catch((e: unknown) => {
      if (current !== at || isAbort(e)) return;
      if (isBlocked(e)) {
        current = null;
        at.h.onBlocked();
        return;
      }
      failed(at);
    });
  };

  /** Attempt `at` could not be loaded or decoded (the element's "error", or its play() rejected). */
  const failed = (at: Attempt) => {
    if (current !== at) return;
    if (at.src !== at.url) {
      // The copy held did not play: the same line from the network URL, as before the look-ahead
      // (never silence). On the next task: see the header.
      deps.onHeldFailed?.(at.url);
      const next: Attempt = { h: at.h, url: at.url, src: at.url, started: false };
      current = next;
      retry = setTimeout(() => {
        retry = null;
        if (current === next) begin(next);
      }, 0);
      return;
    }
    current = null;
    at.h.onError();
  };

  const onEnded = () => {
    const at = live();
    if (!at) return;
    current = null;
    at.h.onEnd();
  };
  const onError = () => {
    const at = live();
    if (at) failed(at);
  };
  const onTime = () => live()?.h.onTime?.(a.currentTime * 1000);
  const onPlay = () => deps.announce();
  // Loading: only a file this player was asked to play starts one (a stopped file's late
  // "play" does not); every pause, end, error or new file ends it.
  const onLoad = (e: Event) => {
    const type = e.type as MediaEventType;
    if ((type === "play" || type === "waiting") && !current) return;
    const at = { kind: "narration" as const, nowMs: now(), ready: a.readyState >= HAVE_FUTURE_DATA };
    deps.setLoading((prev) => mediaLoading(prev, type, at));
    if (type === "playing") live()?.h.onPlaying?.();
  };

  a.addEventListener("ended", onEnded);
  a.addEventListener("error", onError);
  a.addEventListener("timeupdate", onTime);
  a.addEventListener("play", onPlay);
  for (const t of LOAD_EVENTS) a.addEventListener(t, onLoad);

  return {
    play(url, h) {
      cancelRetry();
      const at: Attempt = { h, url, src: deps.held?.(url) ?? url, started: false };
      current = at;
      begin(at);
      return () => {
        if (current?.h === h) {
          current = null;
          cancelRetry();
        }
        a.pause();
      };
    },
    preload(url) {
      if (!url) return;
      const src = deps.held?.(url) ?? url;
      if (pre.getAttribute("src") === src) return;
      pre.src = src;
    },
    owns(el) {
      return el !== null && el === a;
    },
    positionMs() {
      return current && !a.paused ? a.currentTime * 1000 : null;
    },
    otherStarted(el) {
      if (el === a || a.paused) return;
      const at = current;
      current = null;
      cancelRetry();
      a.pause();
      at?.h.onInterrupted();
    },
    dispose() {
      for (const t of LOAD_EVENTS) a.removeEventListener(t, onLoad);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      current = null;
      cancelRetry();
      a.pause();
      a.removeAttribute("src");
      pre.removeAttribute("src");
    },
  };
}
