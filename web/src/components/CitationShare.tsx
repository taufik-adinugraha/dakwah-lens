"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

/**
 * Per-citation share affordance. Two buttons:
 *  - WhatsApp share (deep link → wa.me with pre-filled message)
 *  - Copy to clipboard (for everything else: email, IG bio, Notes…)
 *
 * Format is tight enough to fit one WhatsApp bubble and read well in
 * monospace: Arabic on its own line (RTL renders correctly), then the
 * locale-appropriate translation, then the citation. No trailing
 * branding — da'i forward these to private groups, they don't want
 * the receiver to see a "shared from app X" footer.
 */
export function CitationShare({
  arabic,
  translation,
  citation,
}: {
  arabic: string;
  translation: string;
  citation: string;
}) {
  const [copied, setCopied] = useState(false);

  const formatted = buildShareText({ arabic, translation, citation });
  const waUrl = `https://wa.me/?text=${encodeURIComponent(formatted)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: legacy execCommand. Old Safari / non-HTTPS contexts.
      const ta = document.createElement("textarea");
      ta.value = formatted;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // best-effort — give up silently
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        aria-label="Share to WhatsApp"
      >
        <Share2 className="h-3 w-3" />
        WhatsApp
      </a>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
        aria-label={copied ? "Copied to clipboard" : "Copy citation"}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Build the share string. Plain text — WhatsApp + Telegram + iMessage
 *  + email all render this cleanly. RTL on the Arabic line works in
 *  WhatsApp natively. */
function buildShareText({
  arabic,
  translation,
  citation,
}: {
  arabic: string;
  translation: string;
  citation: string;
}): string {
  const parts: string[] = [];
  if (arabic) parts.push(arabic);
  if (translation) parts.push(translation);
  if (citation) parts.push(`— ${citation}`);
  return parts.join("\n\n");
}
