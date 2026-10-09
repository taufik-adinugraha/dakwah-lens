import { describe, expect, it } from "vitest";

import {
  formatWeekLabel,
  occasionWeeks,
  parseWeekParam,
  weekRangeUtc,
  wibWeekOf,
} from "./week-filter";

describe("parseWeekParam", () => {
  it("keeps a Monday and snaps other days back to their Monday", () => {
    expect(parseWeekParam("2026-10-05")).toBe("2026-10-05");
    expect(parseWeekParam("2026-10-08")).toBe("2026-10-05"); // Thursday
    expect(parseWeekParam("2026-10-11")).toBe("2026-10-05"); // Sunday
    expect(parseWeekParam("2026-01-01")).toBe("2025-12-29"); // across a year
  });

  it("rejects malformed and impossible input", () => {
    expect(parseWeekParam(undefined)).toBeNull();
    expect(parseWeekParam("")).toBeNull();
    expect(parseWeekParam("2026-10")).toBeNull();
    expect(parseWeekParam("2026-02-31")).toBeNull();
    expect(parseWeekParam("1999-01-04")).toBeNull();
    expect(parseWeekParam(["2026-10-07", "x"])).toBe("2026-10-05");
  });
});

describe("weekRangeUtc", () => {
  it("spans Monday 00:00 WIB to the next Monday 00:00 WIB", () => {
    const { startUtc, endUtc } = weekRangeUtc("2026-10-05");
    expect(startUtc.toISOString()).toBe("2026-10-04T17:00:00.000Z");
    expect(endUtc.toISOString()).toBe("2026-10-11T17:00:00.000Z");
  });
});

describe("formatWeekLabel", () => {
  const plain = (s: string) => s.replace(/\u00A0/g, " ");

  it("formats Indonesian ranges", () => {
    expect(plain(formatWeekLabel("2026-10-05", "id"))).toBe("5–11 Okt 2026");
    expect(plain(formatWeekLabel("2026-09-28", "id"))).toBe("28 Sep – 4 Okt 2026");
    expect(plain(formatWeekLabel("2025-12-29", "id"))).toBe("29 Des 2025 – 4 Jan 2026");
  });

  it("formats English ranges", () => {
    expect(plain(formatWeekLabel("2026-10-05", "en"))).toMatch(/Oct 5\s*–\s*11, 2026/);
  });

  it("only breaks at the dash, never inside a date", () => {
    expect(formatWeekLabel("2025-12-29", "id")).toBe(
      "29\u00A0Des\u00A02025 – 4\u00A0Jan\u00A02026",
    );
    expect(formatWeekLabel("2026-10-05", "id")).toBe("5–11\u00A0Okt\u00A02026");
    expect(formatWeekLabel("2025-12-29", "en")).not.toMatch(/\d [A-Z]|[a-z] \d|, \d/);
  });
});

describe("wibWeekOf", () => {
  it("buckets by the WIB calendar day", () => {
    // Sunday 23:30 UTC = Monday 06:30 WIB → the new week.
    expect(wibWeekOf(new Date("2026-10-04T23:30:00Z"))).toBe("2026-10-05");
    // Sunday 16:59 UTC = Sunday 23:59 WIB → still the old week.
    expect(wibWeekOf(new Date("2026-10-04T16:59:00Z"))).toBe("2026-09-28");
  });
});

describe("occasionWeeks", () => {
  // The three prod occasions (WIB): Maulid 1448 saved Sun 08-16 for Tue
  // 08-25; Asyura 1448 saved Sun 06-21 for Thu 06-25; Kemerdekaan 2026
  // saved Wed 08-05 for Mon 08-17.
  const maulidSaved = new Date("2026-08-16T01:56:00Z");
  const asyuraSaved = new Date("2026-06-21T01:34:00Z");
  const kemerdekaanSaved = new Date("2026-08-05T01:48:00Z");

  it("files an edition under the Fridays between its save and its event", () => {
    // Fri 08-21, the only Friday after the Sunday save and before Maulid.
    expect(occasionWeeks(maulidSaved, "2026-08-25", "2026-10-05")).toEqual(["2026-08-17"]);
    // Fri 08-07 and Fri 08-14.
    expect(occasionWeeks(kemerdekaanSaved, "2026-08-17", "2026-10-05")).toEqual([
      "2026-08-03",
      "2026-08-10",
    ]);
  });

  it("files under the next Friday when the event comes before it", () => {
    // Saved Sunday, event Thursday: the first Friday after the save is
    // 06-26, the day after Asyura.
    expect(occasionWeeks(asyuraSaved, "2026-06-25", "2026-10-05")).toEqual(["2026-06-22"]);
  });

  it("keeps a row re-saved after its event under its event's Friday", () => {
    expect(
      occasionWeeks(new Date("2026-10-08T04:00:00Z"), "2026-08-25", "2026-10-05"),
    ).toEqual(["2026-08-17"]);
  });

  it("never lists a week after `notAfter`", () => {
    expect(occasionWeeks(kemerdekaanSaved, "2026-08-17", "2026-08-03")).toEqual([
      "2026-08-03",
    ]);
    // Saved Sunday for an upcoming event: its first Friday is next week,
    // so it shows in the current (save) week meanwhile.
    expect(occasionWeeks(maulidSaved, "2026-08-25", "2026-08-10")).toEqual(["2026-08-10"]);
  });

  it("falls back to the save week alone", () => {
    expect(occasionWeeks(maulidSaved, undefined, "2026-10-05")).toEqual(["2026-08-10"]);
    expect(occasionWeeks(maulidSaved, "2026-02-31", "2026-10-05")).toEqual(["2026-08-10"]);
    // A wrong year, either way, is not trusted.
    expect(occasionWeeks(maulidSaved, "2027-08-25", "2026-10-05")).toEqual(["2026-08-10"]);
    expect(occasionWeeks(maulidSaved, "2025-08-25", "2026-10-05")).toEqual(["2026-08-10"]);
  });
});
