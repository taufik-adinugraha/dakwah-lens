import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import proxy from "./proxy";

// Drives the real proxy, next-intl's middleware included, as Next calls it: basePath "/belajar",
// the path as the visitor sent it. Where the proxy rewrites a request is the path Next serves.
const saved = process.env.BELAJAR_WARIS;
function setSwitch(value: string | undefined) {
  if (value === undefined) delete process.env.BELAJAR_WARIS;
  else process.env.BELAJAR_WARIS = value;
}
afterEach(() => setSwitch(saved));

/** The rewritten path, or "<status> <redirect path>". */
function landing(path: string): string {
  const res = proxy(new NextRequest(`http://127.0.0.1:3200${path}`, { nextConfig: { basePath: "/belajar" } }));
  const rewrite = res.headers.get("x-middleware-rewrite");
  if (rewrite) return new URL(rewrite).pathname;
  return `${res.status} ${new URL(res.headers.get("location") ?? "/", "http://127.0.0.1:3200").pathname}`;
}

// (A trailing "/" survives the rewrite; the catch-all 404s it all the same.)
const HIDDEN_404 = /^\/belajar\/(id|en)\/_tersembunyi\/?$/;
const WARIS_PAGE = /^\/belajar\/(id|en)\/waris(?:\/|$)/;
const TRACK = ["/belajar/id/waris", "/belajar/en/waris/hitung", "/belajar/id/waris/laporan"];

describe("proxy: Ilmu Waris hidden unless BELAJAR_WARIS=on (operator, 2026-10-10)", () => {
  it("answers every waris URL with the module's 404, however it is spelled", () => {
    setSwitch(undefined);
    for (const path of [
      ...TRACK,
      "/belajar/en/waris/",
      "/belajar/id/waris/tidak-ada",
      "/belajar/id/w%61ris/hitung",
      "/belajar/en/waris%2Fhitung",
      // Spellings next-intl cleans into the page's own path (src/proxy.ts).
      "/belajar/id/wa%09ris",
      "/belajar/en/waris%0A/hitung",
      "/belajar/i%0Dd/waris/laporan",
      "/belajar/id/waris%20",
      "/belajar/id/waris%00",
    ]) {
      expect(landing(path), path).toMatch(HIDDEN_404);
    }
  });

  it("no TAB, LF or CR anywhere in a waris URL, nor a trailing space or NUL, reaches the page", () => {
    setSwitch(undefined);
    let tried = 0;
    for (const base of TRACK) {
      for (let i = "/belajar/".length; i <= base.length; i++) {
        for (const token of ["%09", "%0A", "%0d", "%0D%0A"]) {
          const path = base.slice(0, i) + token + base.slice(i);
          expect(decodeURIComponent(landing(path)), path).not.toMatch(WARIS_PAGE);
          tried++;
        }
      }
      for (const token of ["%20", "%00", "%20%20"]) expect(landing(base + token), base + token).toMatch(HIDDEN_404);
    }
    expect(tried).toBeGreaterThan(150);
  });

  it("leaves every other page, and the locale redirects, as next-intl routes them", () => {
    setSwitch(undefined);
    expect(landing("/belajar/id")).toBe("/belajar/id");
    expect(landing("/belajar/id/kredit")).toBe("/belajar/id/kredit");
    expect(landing("/belajar/en/quran")).toBe("/belajar/en/quran");
    expect(landing("/belajar/id/warisan")).toBe("/belajar/id/warisan");
    expect(landing("/belajar")).toBe("307 /belajar/id");
    // A redirect into the track is gated when the redirected request comes back.
    expect(landing("/belajar/waris")).toBe("307 /belajar/id/waris");
  });

  it("serves the track with the switch on", () => {
    setSwitch("on");
    expect(landing("/belajar/id/waris")).toBe("/belajar/id/waris");
    expect(landing("/belajar/en/waris/hitung")).toBe("/belajar/en/waris/hitung");
    expect(landing("/belajar/id/waris/laporan")).toBe("/belajar/id/waris/laporan");
  });
});

// ── BELAJAR_SURAHS: Al-Fatihah first (operator, 2026-10-10; plan L14). The same one check gates
// the surahs the switch does not publish, raw, decoded and where next-intl rewrites to.
const savedSurahs = process.env.BELAJAR_SURAHS;
function setSurahs(value: string | undefined) {
  if (value === undefined) delete process.env.BELAJAR_SURAHS;
  else process.env.BELAJAR_SURAHS = value;
}
afterEach(() => setSurahs(savedSurahs));

const EVERY_SURAH = "al-fatihah,al-ikhlas,al-falaq,an-nas";
const MUAWWIDZAT_PAGE = /^\/belajar\/(id|en)\/quran\/(al-ikhlas|al-falaq|an-nas)(?:\/|$)/;
const MUAWWIDZAT = [
  "/belajar/id/quran/al-ikhlas",
  "/belajar/en/quran/al-ikhlas/4",
  "/belajar/id/quran/al-falaq/5",
  "/belajar/en/quran/an-nas",
  "/belajar/id/quran/an-nas/6",
];

describe("proxy: only the surahs BELAJAR_SURAHS publishes (unset: Al-Fatihah only)", () => {
  it("answers every page of an unpublished surah with the module's 404, however it is spelled", () => {
    setSwitch(undefined);
    setSurahs(undefined);
    for (const path of [
      ...MUAWWIDZAT,
      "/belajar/id/quran/al-ikhlas/",
      "/belajar/en/quran/al-falaq",
      "/belajar/id/quran/an-nas/7",
      "/belajar/id/quran/al-ikhlas/tidak-ada",
      "/belajar/id/quran/al-%69khlas/2",
      "/belajar/en/quran%2Fan-nas",
      "/belajar/id/quran/an-nas%2F3",
      // Spellings next-intl cleans into the page's own path (src/proxy.ts).
      "/belajar/id/quran/al-ikh%09las",
      "/belajar/en/quran%0A/al-falaq/1",
      "/belajar/i%0Dd/quran/an-nas/2",
      "/belajar/id/quran/al-ikhlas%20",
      "/belajar/id/quran/al-falaq%00",
    ]) {
      expect(landing(path), path).toMatch(HIDDEN_404);
    }
  });

  it("no TAB, LF or CR anywhere in a hidden surah's URL, nor a trailing space or NUL, reaches the page", () => {
    setSurahs(undefined);
    let tried = 0;
    for (const base of MUAWWIDZAT) {
      for (let i = "/belajar/".length; i <= base.length; i++) {
        for (const token of ["%09", "%0A", "%0d", "%0D%0A"]) {
          const path = base.slice(0, i) + token + base.slice(i);
          expect(decodeURIComponent(landing(path)), path).not.toMatch(MUAWWIDZAT_PAGE);
          tried++;
        }
      }
      for (const token of ["%20", "%00", "%20%20"]) expect(landing(base + token), base + token).toMatch(HIDDEN_404);
    }
    expect(tried).toBeGreaterThan(300);
  });

  it("leaves Al-Fatihah, the track page and paths that are no lesson as next-intl routes them", () => {
    setSurahs(undefined);
    expect(landing("/belajar/id/quran")).toBe("/belajar/id/quran");
    expect(landing("/belajar/en/quran")).toBe("/belajar/en/quran");
    expect(landing("/belajar/id/quran/al-fatihah")).toBe("/belajar/id/quran/al-fatihah");
    expect(landing("/belajar/en/quran/al-fatihah/7")).toBe("/belajar/en/quran/al-fatihah/7");
    // Not a lesson: the lesson routes' own 404 (dynamicParams = false), not the gate's.
    expect(landing("/belajar/id/quran/al-baqarah")).toBe("/belajar/id/quran/al-baqarah");
    expect(landing("/belajar/id/quran/al-ikhlasan")).toBe("/belajar/id/quran/al-ikhlasan");
    // Outside /quran, a slug is no lesson (next.config.ts redirects the pre-hub URLs first).
    expect(landing("/belajar/id/al-ikhlas")).toBe("/belajar/id/al-ikhlas");
    // A redirect into a hidden surah is gated when the redirected request comes back.
    expect(landing("/belajar/quran/al-ikhlas")).toBe("307 /belajar/id/quran/al-ikhlas");
  });

  it("publishes exactly what the switch lists, and nothing it does not", () => {
    setSurahs(EVERY_SURAH);
    for (const path of MUAWWIDZAT) expect(landing(path), path).toBe(path);
    expect(landing("/belajar/id/quran/al-fatihah/1")).toBe("/belajar/id/quran/al-fatihah/1");
    // Trimmed and lower-cased; the others stay hidden.
    setSurahs("al-fatihah, AL-FALAQ ");
    expect(landing("/belajar/id/quran/al-falaq/5")).toBe("/belajar/id/quran/al-falaq/5");
    expect(landing("/belajar/id/quran/al-ikhlas")).toMatch(HIDDEN_404);
    expect(landing("/belajar/id/quran/an-nas/6")).toMatch(HIDDEN_404);
    // The list is the whole published set: without al-fatihah, Al-Fatihah is hidden too.
    setSurahs("an-nas");
    expect(landing("/belajar/id/quran/an-nas/1")).toBe("/belajar/id/quran/an-nas/1");
    expect(landing("/belajar/id/quran/al-fatihah/1")).toMatch(HIDDEN_404);
    // A value naming no lesson counts as unset: a typo never empties the track.
    for (const v of ["", " ", ",", "al-fatiha", "semua", "on"]) {
      setSurahs(v);
      expect(landing("/belajar/id/quran/al-fatihah/1"), JSON.stringify(v)).toBe("/belajar/id/quran/al-fatihah/1");
      expect(landing("/belajar/id/quran/al-ikhlas/1"), JSON.stringify(v)).toMatch(HIDDEN_404);
    }
  });

  it("keeps the two switches apart", () => {
    setSwitch("on");
    setSurahs(undefined);
    expect(landing("/belajar/id/waris/hitung")).toBe("/belajar/id/waris/hitung");
    expect(landing("/belajar/id/quran/al-ikhlas")).toMatch(HIDDEN_404);
    setSwitch(undefined);
    setSurahs(EVERY_SURAH);
    expect(landing("/belajar/id/waris/hitung")).toMatch(HIDDEN_404);
    expect(landing("/belajar/id/quran/al-ikhlas")).toBe("/belajar/id/quran/al-ikhlas");
  });
});
