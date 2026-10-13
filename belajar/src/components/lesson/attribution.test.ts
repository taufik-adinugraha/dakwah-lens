/**
 * A scholars' reading and who holds it (WordCard.splitAttribution): the word card gives the
 * attribution a line of its own, so the dash that opens it can no longer be left at the start of
 * a wrapped line (CI line breaks, 2026-10-13: "(“permulaanku”) ⏎ — al-Jadwal," at Sangat besar on
 * a phone). The split is only safe while the content keeps the form it has today, which this file
 * holds: a reading has at most ONE " — ", its marked twin splits at the same place, and the two
 * halves put back together are the content's bytes.
 */
import { describe, expect, it } from "vitest";

import { SURAHS } from "@/lib/content";

import { splitAttribution } from "./WordCard";

/** Every reading of every word, with its marked twin when the word has one. */
const READINGS = SURAHS.flatMap((s) =>
  s.ayat.flatMap((a) =>
    a.words.flatMap((w) =>
      w.ikhtilaf.flatMap((x, i) =>
        x.options.map((plain, j) => ({ loc: w.loc, plain, marked: w.marked?.ikhtilaf[i]?.options[j] })),
      ),
    ),
  ),
);

describe("a scholars' reading and its attribution", () => {
  it("splits at the dash and loses nothing", () => {
    expect(splitAttribution("Khabar tersirat (“permulaanku”) — al-Jadwal, Darwisy")).toEqual(["Khabar tersirat (“permulaanku”)", "al-Jadwal, Darwisy"]);
    expect(splitAttribution("Bulan: berdasarkan hadits Aisyah")).toEqual(["Bulan: berdasarkan hadits Aisyah", undefined]);
    expect(splitAttribution(undefined)).toEqual([undefined, undefined]);
    // A hyphen or a dash inside a word is not the separator.
    expect(splitAttribution("jar-majrur ini—menurut sebagian")).toEqual(["jar-majrur ini—menurut sebagian", undefined]);
  });

  it("every reading of the lessons has at most one dash, and the card shows its bytes", () => {
    expect(READINGS.length).toBeGreaterThan(90);
    for (const r of READINGS) {
      expect(r.plain.split(" — ").length, `${r.loc}: ${r.plain}`).toBeLessThanOrEqual(2);
      const [reading, by] = splitAttribution(r.plain);
      // What the card draws: the reading, a space, and the attribution opened by the dash.
      expect(by === undefined ? reading : `${reading} — ${by}`, r.loc).toBe(r.plain);
      expect(reading.trim(), r.loc).toBe(reading);
      if (by !== undefined) expect(by.trim().length, r.loc).toBeGreaterThan(0);
    }
  });

  it("the marked twin of a reading splits where the reading does", () => {
    let twins = 0;
    for (const r of READINGS) {
      if (r.marked === undefined) continue;
      twins++;
      const [, by] = splitAttribution(r.plain);
      const [mReading, mBy] = splitAttribution(r.marked);
      expect(mBy === undefined, `${r.loc}: ${r.marked}`).toBe(by === undefined);
      // No markup span straddles the dash: each half is balanced on its own.
      for (const half of [mReading, mBy ?? ""]) expect((half.match(/\[\[/g) ?? []).length, r.loc).toBe((half.match(/\]\]/g) ?? []).length);
    }
    // Al-Fatihah's readings are the ones marked today (34); a surah's are checked once they are.
    expect(twins).toBeGreaterThan(30);
  });
});
