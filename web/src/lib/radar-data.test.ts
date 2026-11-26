import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-11-26: /radar took 5-10 s and /radar/youtube 16 s on every visit. The layout reads the
// session cookie, so `revalidate` never cached them, and /radar began with two lifetime counts
// of social_posts that nothing displayed (2.1 s + 3.4 s, one after the other). The figures now
// live in lib/radar-data.ts behind the in-process cache, and the boot hook loads them.

// The queries need the database, so they are replaced by counters. Every mocked reader records
// how many loads run at the same moment, so the warm-up's one-at-a-time rule can be checked.
const h = vi.hoisted(() => {
  const state = { calls: [] as string[], running: 0, peak: 0 };
  const fake = (name: string, value: unknown = []) =>
    vi.fn(async (...args: unknown[]) => {
      state.calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      state.running += 1;
      state.peak = Math.max(state.peak, state.running);
      await new Promise((r) => setTimeout(r, 1));
      state.running -= 1;
      return value;
    });
  return { state, fake };
});
const calls = h.state.calls;

vi.mock("@/lib/briefing-data", () => ({
  getOverviewInsights: h.fake("getOverviewInsights", null),
  getPlatformInsights: h.fake("getPlatformInsights", null),
  getTopEngagedPosts: h.fake("getTopEngagedPosts"),
}));
vi.mock("@/lib/dashboard-metrics", () => ({
  getPlatformDistribution7d: h.fake("getPlatformDistribution7d"),
  getRisingVideos: h.fake("getRisingVideos"),
  getSentimentByPlatform7d: h.fake("getSentimentByPlatform7d"),
  getSentimentDistribution7d: h.fake("getSentimentDistribution7d", {}),
  getThemeGroupReachDelta: h.fake("getThemeGroupReachDelta"),
  getTopIssues: h.fake("getTopIssues"),
  getTopicDistribution7d: h.fake("getTopicDistribution7d"),
  getTopicsByPlatform7d: h.fake("getTopicsByPlatform7d"),
}));

const { clearCache } = await import("./stale-while-revalidate");
const radar = await import("./radar-data");

beforeEach(() => {
  clearCache();
  calls.length = 0;
  h.state.running = 0;
  h.state.peak = 0;
});

describe("the radar figures are kept", () => {
  it("a second visit does not query again", async () => {
    await radar.getRadarOverview();
    const first = calls.length;
    await radar.getRadarOverview();
    await radar.getCachedPlatformInsights("youtube");
    await radar.getCachedPlatformInsights("youtube");
    expect(first).toBe(7);
    expect(calls.length).toBe(8);
  });

  it("mainstream keeps one copy per scope and region, so a filter never shows another filter's figures", async () => {
    await radar.getCachedPlatformInsights("mainstream", { scope: "all", region: null });
    await radar.getCachedPlatformInsights("mainstream", { scope: "national", region: null });
    await radar.getCachedPlatformInsights("mainstream", { scope: "regional", region: "Aceh" });
    await radar.getCachedPlatformInsights("mainstream", { scope: "regional", region: "Bali" });
    await radar.getCachedPlatformInsights("mainstream", { scope: "regional", region: "Aceh" });
    expect(calls.filter((c) => c.startsWith("getPlatformInsights"))).toHaveLength(4);
  });

  it("other platforms ignore the filters, as their query does, and share one copy", async () => {
    await radar.getCachedPlatformInsights("youtube", { scope: "national", region: null });
    await radar.getCachedPlatformInsights("youtube", { scope: "all", region: null });
    expect(calls.filter((c) => c.startsWith("getPlatformInsights"))).toHaveLength(1);
  });

  it("each platform gets the panels it showed before", async () => {
    await radar.getCachedPlatformExtras("youtube");
    await radar.getCachedPlatformExtras("mainstream");
    await radar.getCachedPlatformExtras("tiktok");
    expect(calls.sort()).toEqual(
      [
        'getRisingVideos(10)',
        'getThemeGroupReachDelta("mainstream")',
        'getThemeGroupReachDelta("youtube")',
        'getTopEngagedPosts("youtube",10)',
      ].sort(),
    );
  });
});

describe("the boot warm-up", () => {
  it("loads /radar and every platform, one page at a time", async () => {
    await radar.warmRadar();
    expect(calls).toContain("getOverviewInsights()");
    for (const p of ["mainstream", "youtube", "tiktok", "x", "instagram", "facebook"]) {
      expect(calls.some((c) => c.startsWith(`getPlatformInsights("${p}"`))).toBe(true);
    }
    // /radar's own seven queries run together (as the page always ran them); the platform
    // pages, which read most of social_posts, never overlap each other or /radar.
    const firstPlatform = calls.findIndex((c) => c.startsWith("getPlatformInsights"));
    expect(calls.slice(firstPlatform).every((c) => !c.startsWith("getTopIssues"))).toBe(true);
    expect(h.state.peak).toBeLessThanOrEqual(7);
  });

  it("never holds more than one platform load at once", async () => {
    await radar.getRadarOverview();
    h.state.peak = 0;
    await radar.warmRadar();
    expect(h.state.peak).toBeLessThanOrEqual(3);
  });
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
/** The code alone: the comments explain the old queries by name. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the pages read through the cache", () => {
  const RADAR = read("../app/[locale]/radar/page.tsx");
  const PLATFORM = read("../app/[locale]/radar/[platform]/page.tsx");

  it("/radar asks radar-data and runs none of its queries itself", () => {
    expect(RADAR).toMatch(/await getRadarOverview\(\)/);
    expect(RADAR).not.toMatch(/getOverviewInsights|getTopIssues\(|Distribution7d\(|ByPlatform7d\(/);
  });

  it("/radar/<platform> asks radar-data, and reads the session itself", () => {
    expect(PLATFORM).toMatch(/getCachedPlatformInsights\(platform, filters\)/);
    expect(PLATFORM).toMatch(/getCachedPlatformExtras\(platform\)/);
    expect(PLATFORM).toMatch(/auth\(\)/);
    expect(PLATFORM).not.toMatch(/getPlatformInsights\(|getRisingVideos\(|getTopEngagedPosts\(|getThemeGroupReachDelta\(/);
  });

  it("radar-data never caches the session", () => {
    expect(code(read("./radar-data.ts"))).not.toMatch(/auth\(|@\/auth/);
  });
});

describe("the overview no longer counts the whole table", () => {
  it("getOverviewInsights has no lifetime count", () => {
    const src = read("./briefing-data.ts");
    const body = code(src.slice(
      src.indexOf("export async function getOverviewInsights"),
      src.indexOf("export async function", src.indexOf("export async function getOverviewInsights") + 10),
    ));
    expect(body).not.toMatch(/totalPosts|classifiedPosts/);
    expect(body).toMatch(/\.limit\(1\)/);
  });
});

describe("the boot hook", () => {
  const BOOT = read("../instrumentation.ts");

  it("warms radar after the landing figures, without awaiting it", () => {
    expect(BOOT.indexOf("warmRadar")).toBeGreaterThan(BOOT.indexOf("void warmLanding()"));
    expect(BOOT).not.toMatch(/await warmRadar\(|await import\("\.\/lib\/radar-data"\)/);
  });
});
