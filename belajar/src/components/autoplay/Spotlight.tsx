"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { guideSelector } from "@/components/exercises/guide";
import type { Guide } from "@/lib/autoplay";

/** Space between a target and its ring (px). */
const PAD = 6;
/** A label sits on its ring's top edge (mostly above it) when there is this
 *  much room above the ring in the stage area, else on its bottom edge (px). */
const ROOM_ABOVE = 28;
/** Close enough to an edge of the viewport to count as out of view (px). */
const EDGE = 24;
/** How far a label sits in from its ring's edge, and the least room it
 *  keeps from the stage area's edge (px). */
const INSET = 12;
const MARGIN = 8;

type Box = {
  target: string;
  label: string;
  /** Ring rectangle, relative to the stage area. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor the label at the ring's right edge (target in the right half):
   *  its distance from the stage area's right edge. */
  right: number | null;
  /** The label's left offset when it is anchored at the left. */
  left: number;
  /** Widest the label may be without leaving the stage area (it wraps). */
  maxW: number;
  above: boolean;
};

export type Offscreen = "above" | "below" | null;

const sameBoxes = (a: Box[], b: Box[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      x.target === y.target &&
      x.label === y.label &&
      Math.round(x.x) === Math.round(y.x) &&
      Math.round(x.y) === Math.round(y.y) &&
      Math.round(x.w) === Math.round(y.w) &&
      Math.round(x.h) === Math.round(y.h) &&
      x.right === y.right &&
      Math.round(x.left) === Math.round(y.left) &&
      Math.round(x.maxW) === Math.round(y.maxW) &&
      x.above === y.above
    );
  });

/**
 * Points at the control the learner should use next (an exercise's
 * `data-guide` target, found with guideSelector) INSIDE the stage area it is
 * rendered in — never over the whole page:
 * - a thick forest ring with a white halo around the target, plus a label
 *   ("Ketuk di sini") with an arrow: never colour alone (senior-ux §3.2).
 *   The label never leaves the stage area: it is anchored on the target's
 *   side and wraps within the room left (a phone at the largest text size
 *   included), so the page never scrolls sideways;
 * - the rest of the stage area is dimmed lightly (an SVG mask with a hole
 *   per target); nothing outside the stage is touched;
 * - pointer-events: none — every control stays usable;
 * - follows the target through layout changes (ResizeObserver +
 *   MutationObserver); it never scrolls the page. When the target is out of
 *   view it reports `onOffscreen`, so the stage can offer a button that
 *   brings it into view on the learner's tap;
 * - `pulse` (the reminder count) makes the ring glow three times — only
 *   without prefers-reduced-motion; otherwise the ring is static.
 *
 * Render it as a direct child of a `relative isolate` element (the stage
 * area): it covers that element and measures against it.
 */
export function Spotlight({
  guides,
  pulse,
  bottomInset,
  onOffscreen,
}: {
  /** Targets to point at (exercise controls); empty → nothing is drawn. */
  guides: Guide[];
  /** Changes when a reminder fires. */
  pulse: number;
  /** Height (px) of what covers the bottom of the viewport (the sticky
   *  controls bar), for the out-of-view check. */
  bottomInset: number;
  onOffscreen?: (where: Offscreen) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const rawId = useId();
  // useId may contain characters a url(#…) reference does not accept.
  const maskId = `spot${rawId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [boxes, setBoxes] = useState<Box[]>([]);

  // Latest out-of-view callback and inset, read by the observers.
  const reportRef = useRef(onOffscreen);
  const insetRef = useRef(bottomInset);
  useEffect(() => {
    reportRef.current = onOffscreen;
    insetRef.current = bottomInset;
  }, [onOffscreen, bottomInset]);

  // A stable key for the effect: target + label of every guide.
  const key = guides.map((g) => `${g.target}\u0001${g.label}`).join("\u0002");

  useEffect(() => {
    const layer = layerRef.current;
    const root = layer?.parentElement;
    if (!layer || !root) return;
    const list = key
      ? key.split("\u0002").map((s) => {
          const [target, label] = s.split("\u0001");
          return { target, label };
        })
      : [];
    let raf = 0;
    let lastOff: Offscreen = null;
    const report = (where: Offscreen) => {
      if (where === lastOff) return;
      lastOff = where;
      reportRef.current?.(where);
    };
    const measure = () => {
      raf = 0;
      const r = root.getBoundingClientRect();
      const out: Box[] = [];
      let first: DOMRect | null = null;
      for (const g of list) {
        const el = root.querySelector(guideSelector(g.target));
        if (!el || layer.contains(el)) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        if (!first) first = b;
        const x = b.left - r.left - PAD;
        const y = b.top - r.top - PAD;
        const w = b.width + 2 * PAD;
        const h = b.height + 2 * PAD;
        const right = x + w / 2 > r.width / 2 ? Math.max(MARGIN, r.width - (x + w) + INSET) : null;
        const left = Math.max(MARGIN, x + INSET);
        const maxW = Math.max(120, r.width - (right ?? left) - MARGIN);
        out.push({ target: g.target, label: g.label, x, y, w, h, right, left, maxW, above: y >= ROOM_ABOVE });
      }
      setBoxes((prev) => (sameBoxes(prev, out) ? prev : out));
      if (!first) {
        report(null);
        return;
      }
      const bottom = window.innerHeight - insetRef.current;
      if (first.bottom < EDGE) report("above");
      else if (first.top > bottom - EDGE) report("below");
      else report(null);
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    const mo = new MutationObserver((records) => {
      // The ring and label live inside the root too: their own updates are
      // not a layout change of the page.
      if (records.some((m) => !layer.contains(m.target))) schedule();
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-guide", "class", "hidden"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      reportRef.current?.(null);
    };
  }, [key]);

  // Reminder: the ring glows three times (no movement); static with
  // prefers-reduced-motion.
  useEffect(() => {
    if (pulse === 0) return;
    const layer = layerRef.current;
    if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rings = Array.from(layer.querySelectorAll<HTMLElement>("[data-spotlight-ring]"));
    const anims = rings.map((el) =>
      el.animate(
        [
          { boxShadow: "0 0 0 3px #ffffff" },
          { boxShadow: "0 0 0 3px #ffffff, 0 0 0 12px rgb(14 90 60 / 0.35)" },
          { boxShadow: "0 0 0 3px #ffffff" },
        ],
        { duration: 900, iterations: 3, easing: "ease-in-out" },
      ),
    );
    return () => anims.forEach((a) => a.cancel());
  }, [pulse]);

  const shown = boxes.filter((b) => guides.some((g) => g.target === b.target));

  return (
    <div ref={layerRef} aria-hidden data-autoplay="spotlight" className="pointer-events-none absolute inset-0 z-10">
      {shown.length > 0 && (
        <>
          <svg className="absolute inset-0 h-full w-full">
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                {shown.map((b) => (
                  <rect key={b.target} x={b.x} y={b.y} width={b.w} height={b.h} rx={16} fill="black" />
                ))}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="#1b1a17" fillOpacity={0.2} mask={`url(#${maskId})`} />
          </svg>
          {shown.map((b) => (
            <div key={b.target}>
              <div
                data-spotlight-ring=""
                className="absolute rounded-2xl border-4 border-forest"
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, boxShadow: "0 0 0 3px #ffffff" }}
              />
              {/* The label straddles the ring's edge, so it covers as little
                  as possible of what is around the target (the caption). */}
              <div
                className="absolute flex"
                style={{
                  top: b.above ? b.y : b.y + b.h,
                  transform: b.above ? "translateY(-62%)" : "translateY(-38%)",
                  maxWidth: b.maxW,
                  ...(b.right === null ? { left: b.left } : { right: b.right, justifyContent: "flex-end" }),
                }}
              >
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-2xl border-2 border-white bg-forest px-3 py-1 text-base font-semibold text-paper shadow-md">
                  {b.above ? (
                    <ArrowDown aria-hidden className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                  ) : (
                    <ArrowUp aria-hidden className="h-5 w-5 shrink-0" strokeWidth={2.5} />
                  )}
                  <span className="min-w-0 text-balance">{b.label}</span>
                </span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
