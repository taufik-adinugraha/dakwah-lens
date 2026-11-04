"use client";

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";

/**
 * The bar of the next step (operator 2026-11-04: "current design we need to scroll down, better to use
 * sticky button so it always appear in the bottom of the screen"), as the lesson's controls bar: stuck to
 * the bottom of the screen while the page runs on below it, at its own place at the page's end, so nothing
 * stays under it for good. Its side gutters are the pages' px-4 sm:px-6.
 *
 * 2.4.11, as html's scroll-padding-top does for the sticky header: what is focused or scrolled to stays
 * above the bar. Measured, because the bar's height follows the text size and whether its buttons fit side
 * by side. A layout effect, so it holds before PathTest's verdict scrolls itself into view in the same commit.
 */
function NextBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const fit = () => root.style.setProperty("scroll-padding-bottom", `${bar.getBoundingClientRect().height + 16}px`);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, []);
  return (
    <div
      ref={ref}
      data-next-bar=""
      className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-hairline bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_28px_-14px_rgb(14_90_60/0.35)] backdrop-blur-md sm:-mx-6 sm:px-6"
    >
      {children}
    </div>
  );
}

/**
 * A page of the learning path with the bar under it. The bar is a direct child of this block because a sticky
 * element cannot leave its parent. On a phone the block is at least a screen tall, so the bar stands at the
 * same place from card to card, whatever each card's height. svh, not dvh: the block does not change height
 * as the browser's toolbar slides away.
 */
export function NextBarPage({ bar, children, ...attributes }: { bar: ReactNode } & ComponentProps<"div">) {
  return (
    <div {...attributes} className="flex min-h-svh flex-col sm:min-h-0">
      <div className="flex-1">{children}</div>
      {bar ? <NextBar>{bar}</NextBar> : null}
    </div>
  );
}
