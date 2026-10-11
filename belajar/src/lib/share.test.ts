import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BRIDGES, MAIN_PAGES, mainSiteHref } from "./mainSite";
import { ayahHref, hubHref, quranHref, SURAH_SLUGS } from "./routes";
import { alternatesFor, lessonShareable, ogImageUrl, pageUrl, shareMetadata, shareUrl, whatsappHref } from "./share";

// Brand, bridges to the main site and sharing (operator, 2026-10-10: "we hope this feature can
// increase traffic to main app dakwah-lens.id. at least we should put logo there").
const BELAJAR = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
type Tree = { [k: string]: string | Tree };
const messages = { id: JSON.parse(read("messages/id.json")) as Tree, en: JSON.parse(read("messages/en.json")) as Tree };
const keys = (t: Tree, prefix = ""): string[] =>
  Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
const ns = (locale: "id" | "en", name: string) => messages[locale][name] as Record<string, string>;

describe("main-site links (lib/mainSite.ts)", () => {
  it("points every bridge at a page verified on the live site, with the module's UTM tags", () => {
    // Checked 2026-10-11 by <title> on https://dakwah-lens.id (the main app answers 200 for any
    // path, so a status says nothing): Briefing Publik, Pustaka Kitab, Naskah Khutbah Jumat &
    // Kultum Pekan Ini, Dakwah-Lens.
    expect(MAIN_PAGES).toEqual({ home: "", briefings: "/briefings", kitab: "/kitab", khutbahKultum: "/khutbah-kultum" });
    const utm = (c: string) => `utm_source=belajar&utm_medium=referral&utm_campaign=${c}`;
    expect(mainSiteHref("id", BRIDGES.surah_end.page, BRIDGES.surah_end.placement)).toBe(`https://dakwah-lens.id/id/briefings?${utm("surah-end")}`);
    expect(mainSiteHref("en", BRIDGES.ayah_kitab.page, BRIDGES.ayah_kitab.placement)).toBe(`https://dakwah-lens.id/en/kitab?${utm("ayah-materials")}`);
    expect(mainSiteHref("id", BRIDGES.ayah_khutbah.page, BRIDGES.ayah_khutbah.placement)).toBe(`https://dakwah-lens.id/id/khutbah-kultum?${utm("ayah-materials")}`);
    expect(mainSiteHref("id", BRIDGES.track.page, BRIDGES.track.placement)).toBe(`https://dakwah-lens.id/id/kitab?${utm("track")}`);
    expect(mainSiteHref("en", BRIDGES.hub.page, BRIDGES.hub.placement)).toBe(`https://dakwah-lens.id/en?${utm("hub")}`);
    expect(mainSiteHref("id", "home", "footer")).toBe(`https://dakwah-lens.id/id?${utm("footer")}`);
  });

  it("labels every bridge in both locales; says klik, never ketuk", () => {
    for (const locale of ["id", "en"] as const) {
      const m = ns(locale, "MainSite");
      for (const id of Object.keys(BRIDGES)) expect(m[`${id}_label`], `${locale} MainSite.${id}_label`).toBeTruthy();
      expect(m.materials_heading).toBeTruthy();
      expect(ns(locale, "Footer").part_of).toBeTruthy();
    }
    expect(ns("id", "Footer").part_of).toBe("Bagian dari Dakwah-Lens");
    expect(ns("en", "Footer").part_of).toBe("Part of Dakwah-Lens");
    expect(ns("id", "MainSite").surah_end_label).toBe("Baca Tafsir Pekan Ini di Dakwah-Lens");
    // The footer's AI label is untouched.
    expect(ns("id", "Footer").disclaimer).toMatch(/^Dibantu AI, bukan fatwa otoritatif\./);
    for (const name of ["MainSite", "Share", "Og", "Footer"]) {
      for (const v of Object.values(ns("id", name))) expect(v).not.toMatch(/ketuk/i);
    }
  });
});

describe("sharing (lib/share.ts)", () => {
  it("builds the canonical address, the card address and the tagged share links", () => {
    expect(pageUrl("id", hubHref())).toBe("https://dakwah-lens.id/belajar/id");
    expect(pageUrl("en", quranHref())).toBe("https://dakwah-lens.id/belajar/en/quran");
    expect(ogImageUrl("id", hubHref())).toBe("https://dakwah-lens.id/belajar/id/og");
    expect(ogImageUrl("id", quranHref())).toBe("https://dakwah-lens.id/belajar/id/quran/og");
    expect(ogImageUrl("id", ayahHref("al-fatihah", 1))).toBe("https://dakwah-lens.id/belajar/id/quran/al-fatihah/1/og");
    const url = pageUrl("id", ayahHref("al-fatihah", 1));
    expect(shareUrl(url, "share")).toBe(`${url}?utm_source=share&utm_medium=share`);
    expect(shareUrl(url, "whatsapp")).toBe(`${url}?utm_source=share&utm_medium=whatsapp`);
    const wa = new URL(whatsappHref("Belajar: Al-Fatihah · Ayat 1", url));
    expect(wa.origin + wa.pathname).toBe("https://wa.me/");
    expect(wa.searchParams.get("text")).toBe(`Belajar: Al-Fatihah · Ayat 1\n${url}?utm_source=share&utm_medium=whatsapp`);
  });

  it("gives og:url the canonical address and both cards the page's own image", () => {
    const path = ayahHref("al-fatihah", 1);
    const meta = shareMetadata({ locale: "id", path, title: "T", description: "D", imageAlt: "A" });
    expect(meta.openGraph?.url).toBe(alternatesFor("id", path).canonical);
    const images = (meta.openGraph as { images: { url: string; width: number; height: number }[] }).images;
    expect(images).toEqual([expect.objectContaining({ url: ogImageUrl("id", path), width: 1200, height: 630 })]);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", images: [{ url: ogImageUrl("id", path) }] });
    expect(alternatesFor("en", path).languages).toEqual({
      id: "https://dakwah-lens.id/belajar/id/quran/al-fatihah/1",
      en: "https://dakwah-lens.id/belajar/en/quran/al-fatihah/1",
      "x-default": "https://dakwah-lens.id/belajar/id/quran/al-fatihah/1",
    });
  });

  it("has one check for what may be shared", () => {
    for (const slug of SURAH_SLUGS) expect(lessonShareable(slug)).toBe(true);
    expect(lessonShareable("al-baqarah")).toBe(false);
    // Every OG / share decision goes through it: the lesson page (metadata and button) and the
    // lesson card route.
    const page = read("src/app/[locale]/quran/[surah]/[ayah]/page.tsx");
    expect(page.match(/lessonShareable\(s\.slug\)/g)?.length).toBe(2);
    expect(read("src/app/[locale]/quran/[surah]/[ayah]/og/route.ts")).toMatch(/lessonShareable\(s\.slug\)/);
    // The track page's own path constant is the track's route.
    expect(/const TRACK_PATH = "([^"]+)"/.exec(read("src/app/[locale]/quran/page.tsx"))?.[1]).toBe(quranHref());
  });

  it("has the same message keys in both locales, every namespace", () => {
    expect(keys(messages.en).sort()).toEqual(keys(messages.id).sort());
  });
});

describe("brand in the header and footer", () => {
  it("marks what CI checks and screenshots", () => {
    const layout = read("src/app/[locale]/layout.tsx");
    expect(layout).toContain('data-brand=""');
    expect(layout).toContain('src="/belajar/dakwah-lens-logo-short-removebg.png"');
    expect(layout).toContain('alt="Dakwah-Lens"');
    expect(layout).toContain('data-main-site="footer"');
    expect(read("src/components/autoplay/SurahEndCard.tsx")).toContain('<MainSiteBridge id="surah_end"');
    expect(read("src/components/MainSiteBridge.tsx")).toContain("data-main-site={id}");
    const share = read("src/components/ShareButton.tsx");
    for (const m of ["data-share-toggle", "data-share-panel", "data-share-whatsapp", "data-share-copy", "data-share-status"]) expect(share).toContain(m);
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ["[data-brand]", '[data-main-site="footer"]', '[data-main-site="surah_end"]', "[data-share-toggle]", "[data-share-copy]", '[data-autoplay="end"]']) {
      expect(shots).toContain(sel);
    }
  });

  it("uses the main site's own logo and icons, byte for byte", () => {
    // Checked where the repo is complete (CI checks out all of it).
    const web = join(BELAJAR, "..", "web");
    if (!existsSync(web)) return;
    const same = (a: string, b: string) => expect(readFileSync(join(BELAJAR, a)).equals(readFileSync(join(web, b))), `${a} = web/${b}`).toBe(true);
    same("public/dakwah-lens-logo-short-removebg.png", "public/dakwah-lens-logo-short-removebg.png");
    same("src/app/favicon.ico", "public/favicon_io/favicon.ico");
    same("src/app/apple-icon.png", "public/favicon_io/apple-touch-icon.png");
  });
});
