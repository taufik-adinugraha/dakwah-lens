"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";

/**
 * Mobile-only hamburger menu. Renders nothing on `md+` screens — the
 * desktop nav in `Header.tsx` handles those. On smaller screens, the
 * button opens a right-side drawer with the same nav items.
 *
 * Why this is a separate component:
 *  - Header is an async server component (auth + i18n on the server)
 *  - Drawer toggle is interactive → needs `use client`
 *  - Keep the boundary small: parent server component computes all the
 *    URLs + labels and passes them as plain serializable props.
 */

export type MobileNavItem = {
  /** Absolute URL with locale prefix baked in. Always rendered as a
   *  plain `<a>` so cross-page hash links (e.g. /en#donate) scroll
   *  natively after navigation — same pattern as Header desktop. */
  href: string;
  label: string;
};

export function MobileNav({
  items,
  openLabel,
  closeLabel,
}: {
  items: MobileNavItem[];
  openLabel: string;
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // We portal the drawer to `document.body` so it escapes the Header's
  // `sticky z-30` stacking context — otherwise the drawer's z-index
  // gets trapped under any z-40+ element at body level (e.g. the
  // pending-approval banner). SSR never sees `open=true` because the
  // initial state is false and only flips on a client click, so it's
  // safe to call `document.body` without a `mounted` guard.

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't scroll along with the menu.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={openLabel}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-paper-deep md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={openLabel}
            className="fixed inset-0 z-[60] md:hidden"
          >
            <button
              type="button"
              aria-label={closeLabel}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-forest/50"
            />
            <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-end p-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={closeLabel}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-paper-deep"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 px-3 pb-6">
                {items.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-3 text-base font-medium text-ink-muted transition hover:bg-paper-deep"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
