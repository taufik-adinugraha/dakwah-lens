import { describe, expect, it } from "vitest";

import { FLOW, fitLines, flowable, severalLines, type FitBox } from "./lineFit";

// The in-flow fallback's decisions (src/lib/lineFit.ts) on plain objects; the browser side — that
// a marked box really breaks in the paragraph's flow, the words around it sharing its lines — is
// the CI self-test's (scripts/ci/linebreaks.mjs, linebreaks-fixture.html).

type Node = { nodeType: number; textContent: string | null };
const text = (s: string): Node => ({ nodeType: 3, textContent: s });
const element: Node = { nodeType: 1, textContent: "" };

/** A box whose layout as a box is `wide` (it wraps or sticks out). */
function fake(kind: string, childNodes: Node[], wide = false, marked = false) {
  const attrs = new Map<string, string>([["data-lb", kind]]);
  if (marked) attrs.set(FLOW, "");
  return {
    wide,
    childNodes,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    hasAttribute: (n: string) => attrs.has(n),
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  } satisfies FitBox & { wide: boolean };
}

describe("lineFit", () => {
  it("lays out in the flow only a box with something to break between", () => {
    expect(flowable(fake("glue", [text("Al-Fatihah")]))).toBe(true);
    // a seam: two parts
    expect(flowable(fake("unit", [element, text(" "), element]))).toBe(true);
    // a term: its first word, then its seam
    expect(flowable(fake("unit", [text("huruf "), element]))).toBe(true);
    // one Arabic part: it wraps inside its own right-to-left box instead
    expect(flowable(fake("unit", [element]))).toBe(false);
    expect(flowable(fake("unit", [text(" "), element, text("")]))).toBe(false);
    expect(flowable(fake("part", [text("jar")]))).toBe(false);
  });

  it("tells several lines from one (an Amiri run beside Inter text is a few px off)", () => {
    const r = (top: number, height: number, width = 10) => ({ top, bottom: top + height, height, width });
    expect(severalLines([r(10, 22), r(4, 42), r(11, 22)])).toBe(false);
    expect(severalLines([r(10, 22), r(43, 22)])).toBe(true);
    // empty boxes (a collapsed space at a line's end) are not a line
    expect(severalLines([r(10, 22), r(43, 22, 0), r(80, 0)])).toBe(false);
    expect(severalLines([])).toBe(false);
  });

  it("clears every mark, then marks each box too wide for its line, measured as a box", () => {
    const wide = fake("unit", [text("huruf "), element], true);
    const fits = fake("unit", [text("huruf "), element], false, true); // a mark left from a narrower screen
    const arabic = fake("unit", [element], true);
    const glue = fake("glue", [text("Al-Fatihah")], true);
    const seenMarked: boolean[] = [];
    const n = fitLines([wide, fits, arabic, glue], (b) => {
      seenMarked.push(b.hasAttribute(FLOW));
      return (b as typeof wide).wide;
    });
    expect(n).toBe(2);
    expect([wide, fits, arabic, glue].map((b) => b.hasAttribute(FLOW))).toEqual([true, false, false, true]);
    // every box was measured unmarked (as a box), and the one-part unit not at all
    expect(seenMarked).toEqual([false, false, false]);
  });
});
