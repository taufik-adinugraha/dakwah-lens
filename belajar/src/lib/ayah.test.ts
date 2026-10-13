import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// src/lib/ayat.ts is server-only (the marker package throws outside a server build).
vi.mock("server-only", () => ({}));

import raw from "../../content/ayat/locations.json";
import { GET } from "@/app/api/ayah/route";
import { AyatFile } from "@/content/ayat-schema";

import {
  AYAH_API,
  ayahApiUrl,
  ayahLookup,
  ayahRefValues,
  namesFor,
  parseAyahLoc,
  parseAyahPayload,
  RECITER,
  recitationUrl,
} from "./ayah";
import { surahNamesFor } from "./ayat";
import { getSurah, SURAHS } from "./content";

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");
const FILE = AyatFile.parse(raw);
const lookup = ayahLookup(FILE);
const MSG = { id: JSON.parse(read("messages/id.json")), en: JSON.parse(read("messages/en.json")) };
const fmt = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? String(values[k]) : all));
const FACT_LOCS = [...new Set(SURAHS.flatMap((s) => s.facts.flatMap((f) => f.locations)))];

describe("the ayah popup's locations (operator 2026-10-12)", () => {
  it("parses surah:ayah as the content writes it, and nothing else", () => {
    expect(parseAyahLoc("2:255")).toEqual({ surah: 2, ayah: 255 });
    expect(parseAyahLoc("1:1")).toEqual({ surah: 1, ayah: 1 });
    expect(parseAyahLoc("114:6")).toEqual({ surah: 114, ayah: 6 });
    for (const bad of ["", "2", "2:", ":5", "0:1", "1:0", "115:1", "02:255", "2:0255", " 2:255", "2:255 ", "2/255", "2:255:1", "abc", null, 7]) {
      expect(parseAyahLoc(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("maps a location to its EveryAyah file, SSSAAA.mp3 (Alafasy, the one imam)", () => {
    expect(RECITER).toBe("Alafasy_128kbps");
    expect(recitationUrl("2:255")).toBe("https://everyayah.com/data/Alafasy_128kbps/002255.mp3");
    expect(recitationUrl("1:1")).toBe("https://everyayah.com/data/Alafasy_128kbps/001001.mp3");
    expect(recitationUrl("114:6")).toBe("https://everyayah.com/data/Alafasy_128kbps/114006.mp3");
    // One imam (operator 2026-10-13, plan L21): the file is named by the location alone. Until then
    // a second argument named another reciter's folder; one passed now changes nothing.
    expect((recitationUrl as (loc: string, reciter: string) => string | null)("2:255", "Husary_Muallim_128kbps")).toBe(
      "https://everyayah.com/data/Alafasy_128kbps/002255.mp3",
    );
    expect(recitationUrl("115:1")).toBeNull();
  });

  it("names exactly the file every lesson already streams for that ayah: the lesson's one recitation, the same imam", () => {
    let n = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        // One imam (plan L21): the popup's file of a lesson ayah IS the lesson's recording.
        expect(a.recitation.map((r) => r.reciter), a.loc).toEqual([RECITER]);
        expect(recitationUrl(a.loc), a.loc).toBe(a.recitation[0].url);
        n++;
      }
    }
    // Every lesson ayah (until 2026-10-13 this counted 44: two reciters' files of each).
    expect(n).toBe(SURAHS.reduce((sum, s) => sum + s.ayat.length, 0));
    expect(n).toBeGreaterThanOrEqual(22);
    // and its host is one the CSP lets media come from
    expect(read("next.config.ts")).toContain('"https://everyayah.com"');
  });

  it("asks the module's own origin for one ayah at a time", () => {
    expect(AYAH_API).toBe("/belajar/api/ayah");
    expect(ayahApiUrl("2:282")).toBe("/belajar/api/ayah?loc=2:282");
    expect(ayahApiUrl("2:282&x=1")).toBeNull();
  });
});

describe("the popup's reference: QS Al-Baqarah [2]: 255", () => {
  it("formats in both locales from the surah names of the data file", () => {
    const v = ayahRefValues("2:255", FILE.names)!;
    expect(v).toEqual({ name: "Al-Baqarah", surah: 2, ayah: 255 });
    // No-break spaces keep "[2]: 255" with its name: a line never starts with "[2]" (it would read
    // as a footnote mark) or ": 255" (line breaks, operator 2026-10-10).
    expect(fmt(MSG.id.Ayah.ref, v)).toBe("QS Al-Baqarah [2]: 255");
    expect(fmt(MSG.en.Ayah.ref, v)).toBe("Surah Al-Baqarah [2]: 255");
    expect(fmt(MSG.id.Ayah.ref, ayahRefValues("3:18", FILE.names)!).replace(/ /g, " ")).toBe("QS Ali 'Imran [3]: 18");
    expect(ayahRefValues("2:255", {})).toBeNull();
    expect(ayahRefValues("nope", FILE.names)).toBeNull();
  });

  it("spells every lesson surah as its lesson does, and the surahs the fact cards name as they write them", () => {
    for (const s of SURAHS) expect(FILE.names[String(s.surah)]).toBe(s.name_id);
    expect(FILE.names["35"]).toBe("Fathir");
    expect(FILE.names["82"]).toBe("Al-Infithar");
    for (const name of Object.values(FILE.names)) expect(name).toMatch(/^[A-Z][A-Za-z' -]*[A-Za-z']$/);
  });

  it("hands a page's dialog only the names its chips point into", () => {
    expect(namesFor(["2:5", "2:6", "112:1", "bad"], FILE.names)).toEqual({ "2": "Al-Baqarah", "112": "Al-Ikhlas" });
    const fatihah = getSurah("al-fatihah")!;
    const names = surahNamesFor(fatihah.facts.flatMap((f) => f.locations));
    expect(Object.keys(names).length).toBeGreaterThan(50);
    expect(Object.keys(names).length).toBeLessThan(115);
  });
});

describe("the data lookup (content/ayat/locations.json)", () => {
  it("has one entry per fact location of every surah, hidden surahs included, and no other", () => {
    expect(FILE.ayat.map((e) => e.loc).sort()).toEqual([...FACT_LOCS].sort());
    for (const loc of FACT_LOCS) expect(lookup(loc), loc).not.toBeNull();
    expect(FACT_LOCS.length).toBeGreaterThan(1500);
  });

  it("shows an ayah that has a lesson exactly as its lesson does (Arabic, translation, footnotes, credit)", () => {
    let n = 0;
    for (const s of SURAHS) {
      for (const a of s.ayat) {
        const p = lookup(a.loc);
        if (!p) continue;
        n++;
        expect(p.ar).toBe(a.ar);
        expect(p.translation.text).toBe(a.translation.text);
        expect(p.translation.footnotes).toEqual(a.translation.footnotes);
        expect(p.translation.source_label).toBe(a.translation.source_label);
        expect(p.translation.version).toBe(a.translation.version);
        expect(p.name).toBe(s.name_id);
      }
    }
    expect(n).toBe(22);
    const p = lookup("1:4")!;
    expect(p.translation.text).toContain("[1]");
    expect(p.translation.footnotes[0]).toMatch(/^\[1\] /);
  });

  it("answers null for a location the file does not have, or a malformed one", () => {
    for (const loc of ["2:999", "103:1", "2:0255", "02:282", "", "x", null, undefined, 3]) expect(lookup(loc), String(loc)).toBeNull();
  });

  it("round-trips through the browser's check of the answer, which refuses another ayah or a broken one", () => {
    const p = lookup("2:282")!;
    expect(parseAyahPayload(JSON.parse(JSON.stringify(p)), "2:282")).toEqual(p);
    expect(parseAyahPayload(p, "2:283")).toBeNull();
    expect(parseAyahPayload({ ...p, ar: "" }, "2:282")).toBeNull();
    expect(parseAyahPayload({ ...p, translation: { ...p.translation, footnotes: [3] } }, "2:282")).toBeNull();
    expect(parseAyahPayload(null, "2:282")).toBeNull();
    expect(parseAyahPayload({ error: "not_found" }, "2:282")).toBeNull();
  });
});

describe("GET /belajar/api/ayah", () => {
  const get = (q: string) => GET(new NextRequest(`http://127.0.0.1:3200/belajar/api/ayah${q}`));

  it("answers one ayah, cacheable for a day", async () => {
    const res = await get("?loc=2:282");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await res.json()).toEqual(lookup("2:282"));
    expect((await (await get("?loc=2%3A282")).json()).loc).toBe("2:282");
  });

  it("answers 404 for a location the file has no entry for, or none at all", async () => {
    for (const q of ["?loc=2:999", "?loc=103:1", "?loc=abc", "?loc=", ""]) {
      const res = await get(q);
      expect(res.status, q).toBe(404);
      expect(res.headers.get("cache-control"), q).toBe("no-store");
    }
  });
});

describe("the popup in the code (no data file in a page, no link out, the house wording)", () => {
  it("keeps the ~1 MB data file on the server: only src/lib/ayat.ts imports it, server-only, and no client module imports that", () => {
    const files = readdirSync(join(BELAJAR, "src"), { recursive: true, encoding: "utf8" })
      .map((f) => `src/${f.split("\\").join("/")}`)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
    const importers = files.filter((f) => /^import [^;]*from "[^"]*content\/ayat\/locations\.json";$/m.test(read(f)));
    expect(importers).toEqual(["src/lib/ayat.ts"]);
    expect(read("src/lib/ayat.ts")).toMatch(/^import "server-only";$/m);
    for (const f of files) {
      const src = read(f);
      if (/^"use client";/.test(src)) expect(src, f).not.toMatch(/from "@\/lib\/ayat"/);
    }
    expect(read("src/components/surah/AyahDialog.tsx")).not.toMatch(/from "@\/lib\/ayat"/);
  });

  it("the fact cards' chips are buttons that open the dialog, never a link to quran.com", () => {
    const card = read("src/components/surah/FactCard.tsx");
    expect(card).not.toMatch(/https?:\/\/(www\.)?quran\.com/);
    expect(card).not.toMatch(/<a\b|href=/);
    expect(card).toContain("<AyahChip");
    const dialog = read("src/components/surah/AyahDialog.tsx");
    for (const marker of ["data-ayah-chip", "data-ayah-dialog", "data-ayah-play", "data-ayah-close", "showModal()", "useAyahRecitation"]) {
      expect(dialog).toContain(marker);
    }
    const hook = read("src/hooks/useAyahRecitation.ts");
    expect(hook).toContain('a.preload = "none"');
    expect(hook).toContain("AUDIO_START_EVENT");
    // The markers the CI browser checks drive (screenshots.mjs, linebreaks.mjs, surahs-smoke.mjs).
    const shots = read("scripts/ci/screenshots.mjs");
    for (const sel of ["[data-ayah-chip]", "dialog[data-ayah-dialog]", "[data-ayah-play]", "[data-ayah-close]", "[data-ayah-ar]", "[data-ayah-translation]"]) {
      expect(shots).toContain(sel);
    }
    expect(read("scripts/ci/linebreaks.mjs")).toContain("dialog[data-ayah-dialog]");
    expect(read("scripts/ci/surahs-smoke.mjs")).toContain("data-ayah-chip=");
    expect(read("src/app/globals.css")).toContain("html:has(dialog[data-ayah-dialog][open])");
  });

  it("says it plainly in both locales: Indonesian first, klik never ketuk, the lesson's loading line", () => {
    const keys = Object.keys(MSG.id.Ayah);
    expect(Object.keys(MSG.en.Ayah)).toEqual(keys);
    for (const k of ["ref", "close", "loading_text", "text_failed", "text_missing", "retry", "play", "pause", "loading_slow", "recite_failed", "recitation_credit"]) {
      expect(MSG.id.Ayah[k], `id Ayah.${k}`).toBeTruthy();
    }
    expect(MSG.id.Ayah.close).toBe("Tutup");
    for (const v of [...Object.values(MSG.id.Ayah), ...Object.values(MSG.en.Ayah)] as string[]) {
      expect(v).not.toMatch(/\b(ketuk|mengetuk|diketuk|tap)\b/i);
      expect(v).not.toMatch(/\b[A-Z]{4,}\b/); // no ALL CAPS emphasis
    }
    expect(MSG.id.Ayah.recite_failed).toContain(`klik “${MSG.id.Ayah.retry}”`);
    expect(MSG.id.Ayah.text_failed).toContain(`klik “${MSG.id.Ayah.retry}”`);
    expect(MSG.id.Guided.loading_recitation).toBe("Memuat bacaan imam…");
    expect(read("src/components/surah/AyahDialog.tsx")).toContain('tg("loading_recitation")');
    // The Kredit page's note stays true: recordings stream from the provider, nothing stored here.
    expect(MSG.id.Credits.streaming_note).toContain("langsung dari server penyedia rekaman");
  });
});
