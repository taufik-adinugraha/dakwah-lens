import { ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";

export type Crumb = { label: string; href?: string };

/**
 * Where the learner is inside a track: "Belajar › Al-Qur'an › Al-Fatihah ›
 * Ayat 2" (plan L9). Every crumb but the last is a 44px link; the last one
 * is the current page, plain text marked aria-current. The row wraps rather
 * than shrinking at large text sizes. In-module paths only (next-intl Link).
 */
export function Breadcrumb({
  items,
  label,
  className,
}: {
  items: Crumb[];
  /** Accessible name of the nav landmark ("Anda berada di"). */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1 text-base">
        {items.map((c, i) => {
          const current = i === items.length - 1;
          return (
            <li key={c.href ?? c.label} className="inline-flex items-center gap-x-1">
              {i > 0 ? (
                <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-ink-soft" />
              ) : null}
              {c.href && !current ? (
                <Link href={c.href} className="link-text inline-flex min-h-11 items-center px-1">
                  {c.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? "page" : undefined}
                  className="inline-flex min-h-11 items-center px-1 font-semibold text-ink"
                >
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
