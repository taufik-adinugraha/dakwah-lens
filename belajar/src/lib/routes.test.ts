import { describe, expect, it } from "vitest";

import { SURAHS } from "./content";
import { CURRICULUM } from "./curriculum";
import {
  ayahHref,
  conceptHref,
  curriculumHref,
  hubHref,
  lessonHref,
  lexemeHref,
  quranHref,
  SURAH_SLUGS,
  surahHref,
  warisHref,
  wordAnchorId,
} from "./routes";
import { fragmentFor, tokenFromHash } from "./waris/questionnaire/codec";

describe("route helpers (plan L9: hub + /quran track)", () => {
  it("builds the track's lesson URLs under /quran", () => {
    expect(hubHref()).toBe("/");
    expect(quranHref()).toBe("/quran");
    expect(surahHref("al-fatihah")).toBe("/quran/al-fatihah");
    expect(ayahHref("al-fatihah", 2)).toBe("/quran/al-fatihah/2");
  });

  it("deep-links a word with the same id its card renders", () => {
    expect(wordAnchorId("1:2:3")).toBe("w-1-2-3");
    expect(ayahHref("al-fatihah", 2, "1:2:3")).toBe("/quran/al-fatihah/2#w-1-2-3");
  });

  it("keeps the shared library at hub level", () => {
    expect(conceptHref("idafah")).toBe("/konsep/idafah");
    expect(lexemeHref("rabb")).toBe("/kosakata/rabb");
  });

  it("builds the Ilmu Waris track's URLs under /waris", () => {
    expect(warisHref.track()).toBe("/waris");
    expect(warisHref.hitung()).toBe("/waris/hitung");
    expect(warisHref.hitung({ baru: true })).toBe("/waris/hitung#baru");
    expect(warisHref.laporan()).toBe("/waris/laporan");
  });

  it("puts a report's answers in the fragment the codec reads, never in a query string", () => {
    const token = "v1.AQIDBA";
    const href = warisHref.laporan(token);
    expect(href).toBe(`/waris/laporan#${fragmentFor(token)}`);
    expect(href).not.toContain("?");
    expect(tokenFromHash(href.slice(href.indexOf("#")))).toBe(token);
  });

  it("lists every surah with a lesson, so its pre-hub URLs redirect", () => {
    for (const s of SURAHS) expect(SURAH_SLUGS).toContain(s.slug);
  });

  it("lists exactly the loaded surahs, in the same (mushaf) order", () => {
    expect([...SURAH_SLUGS]).toEqual(SURAHS.map((s) => s.slug));
    expect(SURAH_SLUGS).toEqual(["al-fatihah", "al-ikhlas", "al-falaq", "an-nas"]);
  });

  it("builds Al-Mu'awwidzat lesson URLs and word anchors like Al-Fatihah's", () => {
    expect(surahHref("an-nas")).toBe("/quran/an-nas");
    expect(ayahHref("al-ikhlas", 4)).toBe("/quran/al-ikhlas/4");
    expect(ayahHref("al-falaq", 1, "113:1:2")).toBe("/quran/al-falaq/1#w-113-1-2");
  });

  it("only uses slugs that are safe inside the redirect pattern", () => {
    for (const slug of SURAH_SLUGS) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("the curriculum page and its lesson links (plan L27)", () => {
  it("sits in the track, beside the surahs: a static segment no surah slug may take", () => {
    expect(curriculumHref()).toBe("/quran/kurikulum");
    expect(curriculumHref().startsWith(`${quranHref()}/`)).toBe(true);
    const segment = curriculumHref().slice(quranHref().length + 1);
    expect(SURAH_SLUGS as readonly string[]).not.toContain(segment);
    // … nor the track's other static segment, its share card.
    expect(segment).not.toBe("og");
  });

  it("builds a lesson's link in ONE place: an ayah lesson of a surah with pages, and nothing else", () => {
    expect(lessonHref({ id: "1:4", slug: "al-fatihah", ayah: 4 })).toBe(ayahHref("al-fatihah", 4));
    expect(lessonHref({ id: "114:6", slug: "an-nas", ayah: 6 })).toBe("/quran/an-nas/6");
    // The introduction (lesson "0") has no route yet: no link, whatever else it is given.
    expect(lessonHref({ id: "0" })).toBeNull();
    expect(lessonHref({ id: "0", slug: "al-fatihah", ayah: 1 })).toBeNull();
    // A segment of a long ayah has no page; a unit without lesson pages has no slug.
    expect(lessonHref({ id: "2:255/3", ayah: 255, segment: 3 })).toBeNull();
    expect(lessonHref({ id: "2:255/3", slug: "al-fatihah", ayah: 255, segment: 3 })).toBeNull();
    expect(lessonHref({ id: "2:255", ayah: 255 })).toBeNull();
  });

  it("gives every lesson of the curriculum its page or none, from the file's own fields", () => {
    const slug = (unit: string) => CURRICULUM.units.find((u) => u.id === unit)?.slug;
    for (const l of CURRICULUM.lessons) {
      const href = lessonHref({ id: l.id, slug: slug(l.unit), ayah: l.ayah, segment: l.segment });
      const page = slug(l.unit) !== undefined && l.ayah !== undefined && l.segment === undefined;
      expect(href, l.id).toBe(page ? ayahHref(slug(l.unit)!, l.ayah!) : null);
      // A unit's slug is a surah with lesson pages, so the link can only lead to a real lesson.
      if (href) expect(SURAH_SLUGS as readonly string[], l.id).toContain(slug(l.unit));
    }
    expect(CURRICULUM.lessons[0].id).toBe("0");
  });
});
