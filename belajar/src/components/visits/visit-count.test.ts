import { describe, expect, it } from "vitest";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARRIVALS, arrivalOf, countVisit, HERO_UTM, jakartaDay, optOutRequest, parseVisitMemory, sectionOf, viewOnly, VISIT_SECTIONS, WHOLE_MODULE } from "./visit-count";

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
    expect(step(null, "hub").report).toEqual({ section: "hub", firstToday: true, firstEver: true, firstTodayAll: true, firstEverAll: true, arrival: "other" });
  });

  it("the same section again that day is only a view", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "hub").report).toEqual(viewOnly("hub"));
  });

  it("another section that day is new to that section and not to the module", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "quran").report).toEqual({ section: "quran", firstToday: true, firstEver: true, firstTodayAll: false, firstEverAll: false, arrival: "other" });
  });

  it("the next day is a visitor of the day, and not a new one", () => {
    const { memory } = step(null, "hub");
    expect(step(memory, "hub", NEXT).report).toEqual({ section: "hub", firstToday: true, firstEver: false, firstTodayAll: true, firstEverAll: false, arrival: "other" });
  });

  it("the next day forgets yesterday's sections and keeps the ones ever seen", () => {
    const first = step(null, "hub");
    const second = step(first.memory, "quran");
    const next = step(second.memory, "konsep", NEXT);
    expect(next.memory).toEqual({ day: NEXT, today: ["konsep"], ever: ["hub", "quran", "konsep"] });
    expect(next.report).toEqual({ section: "konsep", firstToday: true, firstEver: true, firstTodayAll: true, firstEverAll: false, arrival: "other" });
  });

  it("does not grow what it keeps by viewing the same section again", () => {
    const first = step(null, "hub");
    expect(step(first.memory, "hub").memory).toEqual(first.memory);
  });

  it("reports only those six things, none of which tells two visitors apart", () => {
    expect(Object.keys(step(null, "hub").report).sort()).toEqual(["arrival", "firstEver", "firstEverAll", "firstToday", "firstTodayAll", "section"]);
  });

  it("carries where the view came from, and nothing else changes with it", () => {
    const plain = step(null, "hub").report;
    const hero = countVisit(null, "hub", DAY, "hero").report;
    expect(hero).toEqual({ ...plain, arrival: "hero" });
    expect(viewOnly("hub", "main")).toEqual({ section: "hub", firstToday: false, firstEver: false, firstTodayAll: false, firstEverAll: false, arrival: "main" });
  });

  it("stays well under the route's 200-byte limit, in the longest case", () => {
    const longest = JSON.stringify({ section: "kosakata-bertahap", firstToday: false, firstEver: false, firstTodayAll: false, firstEverAll: false, arrival: "other" });
    expect(longest.length).toBeLessThan(160);
    for (const section of VISIT_SECTIONS) for (const arrival of ARRIVALS) expect(JSON.stringify(countVisit(null, section, DAY, arrival).report).length).toBeLessThan(200);
  });
});

describe("arrivalOf: where the first page of a visit came from", () => {
  const ORIGIN = "https://dakwah-lens.id";
  const at = (referrer: string, search = "", navigationType: string | undefined = "navigate") => arrivalOf({ referrer, origin: ORIGIN, navigationType, search });
  const HERO = "?utm_source=dakwah-lens&utm_medium=hero";

  it("is `main` from a page of the main site", () => {
    expect(at(`${ORIGIN}/id`)).toBe("main");
    expect(at(`${ORIGIN}/en/briefings`)).toBe("main");
    expect(at(`${ORIGIN}/id/kitab?q=sabar`)).toBe("main");
  });

  it("is `hero` from the main site when the address carries the button's tag", () => {
    expect(at(`${ORIGIN}/id`, HERO)).toBe("hero");
    expect(at(`${ORIGIN}/en`, `${HERO}&utm_campaign=x`)).toBe("hero");
  });

  it("needs both halves of the tag, and the main site as the referrer, for `hero`", () => {
    expect(at(`${ORIGIN}/id`, "?utm_medium=hero")).toBe("main");
    expect(at(`${ORIGIN}/id`, "?utm_source=dakwah-lens")).toBe("main");
    expect(at(`${ORIGIN}/id`, "?utm_source=dakwah-lens&utm_medium=header")).toBe("main");
    // A copied address that still holds the tag, opened from a chat or a search: not the button.
    expect(at("https://chat.whatsapp.com/", HERO)).toBe("other");
    expect(at("", HERO)).toBe("other");
  });

  it("is `other` from anywhere else, and from nowhere", () => {
    expect(at("")).toBe("other");
    expect(at("not a url")).toBe("other");
    expect(at("https://www.google.com/")).toBe("other");
    expect(at("https://dakwah-lens.id.evil.example/id")).toBe("other");
    expect(at("http://dakwah-lens.id/id")).toBe("other");
  });

  it("is `other` from a page of Belajar itself", () => {
    expect(at(`${ORIGIN}/belajar/id`)).toBe("other");
    expect(at(`${ORIGIN}/belajar`)).toBe("other");
    expect(at(`${ORIGIN}/belajar/id/quran/al-fatihah/1`, HERO)).toBe("other");
    // A main-site page that merely starts with the same letters is still the main site.
    expect(at(`${ORIGIN}/belajarbersama`)).toBe("main");
  });

  it("is `other` on a reload or Back, whose referrer is the old one, and counts a fresh navigation", () => {
    expect(at(`${ORIGIN}/id`, HERO, "reload")).toBe("other");
    expect(at(`${ORIGIN}/id`, HERO, "back_forward")).toBe("other");
    expect(at(`${ORIGIN}/id`, HERO, "navigate")).toBe("hero");
    // A browser with no Navigation Timing entry is not turned away.
    expect(at(`${ORIGIN}/id`, HERO, undefined)).toBe("hero");
  });

  it("only ever answers with one of the three words the route accepts", () => {
    for (const a of [at(`${ORIGIN}/id`, HERO), at(`${ORIGIN}/id`), at("")]) expect(ARRIVALS).toContain(a);
  });
});

describe("optOutRequest: leaving a browser out of the counts", () => {
  it.each([
    ["?kunjungan=tidak", "off"],
    ["?kunjungan=ya", "on"],
    ["?utm_source=share&kunjungan=tidak", "off"],
    ["?kunjungan=ya&hal=2", "on"],
  ])("%s asks for %s", (search, want) => {
    expect(optOutRequest(search)).toBe(want);
  });

  it.each([[""], ["?"], ["?kunjungan="], ["?kunjungan=nanti"], ["?kunjungan=TIDAK"], ["?tidak"], ["?hal=2"]])("%j asks for nothing", (search) => {
    expect(optOutRequest(search)).toBeNull();
  });
});

describe("the homepage button's tag", () => {
  const web = join(__dirname, "..", "..", "..", "..", "web", "src", "components", "landing", "Hero.tsx");
  // Checked where the repo is complete (CI checks out all of it), like the logo test in header-menu.test.ts.
  it.skipIf(!existsSync(web))("is the one Belajar looks for", () => {
    const hero = readFileSync(web, "utf8");
    const link = /href=\{`\/belajar\/\$\{locale\}\?([^`]+)`\}\s+data-hero-belajar/.exec(hero)?.[1];
    expect(link).toBeTruthy();
    expect(Object.fromEntries(new URLSearchParams(link))).toEqual(HERO_UTM);
  });
});
