import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 2026-11-04: the landing page took 2.2 to 3.6 s to open. Its "posts analyzed" count filters
// `social_posts` on `created_at`, which had no index, so every visit made Postgres read the whole
// table (2.8 s, ~0.5 GB), and the comment above it said the query "hits an indexed column
// (<10ms)". The query needs the database, so this pins the source instead: the page asks
// lib/landing-data.ts for its figures, that file keeps them for a while, and the boot hook loads
// them without holding the server back.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const PAGE = read("../app/[locale]/page.tsx");
const DATA = read("./landing-data.ts");
const BOOT = read("../instrumentation.ts");

describe("the landing page does not run the post count itself", () => {
  it("asks landing-data for both figures and queries nothing about posts", () => {
    expect(PAGE).toMatch(/getLandingCoverage\(\)/);
    expect(PAGE).toMatch(/getLandingInsights\(\)/);
    expect(PAGE).not.toMatch(/socialPosts|social_posts|created_at/);
    expect(PAGE).not.toMatch(/\bcount\(/);
  });
});

describe("landing-data keeps its figures", () => {
  it("both public readers go through the cache, none straight to the query", () => {
    expect(DATA).toMatch(/cached\("landing:coverage", loadCoverage, \{ ttlMs: LANDING_TTL_MS \}\)/);
    expect(DATA).toMatch(/cached\("landing:insights", loadInsights, \{ ttlMs: LANDING_TTL_MS \}\)/);
    expect(DATA).not.toMatch(/export (async )?function (loadCoverage|loadInsights)/);
  });

  it("for a span that is long enough to matter and short enough to be true", () => {
    const m = /export const LANDING_TTL_MS = (\d+) \* (\d+) \* (\d+);/.exec(DATA);
    expect(m, "LANDING_TTL_MS as minutes * seconds * ms").not.toBeNull();
    const ms = Number(m![1]) * Number(m![2]) * Number(m![3]);
    // Under ten minutes the count would run often enough to matter again; over six hours a
    // briefing saved this morning would not show on the landing page this afternoon.
    expect(ms).toBeGreaterThanOrEqual(10 * 60_000);
    expect(ms).toBeLessThanOrEqual(6 * 3_600_000);
  });

  it("still counts what the nightly batch labelled, so the cache cannot hide a changed definition", () => {
    expect(DATA).toMatch(/theme_group IS NOT NULL/);
    expect(DATA).toMatch(/sentiment_label IS NOT NULL/);
    expect(DATA).toMatch(/created_at >= now\(\) - interval '30 days'/);
  });
});

describe("the boot hook loads them without holding the server back", () => {
  it("fire-and-forget, inside a try, after the import", () => {
    const at = BOOT.indexOf('await import("./lib/landing-data")');
    expect(at, "the lazy import").toBeGreaterThan(-1);
    const before = BOOT.slice(BOOT.lastIndexOf("try {", at), at);
    expect(before, "the import sits in a try block").toContain("try {");
    // register() must finish before the server takes requests: a 3 s count is never awaited there.
    expect(BOOT).toMatch(/void warmLanding\(\)/);
    expect(BOOT).not.toMatch(/await warmLanding\(/);
    expect(BOOT).toMatch(/\.catch\(/);
  });

  it("runs on the Node runtime only, and not while the site is being built", () => {
    const guards = BOOT.slice(0, BOOT.indexOf('await import("./lib/landing-data")'));
    expect(guards).toContain('process.env.NEXT_PHASE === "phase-production-build"');
    expect(guards).toContain('process.env.NEXT_RUNTIME !== "nodejs"');
  });
});
