import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AudioLoading,
  IDLE_PRELOAD_MAX_MS,
  idlePreloadUrl,
  LOADING_SHOW_MS,
  LOADING_SLOW_MS,
  loadingStage,
  mediaLoading,
  type MediaEventType,
  savesData,
  watchLoading,
} from "./loading";

// Never a silent wait (operator 2026-10-11, narration rule 19): what the stage says while the
// narrator's voice or the imam's recitation loads, and when.

describe("loading thresholds", () => {
  it("are the operator's: a line after 0.6 s, what to do after 8 s", () => {
    expect(LOADING_SHOW_MS).toBe(600);
    expect(LOADING_SLOW_MS).toBe(8000);
  });

  it("says nothing for a fast load, then names it, then says what to do", () => {
    const l: AudioLoading = { kind: "narration", sinceMs: 10_000 };
    expect(loadingStage(null, 99_999)).toBe("quiet");
    expect(loadingStage(l, 10_000)).toBe("quiet");
    expect(loadingStage(l, 10_000 + LOADING_SHOW_MS - 1)).toBe("quiet");
    expect(loadingStage(l, 10_000 + LOADING_SHOW_MS)).toBe("loading");
    expect(loadingStage(l, 10_000 + LOADING_SLOW_MS - 1)).toBe("loading");
    expect(loadingStage(l, 10_000 + LOADING_SLOW_MS)).toBe("slow");
    expect(loadingStage(l, 10_000 + 60_000)).toBe("slow");
  });
});

/** Feeds a player's element events through mediaLoading, as the hooks do (one `at` per event). */
function run(kind: "narration" | "recitation", events: [MediaEventType, number, boolean?][]) {
  let l: AudioLoading | null = null;
  const seen: (AudioLoading | null)[] = [];
  for (const [type, nowMs, ready] of events) {
    l = mediaLoading(l, type, { kind, nowMs, ready });
    seen.push(l);
  }
  return seen;
}

describe("a player's loading value (the hooks' state transitions)", () => {
  it("a fresh file: loading from its start until it is heard", () => {
    // Chromium on a file not in cache: play → waiting → playing.
    const [play, waiting, playing] = run("narration", [
      ["play", 1000],
      ["waiting", 1005],
      ["playing", 2400],
    ]);
    expect(play).toEqual({ kind: "narration", sinceMs: 1000 });
    // The stall that follows the ask keeps the ask's clock (same object: no re-render).
    expect(waiting).toBe(play);
    expect(playing).toBeNull();
  });

  it("a file already buffered (cached, preloaded, resumed): never loading", () => {
    const seen = run("recitation", [
      ["play", 1000, true],
      ["playing", 1001, true],
    ]);
    expect(seen).toEqual([null, null]);
  });

  it("a stall mid-file: loading again from the stall until it plays on", () => {
    const seen = run("recitation", [
      ["play", 1000],
      ["playing", 1300],
      ["waiting", 5000],
      ["playing", 9000],
    ]);
    expect(seen[1]).toBeNull();
    expect(seen[2]).toEqual({ kind: "recitation", sinceMs: 5000 });
    expect(seen[3]).toBeNull();
  });

  it("a seek to a word that is not buffered (no new play event): loading until it plays", () => {
    // The imam's whole ayah plays, then playWord seeks while it plays: only "waiting" fires.
    const seen = run("recitation", [
      ["play", 0, true],
      ["playing", 1, true],
      ["waiting", 4000],
      ["playing", 4700],
    ]);
    expect(seen.map((l) => l?.sinceMs ?? null)).toEqual([null, null, 4000, null]);
  });

  it("every pause, end, error or new file ends a load", () => {
    for (const end of ["pause", "ended", "error", "emptied"] as const) {
      const [, after] = run("narration", [
        ["play", 0],
        [end, 50],
      ]);
      expect(after, end).toBeNull();
    }
  });

  it("the next file starts its own clock (a stopped file's load does not carry over)", () => {
    // stop() pauses; the next line sets a new src (emptied), then plays.
    const seen = run("narration", [
      ["play", 0],
      ["pause", 300],
      ["emptied", 301],
      ["play", 302],
    ]);
    expect(seen[3]).toEqual({ kind: "narration", sinceMs: 302 });
  });
});

describe("watchLoading (fake timers)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports 'loading' at 0.6 s and 'slow' at 8 s, nothing before", () => {
    const stages: string[] = [];
    watchLoading({ kind: "narration", sinceMs: 0 }, 0, (s) => stages.push(s));
    vi.advanceTimersByTime(LOADING_SHOW_MS - 1);
    expect(stages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(stages).toEqual(["loading"]);
    vi.advanceTimersByTime(LOADING_SLOW_MS - LOADING_SHOW_MS - 1);
    expect(stages).toEqual(["loading"]);
    vi.advanceTimersByTime(1);
    expect(stages).toEqual(["loading", "slow"]);
    vi.advanceTimersByTime(60_000);
    expect(stages).toEqual(["loading", "slow"]);
  });

  it("stops when the sound plays (its stop function), so a quick load says nothing", () => {
    const stages: string[] = [];
    const stop = watchLoading({ kind: "recitation", sinceMs: 0 }, 0, (s) => stages.push(s));
    vi.advanceTimersByTime(400);
    stop();
    vi.advanceTimersByTime(20_000);
    expect(stages).toEqual([]);
  });

  it("a load already under way when watched: its current stage on the next tick, never synchronously", () => {
    const stages: string[] = [];
    // Seen 5 s into the load (e.g. the stage re-rendered): "loading" at once, "slow" 3 s later.
    watchLoading({ kind: "narration", sinceMs: 1000 }, 6000, (s) => stages.push(s));
    expect(stages).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(stages).toEqual(["loading"]);
    vi.advanceTimersByTime(2999);
    expect(stages).toEqual(["loading"]);
    vi.advanceTimersByTime(1);
    expect(stages).toEqual(["loading", "slow"]);
    // Past 8 s already: straight to "slow".
    const late: string[] = [];
    watchLoading({ kind: "narration", sinceMs: 0 }, 9000, (s) => late.push(s));
    vi.advanceTimersByTime(0);
    expect(late).toEqual(["slow"]);
  });
});

describe("idle preload of the first line (before Mulai)", () => {
  const first = { url: "/belajar/media/narration/kang-nandar/shared/start.mp3", ms: 23_249 };

  it("warms the first line, also the 23 s shared:start (≈ 186 KB at 64 kbps, the same file on every ayah)", () => {
    expect(idlePreloadUrl(first)).toBe(first.url);
    expect(idlePreloadUrl(first, { effectiveType: "4g" })).toBe(first.url);
    expect(idlePreloadUrl({ ...first, ms: IDLE_PRELOAD_MAX_MS })).toBe(first.url);
  });

  it("never when there is none, the line is long, or the browser asks to save data", () => {
    expect(idlePreloadUrl(null)).toBeNull();
    expect(idlePreloadUrl({ ...first, ms: IDLE_PRELOAD_MAX_MS + 1 })).toBeNull();
    expect(idlePreloadUrl(first, { saveData: true })).toBeNull();
    expect(idlePreloadUrl(first, { effectiveType: "2g" })).toBeNull();
    expect(idlePreloadUrl(first, { effectiveType: "slow-2g" })).toBeNull();
  });
});

describe("the browser asks to save data (savesData: the idle warm and the look-ahead, lookahead.ts)", () => {
  it("Data Saver, or a 2G-class connection", () => {
    expect(savesData({ saveData: true })).toBe(true);
    expect(savesData({ effectiveType: "2g" })).toBe(true);
    expect(savesData({ effectiveType: "slow-2g" })).toBe(true);
    expect(savesData({ saveData: true, effectiveType: "4g" })).toBe(true);
  });

  it("not otherwise, nor where the browser says nothing (Safari, Firefox: no navigator.connection)", () => {
    expect(savesData(undefined)).toBe(false);
    expect(savesData(null)).toBe(false);
    expect(savesData({})).toBe(false);
    expect(savesData({ saveData: false, effectiveType: "3g" })).toBe(false);
    expect(savesData({ effectiveType: "4g" })).toBe(false);
  });
});
