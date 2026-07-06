"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/**
 * Subtle "reveal on enter" wrapper for the landing redesign.
 *
 * Adds the `.reveal` class (opacity + 12px rise, see globals.css) and
 * flips it to `.is-in` the first time the element scrolls into view.
 * `delay` staggers siblings for a gentle cascade. Reduced motion is
 * handled entirely in CSS — the `.reveal` rules live under a
 * `prefers-reduced-motion: no-preference` media query, so those users
 * see content immediately regardless of `is-in`; no JS branch needed.
 *
 * Renders as a <div> by default; pass `as` to use a semantic tag.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  /** Stagger in milliseconds. */
  delay?: number;
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Ancient/headless fallback: no IntersectionObserver → just reveal.
    // Deferred via rAF so it isn't a synchronous setState in the effect
    // body (that would cascade renders).
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
            break;
          }
        }
      },
      // Trigger a touch before the element is fully on-screen so the
      // motion reads as "settling in" rather than popping late.
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${shown ? "is-in" : ""} ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
