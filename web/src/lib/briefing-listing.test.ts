import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  BRIEFING_LISTED_DAYS,
  briefingListedSql,
  isBriefingListed,
} from "./briefing-listing";

const DAY = 86_400_000;
const NOW = new Date("2026-10-29T05:00:00Z"); // 12:00 WIB

describe("isBriefingListed", () => {
  it("lists a briefing for BRIEFING_LISTED_DAYS after it is saved, then unlists it", () => {
    expect(BRIEFING_LISTED_DAYS).toBe(10);
    expect(isBriefingListed({ generatedAt: new Date(NOW.getTime() - 9 * DAY) }, NOW)).toBe(true);
    expect(isBriefingListed({ generatedAt: new Date(NOW.getTime() - 10 * DAY) }, NOW)).toBe(true);
    expect(isBriefingListed({ generatedAt: new Date(NOW.getTime() - 10 * DAY - 60_000) }, NOW)).toBe(false);
    expect(isBriefingListed({ generatedAt: new Date(NOW.getTime() - 40 * DAY) }, NOW)).toBe(false);
  });

  it("keeps an occasion edition saved far ahead listed until its event day (WIB)", () => {
    const old = new Date(NOW.getTime() - 20 * DAY);
    const occ = (date: unknown) => ({ generatedAt: old, occasionSlug: "maulid-2026", headlineStats: { gregorian_date: date } });
    expect(isBriefingListed(occ("2026-11-05"), NOW)).toBe(true);
    expect(isBriefingListed(occ("2026-10-29"), NOW)).toBe(true); // event is today
    expect(isBriefingListed(occ("2026-10-28"), NOW)).toBe(false);
    // No date, or a malformed one, falls back to the 10-day rule.
    expect(isBriefingListed(occ(undefined), NOW)).toBe(false);
    expect(isBriefingListed(occ("5 Nov"), NOW)).toBe(false);
    // A weekly row never gets the event exception.
    expect(isBriefingListed({ generatedAt: old, occasionSlug: null, headlineStats: { gregorian_date: "2026-11-05" } }, NOW)).toBe(false);
  });
});

describe("briefingListedSql", () => {
  const dialect = new PgDialect();

  it("renders the same rule in SQL, with no bound parameters", () => {
    const { sql, params } = dialect.sqlToQuery(briefingListedSql());
    expect(params).toEqual([]);
    expect(sql).toContain("generated_at >= now() - interval '10 days'");
    expect(sql).toContain("occasion_slug IS NOT NULL");
    expect(sql).toContain("(headline_stats->>'gregorian_date')::date");
    expect(sql).toContain("(now() AT TIME ZONE 'Asia/Jakarta')::date");
  });

  it("qualifies every column with the table alias when given one", () => {
    const { sql } = dialect.sqlToQuery(briefingListedSql("i"));
    expect(sql).toContain("i.generated_at >=");
    expect(sql).toContain("i.occasion_slug IS NOT NULL");
    expect(sql).toContain("i.headline_stats->>'gregorian_date'");
    expect(sql).not.toMatch(/[^.]\bgenerated_at\b/);
  });
});

// The listings query the database, so this pins the sources: each surface
// that lists briefings must keep applying the rule. Count = number of
// briefing queries in that file that are listings (direct-link getters like
// getBriefingBySlug, saved items and admin views are deliberately exempt).
const LISTING_USES: Array<[string, number]> = [
  ["./briefing-data.ts", 11],
  ["./discussions-data.ts", 1],
  ["./landing-data.ts", 1],
  ["./dashboard-metrics.ts", 3],
  ["../app/[locale]/flyers/public/page.tsx", 3],
  ["../app/sitemap.ts", 1],
];

describe("every briefing listing applies the listing window", () => {
  it.each(LISTING_USES)("%s", (rel, n) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    expect(src).toMatch(/import \{ briefingListedSql \} from "@\/lib\/briefing-listing";/);
    expect(src.match(/briefingListedSql\(/g)?.length ?? 0).toBe(n);
  });

  it.each([
    "../app/[locale]/briefings/[id]/page.tsx",
    "../app/[locale]/briefings/[id]/[deliverable]/page.tsx",
    "../app/[locale]/d/[brief]/page.tsx",
    "../app/[locale]/d/[brief]/[deliverable]/page.tsx",
    "../app/[locale]/m/[id]/page.tsx",
  ])("%s noindexes an unlisted briefing", (rel) => {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    expect(src).toMatch(/robots: isBriefingListed\(\w+\) \? undefined : \{ index: false, follow: true \}/);
  });
});
