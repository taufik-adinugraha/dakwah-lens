// The line-break check's self-test fixture (linebreaks-fixture.html, laid out in a real page by
// linebreaks.mjs before the real run), checked without a browser: it has a bad case for every kind
// the check reports, so the self-test proves each can fail; its good cases are exactly what
// MixedText renders, so "the markup as it ships passes" is about the real markup; and every slot is
// filled from content bytes.
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaptionView } from "@/components/autoplay/CaptionView";
import { MixedText } from "@/components/library/MixedText";

import { fixtureCases, fixtureValues, loadFixture } from "./linebreaks-fixture.mjs";
import { KINDS } from "./linebreaks-measure.mjs";

const BELAJAR = fileURLToPath(new URL("../../", import.meta.url));

const body = await loadFixture(BELAJAR);
const cases = fixtureCases(body);

describe("linebreaks self-test fixture", () => {
  it("has a bad case for every kind the check reports (a bug in the check is the unit tests')", () => {
    expect(cases.length).toBeGreaterThan(20);
    for (const c of cases) for (const k of c.expect) expect(KINDS, c.name).toContain(k);
    const expected = new Set(cases.flatMap((c) => c.expect));
    expect(KINDS.filter((k) => k !== "check-error" && !expected.has(k))).toEqual([]);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  it("holds exactly what MixedText renders in its good cases, and sizes the fallback's cases", () => {
    const good = cases.filter((c) => !c.expect.length);
    expect(good.map((c) => c.name)).toEqual([
      "unit-with-room",
      "item-in-bracket",
      "unit-in-flow",
      "glue-in-flow",
      "arabic-box-rtl",
      "ayah-end",
      "karaoke",
      "emphasis",
      "karaoke-emphasis",
    ]);
    const mixed = good.flatMap((c) => c.mixed.map((m) => [c.name, m]));
    expect(mixed.length).toBe(16);
    for (const [name, m] of mixed)
      expect(m.html, `${name}: "${m.text}"`).toBe(renderToStaticMarkup(createElement(MixedText, { text: m.text, emphasis: m.emphasis || undefined })));
    for (const name of ["unit-in-flow", "unit-boxed"]) expect(cases.find((c) => c.name === name)?.fit).toBe("unit");
    for (const name of ["glue-in-flow", "glue-boxed"]) expect(cases.find((c) => c.name === name)?.fit).toBe("glue");
    for (const name of ["arabic-box-rtl", "arabic-box-ltr"]) expect(cases.find((c) => c.name === name)?.fit).toBe("arabic");
  });

  it("holds every kind of emphasis, and karaoke words exactly as CaptionView draws them in every state", () => {
    const section = (name) => body.split(`data-case="${name}"`)[1].split("</section>")[0];
    expect([...section("emphasis").matchAll(/data-emph="(\w+)"/g)].map((m) => m[1])).toEqual(["term", "term", "meaning", "sound"]);
    // The karaoke words: CaptionView's markup (its transition classes aside), every state with
    // and without emphasis, the word being said a term with its Arabic.
    const p = /<p[^>]*>([\s\S]*)<\/p>/.exec(section("karaoke-emphasis"))[1];
    const words = [...p.matchAll(/<span data-mixed="([^"]*)"/g)].map((m) => m[1]);
    const states = [...p.matchAll(/data-karaoke="(\w+)"(?: data-emph="(\w+)")?/g)].map((m) => [m[1], m[2] ?? null]);
    expect(states.map(([st, e]) => `${st}:${e ?? "-"}`)).toEqual(expect.arrayContaining(["said:meaning", "now:term", "later:meaning", "said:-", "later:-"]));
    const now = states.findIndex(([st]) => st === "now");
    const drawn = renderToStaticMarkup(
      createElement(CaptionView, {
        caption: { kind: "karaoke", words: words.map((w, i) => [w, i, i + 1]), emph: states.map(([, e]) => e), now, said: now, voiced: true },
      }),
    );
    const shipped = p.replace(/<span data-mixed="[^"]*" style="display:contents">([\s\S]*?)<\/span><!--\/mixed-->/g, "$1");
    expect(drawn.replace(/ motion-safe:\S+/g, "").replace(/&amp;/g, "&")).toBe(shipped);
  });

  it("fills every slot from the dictionary and the lesson content", async () => {
    expect(body).not.toMatch(/\{\{/);
    const v = await fixtureValues(BELAJAR);
    expect(v["TERM.display"]).toBe(`${v["TERM.lead"]} ${v["TERM.last"]} (${v["TERM.ar"]})`);
    expect(v["WIDE.display"]).toBe(`${v["WIDE.lead"]} ${v["WIDE.last"]} (${v["WIDE.ar"]})`);
    expect(v.HALF1 + v.HALF2).toBe(v["ONE.ar"]);
    expect(v.HALF1 && v.HALF2).toBeTruthy();
    expect(v.QUOTE.split(" ")).toHaveLength(4);
  });
});
