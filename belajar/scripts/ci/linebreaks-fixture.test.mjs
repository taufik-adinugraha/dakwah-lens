// The line-break check's self-test fixture (linebreaks-fixture.html, laid out in a real page by
// linebreaks.mjs before the real run), checked without a browser: it has a bad case for every kind
// the check reports, so the self-test proves each can fail; its good cases are exactly what
// MixedText renders, so "the markup as it ships passes" is about the real markup; and every slot is
// filled from content bytes.
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
    expect(good.map((c) => c.name)).toEqual(["unit-with-room", "unit-in-flow", "glue-in-flow", "arabic-box-rtl", "ayah-end", "karaoke"]);
    const mixed = good.flatMap((c) => c.mixed.map((m) => [c.name, m]));
    expect(mixed.length).toBe(6);
    for (const [name, m] of mixed) expect(m.html, `${name}: "${m.text}"`).toBe(renderToStaticMarkup(createElement(MixedText, { text: m.text })));
    for (const name of ["unit-in-flow", "unit-boxed"]) expect(cases.find((c) => c.name === name)?.fit).toBe("unit");
    for (const name of ["glue-in-flow", "glue-boxed"]) expect(cases.find((c) => c.name === name)?.fit).toBe("glue");
    for (const name of ["arabic-box-rtl", "arabic-box-ltr"]) expect(cases.find((c) => c.name === name)?.fit).toBe("arabic");
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
