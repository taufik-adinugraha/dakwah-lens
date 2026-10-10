import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/surahs/route";
import { parsePublished, type SurahRef, upNext } from "@/components/autoplay/useUpNext";

import { SURAHS } from "./content";
import { DEFAULT_SURAHS, publishedSurahs, surahPublished } from "./features";
import { SURAH_SLUGS } from "./routes";

// BELAJAR_SURAHS (operator, 2026-10-10: "let's focus on alfatihah first, show cards for other
// surah as 'segera hadir', but not clickable"; docs/belajar-plan.md L14). The proxy's gate is in
// src/proxy.test.ts, the request-time read in src/lib/features.test.ts.
const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

const saved = process.env.BELAJAR_SURAHS;
function setSurahs(value: string | undefined) {
  if (value === undefined) delete process.env.BELAJAR_SURAHS;
  else process.env.BELAJAR_SURAHS = value;
}
afterEach(() => setSurahs(saved));

const ref = (slug: string): SurahRef => {
  const s = SURAHS.find((x) => x.slug === slug);
  if (!s) throw new Error(slug);
  return { slug, name: s.name_id };
};
/** What the ayah page passes on Al-Fatihah 7: every surah after it, in mushaf order. */
const AFTER_FATIHAH = ["al-ikhlas", "al-falaq", "an-nas"].map(ref);

describe("BELAJAR_SURAHS: which surahs are published", () => {
  it("publishes Al-Fatihah only while unset (production)", () => {
    setSurahs(undefined);
    expect(DEFAULT_SURAHS).toEqual(["al-fatihah"]);
    expect(publishedSurahs()).toEqual(["al-fatihah"]);
    expect(surahPublished("al-fatihah")).toBe(true);
    for (const slug of ["al-ikhlas", "al-falaq", "an-nas"]) expect(surahPublished(slug), slug).toBe(false);
  });

  it("lists what it names, in mushaf order whatever the order written; trims, lower-cases, ignores unknown slugs", () => {
    setSurahs(SURAH_SLUGS.join(","));
    expect(publishedSurahs()).toEqual([...SURAH_SLUGS]);
    setSurahs(" an-nas ,AL-IKHLAS,al-baqarah,al-fatihah");
    expect(publishedSurahs()).toEqual(["al-fatihah", "al-ikhlas", "an-nas"]);
    expect(surahPublished("al-falaq")).toBe(false);
    setSurahs("an-nas");
    expect(publishedSurahs()).toEqual(["an-nas"]);
    expect(surahPublished("al-fatihah")).toBe(false);
  });

  it("counts a value that names no lesson as unset, so a typo cannot empty the track", () => {
    for (const v of ["", " ", ",,", "al-fatiha", "on", "semua"]) {
      setSurahs(v);
      expect(publishedSurahs(), JSON.stringify(v)).toEqual(["al-fatihah"]);
    }
  });

  it("/belajar/api/surahs lists exactly the published surahs, never cached", async () => {
    setSurahs(undefined);
    let res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ published: ["al-fatihah"] });
    setSurahs("al-fatihah,al-falaq");
    res = await GET();
    expect(await res.json()).toEqual({ published: ["al-fatihah", "al-falaq"] });
  });
});

describe("the end of a surah offers only a published one (useUpNext.ts)", () => {
  it("at the end of Al-Fatihah while it is the only one: the next surah is coming soon, nothing to click", () => {
    expect(upNext(AFTER_FATIHAH, new Set(["al-fatihah"]))).toEqual({ next: null, soon: ref("al-ikhlas") });
  });

  it("goes on to the first published surah, skipping unpublished ones", () => {
    expect(upNext(AFTER_FATIHAH, new Set(SURAH_SLUGS))).toEqual({ next: ref("al-ikhlas"), soon: null });
    expect(upNext(AFTER_FATIHAH, new Set(["al-fatihah", "an-nas"]))).toEqual({ next: ref("an-nas"), soon: null });
  });

  it("offers nothing after the last surah, or while the published list is unknown", () => {
    expect(upNext([], new Set(SURAH_SLUGS))).toEqual({ next: null, soon: null });
    expect(upNext(AFTER_FATIHAH, null)).toEqual({ next: null, soon: null });
  });

  it("reads the API's answer defensively", () => {
    expect(parsePublished({ published: ["al-fatihah", 3, null, "an-nas"] })).toEqual(new Set(["al-fatihah", "an-nas"]));
    for (const body of [null, undefined, "al-fatihah", [], {}, { published: "al-fatihah" }]) {
      expect(parsePublished(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("every place that lists or links surahs reads the switch", () => {
  it("the pages that list or link surahs read it at request time", () => {
    for (const page of [
      "src/app/[locale]/page.tsx",
      "src/app/[locale]/quran/page.tsx",
      "src/app/[locale]/konsep/[id]/page.tsx",
      "src/app/[locale]/kosakata/[id]/page.tsx",
      "src/app/[locale]/kredit/page.tsx",
    ]) {
      expect(read(page), page).toContain("await visibleSurahs()");
    }
    // A concept's full card links its examples only into a published surah; the page renders it
    // after visibleSurahs(), and the lesson page shows only the compact card (no examples).
    expect(read("src/components/library/ConceptCard.tsx")).toContain("surahPublished(s.slug) ?");
    const ayah = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    const cards = ayah.match(/<ConceptCard\b[^>]*?\/>/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).toMatch(/\bcompact\b/);
  });

  it("the lesson pages stay prerendered: the end card asks the API in the browser", () => {
    const ayah = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    expect(ayah).not.toMatch(/visibleSurahs|connection\(|surahPublished/);
    expect(ayah).toContain("following={following}");
    expect(ayah).not.toContain("nextSurah");
    const stage = read("src/components/lesson/LessonStage.tsx");
    expect(stage).toContain("useUpNext(following)");
    expect(stage).toContain("nextSurah={upNext.next}");
    expect(read("src/components/autoplay/useUpNext.ts")).toContain('"/belajar/api/surahs"');
  });

  it("nothing else builds a lesson link (each file here is gated, or is a lesson page behind the proxy)", () => {
    const allowed = new Set([
      "src/lib/routes.ts", // the helpers themselves
      "src/app/[locale]/quran/page.tsx", // published surahs only; the others are "Segera hadir" cards
      "src/app/[locale]/kosakata/[id]/page.tsx", // published surahs only; the others plain text
      "src/components/library/ConceptCard.tsx", // surahPublished()
      "src/app/[locale]/quran/[surah]/page.tsx", // within its own surah, reached only when published
      "src/app/[locale]/quran/[surah]/[ayah]/page.tsx", // ditto
      "src/components/lesson/LessonStage.tsx", // within its surah; the next surah via useUpNext
      "src/components/autoplay/useAutoplay.ts", // the hand-offs LessonStage asks for
    ]);
    const files = readdirSync(join(BELAJAR, "src"), { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f.split("\\").join("/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const linking = files.filter((f) => /\b(ayahHref|surahHref)\(/.test(read(f)));
    for (const f of linking) expect(allowed.has(f), `${f} builds a lesson link: gate it on BELAJAR_SURAHS`).toBe(true);
  });

  it("the end card says why there is nothing to click, in both locales, and marks what CI drives", () => {
    const id = JSON.parse(read("messages/id.json")) as Record<string, Record<string, string>>;
    const en = JSON.parse(read("messages/en.json")) as Record<string, Record<string, string>>;
    expect(id.Quran.coming_soon).toBe("Segera hadir");
    expect(en.Quran.coming_soon).toBe("Coming soon");
    expect(id.Guided.end_soon).toBe("Surah berikutnya, {surah}, segera hadir.");
    expect(id.Guided.end_repeat).toBe("Ulangi {surah}");
    for (const msgs of [id, en]) {
      expect(msgs.Guided.end_soon).toContain("{surah}");
      expect(msgs.Hub.quran_coming).toContain("{list}");
    }
    const card = read("src/components/autoplay/SurahEndCard.tsx");
    for (const m of ['data-autoplay="end-soon"', 'data-autoplay="end-next"', 'data-autoplay="end-repeat"']) {
      expect(card).toContain(m);
    }
    expect(read("src/app/[locale]/quran/page.tsx")).toContain("data-coming-soon={s.slug}");
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ['[data-autoplay="end-soon"]', '[data-autoplay="end-next"]', "[data-coming-soon]"]) {
      expect(shots).toContain(sel);
    }
  });

  it("CI tests the hidden surahs on a container that lists every surah, and the default one hides them", () => {
    const wf = join(BELAJAR, "..", ".github", "workflows", "deploy-belajar.yml");
    if (!existsSync(wf)) return;
    const yaml = readFileSync(wf, "utf8");
    expect(yaml).toContain(`-e BELAJAR_SURAHS=${SURAH_SLUGS.join(",")}`);
    expect(yaml).toContain("node belajar/scripts/ci/surahs-smoke.mjs --hidden");
    expect(yaml).toContain("node belajar/scripts/ci/surahs-smoke.mjs ||");
    expect(yaml).toContain("node screenshots.mjs --surahs");
  });
});
