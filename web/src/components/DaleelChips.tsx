"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, ChevronDown, X } from "lucide-react";

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
 * Shared between /insights (overall-view briefing) and
 * /insights/segment/[focus] (per-segment briefings) — the daleel shape
 * is identical across both.
 */
/**
 * @param refs The daleel passages to render.
 * @param mode "chips" (default) — compact pill row, useful when the
 *   page already shows the narrative paragraph 3 inline. "cards" — full
 *   vertical stack with citation, Arabic preview, and ID translation
 *   visible at a glance. Use "cards" when paragraph 3 is hidden so the
 *   user can still scan the cited references.
 * @param headerLabel Override the section header — defaults to the
 *   Insights i18n key.
 */
export function DaleelChips({
  refs,
  mode = "chips",
  headerLabel,
}: {
  refs: DaleelRef[];
  mode?: "chips" | "cards";
  headerLabel?: string;
}) {
  const t = useTranslations("Insights");
  const locale = useLocale();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (refs.length === 0) return null;

  const active = activeId ? refs.find((r) => r.ref_id === activeId) ?? null : null;
  const label = headerLabel ?? t("exec_daleel_label");

  return (
    <>
      <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/60 p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="group flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <BookOpen className="h-3 w-3" />
            {label}
            <span className="ml-1 rounded-full bg-emerald-100/80 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800">
              {refs.length}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 text-emerald-700 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
        {expanded && (
          <div className="mt-3">
            {mode === "cards" ? (
              <div className="space-y-2">
                {refs.map((d) => (
                  <DaleelCard
                    key={d.ref_id}
                    daleel={d}
                    locale={locale}
                    onClick={() => setActiveId(d.ref_id)}
                  />
                ))}
              </div>
            ) : (
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
            )}
          </div>
        )}
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

/* ───────── Card layout — shown inline in briefings ───────── */

function DaleelCard({
  daleel,
  locale,
  onClick,
}: {
  daleel: DaleelRef;
  /** Active UI locale — switches Quran preview between ID (Kemenag) and
   *  EN (Sahih International). Hadith corpora have only EN data, so the
   *  fallback still kicks in for those. Before 2026-05-21 this always
   *  showed translation_id first, leaving the EN-locale briefing with
   *  Indonesian Quran previews on every card. */
  locale: string;
  onClick: () => void;
}) {
  const translation =
    locale === "en"
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || "";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-emerald-100 bg-white/80 px-3 py-2.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-emerald-100/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-800">
            {daleel.corpus.replace(/_/g, " ")}
          </span>
          <span className="text-xs font-semibold text-slate-900">
            {daleel.citation}
          </span>
        </div>
        <span className="text-[10px] text-slate-400 group-hover:text-emerald-700">
          tap to read full →
        </span>
      </div>
      {daleel.arabic && (
        <p
          dir="rtl"
          lang="ar"
          className="mt-2 line-clamp-2 text-pretty text-right text-base leading-relaxed text-slate-700"
        >
          {daleel.arabic}
        </p>
      )}
      {translation && (
        <p className="mt-1.5 line-clamp-2 text-pretty text-xs leading-relaxed text-slate-600">
          {translation}
        </p>
      )}
    </button>
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
  const locale = useLocale();
  // Locale-aware default: when the user reads in id, only ID translation
  // shows; when in en, only EN. A toggle reveals the other translation
  // for cross-checking. Reduces visual noise — most users want the
  // translation that matches their reading language.
  const otherLocale = locale === "id" ? "en" : "id";
  const [showOther, setShowOther] = useState(false);

  const primaryTranslation =
    locale === "en"
      ? daleel.translation_en || daleel.translation_id || ""
      : daleel.translation_id || daleel.translation_en || "";
  const primaryLabel =
    locale === "en"
      ? t("exec_daleel_translation_en_label")
      : t("exec_daleel_translation_id_label");
  const secondaryTranslation =
    otherLocale === "en"
      ? daleel.translation_en
      : daleel.translation_id;
  const secondaryLabel =
    otherLocale === "en"
      ? t("exec_daleel_translation_en_label")
      : t("exec_daleel_translation_id_label");
  const hasSecondary =
    secondaryTranslation && secondaryTranslation !== primaryTranslation;

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

          {primaryTranslation && (
            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {primaryLabel}
                </p>
                {hasSecondary && (
                  <button
                    type="button"
                    onClick={() => setShowOther((v) => !v)}
                    className="text-[10px] font-medium text-emerald-700 hover:underline"
                  >
                    {showOther
                      ? t("exec_daleel_hide_other_translation")
                      : t("exec_daleel_show_other_translation", {
                          lang: secondaryLabel,
                        })}
                  </button>
                )}
              </div>
              <p className="whitespace-pre-line text-pretty text-base leading-relaxed text-slate-800">
                {primaryTranslation}
              </p>
            </section>
          )}

          {showOther && hasSecondary && (
            <section className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {secondaryLabel}
              </p>
              <p className="whitespace-pre-line text-pretty text-sm leading-relaxed text-slate-700">
                {secondaryTranslation}
              </p>
            </section>
          )}
        </div>

      </div>
    </div>
  );
}
