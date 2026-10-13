import { describe, expect, it } from "vitest";

import { recitationToWarm } from "./warm";

// The imam's recitation fetched early (operator 2026-10-11: "how to reduce the loading time?" …
// "do all three"): when the lesson asks the browser for which recording. One imam (operator
// 2026-10-13, plan L21), so an ayah has one recording: the two below are two AYAT's, not two
// reciters' (until then the second was Husary Mu'allim's of the same ayah, chosen in "Pengaturan").

const ALAFASY_1 = "https://everyayah.com/data/Alafasy_128kbps/001001.mp3";
const ALAFASY_2 = "https://everyayah.com/data/Alafasy_128kbps/001002.mp3";

describe("when the imam's recitation is fetched ahead", () => {
  it("never on a page that is only looked at: nothing before the lesson has started", () => {
    expect(recitationToWarm({ started: false, currentUrl: ALAFASY_1 })).toBeNull();
    expect(recitationToWarm({ started: false, currentUrl: ALAFASY_2 })).toBeNull();
    expect(recitationToWarm({ started: false, currentUrl: null })).toBeNull();
  });

  it("this ayah's recording once the lesson has started", () => {
    expect(recitationToWarm({ started: true, currentUrl: ALAFASY_1 })).toBe(ALAFASY_1);
  });

  it("the recording it is handed, and no other: the rule holds none of its own (each page hands it its ayah's)", () => {
    expect(recitationToWarm({ started: true, currentUrl: ALAFASY_2 })).toBe(ALAFASY_2);
  });

  it("no recording to play: nothing to fetch", () => {
    expect(recitationToWarm({ started: true, currentUrl: null })).toBeNull();
    expect(recitationToWarm({ started: true, currentUrl: "" })).toBeNull();
  });

  it("takes nothing but the lesson's start and this ayah's recording: no step, no next ayah, no connection", () => {
    // The rule has no way to name another ayah's recording (review 2026-10-11: a recording is
    // asked for by the page that plays it), and no connection hint holds this one back (the lesson
    // plays it anyway). Extra fields a caller might still pass change nothing.
    const loose = { started: true, currentUrl: ALAFASY_1, step: "recap", nextUrl: ALAFASY_2, conn: { saveData: true } };
    expect(recitationToWarm(loose)).toBe(ALAFASY_1);
    expect(recitationToWarm.length).toBe(1);
  });
});
