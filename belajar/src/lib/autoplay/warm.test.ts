import { describe, expect, it } from "vitest";

import { type ConnectionHints, idlePreloadUrl, savesData } from "./loading";
import type { NavIntent, StepKind } from "./types";
import { askOnce, NEXT_AYAH_WARM_STEPS, recitationWarmPlan, type RecitationWarmInput } from "./warm";

// The imam's recitation fetched early (operator 2026-10-11: "how to reduce the loading time?" …
// "do all three"): when the lesson asks the browser for which recording.

const ALAFASY_1 = "https://everyayah.com/data/Alafasy_128kbps/001001.mp3";
const HUSARY_1 = "https://everyayah.com/data/Husary_Muallim_128kbps/001001.mp3";
const ALAFASY_2 = "https://everyayah.com/data/Alafasy_128kbps/001002.mp3";
const TO_AYAH_2: NavIntent = { kind: "ayah", slug: "al-fatihah", ayah: 2 };
const SURAH_END: NavIntent = { kind: "surah_end", slug: "al-fatihah" };

/** Every kind of step a lesson has (sequence.ts). */
const STEPS: readonly StepKind[] = [
  "intro",
  "recite_ayah",
  "primer",
  "recite_word",
  "explain",
  "compose",
  "structure",
  "concept",
  "exercise",
  "recap",
  "next",
  "done",
];
/** What browsers report: nothing (Safari, Firefox), a fast line, Data Saver, a 2G-class line. */
const CONNECTIONS: readonly (ConnectionHints | null | undefined)[] = [
  undefined,
  null,
  {},
  { effectiveType: "4g" },
  { effectiveType: "3g", saveData: false },
  { saveData: true },
  { effectiveType: "2g" },
  { effectiveType: "slow-2g" },
  { effectiveType: "4g", saveData: true },
];

const plan = (over: Partial<RecitationWarmInput> = {}) =>
  recitationWarmPlan({ started: true, currentUrl: ALAFASY_1, step: "intro", nav: TO_AYAH_2, nextUrl: ALAFASY_2, ...over });

describe("when the imam's recitation is fetched ahead", () => {
  it("never on a page that is only looked at: nothing before the lesson has started", () => {
    for (const step of STEPS) {
      for (const conn of CONNECTIONS) {
        for (const nav of [TO_AYAH_2, SURAH_END]) {
          expect(plan({ started: false, step, conn, nav })).toEqual({ current: null, next: null });
        }
      }
    }
  });

  it("this ayah's recording from the start, on every step — the opening line included", () => {
    for (const step of STEPS) expect(plan({ step }).current).toBe(ALAFASY_1);
  });

  it("this ayah's recording whatever the connection says: the lesson plays it anyway", () => {
    for (const conn of CONNECTIONS) expect(plan({ conn }).current).toBe(ALAFASY_1);
  });

  it("the recording of the reciter chosen: another one chosen in Pengaturan is the one asked for", () => {
    expect(plan({ currentUrl: ALAFASY_1 }).current).toBe(ALAFASY_1);
    const switched = plan({ currentUrl: HUSARY_1 });
    expect(switched.current).toBe(HUSARY_1);
    // The next ayah's file is its page's default reciter's, whoever recites this one.
    expect(plan({ currentUrl: HUSARY_1, step: "recap" }).next).toBe(ALAFASY_2);
  });

  it("no recording to play: nothing to fetch", () => {
    expect(plan({ currentUrl: null })).toEqual({ current: null, next: null });
    expect(plan({ currentUrl: "" }).current).toBeNull();
  });
});

describe("when the next ayah's recitation is fetched ahead", () => {
  it("from the recap on, and on no step before it", () => {
    expect([...NEXT_AYAH_WARM_STEPS]).toEqual(["recap", "next"]);
    for (const step of STEPS) {
      expect(plan({ step }).next).toBe(step === "recap" || step === "next" ? ALAFASY_2 : null);
    }
  });

  it("only where the lesson goes on by itself: never at the end of a surah", () => {
    for (const step of STEPS) expect(plan({ step, nav: SURAH_END }).next).toBeNull();
    // The last ayah's page offers no next recording either.
    expect(plan({ step: "recap", nextUrl: null }).next).toBeNull();
    expect(plan({ step: "recap", nextUrl: "" }).next).toBeNull();
  });

  it("not when the browser asks to save data — the idle preload's rule, one function", () => {
    for (const conn of CONNECTIONS) {
      const p = plan({ step: "recap", conn });
      expect(p.next).toBe(savesData(conn) ? null : ALAFASY_2);
      // This ayah's is asked for all the same.
      expect(p.current).toBe(ALAFASY_1);
      // The same connections that hold back the idle preload of the first line.
      expect(idlePreloadUrl({ url: "/belajar/media/narration/x.mp3", ms: 1000 }, conn) === null).toBe(savesData(conn));
    }
    expect(CONNECTIONS.filter((c) => savesData(c))).toEqual([{ saveData: true }, { effectiveType: "2g" }, { effectiveType: "slow-2g" }, { effectiveType: "4g", saveData: true }]);
  });
});

describe("each file is asked for once in a visit", () => {
  it("true the first time, false ever after; other files are their own", () => {
    const asked = new Set<string>();
    expect(askOnce(asked, ALAFASY_2)).toBe(true);
    expect(askOnce(asked, ALAFASY_2)).toBe(false);
    expect(askOnce(asked, ALAFASY_2)).toBe(false);
    expect(askOnce(asked, HUSARY_1)).toBe(true);
    expect(askOnce(asked, ALAFASY_2)).toBe(false);
    expect([...asked]).toEqual([ALAFASY_2, HUSARY_1]);
  });

  it("a file the stage's player already fetched is not fetched again on the spare element", () => {
    // useSegmentPlayer's warm() adds its file to the same set.
    const asked = new Set<string>([ALAFASY_2]);
    expect(askOnce(asked, ALAFASY_2)).toBe(false);
  });

  it("a recap replayed, or stepped back to, asks for nothing new", () => {
    const asked = new Set<string>();
    const fetched: string[] = [];
    // exercise → recap → (‹ Sebelumnya) exercise → recap → (↺ Ulangi) recap → next
    for (const step of ["exercise", "recap", "exercise", "recap", "recap", "next"] as const) {
      const next = plan({ step }).next;
      if (next && askOnce(asked, next)) fetched.push(next);
    }
    expect(fetched).toEqual([ALAFASY_2]);
  });
});
