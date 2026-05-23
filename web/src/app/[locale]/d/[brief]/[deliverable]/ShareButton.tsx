"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/** Native share if available, copy-to-clipboard fallback. Lives on its
 *  own component because the parent /d/{brief}/{deliverable}/page.tsx
 *  is a server component. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
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

  return (
    <button
      type="button"
      onClick={onClick}
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
  );
}
