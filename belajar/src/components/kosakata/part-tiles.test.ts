import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KosakataPath } from "@/content/kosakata-schema";

import en from "../../../messages/en.json";
import id from "../../../messages/id.json";
import { PartTiles } from "./PartTiles";

// A WORD CUT AT ITS PART IS DRAWN AS TILES (operator 2026-11-05: "it should be kamaa but i dont see mim
// here", then لَمِنَ). Amiri draws كم, لم and the lam and alif of ٱلْأَرْضِ as one shape, so colouring the
// part inside its word turned the next letter red or hid it under the tint (PartTiles.tsx). Rendered
// here as the server draws it, on every real example of path.json, in both locales. How it looks is
// seen in the CI screenshots; this pins what is drawn: the pieces in the order the word is written,
// one marked tile, the whole word whole, and no colour inside a word.

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const path = JSON.parse(readFileSync(join(BELAJAR, "content", "kosakata", "path.json"), "utf8")) as KosakataPath;
const MSG = { id, en } as const;

function render(locale: "id" | "en", word: readonly [string, string, string]): string {
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: MSG[locale], timeZone: "Asia/Jakarta", children: createElement(PartTiles, { word }) };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

type Tile = { marked: boolean; classes: string; arClasses: string; ar: string; label: string | null };
/** The tiles in document order: the row's, then the whole word's (last). */
function tilesOf(html: string): Tile[] {
  const tile = /<div dir="ltr"( data-path-mark="")? class="([^"]*)"><span lang="ar" dir="rtl" class="([^"]*)">([^<]*)<\/span>(?:<span class="sr-only">([^<]*)<\/span>)?<\/div>/g;
  return [...html.matchAll(tile)].map((m) => ({ marked: m[1] !== undefined, classes: m[2], arClasses: m[3], ar: m[4], label: m[5] ?? null }));
}
const count = (html: string, needle: string) => html.split(needle).length - 1;

const examples = Object.values(path.parts).flatMap((p) => p.examples.map((e, i) => ({ name: `${p.key}/${i === 0 ? "card" : "test"} ${e.word.join("")}`, word: e.word, form: e.voice.form })));

describe("PartTiles: a word cut at its part, drawn as tiles", () => {
  it("is drawn for every example the path has", () => {
    expect(examples).toHaveLength(Object.keys(path.parts).length * 2);
    expect(examples.length).toBeGreaterThan(30);
  });

  for (const locale of ["id", "en"] as const) {
    it(`${locale}: the pieces in the order the word is written, one marked tile, the whole word whole`, () => {
      for (const { name, word, form } of examples) {
        const html = render(locale, word);
        const all = tilesOf(html);
        const pieces = word.filter((s) => s !== "");
        expect(all, name).toHaveLength(pieces.length + 1);
        const row = all.slice(0, -1);
        const whole = all[all.length - 1];
        // the right-to-left row puts its first piece on the right: a prefix first, a stem before its suffix
        expect(row.map((t) => t.ar), name).toEqual(pieces);
        expect(html, name).toContain('<div dir="rtl" class="flex flex-wrap');
        // the whole word is the pieces joined, and is what the recording says
        expect(whole.ar, name).toBe(word.join(""));
        expect(whole.ar, name).toBe(form);
        expect(whole.marked, name).toBe(false);
        // one marked tile, the part, saying so to a screen reader; the others and the whole say nothing
        expect(row.filter((t) => t.marked), name).toHaveLength(1);
        const marked = row.find((t) => t.marked)!;
        expect(marked.ar, name).toBe(word[1]);
        expect(marked.classes, name).toContain("mark-tile");
        expect(marked.label, name).toBe(MSG[locale].KosakataPath.part_marked);
        for (const t of [...row.filter((x) => !x.marked), whole]) {
          expect(t.classes, name).not.toContain("mark-tile");
          expect(t.label, name).toBeNull();
        }
        // the hooks scripts/ci/screenshots.mjs selects on: one mark inside the word's box
        expect(count(html, 'data-path-part-word=""'), name).toBe(1);
        expect(count(html, 'data-path-mark=""'), name).toBe(1);
        // a "+" between the pieces and one arrow to the whole word
        expect(count(html, "lucide-plus"), name).toBe(pieces.length - 1);
        expect(count(html, "lucide-arrow-down"), name).toBe(1);
      }
    });
  }

  it("never colours a piece of a word inside the word", () => {
    for (const { name, word } of examples) {
      const html = render("id", word);
      expect(html, name).not.toContain("word-mark");
      // every piece of Arabic is a whole tile's text: no Arabic text sits beside a span of another colour
      const arabic = [...html.matchAll(/<span lang="ar"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
      expect(arabic, name).toEqual([...word.filter((s) => s !== ""), word.join("")]);
    }
  });

  it("gives every box of Arabic the room its marks need (ar-clear) and a size of its own: the word's the larger", () => {
    for (const { name, word } of examples) {
      const tiles = tilesOf(render("id", word));
      for (const t of tiles) expect(t.arClasses, name).toMatch(/\bar-clear\b/);
      for (const t of tiles.slice(0, -1)) expect(t.arClasses, name).toContain("text-ar-md");
      expect(tiles[tiles.length - 1].arClasses, name).toContain("text-ar-lg");
    }
  });
});
