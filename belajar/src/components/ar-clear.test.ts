import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Room for the marks (operator 2026-10-17: "fix some layout to avoid overlapping between words like
// this (isim overlap with harakat)": the shaddah + dhammah of rabbu stood in its tile's "isim"
// label, and the same tile read ”rabbu · “Tuhan). One rule, globals.css `ar-clear`: a box of Arabic
// that a label, a transliteration, a tag or a border sits right above or below gets the padding its
// marks need, from Amiri's measured ink and the line height in force (--ar-lh). That it WORKS is
// measured in a browser (scripts/ci/linebreaks.mjs, inkMeasure: every text size, phone and
// desktop); this pins that every such box carries it, so a new tile cannot skip it.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(BELAJAR, rel), "utf8");

/** Every opening JSX tag in `src` that carries lang="ar", whole (its attributes across lines). */
function arabicTags(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf('lang="ar"'); i >= 0; i = src.indexOf('lang="ar"', i + 1)) {
    const start = src.lastIndexOf("<", i);
    let depth = 0;
    let end = i;
    for (let k = start + 1; k < src.length; k++) {
      const ch = src[k];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && src[k - 1] !== "=") {
        end = k;
        break;
      }
    }
    out.push(src.slice(start, end + 1));
  }
  return out;
}
const classesOf = (tag: string) => (/className=(?:"([^"]*)"|\{([\s\S]*)\})/.exec(tag)?.slice(1).find(Boolean) ?? "");

/** The components whose Arabic boxes have a label, a transliteration, a badge or a border right
 *  above or below them — each read through on 2026-10-17 — and how many such boxes each has. */
const BOXES: Record<string, number> = {
  "src/components/lesson/WordComposition.tsx": 1, // Ar: every tile, chip piece, primer name and example
  "src/components/lesson/LessonStage.tsx": 1, // the stage's word card
  "src/components/lesson/ExampleCard.tsx": 1,
  "src/components/lesson/StructureItemCard.tsx": 1,
  "src/components/lesson/TermContrastCard.tsx": 1,
  "src/components/lesson/WordCard.tsx": 1,
  "src/components/lesson/AyahPlayer.tsx": 2, // the mushaf line's words, with and without a recording
  "src/components/library/WordParts.tsx": 1,
  "src/components/library/ConceptCard.tsx": 1, // an example row's word
  "src/components/library/HarakatChart.tsx": 2, // the bare letter and the marked letter
  "src/components/library/TermText.tsx": 1, // the title's Arabic headword
  "src/components/library/StructureSection.tsx": 2, // a word over its role; a group's words
  "src/components/exercises/LabelRole.tsx": 1,
  "src/components/exercises/WhyHarakat.tsx": 1,
  "src/components/exercises/SortCase.tsx": 2, // a word to sort; the words in a bin
  "src/components/exercises/TapWord.tsx": 1,
  "src/components/exercises/WaznFactory.tsx": 1,
  "src/components/exercises/WordKind.tsx": 1,
  "src/components/rumus/RumusSheet.tsx": 1, // a formula's example word, under "Contoh"
  "src/app/[locale]/kosakata/[id]/page.tsx": 2, // the headword over its caption; a word in a row
};

/** Large Arabic (text-ar-md and up) that needs no ar-clear, and why. */
const EXEMPT: Record<string, string> = {
  "src/components/surah/AyahDialog.tsx": "a multi-line .quran paragraph (2.2) with 1.25rem of padding above it and 1rem below",
  "src/components/library/MarkCircle.tsx": "a lone mark centred on its circle by its own ink (markInk.ts), moved by a transform",
};

describe("ar-clear: room for the marks of every box of Arabic", () => {
  const css = read("src/app/globals.css");

  it("is one utility, from Amiri's measured extents and the line height in force", () => {
    expect(css).toMatch(/--ar-ascent: 1\.124;/);
    expect(css).toMatch(/--ar-descent: 0\.634;/);
    // the module's tallest stack (QS 113:4, bold 1.474em) and deepest kasrah on a lesson surface
    expect(css).toMatch(/--ar-ink-above: 1\.48;/);
    expect(css).toMatch(/--ar-ink-below: 0\.78;/);
    const util = /@utility ar-clear \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(util).toContain("padding-top: max(0px, calc((var(--ar-ink-above) - var(--ar-ascent) - (var(--ar-lh, 2) - var(--ar-ascent) - var(--ar-descent)) / 2) * 1em));");
    expect(util).toContain("padding-bottom: max(0px, calc((var(--ar-ink-below) - var(--ar-descent) - (var(--ar-lh, 2) - var(--ar-ascent) - var(--ar-descent)) / 2) * 1em));");
    // never clipped instead
    expect(util).not.toMatch(/overflow/);
  });

  it("every Arabic line height is given to it as --ar-lh, so its padding follows the line box", () => {
    for (const rule of [/\.quran \{[^}]*\}/, /\.arabic-inline \{[^}]*\}/, /\[data-autoplay="composition"\] :is\(\.arabic-inline, \.quran\) \{[^}]*\}/, /\[data-autoplay="composition"\] \.compose-ar \{[^}]*\}/]) {
      const body = rule.exec(css)?.[0] ?? "";
      expect(body, String(rule)).toMatch(/--ar-lh: [\d.]+;/);
      expect(body, String(rule)).toContain("line-height: var(--ar-lh);");
    }
    // the composition draws only content/compose's forms: its own room (rabbu 1.287em, ar-rahimi 0.759em)
    expect(css).toMatch(/\[data-autoplay="composition"\] \{\s*--ar-ink-above: 1\.3;\s*--ar-ink-below: 0\.77;\s*\}/);
  });

  it("the composition's Arabic is a box (an inline element's padding moves nothing) with it", () => {
    const src = read("src/components/lesson/WordComposition.tsx");
    const ar = /function Ar\([\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
    expect(ar).toContain('"ar-clear inline-block whitespace-nowrap"');
    // every Arabic string of the figure is drawn by Ar: no other Arabic tag in the file
    expect(arabicTags(src)).toHaveLength(1);
  });

  it("every listed component's Arabic boxes carry it", () => {
    for (const [file, n] of Object.entries(BOXES)) {
      const tags = arabicTags(read(file)).filter((t) => /\bar-clear\b/.test(classesOf(t)) || /\bar-clear\b/.test(t));
      expect(tags.length, file).toBe(n);
    }
  });

  it("no large Arabic (text-ar-md and up) in a component goes without it, unless exempt", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(BELAJAR, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== "waris") walk(rel);
        } else if (rel.endsWith(".tsx")) files.push(rel);
      }
    };
    walk("src/components");
    const bare: string[] = [];
    for (const f of files) {
      if (f in EXEMPT) continue;
      for (const t of arabicTags(read(f))) if (/text-ar-(md|lg|xl)/.test(t) && !/\bar-clear\b/.test(t)) bare.push(`${f}: ${t.replace(/\s+/g, " ").slice(0, 120)}`);
    }
    expect(bare).toEqual([]);
    // the MushafLine's words take their size from the line: pinned by name above (AyahPlayer: 2)
  });

  it("the tile's label and its transliteration · gloss line are LTR isolates inside the RTL row", () => {
    const src = read("src/components/lesson/WordComposition.tsx");
    const tile = /function Tile\([\s\S]*?\n\}\n/.exec(src)?.[0] ?? "";
    expect(tile).toMatch(/<span dir="ltr" className=\{clsx\("text-sm leading-tight whitespace-nowrap"/);
    expect(tile).toContain('<span dir="ltr" className="grid text-base leading-tight whitespace-nowrap">');
    // the gloss with its quotes stays inside that isolate
    const line = tile.slice(tile.indexOf('<span dir="ltr" className="grid'));
    expect(line).toMatch(/“\{f\.gloss\}”/);
  });
});
