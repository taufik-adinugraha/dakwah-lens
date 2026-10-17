// The ink check's rules (linebreaks-measure.mjs inkMeasure, `judge`: no DOM), run under node on
// given geometry. A real browser runs the whole check in CI (linebreaks.mjs, with its ink
// self-test: a tile's label over rabbu, a chip's border, ”rabbu · “Tuhan); this pins the rules —
// when ink is in a neighbour's box, when it crosses a border, which quotes are drawn in the wrong
// order, which text is compared with which (operator 2026-10-17: "isim overlap with harakat").
import { describe, expect, it } from "vitest";

import { inkMeasure, INK_KINDS } from "./linebreaks-measure.mjs";

/** The geometry of the operator's tile on a phone (text-ar-md, 32px, line height 1.8 before
 *  ar-clear): the label "isim" (text-sm, leading-tight) right above the Arabic's line box. The
 *  line box starts at 100; Amiri's baseline sits ascent 36 + half-leading 0.8 under it; the ink of
 *  رَبُّ stands 1.287em = 41.2px above the baseline, 0.266em = 8.5px under it. */
const LINE_TOP = 100;
const BASELINE = LINE_TOP + 36.8;
const tile = (extra = {}) => ({
  lines: [{ left: 40, right: 100, baseline: BASELINE }],
  above: 41.2,
  below: 8.5,
  neighbours: [],
  edges: [],
  ...extra,
});
/** "isim": its text box (Inter's content area, 17px) ending where its 17.5px line ends. */
const label = (bottom) => ({ text: "isim", rects: [{ left: 55, right: 85, top: bottom - 17, bottom }] });
const judge = (runs) => inkMeasure({ judge: { runs } }).runs;

describe("inkMeasure: marks never in a neighbour", () => {
  it("the operator's tile: the shaddah + dhammah of rabbu run into the label right above its line box", () => {
    const [found] = judge([tile({ neighbours: [label(LINE_TOP - 0.25)] })]);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("ink-overlap");
    // 41.2 above a baseline 36.8 under the line top: 4.4px over it, 4.15px into the label's text
    // box (which ends 0.25px above the line box)
    expect(found[0].depth).toBeCloseTo(4.15, 1);
  });

  it("with ar-clear the box reaches 1.3em over the baseline (the composition's room): clear", () => {
    // padding-top (1.3 − 1.124 − 0.021)em = 4.96px: the line box, and the baseline, move down by it
    const run = tile({ lines: [{ left: 40, right: 100, baseline: BASELINE + 4.96 }], neighbours: [label(LINE_TOP - 0.25)] });
    expect(judge([run])).toEqual([[]]);
  });

  it("a touch within a pixel (Chromium rounds the font's ascent) is no overlap; a neighbour beside it is none", () => {
    expect(judge([tile({ neighbours: [label(BASELINE - 41.2 + 0.9)] })])).toEqual([[]]);
    // the "+" between two tiles, or the next mushaf word: level with the ink, but not over it
    const beside = { text: "+", rects: [{ left: 101, right: 120, top: 110, bottom: 140 }] };
    expect(judge([tile({ neighbours: [beside] })])).toEqual([[]]);
  });

  it("ink under the baseline into the transliteration below", () => {
    // ٱلرَّحِيمِ: 0.759em = 24.3px under the baseline; the line box ends 21px under it at 1.8
    const translit = { text: "ar-raḥīmi", rects: [{ left: 50, right: 90, top: BASELINE + 21, bottom: BASELINE + 40 }] };
    const [found] = judge([tile({ below: 24.3, neighbours: [translit] })]);
    expect(found.map((o) => o.kind)).toEqual(["ink-overlap"]);
    expect(found[0].depth).toBeCloseTo(3.3, 1);
  });

  it("a chip's own border: the dhammah of mu through the top of its pill (line height 1.6, no padding)", () => {
    // 24px, line height 1.6: the line box starts 1.9px into Amiri's ascent; ink 1.149em = 27.6px
    const base = 200 + 27 - 1.9;
    const run = { lines: [{ left: 10, right: 30, baseline: base }], above: 27.6, below: 12.4, neighbours: [], edges: [{ left: 9, right: 31, top: 200 }, { left: 9, right: 31, bottom: 238.4 }] };
    const [found] = judge([run]);
    expect(found.map((o) => `${o.kind}:${o.side}`)).toEqual(["ink-border:top"]);
    expect(found[0].depth).toBeCloseTo(2.5, 1);
    // its border is beside, not over it: nothing
    expect(judge([{ ...run, edges: [{ left: 40, right: 60, top: 200 }] }])).toEqual([[]]);
  });

  it("every line of a run that wraps is judged", () => {
    const run = tile({
      lines: [
        { left: 40, right: 100, baseline: BASELINE },
        { left: 40, right: 100, baseline: BASELINE + 70 },
      ],
      below: 30,
      neighbours: [{ text: "terjemahan", rects: [{ left: 0, right: 300, top: BASELINE + 95, bottom: BASELINE + 112 }] }],
    });
    expect(judge([run])[0].map((o) => o.kind)).toEqual(["ink-overlap"]);
  });
});

describe("inkMeasure: quotes in reading order", () => {
  const q = (open, close) => inkMeasure({ judge: { quotes: [{ open, close }] } }).quotes[0];
  it("”rabbu · “Tuhan: the closing quote drawn left of the opening one, on one line", () => {
    expect(q({ left: 60, c: 10, h: 20 }, { left: 2, c: 10, h: 20 })).toBe(true);
    expect(q({ left: 60, c: 10, h: 20 }, { left: 110, c: 10, h: 20 })).toBe(false);
  });
  it("a pair across two lines is not judged by its x", () => {
    expect(q({ left: 200, c: 10, h: 20 }, { left: 5, c: 40, h: 20 })).toBe(false);
  });
});

describe("inkMeasure: which text is compared with which", () => {
  const ghost = { id: "ghost" };
  const layer = { id: "layer" };
  const slot = { id: "sticky slot" };
  const pairs = (list) => inkMeasure({ judge: { pairs: list } }).pairs;
  it("only in the same frame and the same layer; never a form with the one it fades from", () => {
    expect(
      pairs([
        [{ world: layer, layer: slot, state: null }, { world: layer, layer: slot, state: "after" }],
        [{ world: layer, layer: slot, state: "before" }, { world: layer, layer: slot, state: "before" }],
        [{ world: layer, layer: slot, state: "before" }, { world: layer, layer: slot, state: "after" }],
        [{ world: layer, layer: slot, state: null }, { world: ghost, layer: slot, state: null }],
        [{ world: null, layer: slot, state: null }, { world: null, layer: null, state: null }],
      ]),
    ).toEqual([true, true, false, false, false]);
  });
  it("names its kinds", () => {
    expect(INK_KINDS).toEqual(["ink-overlap", "ink-border", "quote-order", "check-error"]);
  });
});
