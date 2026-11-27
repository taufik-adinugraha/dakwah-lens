"use client";

import { CirclePlay, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** "Apa Itu Dakwah-Lens?" (2:55, vertical), on the Dakwah-Lens YouTube channel. */
export const OVERVIEW_VIDEO_ID = "jGSlhTQlZBc";

/**
 * The hero's "Dakwah-Lens dalam 3 menit" link (owner 2026-11-27): the overview video in a player
 * over the page, so the visitor stays on the landing page. It is a plain link to the Short on
 * YouTube, so it still works before the script loads; a click opens the player instead. The
 * YouTube frame (privacy-enhanced player, allowed by frame-src in next.config.ts) is only put on
 * the page once the visitor asks for it, so the landing page itself makes no request to Google.
 */
export function HeroVideo({ label, title, closeLabel }: { label: string; title: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const back = trigger.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      back?.focus();
    };
  }, [open]);

  return (
    <>
      <a
        ref={trigger}
        href={`https://www.youtube.com/shorts/${OVERVIEW_VIDEO_ID}`}
        data-hero-video=""
        onClick={(e) => {
          // A new-tab click (ctrl/cmd/middle) keeps the link's own behaviour.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          setOpen(true);
        }}
        className="group inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-forest transition hover:bg-forest-tint"
      >
        <CirclePlay aria-hidden className="h-5 w-5 transition group-hover:scale-110" />
        {label}
      </a>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              ref={close}
              type="button"
              onClick={() => setOpen(false)}
              aria-label={closeLabel}
              className="absolute -top-12 right-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-paper text-ink shadow-md transition hover:bg-white"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
            {/* 9:16, as large as the screen allows: the width is capped by the height that is
                left after the close button's row. */}
            <div className="aspect-[9/16] w-[min(88vw,calc((100svh-7rem)*9/16),420px)] overflow-hidden rounded-2xl bg-ink shadow-2xl">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${OVERVIEW_VIDEO_ID}?autoplay=1&rel=0`}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
