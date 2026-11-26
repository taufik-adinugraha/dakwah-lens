import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

// BELAJAR_UNLISTED (operator, 2026-10-20): a surah that answers at its address and is linked from
// nowhere. Its default is Al-Ikhlas, so the tests of "what the switch does not publish" run with
// none unlisted, and the unlisted state has its own tests below.
const savedUnlisted = process.env.BELAJAR_UNLISTED;
function setUnlisted(value: string | undefined) {
  if (value === undefined) delete process.env.BELAJAR_UNLISTED;
  else process.env.BELAJAR_UNLISTED = value;
}
afterEach(() => setUnlisted(savedUnlisted));

const EVERY_SURAH = "al-fatihah,al-ikhlas,al-falaq,an-nas";
const MUAWWIDZAT_PAGE = /^\/belajar\/(id|en)\/quran\/(al-ikhlas|al-falaq|an-nas)(?:\/|$)/;
const MUAWWIDZAT = [
  "/belajar/id/quran/al-ikhlas",
  "/belajar/en/quran/al-ikhlas/4",
  "/belajar/id/quran/al-falaq/5",
  "/belajar/en/quran/an-nas",
  "/belajar/id/quran/an-nas/6",
];

describe("proxy: the Kosakata list hidden in English unless BELAJAR_KOSAKATA_EN=on (operator, 2026-11-03)", () => {
  const before = process.env.BELAJAR_KOSAKATA_EN;
  afterEach(() => {
    if (before === undefined) delete process.env.BELAJAR_KOSAKATA_EN;
    else process.env.BELAJAR_KOSAKATA_EN = before;
  });

  it("answers the list's English pages with the module's 404, however they are spelled", () => {
    delete process.env.BELAJAR_KOSAKATA_EN;
    for (const path of [
      "/belajar/en/kosakata",
      "/belajar/en/kosakata/",
      "/belajar/en/kosakata/kata/1",
      "/belajar/en/kosakata/bertahap",
      "/belajar/en/kosakata/bertahap/1/3",
      "/belajar/en/kos%61kata",
      "/belajar/en/kosa%09kata",
      "/belajar/en/kosakata%2Fkata%2F1",
    ]) {
      expect(landing(path), path).toMatch(HIDDEN_404);
    }
  });

  it("leaves the Indonesian list and a lesson word's English entry alone", () => {
    delete process.env.BELAJAR_KOSAKATA_EN;
    expect(landing("/belajar/id/kosakata")).toBe("/belajar/id/kosakata");
    expect(landing("/belajar/id/kosakata/kata/1")).toBe("/belajar/id/kosakata/kata/1");
    expect(landing("/belajar/en/kosakata/rahim")).toBe("/belajar/en/kosakata/rahim");
    expect(landing("/belajar/en/kosakata/katala")).toBe("/belajar/en/kosakata/katala");
  });

  it("serves the English list with the switch on", () => {
    process.env.BELAJAR_KOSAKATA_EN = "on";
    expect(landing("/belajar/en/kosakata")).toBe("/belajar/en/kosakata");
    expect(landing("/belajar/en/kosakata/kata/1")).toBe("/belajar/en/kosakata/kata/1");
  });
});

describe("proxy: Kosakata opens on the learning path while it is listed (operator, 2026-11-03)", () => {
  const saved = { path: process.env.BELAJAR_KOSAKATA_BERTAHAP, en: process.env.BELAJAR_KOSAKATA_EN };
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  beforeEach(() => {
    process.env.BELAJAR_KOSAKATA_BERTAHAP = "on";
    delete process.env.BELAJAR_KOSAKATA_EN;
  });
  afterEach(() => {
    restore("BELAJAR_KOSAKATA_BERTAHAP", saved.path);
    restore("BELAJAR_KOSAKATA_EN", saved.en);
  });

  it("sends the section's own address to the path, for a while and not for good", () => {
    expect(landing("/belajar/id/kosakata")).toBe("307 /belajar/id/kosakata/bertahap");
  });

  it("keeps anything else the address carries", () => {
    const res = proxy(new NextRequest("http://127.0.0.1:3200/belajar/id/kosakata?utm=wa", { nextConfig: { basePath: "/belajar" } }));
    expect(new URL(res.headers.get("location") ?? "/", "http://127.0.0.1:3200").search).toBe("?utm=wa");
  });

  it("leaves the list's pages, a search, the path and the words alone", () => {
    for (const path of ["/belajar/id/kosakata?hal=1", "/belajar/id/kosakata?hal=3", "/belajar/id/kosakata?q=tangan", "/belajar/id/kosakata?q="]) {
      expect(landing(path), path).toBe("/belajar/id/kosakata");
    }
    for (const path of ["/belajar/id/kosakata/bertahap", "/belajar/id/kosakata/bertahap/1/3", "/belajar/id/kosakata/kata/1", "/belajar/id/kosakata/rahim"]) {
      expect(landing(path), path).toBe(path);
    }
  });

  it("keeps the English list hidden, and follows the same rule when it is shown", () => {
    expect(landing("/belajar/en/kosakata")).toMatch(HIDDEN_404);
    process.env.BELAJAR_KOSAKATA_EN = "on";
    expect(landing("/belajar/en/kosakata")).toBe("307 /belajar/en/kosakata/bertahap");
  });

  it("is the list again with the switch off", () => {
    delete process.env.BELAJAR_KOSAKATA_BERTAHAP;
    expect(landing("/belajar/id/kosakata")).toBe("/belajar/id/kosakata");
  });
});

describe("proxy: only the surahs BELAJAR_SURAHS publishes (unset: Al-Fatihah only)", () => {
  beforeEach(() => setUnlisted(""));

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
    // The curriculum page and its share card (plan L30): pages of the track, no surah's lesson.
    // They name the hidden surahs as plain text and are never gated.
    expect(landing("/belajar/id/quran/kurikulum")).toBe("/belajar/id/quran/kurikulum");
    expect(landing("/belajar/en/quran/kurikulum")).toBe("/belajar/en/quran/kurikulum");
    expect(landing("/belajar/id/quran/kurikulum/og")).toBe("/belajar/id/quran/kurikulum/og");
    // The cheat sheet (plan L32) the same: its page and card are the track's, never gated, and its
    // own gate (a formula of a hidden surah is not drawn) is in the page, not the proxy.
    expect(landing("/belajar/id/quran/rumus")).toBe("/belajar/id/quran/rumus");
    expect(landing("/belajar/en/quran/rumus")).toBe("/belajar/en/quran/rumus");
    expect(landing("/belajar/id/quran/rumus/og")).toBe("/belajar/id/quran/rumus/og");
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

describe("proxy: an unlisted surah answers at its address (BELAJAR_UNLISTED; default Al-Ikhlas)", () => {
  it("serves Al-Ikhlas by default while Al-Falaq and An-Nas stay hidden", () => {
    setSwitch(undefined);
    setSurahs(undefined);
    setUnlisted(undefined);
    for (const path of ["/belajar/id/quran/al-ikhlas", "/belajar/en/quran/al-ikhlas/4", "/belajar/id/quran/al-ikhlas/1/og"]) {
      expect(landing(path), path).toBe(path);
    }
    for (const path of ["/belajar/id/quran/al-falaq/5", "/belajar/en/quran/an-nas", "/belajar/id/quran/an-nas/6"]) {
      expect(landing(path), path).toMatch(HIDDEN_404);
    }
    // The pre-hub address is redirected into it and then served.
    expect(landing("/belajar/quran/al-ikhlas")).toBe("307 /belajar/id/quran/al-ikhlas");
  });

  it("is the list when set, and an empty value hides every surah that is not published", () => {
    setSurahs(undefined);
    setUnlisted("al-falaq, AN-NAS");
    expect(landing("/belajar/id/quran/al-falaq/5")).toBe("/belajar/id/quran/al-falaq/5");
    expect(landing("/belajar/id/quran/an-nas/6")).toBe("/belajar/id/quran/an-nas/6");
    expect(landing("/belajar/id/quran/al-ikhlas")).toMatch(HIDDEN_404);
    setUnlisted("");
    expect(landing("/belajar/id/quran/al-falaq/5")).toMatch(HIDDEN_404);
    expect(landing("/belajar/id/quran/al-ikhlas")).toMatch(HIDDEN_404);
    // Only a lesson can be unlisted: a typo hides nothing and shows nothing.
    setUnlisted("al-ikhla,semua");
    expect(landing("/belajar/id/quran/al-ikhlas")).toMatch(HIDDEN_404);
  });

  it("does not hide Al-Fatihah, and a spelling next-intl cleans does not reach a hidden surah", () => {
    setSurahs(undefined);
    setUnlisted("al-ikhlas");
    expect(landing("/belajar/id/quran/al-fatihah/1")).toBe("/belajar/id/quran/al-fatihah/1");
    expect(landing("/belajar/id/quran/al-ikh%09las")).toBe("/belajar/id/quran/al-ikhlas");
    expect(landing("/belajar/id/quran/al-fa%09laq")).toMatch(HIDDEN_404);
    expect(landing("/belajar/id/quran/an-nas%20")).toMatch(HIDDEN_404);
  });

  it("is published by the other switch alone: BELAJAR_SURAHS wins, and the unlisted list needs no change", () => {
    setSurahs(EVERY_SURAH);
    setUnlisted("al-ikhlas");
    for (const path of MUAWWIDZAT) expect(landing(path), path).toBe(path);
  });
});

// ── Search engines (docs/belajar-plan.md L42; operator 2026-11-26: "publish belajar so google can see").
// The module is public, so what is reachable but must stay out of the index says so in an X-Robots-Tag
// header, which follows the switches per request and reaches the prerendered lesson pages; what may be
// indexed carries none. lib/indexing.ts has the rule (src/lib/indexing.test.ts holds it to the list the
// operator gave); here the real proxy is asked, as Next calls it.
describe("proxy: X-Robots-Tag for what must stay out of the index", () => {
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
    // As production has it (the image's own default is public; the learning path is listed there).
    process.env.BELAJAR_KOSAKATA_BERTAHAP = "on";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });

  const NOINDEX = "noindex, follow";
  const response = (path: string) => proxy(new NextRequest(`http://127.0.0.1:3200${path}`, { nextConfig: { basePath: "/belajar" } }));
  const tag = (path: string) => response(path).headers.get("x-robots-tag");

  it("leaves what may be indexed without the header: the Indonesian pages that are live", () => {
    for (const path of [
      "/belajar/id",
      "/belajar/id/quran",
      "/belajar/id/quran/al-fatihah",
      "/belajar/id/quran/al-fatihah/1",
      "/belajar/id/quran/pengantar",
      "/belajar/id/quran/kurikulum",
      "/belajar/id/quran/rumus",
      "/belajar/id/konsep",
      "/belajar/id/konsep/harakat",
      "/belajar/id/kosakata/rahim",
      "/belajar/id/kosakata/bertahap",
      "/belajar/id/kosakata?hal=2",
      "/belajar/id/kosakata?hal=2&utm_source=share&utm_medium=whatsapp",
      "/belajar/id/kredit",
    ]) {
      expect(tag(path), path).toBeNull();
      expect(landing(path), path).not.toMatch(HIDDEN_404);
    }
  });

  it("marks the English pages: a translated shell around Indonesian lessons is not indexed", () => {
    for (const path of ["/belajar/en", "/belajar/en/quran", "/belajar/en/quran/al-fatihah/1", "/belajar/en/konsep/harakat", "/belajar/en/kredit"]) {
      expect(tag(path), path).toBe(NOINDEX);
    }
  });

  it("marks an unlisted surah, which answers at its address, and follows BELAJAR_SURAHS when it is published", () => {
    for (const path of ["/belajar/id/quran/al-ikhlas", "/belajar/id/quran/al-ikhlas/1", "/belajar/id/quran/al-ikhlas/4/og"]) {
      expect(landing(path), path).toBe(path);
      expect(tag(path), path).toBe(NOINDEX);
    }
    // A hidden surah answers 404 and needs no tag; Al-Fatihah, published, needs none.
    expect(landing("/belajar/id/quran/al-falaq/1")).toMatch(HIDDEN_404);
    expect(tag("/belajar/id/quran/al-fatihah/1")).toBeNull();
    // Published, it is indexable at once, with no rebuild.
    setSurahs("al-fatihah,al-ikhlas");
    for (const path of ["/belajar/id/quran/al-ikhlas", "/belajar/id/quran/al-ikhlas/1"]) expect(tag(path), path).toBeNull();
    expect(tag("/belajar/id/quran/al-ikhlas/1/og")).toBe(NOINDEX);
    // Lesson zero goes with the surah that hosts it.
    expect(tag("/belajar/id/quran/pengantar")).toBeNull();
    setSurahs("an-nas");
    expect(tag("/belajar/id/quran/pengantar")).toBe(NOINDEX);
  });

  it("marks Ilmu Waris when the operator shows it, the report included", () => {
    setSwitch("on");
    for (const path of ["/belajar/id/waris", "/belajar/id/waris/hitung", "/belajar/id/waris/laporan", "/belajar/en/waris/hitung"]) {
      expect(landing(path), path).toBe(path);
      expect(tag(path), path).toBe(NOINDEX);
    }
  });

  it("marks every share card, which is an image", () => {
    for (const path of ["/belajar/id/og", "/belajar/en/og", "/belajar/id/quran/og", "/belajar/id/quran/kurikulum/og", "/belajar/id/quran/rumus/og", "/belajar/id/quran/al-fatihah/1/og"]) {
      expect(tag(path), path).toBe(NOINDEX);
    }
  });

  it("marks the Kosakata list's searches and variants, the learning path's cards and tests, and the word pages", () => {
    for (const path of [
      "/belajar/id/kosakata?q=tangan",
      "/belajar/id/kosakata?q=",
      "/belajar/id/kosakata?hal=0",
      "/belajar/id/kosakata?hal=abc",
      "/belajar/id/kosakata?hal=1&hal=2",
      "/belajar/id/kosakata/bertahap/1/1",
      "/belajar/id/kosakata/bertahap/1/1/tes",
      "/belajar/id/kosakata/bertahap/1/tes",
      "/belajar/id/kosakata/kata/1",
    ]) {
      expect(tag(path), path).toBe(NOINDEX);
    }
    // The word pages, taken by the operator; and the path's overview, while it is not listed.
    process.env.BELAJAR_KOSAKATA_WORDS_INDEXED = "on";
    expect(tag("/belajar/id/kosakata/kata/1")).toBeNull();
    delete process.env.BELAJAR_KOSAKATA_BERTAHAP;
    expect(tag("/belajar/id/kosakata/bertahap")).toBe(NOINDEX);
  });

  it("asks about the address as it arrived and as the page is served, so a cleaned spelling does not slip past", () => {
    for (const path of ["/belajar/id/quran/al-%69khlas/1", "/belajar/id/quran/al-ikh%09las", "/belajar/id/quran/al-ikhlas/"]) {
      expect(tag(path), path).toBe(NOINDEX);
    }
  });

  it("says noindex everywhere while the module is not public (BELAJAR_PUBLIC): the kill switch", () => {
    for (const value of ["false", undefined]) {
      if (value === undefined) delete process.env.BELAJAR_PUBLIC;
      else process.env.BELAJAR_PUBLIC = value;
      for (const path of ["/belajar/id", "/belajar/id/quran/al-fatihah/1", "/belajar/id/konsep/harakat", "/belajar/id/kosakata?hal=2"]) {
        expect(tag(path), `${path} ${value}`).toBe(NOINDEX);
      }
    }
  });

  it("answers no hreflang Link header (only Indonesian is indexed), and tags no redirect", () => {
    for (const path of ["/belajar/id", "/belajar/en", "/belajar/id/quran/al-fatihah/1"]) {
      expect(response(path).headers.get("link"), path).toBeNull();
    }
    for (const path of ["/belajar", "/belajar/waris", "/belajar/id/kosakata"]) {
      const res = response(path);
      expect(res.status, path).toBe(307);
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
    }
  });
});
