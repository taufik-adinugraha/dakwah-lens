"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Download } from "lucide-react";

import { topicSlug } from "@/lib/brief-markdown";

/**
 * Two-button row: download as a .md file and copy the markdown to clipboard.
 * Both consume the pre-rendered markdown string we built server-side, so
 * the client doesn't need to know the brief's internal shape — just push
 * the bytes.
 */
export function PublicBriefDownload({
  markdown,
  topicTitle,
}: {
  markdown: string;
  topicTitle: string;
}) {
  const t = useTranslations("PublicBriefs");
  const [copied, setCopied] = useState(false);

  function onDownload() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topicSlug(topicTitle) || "brief"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on insecure origins or denied permission.
      // Surface nothing — the download button is the fallback.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onDownload}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800"
      >
        <Download className="h-3.5 w-3.5" />
        {t("download_md")}
      </button>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? t("copied") : t("copy_md")}
      </button>
    </div>
  );
}
