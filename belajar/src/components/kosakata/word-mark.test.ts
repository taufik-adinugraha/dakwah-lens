import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The marked word or part in Kosakata (operator 2026-11-04: "'bagian yang ditandai' use green which
// is indistinguishable from black"). The forest green against the ink is 2.11:1, so a mark drawn in
// it could not be told from the text beside it. The colour is one pair of tokens that two utilities
// in globals.css take: `word-mark` for a whole word of an ayah, `mark-tile` for the tile of a part
// of a word (2026-11-05: a part coloured inside its word cut through the shapes Amiri draws across
// neighbouring letters, and كَمَا showed no mim). This pins that the colour keeps its distance from
// the ink and from the ground it stands on, that both utilities take it from the tokens, and that a
// part of a word is never coloured inside its word again. How it looks is seen in the CI
// screenshots (scripts/ci/screenshots.mjs, the question and card shots).

const BELAJAR = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

const css = read("src/app/globals.css");
const token = (name: string) => {
  const hex = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
  if (!hex) throw new Error(`--color-${name} is not a six-digit hex in globals.css`);
  return hex;
};

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("word-mark: the marked word can be told from the text beside it", () => {
  const mark = token("mark");
  const tint = token("mark-bg");

  it("is read on white and on its own tint (WCAG AA, 4.5:1)", () => {
    expect(contrast(mark, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mark, token("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mark, tint)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps its distance from the ink: more than the forest green did, and 3:1 (1.4.1)", () => {
    const forest = contrast(token("forest"), token("ink"));
    expect(forest).toBeLessThan(2.2); // the figure behind the complaint
    expect(contrast(mark, token("ink"))).toBeGreaterThanOrEqual(3);
  });

  it("is not a colour the module already gives a meaning", () => {
    for (const taken of ["forest", "ok-bg", "notice", "notice-bg"]) {
      expect(mark.toLowerCase()).not.toBe(token(taken).toLowerCase());
      expect(tint.toLowerCase()).not.toBe(token(taken).toLowerCase());
    }
  });

  it("is one utility, with no padding that would break the join between a word's letters", () => {
    const util = /@utility word-mark \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(util).toContain("color: var(--color-mark);");
    expect(util).toContain("background-color: var(--color-mark-bg);");
    expect(util).not.toMatch(/padding|margin|font-weight|text-decoration/);
  });

  it("mark-tile takes the same colour and tint as word-mark, and an edge of that colour", () => {
    const tile = /@utility mark-tile \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(tile).toContain("color: var(--color-mark);");
    expect(tile).toContain("background-color: var(--color-mark-bg);");
    expect(tile).toContain("border-color: var(--color-mark);");
  });

  it("an ayah's word is marked by word-mark and a part by a tile, each with the hook CI selects on", () => {
    // data-path-mark is what scripts/ci/screenshots.mjs looks for; the colour class is not a hook
    const ayah = read("src/components/kosakata/AyahLineView.tsx");
    expect(ayah).toContain('<span data-path-mark="" className="word-mark">');
    expect(ayah).not.toMatch(/data-path-mark=""\s+className="[^"]*(text-forest|bg-ok-bg)/);
    const tiles = read("src/components/kosakata/PartTiles.tsx");
    expect(tiles).toContain('data-path-part-word=""');
    expect(tiles).toContain('data-path-mark={marked ? "" : undefined}');
    expect(tiles).toMatch(/marked \? "mark-tile border-2"/);
  });

  it("a part of a word is never coloured inside its word: the card and the question draw it on a tile", () => {
    for (const file of ["PathTest.tsx", "BatchLearn.tsx"]) {
      const src = read(`src/components/kosakata/${file}`);
      expect(src, file).toContain("<PartTiles word=");
      expect(src, file).not.toContain("word-mark");
      expect(src, file).not.toContain("data-path-mark");
    }
    expect(read("src/components/kosakata/BatchLearn.tsx")).not.toContain('<span className="text-forest">{card.word[1]}</span>');
  });

  it("the screenshot run finds the part by its hook, not by the colour it had (it failed once on .text-forest)", () => {
    const run = read("scripts/ci/screenshots.mjs");
    expect(run).toContain('page.locator("[data-path-part-word] [data-path-mark]")');
    expect(run).not.toMatch(/data-path-part-word\][^"'`]*\.text-forest/);
  });

  it("no sentence names the colour, so it stays true for a reader who cannot tell colours apart", () => {
    for (const lang of ["id", "en"]) {
      const note = (JSON.parse(read(`messages/${lang}.json`)) as { KosakataPath: Record<string, string> }).KosakataPath.part_note;
      expect(note, lang).not.toMatch(/hijau|green|merah|red/i);
    }
  });
});
