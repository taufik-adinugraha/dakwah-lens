/**
 * The fallback for kept-together text wider than its line (line breaks,
 * operator 2026-10-10: "make sure the line break is clean and easy to read,
 * sometime i see wrong line break especially for arabic words").
 *
 * MixedText keeps a term with its Arabic, "huruf jar (حَرْف جَرّ),", as an
 * inline-block (src/lib/textUnits.ts, globals.css .lb-*): it moves to the next
 * line whole. But an inline-block wider than its line is exactly as wide as
 * the line, so nothing shares its first or last line: the words before and
 * after it are left on lines of their own (review, 2026-10-10: at Sangat
 * besar on a phone "mudhaf ilaih (مُضَاف إِلَيْه)" is wider than the caption).
 * CSS has no "keep together unless it does not fit" for inline text, so this
 * measures: every kept box wider than its line — a unit that wraps inside
 * itself, a glued word (nowrap) that sticks out of its box — is marked
 * data-lb-flow, and globals.css lays it out inline, in the paragraph's flow,
 * where a glued word breaks at its hyphen or space. Its pieces
 * stay boxes, so it breaks only between them — outside its seam first
 * ("huruf" ⏎ "jar (حَرْف جَرّ),"; the seam, a box of its own, is marked only
 * when it is wider than its line too: "jar" ⏎ "(حَرْف جَرّ),") — never inside
 * an Arabic word or before its punctuation. Every pass first clears the
 * marks, so a box that fits again (a wider screen, a smaller text size) is a
 * box again.
 *
 * Checked in a real browser at every text size (scripts/ci/linebreaks.mjs:
 * its self-test lays out a unit wider than its line and checks the words
 * around it share its lines).
 */

/** The mark: the box is laid out in the paragraph's flow (globals.css). */
export const FLOW = "data-lb-flow";
/** The boxes MixedText and KeepTogether render. */
export const KEPT = '[data-lb="unit"], [data-lb="glue"]';

/** What the pass reads and writes on a box (an Element in the page). */
export type FitBox = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly childNodes: ArrayLike<{ readonly nodeType: number; readonly textContent: string | null }>;
};

/** A kept box that can break in the flow: a glued word, or a unit of more than one piece (a term
 *  with its seam, a seam of two parts). A unit that is one Arabic part has nothing to break
 *  between: wider than its line, it wraps inside its own right-to-left box. The browser check
 *  decides the same way (linebreaks-measure.mjs, flowable). */
export function flowable(box: FitBox): boolean {
  const kind = box.getAttribute("data-lb");
  if (kind === "glue") return true;
  if (kind !== "unit") return false;
  let pieces = 0;
  for (const n of Array.from(box.childNodes))
    if (n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.textContent ?? ""))) pieces++;
  return pieces > 1;
}

type Rect = { top: number; bottom: number; width: number; height: number };

/** Whether text boxes lie on more than one line: a centre more than half the smaller height away
 *  from the first (an Amiri run and the Inter text beside it differ by a few px on one line). */
export function severalLines(rects: Iterable<Rect>): boolean {
  let first: { c: number; h: number } | null = null;
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    const c = (r.top + r.bottom) / 2;
    if (!first) first = { c, h: r.height };
    else if (Math.abs(c - first.c) > Math.min(first.h, r.height) / 2) return true;
  }
  return false;
}

/** One pass: every mark cleared, then each flowable box wider than its line, measured as a box
 *  (`tooWide`), marked. Returns how many were marked. */
export function fitLines(boxes: Iterable<FitBox>, tooWide: (box: FitBox) => boolean): number {
  const all = [...boxes].filter(flowable);
  for (const b of all) if (b.hasAttribute(FLOW)) b.removeAttribute(FLOW);
  const wide = all.filter(tooWide);
  for (const b of wide) b.setAttribute(FLOW, "");
  return wide.length;
}

/**
 * Runs the pass on `doc` now and whenever its layout may have changed: new text (a lesson step,
 * a karaoke line, an exercise's feedback — at once, before it is painted), a new page size (a
 * turned phone, the text size, a disclosure opened — the next frame), the web fonts arriving.
 * Returns the function that stops it.
 */
export function watchLines(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win || typeof win.ResizeObserver !== "function" || typeof win.MutationObserver !== "function") return () => {};
  const range = doc.createRange();
  // As a box: its text sticks out of it (a glued word does not wrap), or it lies on several lines
  // at its line's full width (max-width: 100% of the block it is in) — wider than its line, not
  // broken by something else.
  const tooWide = (box: FitBox) => {
    const el = box as unknown as HTMLElement;
    if (el.scrollWidth > el.clientWidth + 1) return true;
    const rects: Rect[] = [];
    const walk = doc.createTreeWalker(el, win.NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!/\S/.test(n.textContent ?? "")) continue;
      range.selectNodeContents(n);
      rects.push(...Array.from(range.getClientRects()));
    }
    if (!severalLines(rects)) return false;
    let block = el.parentElement;
    while (block && /^(inline|contents)$/.test(win.getComputedStyle(block).display)) block = block.parentElement;
    if (!block) return true;
    const s = win.getComputedStyle(block);
    return el.getBoundingClientRect().width >= block.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 1;
  };
  const run = () => {
    fitLines(doc.body.querySelectorAll<HTMLElement>(KEPT), tooWide);
  };
  let frame = 0;
  const soon = () => {
    if (!frame)
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        run();
      });
  };
  // Only its own attribute changes after a pass, never the tree: no loop.
  const added = new win.MutationObserver(run);
  added.observe(doc.body, { childList: true, subtree: true });
  // A frame later: a pass inside the observer's callback would change the size it reports.
  const sized = new win.ResizeObserver(soon);
  sized.observe(doc.documentElement);
  doc.fonts?.addEventListener("loadingdone", soon);
  run();
  return () => {
    added.disconnect();
    sized.disconnect();
    doc.fonts?.removeEventListener("loadingdone", soon);
    if (frame) win.cancelAnimationFrame(frame);
  };
}
