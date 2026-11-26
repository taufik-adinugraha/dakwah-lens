import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// src/lib/kosakata.ts is server-only (the marker package throws outside a server build; src/lib/ayah.test.ts does the same).
vi.mock("server-only", () => ({}));

import sitemap, { dynamic } from "@/app/sitemap";

// THE SITEMAP ROUTE, /belajar/sitemap.xml (docs/belajar-plan.md L42), called as Next calls it. The
// addresses and the reasons are held by src/lib/indexing.test.ts on every combination of the switches;
// here the route itself: that it reads them per call, from the real data, and says nothing else.

const KEYS = [
  "BELAJAR_PUBLIC",
  "BELAJAR_WARIS",
  "BELAJAR_SURAHS",
  "BELAJAR_UNLISTED",
  "BELAJAR_KOSAKATA_BERTAHAP",
  "BELAJAR_KOSAKATA_EN",
  "BELAJAR_KOSAKATA_WORDS_INDEXED",
] as const;
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.BELAJAR_PUBLIC = "true";
  process.env.BELAJAR_KOSAKATA_BERTAHAP = "on";
});
afterEach(() => {
  for (const k of KEYS) {
    if (before[k] === undefined) delete process.env[k];
    else process.env[k] = before[k];
  }
});

const BASE = "https://dakwah-lens.id/belajar/id";
const urls = () => sitemap().map((e) => e.url);

describe("/belajar/sitemap.xml", () => {
  it("is rendered per request, because what it lists is decided by runtime switches", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lists, as production runs, the 126 pages the operator listed (a lesson word only while a published surah uses it), and for each only its address", () => {
    const list = urls();
    expect(list).toHaveLength(126);
    expect(list.slice(0, 4)).toEqual([BASE, `${BASE}/quran`, `${BASE}/quran/al-fatihah`, `${BASE}/quran/al-fatihah/1`]);
    expect(list).toContain(`${BASE}/quran/al-fatihah/7`);
    expect(list).toContain(`${BASE}/konsep/harakat`);
    expect(list).toContain(`${BASE}/kosakata?hal=49`);
    expect(list.at(-1)).toBe(`${BASE}/kredit`);
    // No made-up dates, frequencies or priorities: nothing here knows when a page last changed.
    for (const entry of sitemap()) expect(Object.keys(entry)).toEqual(["url"]);
  });

  it("leaves out Al-Ikhlas (unlisted), the other surahs, Ilmu Waris, the English pages, the share cards and the word pages", () => {
    process.env.BELAJAR_WARIS = "on";
    for (const url of urls()) {
      expect(url).not.toMatch(/al-ikhlas|al-falaq|an-nas|\/waris|\/belajar\/en|\/og$|\/kosakata\/kata\/|\?q=/);
    }
  });

  it("follows the operator's switches on the next request, with no rebuild", () => {
    process.env.BELAJAR_SURAHS = "al-fatihah,al-ikhlas";
    expect(urls()).toContain(`${BASE}/quran/al-ikhlas/1`);
    expect(urls()).toContain(`${BASE}/quran/al-ikhlas`);
    delete process.env.BELAJAR_SURAHS;
    expect(urls()).not.toContain(`${BASE}/quran/al-ikhlas/1`);
    delete process.env.BELAJAR_KOSAKATA_BERTAHAP;
    expect(urls()).not.toContain(`${BASE}/kosakata/bertahap`);
    process.env.BELAJAR_KOSAKATA_WORDS_INDEXED = "on";
    expect(urls().filter((u) => u.includes("/kosakata/kata/"))).toHaveLength(4832);
  });

  it("is empty while the module is not public: the kill switch", () => {
    process.env.BELAJAR_PUBLIC = "false";
    expect(sitemap()).toEqual([]);
    delete process.env.BELAJAR_PUBLIC;
    expect(sitemap()).toEqual([]);
  });
});
