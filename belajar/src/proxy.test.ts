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
