import type { ReactNode } from "react";

/**
 * Shared layout primitives for the landing redesign — every section
 * speaks the same quiet language: hairline separator, generous air,
 * uppercase eyebrow, Fraunces display title, muted lede. Keeping them
 * here (instead of per-section copies) is what keeps the page feeling
 * like ONE composed document rather than stacked cards.
 */

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`border-t border-hairline py-20 sm:py-28 ${className}`.trim()}
    >
      <div className="mx-auto max-w-5xl px-6">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
      {children}
    </p>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-4 text-balance font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-medium leading-[1.15] tracking-[-0.015em] text-ink">
      {children}
    </h2>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 max-w-xl text-pretty leading-[1.7] text-ink-muted">
      {children}
    </p>
  );
}
