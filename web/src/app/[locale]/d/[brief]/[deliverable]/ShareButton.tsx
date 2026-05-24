"use client";

import { useState } from "react";
import { Check, Download, Loader2, Share2 } from "lucide-react";

/** Share + Download row for the standalone share / article pages.
 *  Share uses native navigator.share() with clipboard fallback;
 *  Download fetches a server-rendered PDF (via the Puppeteer pipeline
 *  shared with the flyer renderer) and triggers a browser save. */
export function ShareButton({
  title,
  pdfUrl,
}: {
  title: string;
  /** Server PDF endpoint that returns this page rendered as A4 PDF.
   *  Omit to hide the Download button (some surfaces are share-only). */
  pdfUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function onShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* user cancel — fall through to clipboard */
      }
    }
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* permission denied or insecure context */
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function onDownload() {
    if (!pdfUrl) return;
    setDownloading(true);
    try {
      // Open in a new tab; the server route sends a
      // `Content-Disposition: attachment` so most browsers save
      // directly rather than navigate.
      window.location.href = pdfUrl;
    } finally {
      // Give the browser a moment to honor the download header before
      // the spinner clears. ~3s is enough for the PDF to start
      // streaming.
      window.setTimeout(() => setDownloading(false), 3000);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        onClick={onShare}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-white/95 px-4 text-xs font-bold uppercase tracking-[0.15em] text-slate-900 shadow-lg backdrop-blur transition hover:bg-white"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            Tertaut!
          </>
        ) : (
          <>
            <Share2 className="h-3.5 w-3.5" />
            Bagikan
          </>
        )}
      </button>
      {pdfUrl && (
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-xs font-bold uppercase tracking-[0.15em] text-white shadow-lg transition hover:bg-slate-800 disabled:opacity-70"
        >
          {downloading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Menyiapkan…
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              Unduh PDF
            </>
          )}
        </button>
      )}
    </div>
  );
}
