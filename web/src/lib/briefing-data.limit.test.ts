import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 2026-10-13: the per-platform Radar page selected EVERY post of its platform with its full text
// and handed all of it to a client component. With 222,549 mainstream posts that is 550 MB; the
// Next.js server ran out of heap and the web container restarted twice (site-wide 502s). The
// query needs the database, so this pins the source instead: the stories query is capped, its
// text is cut in SQL, and the cap stays a size a person reads.
const SRC = readFileSync(fileURLToPath(new URL("./briefing-data.ts", import.meta.url)), "utf8");

/** From `const top = db` (the ranked ids) to the end of `const topStories = await db … ;`. */
function storiesQuery(): { ranked: string; rows: string } {
  const a = SRC.indexOf("const top = db");
  const b = SRC.indexOf("const topStories = await db");
  expect(a, "the ranked-ids subquery").toBeGreaterThan(-1);
  expect(b, "the topStories query").toBeGreaterThan(a);
  return { ranked: SRC.slice(a, b), rows: SRC.slice(b, SRC.indexOf(";", SRC.indexOf(".orderBy(", b)) + 1) };
}

describe("a platform page's stories list is bounded", () => {
  it("ids are ranked and capped first, without the text; the text is read for those rows only, cut in SQL", () => {
    const { ranked, rows } = storiesQuery();
    expect(ranked).toMatch(/\.limit\(TOP_STORIES_LIMIT\)/);
    // The ranking step never selects the text: cutting it there detoasts every row (36 s measured).
    expect(ranked).not.toMatch(/socialPosts\.text\b/);
    expect(rows).toMatch(/\.from\(top\)/);
    expect(rows).toMatch(/\.innerJoin\(schema\.socialPosts, eq\(schema\.socialPosts\.id, top\.id\)\)/);
    expect(rows).toMatch(/LEFT\(COALESCE\(\$\{schema\.socialPosts\.text\}, ''\), \$\{STORY_TEXT_CHARS\}\)/);
    expect(rows).not.toMatch(/text:\s*schema\.socialPosts\.text\b/);
  });

  it("the cap is a list a person reads, and the text covers what the card shows", () => {
    const limit = Number(/export const TOP_STORIES_LIMIT = (\d+);/.exec(SRC)?.[1]);
    const chars = Number(/export const STORY_TEXT_CHARS = (\d+);/.exec(SRC)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(50);
    expect(limit).toBeLessThanOrEqual(500);
    // The card shows 280 characters and an ellipsis when there is more (PlatformStoriesFilter.tsx).
    expect(chars).toBeGreaterThan(280);
    expect(chars).toBeLessThanOrEqual(600);
  });

  it("no other query in this file selects every post's full text without a limit", () => {
    const unbounded: string[] = [];
    for (const m of SRC.matchAll(/await db\s*\.select\(/g)) {
      const end = SRC.indexOf(";", m.index);
      const stmt = SRC.slice(m.index, end);
      if (/\.from\(schema\.socialPosts\)/.test(stmt) && /text:\s*schema\.socialPosts\.text\b/.test(stmt) && !/\.limit\(/.test(stmt))
        unbounded.push(stmt.slice(0, 80));
    }
    expect(unbounded).toEqual([]);
  });
});
