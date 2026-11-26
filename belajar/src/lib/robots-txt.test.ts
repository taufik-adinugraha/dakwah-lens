import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";

import { SURAHS } from "./content";
import { LEXEMES } from "./lexemes";
import { sitemapEntries } from "./sitemap-paths";
import { LIBRARY } from "./library";

// THE MAIN SITE'S robots.txt MUST NEVER BLOCK /belajar (docs/belajar-plan.md L42). Google cannot see a
// `noindex` on a page it is not allowed to fetch, and the module keeps its English pages, Ilmu Waris and
// its unfinished surahs out of the index with `noindex` and an X-Robots-Tag header (src/lib/indexing.ts),
// not with robots.txt. The file is web/src/app/robots.ts, the main app's; it names the module's own sitemap.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(join(BELAJAR, "..", "web", "src", "app", "robots.ts"), "utf8");

/** The strings of the `disallow: [ ... ]` list, with its comments taken out first. */
function disallowed(): string[] {
  const list = /disallow:\s*\[([\s\S]*?)\n\s*\]/.exec(source)?.[1] ?? "";
  const code = list.replace(/\/\/[^\n]*/g, "");
  return [...code.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** Google's matching: a rule is a prefix of the path (and query) where `*` is any run of characters and a final `$` anchors the end. */
function blocks(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

describe("web/src/app/robots.ts, the main site's robots.txt", () => {
  it("reads as it should: a list of disallowed prefixes, and the sitemaps", () => {
    const rules = disallowed();
    expect(rules.length).toBeGreaterThan(5);
    expect(rules).toContain("/api/");
    for (const rule of rules) expect(rule.startsWith("/"), rule).toBe(true);
  });

  it("does not disallow /belajar, in any spelling, and names the module's own sitemap", () => {
    for (const rule of disallowed()) expect(rule, rule).not.toMatch(/belajar/i);
    expect(source).toContain("`${SITE_URL}/belajar/sitemap.xml`");
    expect(source).toContain("`${SITE_URL}/sitemap.xml`");
    expect(source).toMatch(/sitemap: \[/);
  });

  it("blocks no address the module lists in its sitemap, nor the pages that must stay out (they carry a noindex, which Google must be able to read)", () => {
    const entries = sitemapEntries({
      rt: {
        public: true,
        locales: ["id"],
        published: new Set(SURAHS.map((s) => s.slug)),
        waris: true,
        pathListed: true,
        kosakataEnglish: false,
        wordsIndexed: true,
      },
      allLocales: routing.locales,
      defaultLocale: routing.defaultLocale,
      surahs: SURAHS.map((s) => ({ slug: s.slug, ayat: s.ayat.map((a) => a.ayah) })),
      concepts: [...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)],
      lexemes: LEXEMES,
      kosakataWords: 4832,
    });
    expect(entries.length).toBeGreaterThan(5000);
    const mustStayOut = [
      "/belajar/en",
      "/belajar/en/quran/al-fatihah/1",
      "/belajar/id/waris",
      "/belajar/id/waris/hitung",
      "/belajar/id/waris/laporan",
      "/belajar/id/quran/al-ikhlas/1",
      "/belajar/id/og",
      "/belajar/id/quran/al-fatihah/1/og",
      "/belajar/id/kosakata?q=tangan",
      "/belajar/id/kosakata/bertahap/1/1",
      "/belajar/id/kosakata/bertahap/1/tes",
      "/belajar/api/surahs",
      "/belajar/sitemap.xml",
    ];
    const paths = [...entries.map((e) => new URL(e.url)).map((u) => `${u.pathname}${u.search}`), ...mustStayOut];
    for (const rule of disallowed()) {
      const hit = paths.find((p) => blocks(rule, p));
      expect(hit, `robots.txt rule ${rule} blocks ${hit}`).toBeUndefined();
    }
  });

  it("matches by Google's rules (the matcher above is the one the test trusts)", () => {
    expect(blocks("/*/admin", "/id/admin")).toBe(true);
    expect(blocks("/*/admin", "/belajar/id/admin/x")).toBe(true);
    expect(blocks("/*/admin", "/belajar/id/quran")).toBe(false);
    expect(blocks("/api/", "/api/health")).toBe(true);
    expect(blocks("/api/", "/belajar/api/health")).toBe(false);
    expect(blocks("/*/saved$", "/id/saved")).toBe(true);
    expect(blocks("/*/saved$", "/id/saved/x")).toBe(false);
  });
});
