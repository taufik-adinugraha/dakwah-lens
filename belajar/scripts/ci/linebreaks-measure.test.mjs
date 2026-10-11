// The line-break check's in-page logic (linebreaks-measure.mjs), run under node against a
// scripted layout: a tiny DOM whose text nodes say which line each character is on. A real
// browser runs it in CI (linebreaks.mjs, self-test included); this pins the rules themselves —
// which seams are offenders, which are the allowed fallback of a box wider than its line.
import { afterEach, describe, expect, it } from "vitest";

import { measure } from "./linebreaks-measure.mjs";

// ───── A scripted layout: each text node lists its lines as [from, to, top, left?] (char offsets;
// left: where the line starts, px). `asBox`: its lines while the kept box it is in is laid out as a
// box (data-lb-flow off) — the check takes the mark off for a moment to see that. ─────
const CHAR = 10; // px per character
class FakeText {
  constructor(data, lines, h = 22, asBox = null) {
    this.nodeType = 3;
    this.data = data;
    this.flowLines = lines ?? [[0, data.length, 0]];
    this.asBox = asBox;
    this.h = h;
    this.parentElement = null;
  }
  get textContent() {
    return this.data;
  }
  get lines() {
    if (!this.asBox) return this.flowLines;
    for (let e = this.parentElement; e; e = e.parentElement)
      if (["unit", "glue"].includes(e.getAttribute("data-lb"))) return e.hasAttribute("data-lb-flow") ? this.flowLines : this.asBox;
    return this.flowLines;
  }
}
const UA = {
  display: "inline",
  direction: "ltr",
  unicodeBidi: "normal",
  wordBreak: "normal",
  overflowWrap: "normal",
  paddingLeft: "0px",
  paddingRight: "0px",
  marginLeft: "0px",
  marginRight: "0px",
  borderLeftWidth: "0px",
  borderRightWidth: "0px",
  overflowX: "visible",
  transform: "none",
  translate: "none",
  scale: "none",
  rotate: "none",
};
class FakeEl {
  constructor(tag, attrs, style, children, rect) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.st = { ...style };
    this.children = [];
    this.childNodes = [];
    this.parentElement = null;
    this.rect = rect ?? null;
    for (const c of children ?? []) {
      c.parentElement = this;
      this.childNodes.push(c);
      if (c.nodeType === 1) this.children.push(c);
    }
  }
  get id() {
    return this.attrs.id ?? "";
  }
  getAttribute(n) {
    return n in this.attrs ? this.attrs[n] : null;
  }
  hasAttribute(n) {
    return n in this.attrs;
  }
  setAttribute(n, v) {
    this.attrs[n] = v;
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  get previousElementSibling() {
    const sibs = this.parentElement?.children ?? [];
    return sibs[sibs.indexOf(this) - 1] ?? null;
  }
  get clientWidth() {
    return this.rect?.width ?? 0;
  }
  contains(o) {
    for (let e = o; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
  /** This element and its ancestors, nearest first. */
  *chain() {
    yield this;
    for (let e = this.parentElement; e; e = e.parentElement) yield e;
  }
  checkVisibility() {
    return ![...this.chain()].some((e) => e.st.display === "none");
  }
  /** One rect per line its text is on (an inline box's fragments, without the space a line ends
   *  in, as a browser removes it), or its own rect. */
  getClientRects() {
    if (this.rect) return [this.getBoundingClientRect()];
    const byTop = new Map();
    const walk = (n) =>
      n.nodeType === 3
        ? n.lines.forEach(([f, t, top, x = 0]) => {
            const [l, r] = byTop.get(top) ?? [Infinity, -Infinity];
            byTop.set(top, [Math.min(l, x), Math.max(r, x + n.data.slice(f, t).trimEnd().length * CHAR)]);
          })
        : n.childNodes.forEach(walk);
    walk(this);
    const h = 22;
    return [...byTop].map(([top, [l, r]]) => ({ left: l, right: r, top, bottom: top + h, width: r - l, height: h }));
  }
  get scrollWidth() {
    return this.scroll ?? this.clientWidth;
  }
  set scrollWidth(w) {
    this.scroll = w;
  }
  getBoundingClientRect() {
    if (this.rect) return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height };
    const rs = [];
    const walk = (n) =>
      n.nodeType === 3 ? n.lines.forEach(([f, t, top, x = 0]) => rs.push([x, x + (t - f) * CHAR, top, top + n.h])) : n.childNodes.forEach(walk);
    walk(this);
    if (!rs.length) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    const [l, r, t, b] = [Math.min(...rs.map((x) => x[0])), Math.max(...rs.map((x) => x[1])), Math.min(...rs.map((x) => x[2])), Math.max(...rs.map((x) => x[3]))];
    return { left: l, right: r, top: t, bottom: b, width: r - l, height: b - t };
  }
  matches(sel) {
    return sel.split(",").some((s) => {
      const [parent, self] = s.trim().includes(">") ? s.split(">").map((x) => x.trim()) : [null, s.trim()];
      return compound(this, self) && (!parent || (!!this.parentElement && compound(this.parentElement, parent)));
    });
  }
  closest(sel) {
    return [...this.chain()].find((e) => e.matches(sel)) ?? null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (e) => e.children.forEach((c) => (c.matches(sel) && out.push(c), walk(c)));
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
/** tag, .class, #id, [attr], [attr="v"], [attr|="v"] — what measure() asks for. */
function compound(el, s) {
  if (s.startsWith("#")) return el.id === s.slice(1);
  const m = /^([a-z]+)?((?:\.[\w-]+|\[[^\]]+\])*)$/i.exec(s);
  if (!m) throw new Error(`selector not supported here: ${s}`);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  const classes = (el.attrs.class ?? "").split(/\s+/);
  return (m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).every((p) => {
    if (p[0] === ".") return classes.includes(p.slice(1));
    const [, name, op, v] = /^\[([\w-]+)(?:(\|?=)"([^"]*)")?\]$/.exec(p);
    const got = el.getAttribute(name);
    if (got === null) return false;
    return !op || (op === "=" ? got === v : got === v || got.startsWith(`${v}-`));
  });
}
class FakeRange {
  setStart(n, o) {
    this.n = n;
    this.s = o;
  }
  setEnd(_n, o) {
    this.e = o;
  }
  selectNodeContents(n) {
    this.n = n;
    this.s = 0;
    this.e = n.data.length;
  }
  getClientRects() {
    return this.n.lines.flatMap(([f, t, top, x = 0]) => {
      const [a, b] = [Math.max(f, this.s), Math.min(t, this.e)];
      return a < b ? [{ left: x + (a - f) * CHAR, right: x + (b - f) * CHAR, top, bottom: top + this.n.h, width: (b - a) * CHAR, height: this.n.h }] : [];
    });
  }
}

const saved = {};
function layout(body, { scrollWidth = 400, scope = null } = {}) {
  const html = new FakeEl("html", { lang: "id" }, { display: "block" }, [body], { left: 0, top: 0, width: 400, height: 1000 });
  html.scrollWidth = scrollWidth;
  const g = {
    document: {
      body,
      documentElement: html,
      createRange: () => new FakeRange(),
      querySelector: (s) => body.querySelector(s),
      createTreeWalker(root) {
        const nodes = [];
        const walk = (n) => (n.nodeType === 3 ? nodes.push(n) : n.childNodes.forEach(walk));
        walk(root);
        let i = -1;
        return { nextNode: () => nodes[++i] ?? null };
      },
    },
    window: { innerWidth: 400 },
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle(el) {
      const s = { ...UA, ...el.st };
      // inherited properties
      for (const k of ["direction", "wordBreak", "overflowWrap"]) {
        if (k in el.st) continue;
        for (let e = el.parentElement; e; e = e.parentElement) {
          if (k in e.st) {
            s[k] = e.st[k];
            break;
          }
        }
      }
      if (el.attrs.dir) {
        if (!("direction" in el.st)) s.direction = el.attrs.dir;
        if (!("unicodeBidi" in el.st)) s.unicodeBidi = "isolate";
      }
      if (el.tagName === "BDI" && !("unicodeBidi" in el.st)) s.unicodeBidi = "isolate";
      return s;
    },
  };
  for (const [k, v] of Object.entries(g)) {
    if (!(k in saved)) saved[k] = globalThis[k];
    globalThis[k] = v;
  }
  return measure({ scope });
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) globalThis[k] = v;
});

const el = (tag, attrs, style, children, rect) => new FakeEl(tag, attrs, style, children, rect);
const tx = (data, lines, h, asBox) => new FakeText(data, lines, h, asBox);
const body = (...c) => el("body", {}, { display: "block" }, c, { left: 0, top: 0, width: 400, height: 1000 });
const para = (children, width = 320) => el("p", {}, { display: "block" }, children, { left: 0, top: 0, width, height: 200 });
const bdi = (s, lines, asBox) => el("bdi", { lang: "ar", dir: "rtl" }, {}, [tx(s, lines, 40, asBox)]);
const box = (kind, children, width) => el("span", { "data-lb": kind, class: `lb-${kind}` }, { display: "inline-block" }, children, { left: 0, top: 0, width, height: 40 });
/** A kept box the fallback laid out in the flow (data-lb-flow): inline, no box of its own. With the
 *  mark off (the check measuring it as a box), `asBoxWidth` wide. */
function flowedBox(kind, children, asBoxWidth = null) {
  const e = el("span", { "data-lb": kind, class: `lb-${kind}`, "data-lb-flow": "" }, { display: "inline" }, children);
  if (asBoxWidth !== null) {
    const inFlow = FakeEl.prototype.getBoundingClientRect;
    e.getBoundingClientRect = function () {
      if (this.hasAttribute("data-lb-flow")) return inFlow.call(this);
      return { left: 0, top: 0, right: asBoxWidth, bottom: 40, width: asBoxWidth, height: 40 };
    };
  }
  return e;
}
const kinds = (r) => r.offenders.map((o) => o.kind).sort();

// Arabic samples (not content: the check's own fixtures).
const TERM = "حَرْف جَرّ";
const WORD = "كَسْرَة";
const PHRASE = "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ";

describe("linebreaks measure(): the seams it reports", () => {
  it("a term and its Arabic on two lines; a box as wide as its line is the offender, not its break", () => {
    const split = () => [tx("didahului huruf jar ", [[0, 20, 0]]), tx("(", [[0, 1, 33]]), bdi(TERM, [[0, TERM.length, 30]]), tx("), yaitu", [[0, 8, 33]])];
    expect(kinds(layout(body(para(split()))))).toEqual(["term-split"]);
    // "huruf ⏎ jar (حَرْف جَرّ)": two Latin words apart is a normal break.
    expect(kinds(layout(body(para([tx("didahului huruf ", [[0, 16, 0]]), tx("jar (", [[0, 5, 33]]), bdi(TERM, [[0, TERM.length, 30]]), tx("),", [[0, 2, 33]])]))))).toEqual([]);
    const unit = (width) =>
      box("unit", [box("part", [tx("jar", [[0, 3, 0]])], 30), tx(" ", [[0, 1, 0]]), box("part", [tx("(", [[0, 1, 33]]), bdi(TERM, [[0, TERM.length, 30]]), tx("),", [[0, 2, 33]])], 150)], width);
    // a box as wide as its line: the words around it cannot share its lines (review, 2026-10-10)
    expect(kinds(layout(body(para([unit(320)]))))).toEqual(["unit-boxed"]);
    expect(kinds(layout(body(para([unit(160)]))))).toEqual(["term-split", "unit-broken"]); // it fits, yet broke
    // a single Arabic part may wrap inside its own box, right to left (its lines right-aligned)
    const quote = box("unit", [box("part", [bdi(PHRASE, [[0, 17, 0, 150], [17, PHRASE.length, 50, 320 - (PHRASE.length - 17) * CHAR]])], 320)], 320);
    expect(kinds(layout(body(para([quote]))))).toEqual([]);
  });

  it("a kept box laid out in the flow breaks between its pieces only when it is wider than its line as a box", () => {
    // "kata huruf jar" ⏎ "(حَرْف جَرّ), lagi": in the flow; as a box it wraps at the line's full
    // width (asBox: two lines, 200px).
    const seam = (asBoxTop, asBoxWidth = 200) =>
      flowedBox("unit", [
        box("part", [tx("jar", [[0, 3, 0, 110]], 22, [[0, 3, 0]])], 30),
        tx(" ", [[0, 1, 0, 140]]),
        box("part", [tx("(", [[0, 1, 33]], 22, [[0, 1, asBoxTop]]), bdi(TERM, [[0, TERM.length, 30, 10]], [[0, TERM.length, asBoxTop - 3, 10]]), tx("),", [[0, 2, 33, 110]], 22, [[0, 2, asBoxTop]])], 150),
      ], asBoxWidth);
    const p = (s) => para([tx("kata huruf ", [[0, 11, 0]]), s, tx(" lagi", [[0, 5, 33, 130]])], 200);
    expect(kinds(layout(body(p(seam(33)))))).toEqual([]);
    // … but one that would fit on one line as a box (asBox: one line) must not break
    expect(kinds(layout(body(p(seam(0, 180)))))).toEqual(["term-split", "unit-broken"]);
    // … nor one on two lines as a box narrower than its line: broken by something else
    expect(kinds(layout(body(p(seam(33, 150)))))).toEqual(["term-split", "unit-broken"]);
    // a kept box the CSS left inline without the mark: the .lb-* rule is not applied
    const bare = el("span", { "data-lb": "unit", class: "lb-unit" }, { display: "inline" }, [tx("jar", [[0, 3, 0]])]);
    expect(kinds(layout(body(para([bare]))))).toEqual(["unit-broken"]);
  });

  it("an Arabic word and the gloss after it on two lines, but not a bracket holding Arabic, nor after a quotation", () => {
    expect(kinds(layout(body(para([tx("Kata ", [[0, 5, 0]]), bdi("«مَلِكِ»", [[0, 8, 0]]), tx(" (raja) di", [[0, 1, 0], [1, 10, 33]])]))))).toEqual(["term-split"]);
    // after a phrase of up to three words too
    expect(kinds(layout(body(para([bdi("يَوْمِ ٱلدِّينِ", [[0, 15, 0]]), tx(" (hari pembalasan)", [[0, 1, 0], [1, 18, 33]])]))))).toEqual(["term-split"]);
    expect(kinds(layout(body(para([tx("Kalimat «", [[0, 9, 0]]), bdi(PHRASE, [[0, PHRASE.length, 0]]), tx("» (segala puji)", [[0, 2, 0], [2, 15, 33]])], 400))))).toEqual([]);
    expect(kinds(layout(body(para([bdi("فَعِلَ–يَفْعَلُ", [[0, 14, 0]]), tx(" (seperti ", [[0, 1, 0], [1, 10, 33]]), bdi("عَلِمَ", [[0, 6, 33]]), tx(")", [[0, 1, 33]])]))))).toEqual([]);
  });

  it("a hyphenated word cut, unless it is a kept word wider than its line, laid out in the flow", () => {
    expect(kinds(layout(body(para([tx("surah Al-Fatihah", [[0, 9, 0], [9, 16, 33]])]))))).toEqual(["hyphen-split"]);
    // a kept word wider than its line still a box: reported as boxed
    expect(kinds(layout(body(para([box("glue", [tx("Al-Fatihah", [[0, 3, 0], [3, 10, 33]])], 320)]))))).toEqual(["unit-boxed"]);
    expect(kinds(layout(body(para([box("glue", [tx("Al-Fatihah", [[0, 3, 0], [3, 10, 33]])], 100)]))))).toEqual(["hyphen-split", "unit-broken"]);
    // in the flow: its hyphen is where it breaks, when as a box (nowrap) it sticks out
    const wide = flowedBox("glue", [tx("Al-Fatihah", [[0, 3, 0], [3, 10, 33]], 22, [[0, 10, 0]])]);
    wide.rect = null;
    Object.defineProperty(wide, "clientWidth", { get: () => (wide.hasAttribute("data-lb-flow") ? 0 : 80) });
    Object.defineProperty(wide, "scrollWidth", { get: () => (wide.hasAttribute("data-lb-flow") ? 0 : 100) });
    expect(kinds(layout(body(para([wide], 80))))).toEqual([]);
    // … but not one that fits as a box
    const fits = flowedBox("glue", [tx("Al-Fatihah", [[0, 3, 0], [3, 10, 33]], 22, [[0, 10, 0]])]);
    expect(kinds(layout(body(para([fits], 200))))).toEqual(["hyphen-split", "unit-broken"]);
  });

  it("Arabic: a phrase cut inside Latin text, a word cut inside; a block Arabic paragraph wraps freely", () => {
    const lines = [[0, 17, 0], [17, PHRASE.length, 50]];
    expect(kinds(layout(body(para([tx("Kalimat ", [[0, 8, 0]]), bdi(PHRASE, lines), tx(" muncul", [[0, 7, 50]])]))))).toEqual(["arabic-phrase-split"]);
    expect(kinds(layout(body(para([tx("kata ", [[0, 5, 0]]), bdi(WORD, [[0, 4, 0], [4, 7, 50]])]))))).toEqual(["arabic-word-split"]);
    // never inside a word, even in a box wider than its line
    expect(kinds(layout(body(para([box("part", [bdi(WORD, [[0, 4, 0], [4, 7, 50]])], 320)]))))).toEqual(["arabic-box-ltr", "arabic-word-split"]);
    const ayah = el("p", { lang: "ar", dir: "rtl" }, { display: "block" }, [tx(PHRASE, lines, 45)], { left: 0, top: 0, width: 320, height: 100 });
    expect(kinds(layout(body(ayah)))).toEqual([]);
  });

  it("an Arabic box that wraps reads right to left: its lines right-aligned", () => {
    const part = (x1, x2) => box("part", [bdi(PHRASE, [[0, 17, 0, x1], [17, PHRASE.length, 50, x2]])], 320);
    expect(kinds(layout(body(para([part(0, 0)]))))).toEqual(["arabic-box-ltr"]);
    expect(kinds(layout(body(para([part(150, 320 - (PHRASE.length - 17) * CHAR)]))))).toEqual([]);
    // Latin in it: a term's box (reported as boxed or broken instead), not an Arabic box
    const mixed = box("part", [tx("jar ", [[0, 4, 0]]), bdi(TERM, [[0, TERM.length, 50]])], 320);
    expect(kinds(layout(body(para([mixed]))))).toEqual([]);
  });

  it("Arabic inside Latin text must be isolated (lang, RTL, bdi)", () => {
    expect(kinds(layout(body(para([tx(`kata ${WORD} lagi`, [[0, 16, 0]])]))))).toEqual(["arabic-not-isolated"]);
    expect(kinds(layout(body(para([tx("kata ", [[0, 5, 0]]), bdi(WORD, [[0, 7, 0]]), tx(" lagi", [[0, 5, 0]])]))))).toEqual([]);
  });

  it("punctuation, openers, footnotes and cut Latin words", () => {
    const one = (s, cut) => kinds(layout(body(para([tx(s, [[0, cut, 0], [cut, s.length, 33]])]))));
    expect(one("nashab · Darwisy", 7)).toEqual(["line-start-punct"]);
    expect(one("nashab — Darwisy", 7)).toEqual(["line-start-punct"]);
    expect(one("kata, lagi", 4)).toEqual(["line-start-punct"]);
    expect(one("kata (lagi)", 6)).toEqual(["line-end-opener"]);
    expect(one("pembalasan.[1]", 11)).toEqual(["footnote-orphan"]);
    expect(one("Indonesia - Kementerian", 10)).toEqual(["line-start-punct"]);
    expect(one("hamidtuhu … hamdan", 10)).toEqual(["line-start-punct"]);
    expect(one("satu • dua", 5)).toEqual(["line-start-punct"]);
    expect(one("bagi -nya", 5)).toEqual([]); // a suffix may start a line
    expect(one("berhasil", 3)).toEqual(["word-split"]);
    expect(one("kata lagi", 5)).toEqual([]); // at its space: fine
    // a long code or address where the page asked for breaks anywhere
    const code = el("p", {}, { display: "block", wordBreak: "break-all" }, [tx("a1b2c3d4", [[0, 4, 0], [4, 8, 33]])], { left: 0, top: 0, width: 40, height: 60 });
    expect(kinds(layout(body(code)))).toEqual([]);
  });

  it("karaoke words: broken at the spaces between them is fine, a word cut in two is not", () => {
    const k = (w, top) => el("span", { "data-karaoke": "said" }, {}, [tx(w, [[0, w.length, top]])]);
    const sp = (top) => tx(" ", [[0, 1, top]]);
    expect(kinds(layout(body(para([k("Kata", 0), sp(0), k("pertama", 0), sp(0), k("artinya:", 33), sp(33), k("dengan", 33)]))))).toEqual([]);
    const cut = el("span", { "data-karaoke": "now" }, {}, [tx("Al-Fatihah", [[0, 3, 0], [3, 10, 33]])]);
    expect(kinds(layout(body(para([cut]))))).toEqual(["hyphen-split", "karaoke-word-broken"]);
    // a term may wrap at its own space; its fill follows the text line by line
    const term = el("span", { "data-karaoke": "now" }, {}, [tx("huruf ", [[0, 6, 0]]), tx("jar (", [[0, 5, 33]]), bdi(TERM, [[0, TERM.length, 30]]), tx("),", [[0, 2, 33]])]);
    expect(kinds(layout(body(para([term]))))).toEqual([]);
    // … but never one box the caption's width over two short lines of words
    const boxed = el("span", { "data-karaoke": "now" }, { display: "inline-block" }, [tx("jumlah ismiyyah ", [[0, 16, 0]]), tx("(", [[0, 1, 50]]), bdi(TERM, [[0, TERM.length, 50]]), tx(").", [[0, 2, 50]])], { left: 0, top: 0, width: 320, height: 80 });
    expect(kinds(layout(body(para([boxed]))))).toEqual(["karaoke-fill-wide", "term-split"]);
    // a box only as wide as its longer line: its shorter line is still under a wider fill
    const short = el("span", { "data-karaoke": "now" }, { display: "inline-block" }, [tx("kata ", [[0, 5, 0]]), tx("berikutnya lagi", [[0, 15, 33]])], { left: 0, top: 0, width: 150, height: 60 });
    expect(kinds(layout(body(para([short]))))).toEqual(["karaoke-fill-wide"]);
  });

  it("the ayah marker alone on a row, and glued to the last word", () => {
    const chip = (top) => el("button", {}, { display: "inline-flex" }, [el("span", { lang: "ar" }, {}, [tx("رَبِّ", [[0, 5, top]], 45)])], { left: 0, top, width: 80, height: 60 });
    const marker = (top) => el("span", { "aria-hidden": "", lang: "ar", "data-lb": "ayah-marker" }, { display: "block" }, [tx("﴿٢﴾", [[0, 3, top]], 45)], { left: 0, top, width: 40, height: 60 });
    const line = (children) => el("div", { dir: "rtl", class: "quran flex flex-wrap" }, { display: "flex" }, children, { left: 0, top: 0, width: 320, height: 140 });
    expect(kinds(layout(body(line([chip(0), marker(70)]))))).toEqual(["ayah-marker-alone"]);
    const end = el("span", { "data-lb": "ayah-end" }, { display: "flex" }, [chip(70), marker(70)], { left: 0, top: 70, width: 130, height: 60 });
    expect(kinds(layout(body(line([chip(0), end]))))).toEqual([]);
    // the markup before the fix (marker straight in the line) is found too
    const old = el("span", { "aria-hidden": "", lang: "ar" }, { display: "block" }, [tx("﴿٢﴾", [[0, 3, 70]], 45)], { left: 0, top: 70, width: 40, height: 60 });
    expect(kinds(layout(body(line([chip(0), old]))))).toEqual(["ayah-marker-alone"]);
  });

  it("overflow, a page that scrolls sideways, and a scope with nothing in it", () => {
    // the box and the text in it stick out of the line
    expect(kinds(layout(body(para([box("glue", [tx("Al-Fatihah-Al-Fatihah", [[0, 21, 0]])], 210)], 100))))).toEqual(["overflow", "overflow"]);
    // a box clamped to its line (max-width: 100%) with a wider word inside: the word sticks out
    const clampedGlue = box("glue", [tx("Kementerian", [[0, 11, 0]])], 50);
    clampedGlue.scroll = 110;
    expect(kinds(layout(body(para([clampedGlue], 50))))).toEqual(["overflow", "overflow"]);
    // plain text wider than its column, in no box at all
    expect(kinds(layout(body(para([tx("Penyayang”", [[0, 10, 0]])], 60))))).toEqual(["overflow"]);
    // … unless the column clips or scrolls on purpose
    const clip = el("p", {}, { display: "block", overflowX: "hidden" }, [tx("Penyayang”", [[0, 10, 0]])], { left: 0, top: 0, width: 60, height: 40 });
    expect(kinds(layout(body(clip)))).toEqual([]);
    // … or an animation is moving it (a transform between it and its column)
    const moving = el("span", {}, { transform: "matrix(1, 0, 0, 1, 40, 0)" }, [tx("Penyayang”", [[0, 10, 0]])]);
    expect(kinds(layout(body(para([moving], 60))))).toEqual([]);
    expect(kinds(layout(body(para([tx("kata", [[0, 4, 0]])])), { scrollWidth: 900 }))).toEqual(["page-overflow"]);
    const r = layout(body(el("div", { id: "empty" }, { display: "block" }, [], { left: 0, top: 0, width: 10, height: 10 })), { scope: "#empty" });
    expect(r.counts.containers).toBe(0);
  });

  it("a bug in a rule is reported, not swallowed", () => {
    const broken = el("span", { "data-lb": "unit" }, { display: "inline-block" }, [tx("x", [[0, 1, 0]])], null);
    broken.getBoundingClientRect = () => {
      throw new Error("planted");
    };
    const r = layout(body(para([tx("kata lagi", [[0, 9, 0]])]), para([broken])));
    expect(r.offenders.some((o) => o.kind === "check-error" && /planted/.test(o.detail))).toBe(true);
  });
});
