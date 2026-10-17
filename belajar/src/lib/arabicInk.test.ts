import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { arTall, tallStack } from "./arabicInk";

// Which Arabic runs need a taller line of their own (arabicInk.ts; CI 2026-10-17: QS 113:4 word 3,
// inline, 3px into the line above). The rule was fitted to HarfBuzz measurements of every Arabic
// word the module shows (ink > 1.30em over the baseline ⇔ the rule, 0 misses in 9,493 words); this
// pins it on the content's own bytes, found by place, never typed.

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));
const json = (rel: string) => JSON.parse(readFileSync(join(BELAJAR, rel), "utf8"));
type W = { loc: string; ar: string; lemma?: string };
const words = (slug: string): W[] => json(`content/${slug}.json`).ayat.flatMap((a: { words: W[] }) => a.words);

describe("tallStack: the stacks a line of text has no room for", () => {
  it("QS 113:4 word 3 (fa + shaddah + small alif, 1.46em) and its lemma", () => {
    const w = words("al-falaq").find((x) => x.loc === "113:4:3")!;
    expect(tallStack(w.ar)).toBe(true);
    expect(tallStack(w.lemma!)).toBe(true);
    expect(arTall(w.ar)).toBe("ar-tall");
  });

  it("the tashrif forms with shaddah + dammatain (1.357em)", () => {
    const lex = json("content/library.json").lexicon as { id: string; tashrif?: { forms: { label: string; ar: string }[] } }[];
    expect(tallStack(lex.find((l) => l.id === "hada")!.tashrif!.forms.find((f) => f.label === "isim maf'ul")!.ar)).toBe(true);
    expect(tallStack(lex.find((l) => l.id === "dall")!.tashrif!.forms.find((f) => f.label === "isim fa'il")!.ar)).toBe(true);
  });

  it("no word of Al-Fatihah has one (the tallest, rabbu's ba with shaddah + dhammah, is 1.287em)", () => {
    const tall = words("al-fatihah").filter((w) => tallStack(w.ar)).map((w) => w.loc);
    expect(tall).toEqual([]);
    expect(arTall(words("al-fatihah").find((w) => w.loc === "1:2:3")!.ar)).toBe("");
  });

  it("no composed form has one: the composition's own room (globals.css, 1.33em) holds every form it draws", () => {
    // A composed form with a tall stack must raise --ar-ink-above in [data-autoplay="composition"]
    // first (and its word be walked by scripts/ci/linebreaks.mjs).
    const compose = json("content/compose/al-fatihah.json") as { words: Record<string, { forms: Record<string, { ar: string }> }> };
    const tall = Object.entries(compose.words).flatMap(([loc, u]) => Object.entries(u.forms).filter(([, f]) => tallStack(f.ar)).map(([k]) => `${loc} ${k}`));
    expect(tall).toEqual([]);
  });

  it("the Mu'awwidzat: only that one word", () => {
    const tall = ["al-ikhlas", "al-falaq", "an-nas"].flatMap((s) => words(s).filter((w) => tallStack(w.ar)).map((w) => w.loc));
    expect(tall).toEqual(["113:4:3"]);
  });
});
