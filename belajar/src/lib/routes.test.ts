import { describe, expect, it } from "vitest";

import { SURAHS } from "./content";
import {
  ayahHref,
  conceptHref,
  hubHref,
  lexemeHref,
  quranHref,
  SURAH_SLUGS,
  surahHref,
  wordAnchorId,
} from "./routes";

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

  it("lists every surah with a lesson, so its pre-hub URLs redirect", () => {
    for (const s of SURAHS) expect(SURAH_SLUGS).toContain(s.slug);
  });

  it("only uses slugs that are safe inside the redirect pattern", () => {
    for (const slug of SURAH_SLUGS) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
