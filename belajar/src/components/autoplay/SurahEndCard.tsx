"use client";

import { CheckCircle2, ChevronRight, List, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { quranHref } from "@/lib/routes";

/** Moves keyboard focus to the card when it appears (never scrolls). */
const focusOnMount = (el: HTMLElement | null) => {
  el?.focus({ preventScroll: true });
};

/**
 * The calm end of a surah's autoplay lesson, shown inside the stage: no
 * score, no fanfare, three plain choices. "Ulangi surah" and "Surah
 * berikutnya" start the lesson there by themselves (the tap is the
 * learner's go), "Daftar surah" is a plain link.
 */
export function SurahEndCard({
  surahName,
  nextSurah,
  onRepeat,
  onNextSurah,
}: {
  surahName: string;
  nextSurah: { slug: string; name: string } | null;
  onRepeat: () => void;
  onNextSurah: () => void;
}) {
  const t = useTranslations("Guided");
  return (
    <div ref={focusOnMount} tabIndex={-1} data-autoplay="end" className="mt-5 rounded-2xl bg-ok-bg px-5 py-5 sm:px-6">
      <p className="flex items-center gap-3 font-display text-2xl font-medium text-ink">
        <CheckCircle2 aria-hidden className="h-7 w-7 shrink-0 text-forest" />
        {/* Surah names ("Al-Ikhlas") are never cut at the hyphen (line breaks, 2026-10-10). */}
        <span>
          <MixedText text={t("end_title", { surah: surahName })} />
        </span>
      </p>
      <p className="mt-2 max-w-prose text-pretty text-lg text-ink">{t("end_text")}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {nextSurah && (
          <button type="button" onClick={onNextSurah} className="btn-primary w-full sm:w-auto">
            <span>
              <MixedText text={t("end_next", { surah: nextSurah.name })} />
            </span>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={onRepeat}
          className={`${nextSurah ? "btn-secondary" : "btn-primary"} w-full sm:w-auto`}
        >
          <RotateCcw aria-hidden className="h-5 w-5" />
          {t("end_repeat")}
        </button>
        <Link href={quranHref()} className="btn-secondary w-full sm:w-auto">
          <List aria-hidden className="h-5 w-5" />
          {t("end_list")}
        </Link>
      </div>
    </div>
  );
}
