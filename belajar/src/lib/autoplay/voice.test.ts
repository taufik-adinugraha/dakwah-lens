import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioLoading } from "./loading";
import { createNarrationVoice, type NarrationHandlers, type VoiceElement } from "./voice";

// The narration player on a stand-in Audio element (operator 2026-10-12, plan L18; review
// 2026-10-12): a line is played from the copy the page holds when there is one, from the network
// URL when there is none, and a copy that does not play falls back to the network — never to
// silence. Everything the lesson reads from the element is the same either way.

const URL_A = "/belajar/media/narration/kang-nandar/al-fatihah/aaaaaaaaaaaaaaaa.mp3";
const URL_B = "/belajar/media/narration/kang-nandar/al-fatihah/bbbbbbbbbbbbbbbb.mp3";
const COPY_A = "blob:https://dakwah-lens.id/1";

/** An Audio element as the player uses it: the test sends its events and settles its play(). */
class FakeAudio implements VoiceElement {
  currentTime = 0;
  paused = true;
  readyState = 0;
  /** Every value `src` was set to, in order. */
  sources: string[] = [];
  /** The play() calls: the src played, and how to settle the promise. */
  plays: { src: string; resolve: () => void; reject: (e: unknown) => void }[] = [];
  pauses = 0;
  #src: string | null = null;
  #listeners = new Map<string, Set<(e: Event) => void>>();

  get src() {
    return this.#src ?? "";
  }
  set src(v: string) {
    const had = this.#src !== null;
    this.#src = v;
    this.sources.push(v);
    this.readyState = 0;
    // A new file on an element that had one: "emptied" (the load algorithm).
    if (had) this.emit("emptied");
  }
  play() {
    this.paused = false;
    return new Promise<void>((resolve, reject) => this.plays.push({ src: this.src, resolve, reject }));
  }
  pause() {
    this.paused = true;
    this.pauses++;
  }
  getAttribute(name: string) {
    return name === "src" ? this.#src : null;
  }
  removeAttribute(name: string) {
    if (name === "src") this.#src = null;
  }
  addEventListener(type: string, listener: (e: Event) => void) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: (e: Event) => void) {
    this.#listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const l of [...(this.#listeners.get(type) ?? [])]) l(new Event(type));
  }
  listeners() {
    return [...this.#listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

function setup(copies: Record<string, string> = {}) {
  const audio = new FakeAudio();
  const pre = new FakeAudio();
  const held = new Map(Object.entries(copies));
  const heldFailed: string[] = [];
  let loading: AudioLoading | null = null;
  const loadings: (AudioLoading | null)[] = [];
  let announced = 0;
  const voice = createNarrationVoice({
    audio,
    pre,
    setLoading: (next) => {
      loading = next(loading);
      loadings.push(loading);
    },
    announce: () => {
      announced++;
    },
    now: () => 1_000,
    held: (url) => held.get(url) ?? null,
    onHeldFailed: (url) => {
      heldFailed.push(url);
      held.delete(url);
    },
  });
  /** One line's handlers, recorded. */
  const line = () => {
    const log: string[] = [];
    const h: NarrationHandlers = {
      onEnd: () => log.push("end"),
      onError: () => log.push("error"),
      onBlocked: () => log.push("blocked"),
      onInterrupted: () => log.push("interrupted"),
      onTime: (ms) => log.push(`time:${ms}`),
      onPlaying: () => log.push("playing"),
    };
    return { h, log };
  };
  return { audio, pre, voice, held, heldFailed, line, loading: () => loading, loadings, announced: () => announced };
}

const notSupported = () => new DOMException("no supported source", "NotSupportedError");
/** The next task: the retry after a failed copy starts there. */
const nextTask = () => vi.advanceTimersByTimeAsync(0);

describe("the narration voice (voice.ts createNarrationVoice)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no copy held: the network URL, exactly as before — its events are the line's, loading from play to playing", async () => {
    const { audio, voice, line, loading, announced } = setup();
    const { h, log } = line();
    voice.play(URL_A, h);
    expect(audio.sources).toEqual([URL_A]);
    expect(audio.plays.map((p) => p.src)).toEqual([URL_A]);
    expect(audio.currentTime).toBe(0);
    audio.emit("play");
    expect(announced()).toBe(1);
    expect(loading()).toEqual({ kind: "narration", sinceMs: 1_000 });
    audio.readyState = 4;
    audio.emit("playing");
    expect(loading()).toBeNull();
    audio.currentTime = 1.25;
    audio.emit("timeupdate");
    expect(voice.positionMs()).toBe(1250);
    audio.emit("waiting");
    expect(loading()).toEqual({ kind: "narration", sinceMs: 1_000 });
    audio.emit("playing");
    audio.emit("ended");
    expect(log).toEqual(["playing", "time:1250", "playing", "end"]);
    expect(loading()).toBeNull();
    // A late event of a file that is through reports nothing.
    audio.emit("ended");
    audio.emit("error");
    expect(log).toHaveLength(4);
  });

  it("a copy held: the element plays the object URL — and reports the same events, clock and loading", async () => {
    const { audio, voice, line, loading, heldFailed } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    expect(audio.sources).toEqual([COPY_A]);
    expect(audio.plays.map((p) => p.src)).toEqual([COPY_A]);
    audio.emit("play");
    expect(loading()).toEqual({ kind: "narration", sinceMs: 1_000 });
    audio.readyState = 4;
    audio.emit("playing");
    expect(loading()).toBeNull();
    audio.currentTime = 2.5;
    audio.emit("timeupdate");
    expect(voice.positionMs()).toBe(2500);
    audio.emit("ended");
    expect(log).toEqual(["playing", "time:2500", "end"]);
    expect(heldFailed).toEqual([]);
    // The next line has no copy: the network URL.
    voice.play(URL_B, line().h);
    expect(audio.sources).toEqual([COPY_A, URL_B]);
  });

  it("where the file plays from is decided when the line starts: a copy that arrives mid-line changes nothing", async () => {
    const { audio, voice, held, line } = setup();
    voice.play(URL_A, line().h);
    audio.emit("play");
    held.set(URL_A, COPY_A);
    audio.emit("playing");
    audio.emit("timeupdate");
    expect(audio.sources).toEqual([URL_A]);
    // Played again (a replay): now from the copy.
    voice.play(URL_A, line().h);
    expect(audio.sources).toEqual([URL_A, COPY_A]);
  });

  it.each([
    ["the element's error first, then play() rejecting", ["event", "reject"]],
    ["play() rejecting first, then the element's error", ["reject", "event"]],
  ] as const)("a copy that does not play is never silence — %s: the same line from the network URL, once", async (_name, order) => {
    const { audio, voice, line, heldFailed, loading } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    audio.emit("play");
    for (const step of order) {
      if (step === "event") audio.emit("error");
      else audio.plays[0].reject(notSupported());
      await Promise.resolve();
      await Promise.resolve();
    }
    // Reported once (the page lets the copy go), nothing told to the lesson, not restarted yet.
    expect(heldFailed).toEqual([URL_A]);
    expect(log).toEqual([]);
    expect(audio.sources).toEqual([COPY_A]);
    expect(loading()).toBeNull();
    await nextTask();
    // The same line, from the network URL, with the same handlers.
    expect(audio.sources).toEqual([COPY_A, URL_A]);
    expect(audio.plays.map((p) => p.src)).toEqual([COPY_A, URL_A]);
    audio.emit("play");
    expect(loading()).toEqual({ kind: "narration", sinceMs: 1_000 });
    audio.emit("playing");
    audio.currentTime = 0.5;
    audio.emit("timeupdate");
    audio.emit("ended");
    expect(log).toEqual(["playing", "time:500", "end"]);
    expect(heldFailed).toEqual([URL_A]);
  });

  it("…and only if the network URL fails too is the line's onError called (caption-only, as before)", async () => {
    const { audio, voice, line, heldFailed } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    audio.emit("error");
    await nextTask();
    expect(audio.sources).toEqual([COPY_A, URL_A]);
    audio.emit("error");
    audio.plays[1].reject(notSupported());
    await nextTask();
    expect(log).toEqual(["error"]);
    expect(heldFailed).toEqual([URL_A]);
    // No third start.
    expect(audio.plays).toHaveLength(2);
  });

  it("a network file that fails (no copy involved) reports onError at once, as before: no retry", async () => {
    for (const how of ["event", "reject"] as const) {
      const { audio, voice, line, heldFailed } = setup();
      const { h, log } = line();
      voice.play(URL_A, h);
      if (how === "event") audio.emit("error");
      else audio.plays[0].reject(notSupported());
      await nextTask();
      expect(log, how).toEqual(["error"]);
      expect(audio.plays, how).toHaveLength(1);
      expect(heldFailed, how).toEqual([]);
    }
  });

  it("the browser asking for a tap (NotAllowedError) is not a failed copy: onBlocked, the copy kept, no retry", async () => {
    const { audio, voice, line, heldFailed } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    audio.plays[0].reject(new DOMException("tap first", "NotAllowedError"));
    await nextTask();
    expect(log).toEqual(["blocked"]);
    expect(heldFailed).toEqual([]);
    expect(audio.plays).toHaveLength(1);
  });

  it("a play() interrupted by a pause or a new file (AbortError) is routine: nothing reported", async () => {
    const { audio, voice, line, heldFailed } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    audio.plays[0].reject(new DOMException("interrupted", "AbortError"));
    await nextTask();
    expect(log).toEqual([]);
    expect(heldFailed).toEqual([]);
    expect(audio.plays).toHaveLength(1);
  });

  it("stopped while the retry waits (the learner moved on): no second start, nothing reported", async () => {
    const { audio, voice, line } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    const stop = voice.play(URL_A, h);
    audio.emit("error");
    stop();
    await nextTask();
    expect(audio.plays).toHaveLength(1);
    expect(log).toEqual([]);
    expect(audio.paused).toBe(true);
  });

  it("a new line started while the retry of the one before waits: the retry is dropped, the new line plays", async () => {
    const { audio, voice, line } = setup({ [URL_A]: COPY_A });
    const first = line();
    voice.play(URL_A, first.h);
    audio.emit("error");
    const second = line();
    voice.play(URL_B, second.h);
    await nextTask();
    expect(audio.plays.map((p) => p.src)).toEqual([COPY_A, URL_B]);
    audio.emit("playing");
    audio.emit("ended");
    expect(first.log).toEqual([]);
    expect(second.log).toEqual(["playing", "end"]);
  });

  it("another recording starting cuts the line short (onInterrupted) — also while a retry waits; the narration's own start does not", async () => {
    const { audio, voice, line } = setup({ [URL_A]: COPY_A });
    const { h, log } = line();
    voice.play(URL_A, h);
    audio.emit("play");
    voice.otherStarted(audio); // its own start event
    expect(log).toEqual([]);
    voice.otherStarted({});
    expect(log).toEqual(["interrupted"]);
    expect(audio.paused).toBe(true);
    // While a retry waits.
    const again = line();
    voice.play(URL_A, again.h);
    audio.emit("error");
    voice.otherStarted({});
    await nextTask();
    expect(again.log).toEqual(["interrupted"]);
    expect(audio.plays).toHaveLength(2);
    // Nothing playing: another recording's start is none of the narration's business.
    voice.otherStarted({});
    expect(again.log).toEqual(["interrupted"]);
  });

  it("a stopped file's late events report nothing, and start no loading", async () => {
    const { audio, voice, line, loadings } = setup();
    const { h, log } = line();
    const stop = voice.play(URL_A, h);
    stop();
    const n = loadings.length;
    audio.emit("play");
    audio.emit("waiting");
    expect(loadings).toHaveLength(n);
    audio.emit("ended");
    audio.emit("error");
    audio.emit("timeupdate");
    expect(log).toEqual([]);
    expect(voice.positionMs()).toBeNull();
  });

  it("preload: the copy held when there is one, else the network URL; the same file is not set twice; null leaves it alone", () => {
    const { pre, voice, held } = setup({ [URL_A]: COPY_A });
    voice.preload(null);
    expect(pre.sources).toEqual([]);
    voice.preload(URL_A);
    voice.preload(URL_A);
    expect(pre.sources).toEqual([COPY_A]);
    voice.preload(URL_B);
    voice.preload(URL_B);
    expect(pre.sources).toEqual([COPY_A, URL_B]);
    // The copy of A was let go: its network URL.
    held.delete(URL_A);
    voice.preload(URL_A);
    expect(pre.sources).toEqual([COPY_A, URL_B, URL_A]);
    // The preload element is never played.
    expect(pre.plays).toEqual([]);
  });

  it("owns its element only; dispose removes every listener, stops and clears both elements", () => {
    const { audio, pre, voice, line } = setup();
    expect(voice.owns(audio)).toBe(true);
    expect(voice.owns(pre)).toBe(false);
    expect(voice.owns(null)).toBe(false);
    const { h, log } = line();
    voice.play(URL_A, h);
    voice.preload(URL_B);
    expect(audio.listeners()).toBeGreaterThan(0);
    voice.dispose();
    expect(audio.listeners()).toBe(0);
    expect(audio.paused).toBe(true);
    expect([audio.getAttribute("src"), pre.getAttribute("src")]).toEqual([null, null]);
    audio.emit("ended");
    expect(log).toEqual([]);
  });
});
