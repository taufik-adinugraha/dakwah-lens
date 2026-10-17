import { getEventListeners } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { type DismissDoc, listenForDismiss } from "./dismiss";

// How an open header panel closes without its "Tutup" button (lib/dismiss.ts; operator,
// 2026-10-17: the Menu closes when the cursor or a finger clicks outside it). vitest runs in node
// with no DOM, so the document is a stand-in that keeps listeners the way a browser does (one
// entry per type + callback + capture flag; remove must name the same three) and the elements are
// stand-ins answering contains(). That a browser closes the real menu on a press outside is
// checked in CI (scripts/ci/screenshots.mjs menuShots).

type Entry = { type: string; fn: EventListenerOrEventListenerObject; capture: boolean };

function standInDocument() {
  const entries: Entry[] = [];
  const capture = (o?: boolean | EventListenerOptions) => (typeof o === "boolean" ? o : Boolean(o?.capture));
  const same = (type: string, fn: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => (e: Entry) =>
    e.type === type && e.fn === fn && e.capture === capture(o);
  const doc: DismissDoc & { entries: Entry[]; fire(type: string, event: object): void } = {
    entries,
    addEventListener(type, fn, o) {
      if (fn && !entries.some(same(type, fn, o))) entries.push({ type, fn, capture: capture(o) });
    },
    removeEventListener(type, fn, o) {
      const i = fn ? entries.findIndex(same(type, fn, o)) : -1;
      if (i >= 0) entries.splice(i, 1);
    },
    fire(type, event) {
      for (const e of entries.filter((x) => x.type === type)) {
        if (typeof e.fn === "function") e.fn(event as Event);
        else e.fn.handleEvent(event as Event);
      }
    },
  };
  return doc;
}

/** An element: contains itself and everything under it. */
type El = { contains(other: Node | null): boolean; focus: ReturnType<typeof vi.fn> };
function el(...children: El[]): El {
  const self: El = {
    contains: (other) => other === (self as unknown) || children.some((c) => c.contains(other)),
    focus: vi.fn(),
  };
  return self;
}

/** The header as the Menu sees it: the toggle button (with its icon), the panel and its rows, the page. */
function header() {
  const icon = el();
  const button = el(icon);
  const link = el();
  const tutup = el();
  const panel = el(link, tutup);
  const page = el();
  const aa = el();
  return { icon, button, link, tutup, panel, page, aa };
}

const press = (doc: ReturnType<typeof standInDocument>, target: unknown) => doc.fire("pointerdown", { target });
const key = (doc: ReturnType<typeof standInDocument>, k: string) => doc.fire("keydown", { key: k });

describe("an open header panel closes (lib/dismiss.ts)", () => {
  it("the Menu: listens to Escape and to a press, the press in the capture phase", () => {
    const doc = standInDocument();
    const h = header();
    listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close: vi.fn(), outside: true });
    expect(doc.entries.map((e) => [e.type, e.capture])).toEqual([
      ["keydown", false],
      ["pointerdown", true],
    ]);
  });

  it("a press outside the Menu and its button closes it, and leaves focus where the press put it", () => {
    for (const where of ["page", "aa"] as const) {
      const doc = standInDocument();
      const h = header();
      const close = vi.fn();
      listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close, outside: true });
      press(doc, h[where]);
      expect(close).toHaveBeenCalledTimes(1);
      expect(h.button.focus).not.toHaveBeenCalled();
    }
  });

  it("a press inside the Menu, or on its toggle button, does not close it (the button's click toggles)", () => {
    const doc = standInDocument();
    const h = header();
    const close = vi.fn();
    listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close, outside: true });
    for (const target of [h.panel, h.link, h.tutup, h.button, h.icon]) press(doc, target);
    expect(close).not.toHaveBeenCalled();
  });

  it("Escape closes the panel and puts focus back on its button; other keys do nothing", () => {
    for (const outside of [true, false]) {
      const doc = standInDocument();
      const h = header();
      const close = vi.fn();
      listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close, outside });
      key(doc, "Enter");
      key(doc, "Tab");
      expect(close).not.toHaveBeenCalled();
      key(doc, "Escape");
      expect(close).toHaveBeenCalledTimes(1);
      expect(h.button.focus).toHaveBeenCalledTimes(1);
    }
  });

  it("the Aa panel (outside: false): Escape only, a press anywhere leaves it open", () => {
    const doc = standInDocument();
    const h = header();
    const close = vi.fn();
    listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close, outside: false });
    expect(doc.entries.map((e) => e.type)).toEqual(["keydown"]);
    press(doc, h.page);
    expect(close).not.toHaveBeenCalled();
  });

  it("the cleanup (the panel closed, or the header unmounted) removes every listener; nothing lingers", () => {
    for (const outside of [true, false]) {
      const doc = standInDocument();
      const h = header();
      const close = vi.fn();
      const stop = listenForDismiss(doc, { panel: () => h.panel, button: () => h.button, close, outside });
      stop();
      expect(doc.entries).toEqual([]);
      press(doc, h.page);
      key(doc, "Escape");
      expect(close).not.toHaveBeenCalled();
    }
  });

  it("opened and closed again and again: one set of listeners at a time", () => {
    const doc = standInDocument();
    const h = header();
    const opts = { panel: () => h.panel, button: () => h.button, close: vi.fn(), outside: true };
    for (let i = 0; i < 5; i++) {
      const stop = listenForDismiss(doc, opts);
      expect(doc.entries).toHaveLength(2);
      stop();
      expect(doc.entries).toHaveLength(0);
    }
  });

  it("on a real EventTarget too: the capture flag of add and remove agree, so the cleanup removes it", () => {
    const doc = new EventTarget();
    const close = vi.fn();
    const stop = listenForDismiss(doc, { panel: () => null, button: () => null, close, outside: true });
    expect(getEventListeners(doc, "pointerdown")).toHaveLength(1);
    expect(getEventListeners(doc, "keydown")).toHaveLength(1);
    // Dispatched on the document itself: outside every panel.
    doc.dispatchEvent(new Event("pointerdown"));
    expect(close).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    expect(close).toHaveBeenCalledTimes(2);
    stop();
    expect(getEventListeners(doc, "pointerdown")).toHaveLength(0);
    expect(getEventListeners(doc, "keydown")).toHaveLength(0);
  });
});
