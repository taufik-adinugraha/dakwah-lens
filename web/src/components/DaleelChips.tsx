"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, X } from "lucide-react";

import type { DaleelRef } from "@/db/schema";

/**
 * Chip strip of retrieved daleel passages from an insights briefing.
 *
 * Click → opens an inline modal with the Arabic + translation(s) of
 * the cited passage. The chip USED to deep-link straight to
 * /kitab?q={citation} but the kitab search ignores the corpus filter
 * and treats the citation as a free-text query, surfacing junk results
 * (e.g. "QS. Al-Waaqia: 17" doesn't tokenize cleanly). A modal shows
 * what was actually cited; the "Open in Kitab" link is still there
 * for users who want the full context.
 *
 * Shared between /insights (all-platform briefing) and
 * /insights/segment/[focus] (per-segment briefings) — the daleel shape
 * is identical across both.
 */
export function DaleelChips({ refs }: { refs: DaleelRef[] }) {
  const t = useTranslations("Insights");
  const [activeId, setActiveId] = useState<string | null>(null);

  if (refs.length === 0) return null;

  const active = activeId ? refs.find((r) => r.ref_id === activeId) ?? null : null;

  return (
    <>
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/60 p-3 sm:p-4">
        <p className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
          <BookOpen className="h-3 w-3" />
          {t("exec_daleel_label")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {refs.map((d) => (
            <button
              key={d.ref_id}
              type="button"
              onClick={() => setActiveId(d.ref_id)}
              title={d.translation_id || d.translation_en || ""}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
            >
              <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                {d.corpus.replace(/_/g, " ")}
              </span>
              <span className="truncate font-medium">{d.citation}</span>
            </button>
          ))}
        </div>
      </div>

      {active && (
        <DaleelModal
          daleel={active}
          onClose={() => setActiveId(null)}
        />
      )}
    </>
  );
}

function DaleelModal({
  daleel,
  onClose,
}: {
  daleel: DaleelRef;
  onClose: () => void;
}) {
  const t = useTranslations("Insights");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daleel-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              {daleel.corpus.replace(/_/g, " ")}
            </p>
            <h3
              id="daleel-modal-title"
              className="mt-1 text-balance text-lg font-bold text-slate-900 sm:text-xl"
            >
              {daleel.citation}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("exec_daleel_close")}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {daleel.arabic && (
            <section>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("exec_daleel_arabic_label")}
              </p>
              <p
                className="text-pretty text-right text-xl leading-loose text-slate-900"
                dir="rtl"
                lang="ar"
              >
                {daleel.arabic}
              </p>
            </section>
          )}

          {daleel.translation_id && (
            <section>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("exec_daleel_translation_id_label")}
              </p>
              <p className="whitespace-pre-line text-pretty text-base leading-relaxed text-slate-800">
                {daleel.translation_id}
              </p>
            </section>
          )}

          {daleel.translation_en && (
            <section>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("exec_daleel_translation_en_label")}
              </p>
              <p className="whitespace-pre-line text-pretty text-base leading-relaxed text-slate-800">
                {daleel.translation_en}
              </p>
            </section>
          )}
        </div>

      </div>
    </div>
  );
}
