"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { Download, FileText, ImageDown, Printer } from "lucide-react";

/**
 * Download menu — sits beside the share menu on the brief detail page.
 *
 *   Markdown → /api/briefings/{id}/markdown (raw summary_md)
 *   Text     → /api/briefings/{id}/text (markdown-stripped plain text)
 *   Print    → window.print(); browsers offer "Save as PDF" in the print
 *              dialog. This is the de-facto PDF flow until we provision
 *              Playwright server-side (the /pdf endpoint exists as a stub
 *              but currently returns 503).
 */
export function BriefDownloadMenu({
  briefId,
  labels,
}: {
  briefId: string;
  labels: {
    trigger: string;
    pdf: string;
    markdown: string;
    text: string;
    print: string;
    print_hint: string;
    flyer: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const flyerLang = locale === "en" ? "en" : "id";

  // Close on Esc to match the Share dropdown sibling + the rest of the
  // app's dialog conventions.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        <Download className="h-3.5 w-3.5" />
        {labels.trigger}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.print();
              }}
              className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-slate-50"
            >
              <Printer className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <span className="flex-1">
                <span className="block text-xs font-medium text-slate-700">
                  {labels.print}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                  {labels.print_hint}
                </span>
              </span>
            </button>
            <div className="my-1 border-t border-slate-100" />
            <DownloadLink
              href={`/api/briefings/${briefId}/markdown`}
              icon={<FileText className="h-4 w-4" />}
              label={labels.markdown}
              onClose={() => setOpen(false)}
            />
            <DownloadLink
              href={`/api/briefings/${briefId}/text`}
              icon={<FileText className="h-4 w-4" />}
              label={labels.text}
              onClose={() => setOpen(false)}
            />
            <div className="my-1 border-t border-slate-100" />
            <DownloadLink
              href={`/api/briefings/${briefId}/flyer?lang=${flyerLang}`}
              icon={<ImageDown className="h-4 w-4" />}
              label={labels.flyer}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function DownloadLink({
  href,
  icon,
  label,
  onClose,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClose: () => void;
}) {
  return (
    <a
      href={href}
      download
      onClick={onClose}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
    >
      <span className="text-slate-500">{icon}</span>
      <span>{label}</span>
    </a>
  );
}
