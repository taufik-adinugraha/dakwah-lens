/**
 * The one door to the Web Animations API for the questionnaire (plan §9.3 "Reduced motion"): the
 * global prefers-reduced-motion CSS override does not reach animations started from JavaScript,
 * so every el.animate() goes through here. Under reduced motion nothing animates and the element
 * simply shows its final frame (its own styles). Call only from effects or event handlers.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** A new family-tree node: fade in with an 8px rise over 250ms (ux.md §4.7). */
export function growIn(el: Element): void {
  if (prefersReducedMotion() || typeof (el as HTMLElement).animate !== "function") return;
  (el as HTMLElement).animate(
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 250, easing: "ease-out" },
  );
}

/** Scroll behaviour for moving to the next question. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
