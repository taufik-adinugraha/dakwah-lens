"use client";

import { CheckCircle2, ChevronRight, Clock, List, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { MainSiteBridge } from "@/components/MainSiteBridge";
import { quranHref } from "@/lib/routes";

import type { SurahRef } from "./useUpNext";

/** Moves keyboard focus to the card when it appears (never scrolls). */
const focusOnMount = (el: HTMLElement | null) => {
  el?.focus({ preventScroll: true });
};

/**
 * The calm end of a surah's autoplay lesson, shown inside the stage: no
 * score, no fanfare, three plain choices. "Ulangi {surah}" and "Surah
 * berikutnya" start the lesson there by themselves (the tap is the
 * learner's go), "Daftar surah" is a plain link. Only a published surah is
 * offered next (useUpNext.ts); while the next one is not published, the card
 * says it is coming soon, in words, with nothing to click (operator,
 * 2026-10-10: Al-Fatihah first), and "Ulangi Al-Fatihah" is the primary
 * choice.
 */
export function SurahEndCard({
  surahName,
  nextSurah,
  comingSoon,
  onRepeat,
  onNextSurah,
}: {
  surahName: string;
  /** The published surah to go on to; null after the last, or while none is published. */
  nextSurah: SurahRef | null;
  /** The next surah's name while it is not published yet ("segera hadir"). */
  comingSoon: string | null;
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
      {comingSoon && (
        <p data-autoplay="end-soon" className="mt-3 flex max-w-prose items-start gap-3 text-pretty text-lg text-ink">
          <Clock aria-hidden className="mt-1 h-5 w-5 shrink-0 text-forest" />
          <span>
            <MixedText text={t("end_soon", { surah: comingSoon })} />
          </span>
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        {nextSurah && (
          <button type="button" data-autoplay="end-next" onClick={onNextSurah} className="btn-primary w-full sm:w-auto">
            <span>
              <MixedText text={t("end_next", { surah: nextSurah.name })} />
            </span>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          data-autoplay="end-repeat"
          onClick={onRepeat}
          className={`${nextSurah ? "btn-secondary" : "btn-primary"} w-full sm:w-auto`}
        >
          <RotateCcw aria-hidden className="h-5 w-5" />
          <span>
            <MixedText text={t("end_repeat", { surah: surahName })} />
          </span>
        </button>
        <Link href={quranHref()} className="btn-secondary w-full sm:w-auto">
          <List aria-hidden className="h-5 w-5" />
          {t("end_list")}
        </Link>
      </div>
      {/* After the surah, one calm line to Tafsir Pekan Ini (operator, 2026-10-10). */}
      <MainSiteBridge id="surah_end" className="mt-5" />
    </div>
  );
}
