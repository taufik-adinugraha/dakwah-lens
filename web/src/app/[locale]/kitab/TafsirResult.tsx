"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

/**
 * Tafsir Ibn Kathir search hits are paragraph-sized chunks of a per-ayah
 * commentary that can be 5-50K chars long. Rendering the matched chunk
 * alone reads as cut-off mid-sentence, since the surrounding paragraphs
 * are off-screen. This component shows:
 *
 *   - the matched chunk as the primary surface (highest signal)
 *   - "Excerpt N of M" badge so the reader knows where in the entry
 *     they are
 *   - leading/trailing ellipses when this isn't the first / last chunk
 *   - an expandable "Show full commentary" toggle to reveal the entire
 *     per-ayah commentary (English + Arabic alongside)
 *
 * Used by /kitab when the hit corpus is `tafsir`. Other corpora render
 * inline in `page.tsx` because their payloads are already short enough
 * to display in full.
 */
export function TafsirResult({
  chunk,
  fullCommentaryEn,
  fullCommentaryAr,
  chunkIndex,
  totalChunks,
}: {
  chunk: string;
  fullCommentaryEn?: string;
  fullCommentaryAr?: string;
  chunkIndex?: number;
  totalChunks?: number;
}) {
  const t = useTranslations("Kitab");
  const [expanded, setExpanded] = useState(false);

  const idx = (chunkIndex ?? 0) + 1;
  const total = totalChunks ?? 1;
  const hasMultipleChunks = total > 1;
  const isFirst = idx === 1;
  const isLast = idx === total;

  const canExpand =
    !!fullCommentaryEn && fullCommentaryEn.length > chunk.length + 20;

  return (
    <div className="mt-2">
      {hasMultipleChunks && (
        <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 ring-1 ring-violet-100">
          {t("tafsir_excerpt_badge", { idx, total })}
        </p>
      )}

      <p className="text-sm leading-relaxed text-ink-muted whitespace-pre-line">
        {!isFirst && <span className="text-ink-faint">… </span>}
        {chunk}
        {!isLast && <span className="text-ink-faint"> …</span>}
      </p>

      {canExpand && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="group inline-flex items-center gap-1 text-xs font-medium text-violet-700 transition hover:text-violet-900"
          >
            {expanded ? t("tafsir_hide_full") : t("tafsir_show_full")}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>

          {expanded && (
            <div className="mt-3 space-y-3 rounded-xl border border-violet-100 bg-violet-50/30 p-3 sm:p-4">
              {fullCommentaryAr && (
                <p
                  className="text-right font-amiri text-base leading-loose text-ink"
                  dir="rtl"
                  lang="ar"
                >
                  {fullCommentaryAr}
                </p>
              )}
              {fullCommentaryEn && (
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">
                  {fullCommentaryEn}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
