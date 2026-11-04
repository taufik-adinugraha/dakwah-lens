import { describe, expect, it } from "vitest";

import { countVisit, jakartaDay, parseVisitMemory, sectionOf, viewOnly, VISIT_SECTIONS, WHOLE_MODULE } from "./visit-count";

describe("sectionOf: which part of Belajar a page is in", () => {
  it.each([
    ["/id", "hub"],
    ["/en", "hub"],
    ["/id/quran", "quran"],
    ["/id/quran/al-fatihah/2", "quran"],
    ["/id/quran/pengantar", "quran"],
    ["/id/konsep/isim", "konsep"],
    ["/id/kosakata", "kosakata-daftar"],
    ["/id/kosakata/kata/12", "kosakata-daftar"],
    ["/id/kosakata/bertahap", "kosakata-bertahap"],
    ["/id/kosakata/bertahap/1/3/tes", "kosakata-bertahap"],
    ["/id/kredit", "kredit"],
  ])("%s is %s", (path, section) => {
    expect(sectionOf(path)).toBe(section);
  });

  it("counts a page that is in no section for nothing", () => {
    expect(sectionOf("/id/alamat-keliru")).toBeNull();
  });

  it.each(["/id/waris", "/id/waris/hitung", "/id/waris/laporan", "/en/waris/hitung"])("sends nothing from Ilmu Waris, which promises no server path: %s", (path) => {
    expect(sectionOf(path)).toBeNull();
  });

  it("never names the module's own row, which the route adds itself", () => {
    expect(VISIT_SECTIONS).not.toContain(WHOLE_MODULE);
  });
});

describe("jakartaDay: the day as the table counts it", () => {
  it("turns at midnight WIB, not at midnight UTC", () => {
    expect(jakartaDay(new Date("2026-11-03T16:59:59Z"))).toBe("2026-11-03");
    expect(jakartaDay(new Date("2026-11-03T17:00:00Z"))).toBe("2026-11-04");
  });
});

describe("parseVisitMemory: what the browser kept", () => {
  it("reads what countVisit wrote", () => {
    const { memory } = countVisit(null, "hub", "2026-11-04");
    expect(parseVisitMemory(JSON.stringify(memory))).toEqual(memory);
  });

  it.each([[null], [""], ["not json"], ["null"], ["[]"], ['{"day":1,"today":[],"ever":[]}'], ['{"day":"2026-11-04","today":[1],"ever":[]}'], ['{"day":"2026-11-04","today":[]}']])("treats %j as nothing kept", (raw) => {
    expect(parseVisitMemory(raw)).toBeNull();
  });
});

describe("countVisit: what a view reports", () => {
  const DAY = "2026-11-04";
  const NEXT = "2026-11-05";
  const step = (memory: ReturnType<typeof countVisit>["memory"] | null, section: Parameters<typeof countVisit>[1], day = DAY) => countVisit(memory, section, day);

  it("a browser's very first view is first of everything", () => {
    expect(step(null, "hub").report).toEqual({ section: "hub", firstToday: true, firstEver: true, firstTodayAll: true, firstEverAll: true });
  });

  it("the same section again that day is only a view", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "hub").report).toEqual(viewOnly("hub"));
  });

  it("another section that day is new to that section and not to the module", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "quran").report).toEqual({ section: "quran", firstToday: true, firstEver: true, firstTodayAll: false, firstEverAll: false });
  });

  it("the next day is a visitor of the day, and not a new one", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "hub", NEXT).report).toEqual({ section: "hub", firstToday: true, firstEver: false, firstTodayAll: true, firstEverAll: false });
  });

  it("the next day forgets yesterday's sections and keeps the ones ever seen", () => {
    const first = step(null, "hub");
    const second = step(first.memory, "quran");
    const next = step(second.memory, "konsep", NEXT);
    expect(next.memory).toEqual({ day: NEXT, today: ["konsep"], ever: ["hub", "quran", "konsep"] });
    expect(next.report).toEqual({ section: "konsep", firstToday: true, firstEver: true, firstTodayAll: true, firstEverAll: false });
  });

  it("does not grow what it keeps by viewing the same section again", () => {
    const first = step(null, "hub");
    expect(step(first.memory, "hub").memory).toEqual(first.memory);
  });

  it("reports only those five things, none of which tells two visitors apart", () => {
    expect(Object.keys(step(null, "hub").report).sort()).toEqual(["firstEver", "firstEverAll", "firstToday", "firstTodayAll", "section"]);
  });
});
