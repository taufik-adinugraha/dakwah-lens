import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The spare element that fetches the NEXT ayah's recitation ahead (operator 2026-10-11;
// src/lib/autoplay/warm.ts): what warmRecitation() asks the browser for. No DOM here: a stand-in
// for the browser's Audio records what is set on it. (The stage's own element is driven by the
// hook, inside React: its early fetch is checked in a real browser, scripts/ci/screenshots.mjs.)

const F2 = "https://everyayah.com/data/Alafasy_128kbps/001002.mp3";
const F3 = "https://everyayah.com/data/Alafasy_128kbps/001003.mp3";

/** Every element made, and every address set on it, in order. */
let made: FakeAudio[] = [];

class FakeAudio {
  muted = false;
  preload = "";
  played = 0;
  /** Each `src` set (a media element loads on every set, even of the same address). */
  sets: string[] = [];
  constructor() {
    made.push(this);
  }
  set src(v: string) {
    this.sets.push(v);
  }
  get src() {
    return this.sets.at(-1) ?? "";
  }
  getAttribute(name: string) {
    return name === "src" ? (this.sets.at(-1) ?? null) : null;
  }
  play() {
    this.played++;
    return Promise.resolve();
  }
}

/** The module fresh, as on a new visit (its spare element and its list of files asked for). */
async function freshPlayer() {
  vi.resetModules();
  return import("./useSegmentPlayer");
}

beforeEach(() => {
  made = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("warmRecitation: the next ayah's recording on the spare element", () => {
  it("makes no element and fetches nothing until it is called (a page view alone)", async () => {
    await freshPlayer();
    expect(made).toEqual([]);
  });

  it("fetches the file on one muted element that loads ahead and never plays", async () => {
    const { warmRecitation } = await freshPlayer();
    warmRecitation(F2);
    expect(made).toHaveLength(1);
    const [spare] = made;
    expect(spare.preload).toBe("auto");
    expect(spare.muted).toBe(true);
    expect(spare.sets).toEqual([F2]);
    expect(spare.played).toBe(0);
  });

  it("asks for each file once in a visit: the recap replayed, or the ayah come back to", async () => {
    const { warmRecitation } = await freshPlayer();
    warmRecitation(F2);
    warmRecitation(F2);
    // The next ayah's recap: its own next file, on the same element.
    warmRecitation(F3);
    // Back on the first ayah, at its recap again: F2 was asked for before.
    warmRecitation(F2);
    warmRecitation(F3);
    expect(made).toHaveLength(1);
    expect(made[0].sets).toEqual([F2, F3]);
    expect(made[0].played).toBe(0);
  });
});
