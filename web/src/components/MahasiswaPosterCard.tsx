"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  GraduationCap,
  Maximize2,
  Printer,
} from "lucide-react";

/* eslint-disable @next/next/no-img-element */

/**
 * Mahasiswa Poster — campus bulletin-board hero asset.
 *
 * Replaces (and expands) what used to be the "Pendekatan Gen Z" kafe
 * discussion deliverable. The Section 4 modal still carries the full
 * Mahasiswa article + Q&A; this component surfaces ONLY the 1080×1080
 * poster question PNG above the share-flyer grid so the printable
 * bulletin-board asset has its own visual weight.
 *
 * Renders a single full-width preview card. Click → fullscreen overlay
 * with download + print actions, same UX shape as BriefFlyerSection.
 */
export function MahasiswaPosterCard({
  briefId,
  locale,
  labels,
}: {
  briefId: string;
  locale: string;
  labels: {
    eyebrow: string;
    title: string;
    body: string;
    openLarge: string;
    download: string;
    downloadPdf: string;
    print: string;
    loading: string;
    close: string;
    show: string;
    hide: string;
  };
}) {
  const lang = locale === "en" ? "en" : "id";
  const posterUrl = `/api/insights-brief/${briefId}/flyer?variant=poster&lang=${lang}`;
  const posterPdfUrl = `/api/insights-brief/${briefId}/flyer?variant=poster&lang=${lang}&format=pdf`;
  const downloadName = `dakwah-lens_${briefId}_poster-mahasiswa.png`;
  const downloadPdfName = `dakwah-lens_${briefId}_poster-mahasiswa.pdf`;

  // Heavy 1080² preview + download chrome — default-collapsed so users
  // reading the briefing don't get visually pulled into the poster
  // before they're ready to grab share assets.
  const [expanded, setExpanded] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <section className="mt-10 mb-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
            <GraduationCap className="h-3 w-3" />
            {labels.eyebrow}
          </span>
          <h2 className="mt-2 text-balance text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {labels.title}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            {labels.body}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50"
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {expanded ? labels.hide : labels.show}
      </button>

      {expanded && (
      <article className="mt-5 grid gap-4 overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-violet-50 shadow-sm ring-1 ring-indigo-200/60 sm:grid-cols-[3fr_2fr]">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={labels.openLarge}
          className="group relative aspect-square w-full overflow-hidden bg-gradient-to-br from-indigo-100 to-white"
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5 animate-pulse" />
                {labels.loading}
              </span>
            </div>
          )}
          <img
            src={posterUrl}
            alt={labels.title}
            width={1080}
            height={1080}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition duration-300 ${loaded ? "opacity-100" : "opacity-0"} group-hover:scale-[1.02]`}
          />
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm backdrop-blur transition group-hover:bg-white">
            <Maximize2 className="h-3 w-3" />
            {labels.openLarge}
          </span>
        </button>

        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="text-sm leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-900">
              {labels.title}
            </p>
            <p className="mt-2 text-slate-600">{labels.body}</p>
          </div>

          <div className="mt-auto flex flex-col gap-2">
            {/* Primary: PDF (A4 portrait, clickable URL + QR). */}
            <a
              href={posterPdfUrl}
              download={downloadPdfName}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-indigo-700 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-800"
            >
              <Download className="h-3.5 w-3.5" />
              {labels.downloadPdf}
            </a>
            {/* Secondary: PNG (1080×1080, social shares). */}
            <div className="flex gap-2">
              <a
                href={posterUrl}
                download={downloadName}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-indigo-300 bg-white px-3 text-[11.5px] font-semibold text-indigo-800 transition hover:border-indigo-500 hover:bg-indigo-50"
              >
                <Download className="h-3 w-3" />
                {labels.download}
              </a>
              <button
                type="button"
                onClick={() => {
                  const win = window.open(posterPdfUrl, "_blank");
                  if (win) {
                    win.addEventListener("load", () => {
                      win.focus();
                      win.print();
                    });
                  }
                }}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-indigo-300 bg-white px-3 text-[11.5px] font-semibold text-indigo-800 transition hover:border-indigo-500 hover:bg-indigo-50"
              >
                <Printer className="h-3 w-3" />
                {labels.print}
              </button>
            </div>
          </div>
        </div>
      </article>
      )}

      {zoomed && (
        <ZoomOverlay
          src={posterUrl}
          alt={labels.title}
          closeLabel={labels.close}
          onClose={() => setZoomed(false)}
        />
      )}
    </section>
  );
}

function ZoomOverlay({
  src,
  alt,
  closeLabel,
  onClose,
}: {
  src: string;
  alt: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white"
      >
        ✕
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[88vh] max-w-[88vw] rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
