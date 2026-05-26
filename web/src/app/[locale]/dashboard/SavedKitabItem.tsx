"use client";

/**
 * Saved-kitab row + inline reading modal.
 *
 * The dashboard "Yang baru Anda simpan" card used to link kitab
 * bookmarks to `/kitab/{refId}` — a route that doesn't exist, so
 * every click 404'd. Rather than build a per-citation kitab route
 * (which would need an exact-match lookup against Qdrant), we use
 * the data we already stored: the bookmark payload carries the
 * full Arabic + translation snapshot, so a modal is 100% reliable
 * without any extra fetch.
 *
 * A secondary "Open in Kitab Search" CTA still routes to the
 * `/kitab?q=...&kitab=...` search page in case the user wants to
 * read the surrounding chapter.
 */

import { BookOpenCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

export type SavedKitabLabels = {
  close: string;
  noArabic: string;
  noTranslation: string;
};

export function SavedKitabItem({
  title,
  subtitle,
  payload,
  labels,
}: {
  title: string;
  subtitle: string;
  /** Bookmark snapshot. Stored at save-time, see BookmarkButton's
   *  `payload` on the /kitab page. Keys: corpus, citation, arabic,
   *  translation. */
  payload: {
    corpus?: string;
    citation?: string;
    arabic?: string;
    translation?: string;
  };
  labels: SavedKitabLabels;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-start gap-3 text-left transition hover:text-emerald-700"
      >
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
          <BookOpenCheck className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">
            {title}
          </span>
          <span className="block text-xs text-slate-500">{subtitle}</span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="saved-kitab-modal-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {payload.corpus || subtitle}
                </p>
                <h3
                  id="saved-kitab-modal-title"
                  className="mt-0.5 text-balance text-lg font-bold text-slate-900 sm:text-xl"
                >
                  {payload.citation || title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={labels.close}
                className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5">
              {payload.arabic ? (
                <p
                  className="text-right font-amiri text-lg leading-relaxed text-slate-900 sm:text-xl md:text-2xl"
                  dir="rtl"
                  lang="ar"
                >
                  {payload.arabic}
                </p>
              ) : (
                <p className="text-xs italic text-slate-400">
                  {labels.noArabic}
                </p>
              )}

              {payload.translation ? (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {payload.translation}
                </p>
              ) : (
                <p className="mt-4 text-xs italic text-slate-400">
                  {labels.noTranslation}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
