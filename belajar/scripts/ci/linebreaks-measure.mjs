// CI-only: the in-page half of linebreaks.mjs (line breaks, operator 2026-10-10: "make sure the
// line break is clean and easy to read, sometime i see wrong line break especially for arabic
// words"). Kept in its own module so vitest can run it against a scripted layout
// (linebreaks-measure.test.mjs) — the logic of the check is tested without a browser — and so
// linebreaks.mjs passes it to page.evaluate as a FUNCTION (CDP callFunctionOn), never a string
// for eval, which the module's CSP refuses. Self-contained: no imports, no closures.

/** Every kind of offender measure() reports (linebreaks.mjs prints them; its self-test fixture,
 *  linebreaks-fixture.html, must catch each one it lays out). */
export const KINDS = [
  "term-split",
  "arabic-phrase-split",
  "arabic-word-split",
  "word-split",
  "hyphen-split",
  "footnote-orphan",
  "line-start-punct",
  "line-end-opener",
  "arabic-not-isolated",
  "arabic-box-ltr",
  "unit-broken",
  "unit-boxed",
  "overflow",
  "ayah-marker-alone",
  "karaoke-word-broken",
  "karaoke-fill-wide",
  "page-overflow",
  "check-error",
];

/**
 * Runs IN THE PAGE (passed to page.evaluate as a function: self-contained, no closures).
 * `scope`: a selector to measure under (default: the whole body). Returns { counts, offenders }.
 *
 * `seams`: instead, no DOM at all — [prev, next, afterSpace, arabicBefore] per break, returns the
 * text rules each one breaks (seamKinds below). textUnits.test.ts runs it over every break
 * MixedText leaves open in the content, so the pieces it keeps together and the seams this check
 * reports are one rule, not two that can drift (review, 2026-10-10).
 */
export function measure({ scope, seams }) {
  const AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const AR_LETTERS = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
  const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
  const LETTER = /[\p{L}\p{M}\p{N}]/u;
  const LATIN = /\p{Script=Latin}/u;
  // A line never starts with closing punctuation or a separator (a spaced "-", "•", "…"; a
  // suffix "-nya" may), nor ends with an opener. (’ only as a closing quote: as the hamza sign it
  // begins words, "’alif".)
  const BAD_START = /^(?:[,.;:!?)\]}»”؟،؛·•—–…]|-(?=\s|$)|’(?!\p{L}))/u;
  const BAD_END = /[(\[{«“‘]$/u;
  /** From this many words of ≥ 2 letters an Arabic run is a quotation (textUnits QUOTE_WORDS):
   *  nothing glued to it. A gloss is kept with a run of at most GLOSS_WORDS words (textUnits
   *  GLOSS_WORDS). */
  const QUOTE_WORDS = 4;
  const GLOSS_WORDS = QUOTE_WORDS - 1;
  /** Arabic words of ≥ 2 letters in s (root letters and single letters do not count). */
  const longWords = (s) => (s.match(new RegExp(`${AR_LETTERS.source}+`, "g")) ?? []).filter((w) => w.replace(MARKS, "").length >= 2).length;
  /** Seam rules that a kept box wider than its line may break (its fallback). Never the
   *  punctuation rules: a box breaks only between its pieces, which carry their punctuation. */
  const BOX_MAY_BREAK = new Set(["hyphen-split", "term-split"]);

  /** The text rules of one line seam: `prev` the line before, `t` the line after (both trimmed),
   *  `afterSpace` whether the break is at a space, `arabicBefore` the whole Arabic run `prev` ends
   *  in. The kinds it breaks. */
  const seamKinds = (prev, t, afterSpace, arabicBefore) => {
    const out = [];
    if (BAD_START.test(t)) out.push("line-start-punct");
    if (/^\[\d+\]/.test(t)) out.push("footnote-orphan");
    if (BAD_END.test(prev)) out.push("line-end-opener");
    if (!afterSpace && /[\p{L}\p{M}\p{N}][-–—/]$/u.test(prev) && /^[\p{L}\p{N}]/u.test(t)) out.push("hyphen-split");
    // The term and its Arabic on two lines, "huruf jar ⏎ (حَرْف جَرّ)" — a bracket opening on
    // Arabic (≤ 3 words of ≥ 2 letters up to its ")", as MixedText keeps them) after a Latin word.
    const term = /^\(([^)]*)\)/.exec(t);
    if (/\p{Script=Latin}[’'ʼ]?$/u.test(prev) && term && AR.test(term[1].trim()[0] ?? "") && longWords(term[1]) < QUOTE_WORDS)
      out.push("term-split");
    // … and the gloss after a word or phrase, "«مَلِكِ» ⏎ (raja)" (not a bracket holding Arabic
    // itself within its first two words: that one belongs to its own Arabic; not after a quotation).
    if (/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][»”)]*$/.test(prev) && /^\([“‘"']?\p{Script=Latin}/u.test(t) && longWords(arabicBefore) <= GLOSS_WORDS) {
      const firstTwo = t.split(/\s+/).slice(0, 2);
      const closeAt = firstTwo.findIndex((w) => w.includes(")"));
      const inside = closeAt >= 0 ? firstTwo.slice(0, closeAt + 1) : firstTwo;
      if (!inside.some((w) => AR.test(w))) out.push("term-split");
    }
    return out;
  };
  if (seams) return seams.map(([prev, t, afterSpace, arabicBefore]) => seamKinds(prev, t, afterSpace, arabicBefore ?? ""));

  const root = (scope && document.querySelector(scope)) || document.body;
  const seg = new Intl.Segmenter("id", { granularity: "grapheme" });
  const range = document.createRange();
  const offenders = [];
  const counts = { containers: 0, lines: 0, units: 0, glued: 0, flowed: 0, arabic: 0, karaoke: 0, markers: 0 };

  const short = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const textOf = (el) => short((el.textContent || "").replace(/\s+/g, " ").trim());
  const where = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const tag = e.tagName.toLowerCase();
      const mark = e.getAttribute("data-autoplay") ?? e.getAttribute("data-lb") ?? (e.id || null);
      if (mark || parts.length === 0) parts.unshift(mark ? `${tag}[${mark}]` : tag);
    }
    return parts.join(" › ");
  };
  const push = (kind, el, detail, text) => offenders.push({ kind, where: where(el), detail, text: text ?? textOf(el) });
  /** A bug in this check is reported as an offender (and so fails the step), never swallowed. */
  const guard = (what, el, fn) => {
    try {
      fn();
    } catch (e) {
      push("check-error", el, `${what}: ${e?.stack ?? e}`, "");
    }
  };

  const css = new Map();
  const style = (el) => {
    let s = css.get(el);
    if (!s) css.set(el, (s = getComputedStyle(el)));
    return s;
  };
  const visible = new Map();
  const shown = (el) => {
    if (!el) return false;
    let v = visible.get(el);
    if (v === undefined) {
      v = !el.closest(".sr-only, script, style, noscript, title, template, svg") &&
        el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
      visible.set(el, v);
    }
    return v;
  };

  /** The block whose lines lay this element out: inline boxes (incl. inline-blocks: their lines
   *  are the paragraph's) are looked through; a flex/grid item or a chip is a block of its own. */
  const blocks = new Map();
  const blockOf = (el) => {
    const seen = [];
    let e = el;
    for (; e && e !== document.documentElement; e = e.parentElement) {
      if (blocks.has(e)) {
        e = blocks.get(e);
        break;
      }
      seen.push(e);
      const d = style(e).display;
      if (d !== "inline" && d !== "contents" && d !== "inline-block") break;
    }
    const b = e && e !== document.documentElement ? e : document.body;
    for (const s of seen) blocks.set(s, b);
    return b;
  };
  /** The box a percentage width (max-width: 100%) of `el` refers to. */
  const containingBox = (el) => {
    let e = el.parentElement;
    while (e && /^(inline|contents)$/.test(style(e).display)) e = e.parentElement;
    return e ?? document.body;
  };
  const contentWidth = (el) => {
    const s = style(el);
    return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  };
  /** An inline-block at its max-width (wider content than one line): it may wrap inside. */
  const clamped = (el) => el.getBoundingClientRect().width >= contentWidth(containingBox(el)) - 2;
  /** A unit of more than one piece or a glued word: what src/lib/lineFit.ts (flowable) lays out
   *  in the flow when it is wider than its line. A unit of one Arabic part wraps in its own box. */
  const flowable = (el) => {
    const kind = el.getAttribute("data-lb");
    if (kind === "glue") return true;
    if (kind !== "unit") return false;
    let pieces = 0;
    for (const n of el.childNodes) if (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.textContent ?? ""))) pieces++;
    return pieces > 1;
  };
  /** A kept box laid out in the flow (data-lb-flow, display inline) that is wider than its line
   *  as a box — as lineFit.ts decides: its text sticks out of the box, or it wraps at its line's
   *  full width. Measured by taking the mark off for a moment. */
  const wide = new Map();
  const tooWide = (el) => {
    let v = wide.get(el);
    if (v === undefined) {
      el.removeAttribute("data-lb-flow");
      try {
        v = el.scrollWidth > el.clientWidth + 1 || (lineCount(el) > 1 && clamped(el));
      } finally {
        el.setAttribute("data-lb-flow", "");
      }
      wide.set(el, v);
    }
    return v;
  };
  const flowed = (el) => el.hasAttribute("data-lb-flow") && style(el).display === "inline";
  /** A break between a and b is a fallback, not an offence, when both sit inside a box wider than
   *  its line: a kept box, its part or an Arabic box as an inline-block at its max-width (it can
   *  only wrap inside itself — an Arabic part or quotation at its own spaces; a boxed unit is
   *  reported by section 2), or a kept box laid out in the flow because it is wider than its line
   *  (it breaks between its pieces). Any other box breaking a term is reported. */
  const fallback = (a, b, container) => {
    for (let e = a; e && e !== container; e = e.parentElement) {
      if (!e.contains(b)) continue;
      const kept = e.hasAttribute("data-lb");
      if ((kept || e.matches('[lang|="ar"]')) && style(e).display === "inline-block" && clamped(e)) return true;
      if (kept && flowed(e) && tooWide(e)) return true;
    }
    return false;
  };
  /** Between `el` and `container`: a transform (an animation moving it) — its glyphs are where
   *  the animation puts them, not where the line does. */
  const moved = (el, container) => {
    for (let e = el; e && e !== container; e = e.parentElement) {
      const s = style(e);
      if ((s.transform && s.transform !== "none") || (s.translate && s.translate !== "none") || (s.scale && s.scale !== "none") || (s.rotate && s.rotate !== "none")) return true;
    }
    return false;
  };

  /** Character boxes of the text nodes of one container, in DOM (= logical) order. Within a text
   *  node the line can only move down as the offset grows, so a node on one line costs one
   *  measurement and a node on several lines is bisected to its line changes. Each box keeps its
   *  horizontal extent (l, r) where it was measured — on one line, the node's text without its
   *  spaces; on several, the graphemes at every line change, i.e. both ends of each line — so a
   *  word sticking out of its line is seen (overflow). */
  function charBoxes(nodes) {
    const out = [];
    const rectOf = (n, i, len) => {
      range.setStart(n, i);
      range.setEnd(n, i + len);
      for (const r of range.getClientRects()) if (r.height > 0) return { c: (r.top + r.bottom) / 2, h: r.height, l: r.left, r: r.right };
      return null;
    };
    for (const n of nodes) {
      const el = n.parentElement;
      if (!n.data.trim()) {
        out.push({ space: true });
        continue;
      }
      range.selectNodeContents(n);
      const whole = Array.from(range.getClientRects()).filter((r) => r.height > 0);
      if (!whole.length) continue;
      const gs = Array.from(seg.segment(n.data));
      const at = new Array(gs.length).fill(undefined);
      const one = whole.every((r) => Math.abs((r.top + r.bottom) / 2 - (whole[0].top + whole[0].bottom) / 2) < whole[0].height / 2);
      const isSpace = (k) => /^\s+$/u.test(gs[k].segment);
      if (one) {
        range.setStart(n, n.data.search(/\S/));
        range.setEnd(n, n.data.trimEnd().length);
        const trimmed = Array.from(range.getClientRects()).filter((r) => r.height > 0);
        const ink = trimmed.length ? trimmed : whole;
        const box = {
          c: (whole[0].top + whole[0].bottom) / 2,
          h: whole[0].height,
          l: Math.min(...ink.map((r) => r.left)),
          r: Math.max(...ink.map((r) => r.right)),
        };
        gs.forEach((_, k) => (at[k] = box));
      } else {
        const get = (k) => (at[k] === undefined ? (at[k] = rectOf(n, gs[k].index, gs[k].segment.length)) : at[k]);
        const near = (lo, hi) => {
          // a measurable grapheme strictly between lo and hi, closest to the middle
          const mid = (lo + hi) >> 1;
          for (let d = 0; mid - d > lo || mid + d < hi; d++) {
            for (const k of [mid + d, mid - d]) if (k > lo && k < hi && !isSpace(k) && get(k)) return k;
          }
          return -1;
        };
        const fill = (lo, hi) => {
          const a = get(lo);
          const b = get(hi);
          if (Math.abs(a.c - b.c) < Math.min(a.h, b.h) / 2) {
            for (let k = lo + 1; k < hi; k++) if (at[k] === undefined) at[k] = a;
            return;
          }
          const m = near(lo, hi);
          if (m < 0) return;
          fill(lo, m);
          fill(m, hi);
        };
        let first = 0;
        while (first < gs.length && (isSpace(first) || !get(first))) first++;
        let last = gs.length - 1;
        while (last > first && (isSpace(last) || !get(last))) last--;
        if (first < gs.length) {
          if (last > first) fill(first, last);
        }
      }
      gs.forEach((g, k) => {
        if (isSpace(k)) out.push({ space: true });
        else if (at[k]) out.push({ ch: g.segment, el, c: at[k].c, h: at[k].h, l: at[k].l, r: at[k].r });
      });
    }
    return out;
  }
  /** Boxes → lines: a new line when the vertical centre moves by more than half a glyph box
   *  (Amiri and Inter boxes on one line differ by a few px; lines are ≥ 22px apart). */
  function linesOf(bx) {
    const lines = [];
    let cur = null;
    let prev = null;
    let sawSpace = false;
    for (const b of bx) {
      if (b.space) {
        sawSpace = true;
        if (cur) cur.text += " ";
        continue;
      }
      if (!prev || Math.abs(b.c - prev.c) > Math.min(b.h, prev.h) / 2) {
        cur = { text: "", first: b, last: b, afterSpace: sawSpace, prevBox: prev, boxes: [] };
        lines.push(cur);
      }
      cur.text += b.ch;
      cur.boxes.push(b);
      cur.last = b;
      prev = b;
      sawSpace = false;
    }
    return lines;
  }
  const textNodesUnder = (el) => {
    const out = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) if (shown(n.parentElement)) out.push(n);
    return out;
  };
  const lineCount = (el) => linesOf(charBoxes(textNodesUnder(el))).length;

  // 1. The lines of every container: the text rules (markup-independent).
  const byContainer = new Map();
  for (const n of textNodesUnder(root)) {
    const c = blockOf(n.parentElement);
    if (!byContainer.has(c)) byContainer.set(c, []);
    byContainer.get(c).push(n);
  }
  for (const [c, nodes] of byContainer) guard("text rules", c, () => {
    if (!nodes.some((n) => n.data.trim())) return;
    const lines = linesOf(charBoxes(nodes));
    counts.containers++;
    counts.lines += lines.length;
    lines.forEach((ln, k) => {
      const t = ln.text.trim();
      if (k > 0) {
        const prev = lines[k - 1].text.trim();
        const a = ln.prevBox;
        const b = ln.first;
        const seam = `…${short(prev.slice(-30), 30)} ⏎ ${short(t, 30)}`;
        const allowed = () => fallback(a.el, b.el, c);
        // The text rules, shared with textUnits.test.ts (seamKinds): a box wider than its line may
        // break a term or a hyphen inside itself, nothing else.
        const lastAr = lines[k - 1].boxes.findLast((x) => AR.test(x.ch));
        const arabicBefore = lastAr?.el.closest('[lang|="ar"]')?.textContent ?? "";
        for (const kind of seamKinds(prev, t, ln.afterSpace, arabicBefore))
          if (!BOX_MAY_BREAK.has(kind) || !allowed()) push(kind, kind === "line-end-opener" ? a.el : b.el, seam);
        // A word cut with no space at the seam: never inside Arabic; in Latin only where the page
        // asked for it (break-all / overflow-wrap on a long code or address).
        if (!ln.afterSpace && LETTER.test(a.ch) && LETTER.test(b.ch) && !/[-–—/]$/.test(prev)) {
          const s = style(b.el);
          if (AR.test(a.ch) || AR.test(b.ch)) push("arabic-word-split", b.el, seam);
          else if (s.wordBreak !== "break-all" && !/anywhere|break-word/.test(s.overflowWrap)) push("word-split", b.el, seam);
        }
        // An inline Arabic phrase cut across lines: each line is RTL on its own, so a reader who
        // scans the paragraph left to right reads the phrase out of order. (In a box of its own —
        // an Arabic part wider than its line — it wraps right to left: section 2b.)
        if (ln.afterSpace && AR.test(a.ch) && AR.test(b.ch)) {
          const pa = a.el.closest('[lang|="ar"]');
          if (pa && pa === b.el.closest('[lang|="ar"]') && /^inline/.test(style(pa).display) && !allowed())
            push("arabic-phrase-split", b.el, seam);
        }
      }
    });
    // No glyph sticks out of the container's content box (a word wider than its column, kept on
    // its line, runs into the next column or out of the card). A container that clips or scrolls
    // sideways on purpose (overflow-x not visible: a truncated chip, a wide table) is left alone,
    // and so is text an animation is moving (a transform between it and the container).
    if (style(c).overflowX === "visible") {
      const cb = c.getBoundingClientRect();
      const cs = style(c);
      const left = cb.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const right = cb.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const out = (x) => (x.r > right + 1.5 || x.l < left - 1.5) && !moved(x.el, c);
      const ln = lines.find((l) => l.boxes.some(out));
      if (ln) {
        const x = ln.boxes.find(out);
        push("overflow", x.el, `text ${Math.round(Math.max(x.r - left, right - x.l))}px into a ${Math.round(right - left)}px line`, short(ln.text.trim(), 60));
      }
    }
    // Arabic inside Latin text: lang="ar", right to left, and a bidi isolate (bdi, [dir], its own
    // box) between it and the Latin around it. Arabic-only blocks (the ayah, a chip) are fine.
    const latinHere = nodes.some((n) => LATIN.test(n.data));
    if (latinHere) {
      for (const n of nodes) {
        if (!AR.test(n.data)) continue;
        counts.arabic++;
        const p = n.parentElement;
        const langEl = p.closest("[lang]");
        let ok = !!langEl && /^ar\b/i.test(langEl.getAttribute("lang")) && style(p).direction === "rtl";
        if (ok) {
          ok = false;
          for (let e = p; e && e !== c.parentElement; e = e.parentElement) {
            const s = style(e);
            if (s.direction !== "rtl") break;
            if (/isolate|plaintext/.test(s.unicodeBidi) || !/^(inline|contents)$/.test(s.display)) {
              ok = true;
              break;
            }
          }
        }
        if (!ok) push("arabic-not-isolated", p, `lang=${langEl?.getAttribute("lang") ?? "—"} dir=${style(p).direction}`, short(n.data.trim(), 60));
      }
    }
  });

  // 2. Kept-together boxes (MixedText units, their seams, glued words, KeepTogether): a box on
  //    one line, unless it is wider than its line — then it is laid out in the flow
  //    (data-lb-flow, src/lib/lineFit.ts) and breaks between its pieces, the words around it
  //    sharing its first and last lines. Still a box at its line's full width, it leaves those
  //    words on lines of their own (review, 2026-10-10): unit-boxed. A unit of one Arabic part may
  //    wrap inside its box (2b checks it reads right to left).
  for (const u of root.querySelectorAll('[data-lb="unit"], [data-lb="glue"]')) guard("kept boxes", u, () => {
    if (!shown(u)) return;
    if (u.getAttribute("data-lb") === "glue") counts.glued++;
    else counts.units++;
    const d = style(u).display;
    const w = () => `${Math.round(u.getBoundingClientRect().width)}px of ${Math.round(contentWidth(containingBox(u)))}px`;
    if (d === "inline-block") {
      const lines = lineCount(u);
      if (lines > 1 && !clamped(u)) push("unit-broken", u, `${lines} lines though it fits: ${w()}`);
      else if (lines > 1 && flowable(u))
        push("unit-boxed", u, `${lines} lines in a box as wide as its line (${w()}): the words around it cannot share its lines — the in-flow fallback (data-lb-flow) did not take it`);
    } else if (d === "inline" && u.hasAttribute("data-lb-flow")) {
      counts.flowed++;
      if (lineCount(u) > 1 && !tooWide(u)) push("unit-broken", u, "laid out in the flow (data-lb-flow) and broken, though it fits its line as a box");
    } else push("unit-broken", u, `display: ${d} (the .lb-* rule is not applied)`);
  });
  // 2b. An Arabic box that wraps — an Arabic part or quotation wider than its line, a long
  //     Qur'anic run in its own box — reads right to left: every line right-aligned, so each line
  //     starts where an Arabic reader looks for it (and the bidi isolate keeps the words in order).
  for (const el of root.querySelectorAll('[data-lb], [lang|="ar"], [dir="rtl"]')) guard("arabic box", el, () => {
    if (!shown(el) || style(el).display !== "inline-block") return;
    const text = el.textContent ?? "";
    if (!AR.test(text) || LATIN.test(text)) return;
    const lines = linesOf(charBoxes(textNodesUnder(el)));
    if (lines.length < 2) return;
    const r = el.getBoundingClientRect();
    const s = style(el);
    const right = r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
    const gap = Math.max(...lines.map((ln) => right - Math.max(...ln.boxes.map((x) => x.r))));
    if (gap > 2) push("arabic-box-ltr", el, `wraps on ${lines.length} lines, one ${Math.round(gap)}px short of its right edge: not laid out right to left`);
  });
  // 3. Nothing sticks out of its line: a unit, a part, a kept word, a karaoke word, inline Arabic
  //    (their boxes), and the text inside a kept box (a box clamped to its line by max-width while
  //    the word inside it is wider). Text outside them: section 1.
  for (const el of root.querySelectorAll('[data-lb], [data-karaoke], bdi[lang|="ar"]')) guard("overflow", el, () => {
    if (!shown(el)) return;
    const box = blockOf(el.parentElement);
    if (moved(el, box)) return;
    const cb = box.getBoundingClientRect();
    const s = style(box);
    const r = el.getBoundingClientRect();
    const own = style(el);
    if (r.width === 0) return;
    const bleed = 1 + Math.max(0, -parseFloat(own.marginLeft), -parseFloat(own.marginRight)); // the karaoke fill's -mx
    const left = cb.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
    const right = cb.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
    if (r.right > right + bleed || r.left < left - bleed)
      push("overflow", el, `${Math.round(r.width)}px in a ${Math.round(right - left)}px line`);
    else if (el.hasAttribute("data-lb") && own.display === "inline-block" && el.scrollWidth > el.clientWidth + 1)
      push("overflow", el, `${el.scrollWidth}px of text in a ${el.clientWidth}px box`);
  });
  // 4. The mushaf line: the ayah marker shares a row with the last word. (The second selector is
  //    the marker before it had a data-lb mark: the check also fails the build that has the bug.)
  for (const m of root.querySelectorAll('[data-lb="ayah-marker"], .quran.flex > span[aria-hidden][lang="ar"]')) guard("ayah marker", m, () => {
    if (!shown(m)) return;
    counts.markers++;
    const last = m.previousElementSibling;
    if (!last) return;
    const [a, b] = [m.getBoundingClientRect(), last.getBoundingClientRect()];
    if (a.top >= b.bottom || a.bottom <= b.top) push("ayah-marker-alone", m, "the ayah marker starts a row of its own");
  });
  // 5. Karaoke: a spoken word without a space in it is never cut (a term with its Arabic, "huruf
  //    jar (حَرْف جَرّ),", may wrap at its spaces like any text — section 1 checks its seams); and
  //    its fill hugs the text on every line it covers, never a box wider than its words (a term
  //    turned into one atomic box takes the caption's full width when it is wider than the line).
  for (const k of root.querySelectorAll("[data-karaoke]")) guard("karaoke", k, () => {
    if (!shown(k)) return;
    counts.karaoke++;
    const bx = charBoxes(textNodesUnder(k)).filter((x) => !x.space);
    const lines = linesOf(bx);
    if (!/\s/.test((k.textContent ?? "").trim()) && lines.length > 1) push("karaoke-word-broken", k, "one spoken word on two lines");
    // Per line: the fill there (an inline word's fragment on that line; a box's one rect, on all
    // its lines) against the words on it, with its own padding and a space's width of slack (a
    // line's last space, whether a browser counts it or not).
    const s = style(k);
    const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + 0.4 * (parseFloat(s.fontSize) || 16) + 2;
    const rects = Array.from(k.getClientRects());
    for (const ln of lines) {
      const r = rects.find((x) => ln.first.c >= x.top && ln.first.c <= x.bottom);
      if (!r) continue;
      const text = Math.max(...ln.boxes.map((x) => x.r)) - Math.min(...ln.boxes.map((x) => x.l));
      if (r.width > text + pad) {
        push("karaoke-fill-wide", k, `a ${Math.round(r.width)}px fill over ${Math.round(text)}px of words`);
        break;
      }
    }
  });
  // 6. The page never scrolls sideways.
  if (document.documentElement.scrollWidth > window.innerWidth + 1)
    push("page-overflow", document.body, `scrollWidth ${document.documentElement.scrollWidth} > ${window.innerWidth}`, "");
  return { counts, offenders };
}
