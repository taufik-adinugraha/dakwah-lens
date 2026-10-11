import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { SURAHS } from "@/lib/content";
import { lessonShareable } from "@/lib/share";

import { type CardText, hubCard, lessonCard, trackCard, translationExcerpt, translitLine } from "./text";

// The share cards (lib/og/card.tsx) are drawn by satori, which cannot shape Arabic and which
// downloads a fallback font from the network for any glyph its fonts lack. So every card the
// build draws must be Latin only, and every character on it must be in the committed fonts.
const BELAJAR = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(BELAJAR, rel));
const messages = {
  id: JSON.parse(read("messages/id.json").toString("utf8")),
  en: JSON.parse(read("messages/en.json").toString("utf8")),
} as const;
const og = (locale: "id" | "en") => createTranslator({ locale, messages: messages[locale], namespace: "Og" });

/** Every card the og routes draw (the lesson cards: every shareable lesson, both locales). */
function allCards(): [string, CardText][] {
  const cards: [string, CardText][] = [];
  for (const locale of ["id", "en"] as const) {
    const t = og(locale);
    cards.push([`${locale} hub`, hubCard(t)], [`${locale} track`, trackCard(t)]);
    for (const s of SURAHS.filter((x) => lessonShareable(x.slug))) {
      for (const a of s.ayat) cards.push([`${locale} ${s.slug} ${a.ayah}`, lessonCard(t, s, a)]);
    }
  }
  return cards;
}
const textsOf = (c: CardText) => [c.eyebrow, c.title, c.translit, c.body, c.source, c.disclaimer].filter((x): x is string => !!x);

/** The code points a TrueType font maps (cmap formats 4 and 12; enough for these files). */
function cmap(file: string): Set<number> {
  const b = read(file);
  const tables = b.readUInt16BE(4);
  let cmapAt = -1;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("ascii", rec, rec + 4) === "cmap") cmapAt = b.readUInt32BE(rec + 8);
  }
  if (cmapAt < 0) throw new Error(`${file}: no cmap table`);
  const has = new Set<number>();
  const subtables = b.readUInt16BE(cmapAt + 2);
  for (let i = 0; i < subtables; i++) {
    const at = cmapAt + b.readUInt32BE(cmapAt + 4 + i * 8 + 4);
    const format = b.readUInt16BE(at);
    if (format === 4) {
      const segX2 = b.readUInt16BE(at + 6);
      const ends = at + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(ends + 2 * s);
        const start = b.readUInt16BE(starts + 2 * s);
        const delta = b.readInt16BE(deltas + 2 * s);
        const range = b.readUInt16BE(ranges + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph = 0;
          if (range === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = b.readUInt16BE(ranges + 2 * s + range + 2 * (c - start));
            glyph = g ? (g + delta) & 0xffff : 0;
          }
          if (glyph) has.add(c);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g++) {
        const r = at + 16 + g * 12;
        for (let c = b.readUInt32BE(r); c <= b.readUInt32BE(r + 4); c++) has.add(c);
      }
    }
  }
  return has;
}

const ARABIC = /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-﻿]/u;

describe("share cards (lib/og)", () => {
  const cards = allCards();

  it("draws a card for every shareable lesson in both locales", () => {
    const lessons = SURAHS.filter((s) => lessonShareable(s.slug)).reduce((n, s) => n + s.ayat.length, 0);
    expect(lessons).toBeGreaterThan(0);
    expect(cards).toHaveLength(2 * (2 + lessons));
  });

  it("never puts Arabic script on a card (satori does not shape it)", () => {
    for (const [name, card] of cards) {
      for (const text of textsOf(card)) expect(ARABIC.test(text), `${name}: "${text}"`).toBe(false);
    }
  });

  it("only uses characters the committed fonts draw, so satori never fetches a font", () => {
    const covered = new Set([...cmap("assets/og/Inter-Regular.ttf"), ...cmap("assets/og/Fraunces-Medium.ttf")]);
    expect(covered.size).toBeGreaterThan(500);
    const missing = new Set<string>();
    for (const [name, card] of cards) {
      for (const text of [...textsOf(card), "Dakwah-Lens", "dakwah-lens.id/belajar"]) {
        for (const ch of text) if (!covered.has(ch.codePointAt(0)!)) missing.add(`${name}: U+${ch.codePointAt(0)!.toString(16)} "${ch}"`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("carries the lesson's own transliteration and translation, with the surah and ayah", () => {
    const s = SURAHS.find((x) => x.slug === "al-fatihah")!;
    const card = lessonCard(og("id"), s, s.ayat[0]);
    expect(card.title).toBe("Al-Fatihah · Ayat 1");
    expect(card.eyebrow).toBe("Belajar Bahasa Arab Al-Qur'an");
    expect(card.translit).toBe(s.ayat[0].words.map((w) => w.translit).join(" "));
    expect(card.body).toBe(`“${s.ayat[0].translation.text}”`);
    expect(card.source).toBe(s.ayat[0].translation.source_label);
    expect(lessonCard(og("en"), s, s.ayat[0]).title).toBe("Al-Fatihah · Ayah 1");
    // The module's AI label travels with every card (AGENTS.md).
    for (const [, c] of cards) expect(c.disclaimer).toMatch(/Dibantu AI, bukan fatwa otoritatif|AI-assisted, not an authoritative fatwa/);
  });

  it("drops footnote markers and cuts a long translation at a word", () => {
    expect(translationExcerpt("Pemilik hari pembalasan.[1]")).toBe("Pemilik hari pembalasan.");
    expect(translationExcerpt("jalan yang lurus,[2] dan")).toBe("jalan yang lurus, dan");
    const long = "kata ".repeat(60).trim();
    const cut = translationExcerpt(long, 40);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(41);
    expect(cut).not.toMatch(/\s…$/);
    // Every ayah of the four surahs fits whole today (the longest, Al-Fatihah 7, is 147 characters).
    for (const s of SURAHS) for (const a of s.ayat) expect(translationExcerpt(a.translation.text).endsWith("…")).toBe(false);
    expect(translitLine(SURAHS[0].ayat[0])).toBe("bismi Allāhi ar-raḥmāni ar-raḥīmi");
  });

  it("ships the fonts' licence beside them", () => {
    for (const f of ["OFL-Inter.txt", "OFL-Fraunces.txt"]) expect(read(`assets/og/${f}`).toString("utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
  });
});
