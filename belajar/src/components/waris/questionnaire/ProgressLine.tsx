"use client";

import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SectionId } from "@/lib/waris/questionnaire";

type Status = "selesai" | "sekarang" | "nanti" | "dilewati";

/**
 * Progress as named sections without a total (plan §5.1, §5.7 "Progress": conditional sections
 * would change "dari 6" mid-way), plus "Langkah N" for the screen itself. Each state carries an
 * icon or weight AND a visually hidden word, never colour alone.
 */
export function ProgressLine({ sections, step }: { sections: { section: SectionId; status: Status }[]; step: number | null }) {
  const t = useTranslations("Q");
  return (
    <div className="print:hidden">
      {step !== null ? <p className="text-base font-semibold text-forest">{t("ui.langkah", { n: step })}</p> : null}
      <nav aria-label={t("ui.bagian_label")} className="mt-1">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-base">
          {sections.map((s, i) => (
            <li key={s.section} className="inline-flex items-center gap-x-1">
              {i > 0 ? (
                <span aria-hidden className="text-ink-soft">
                  ·
                </span>
              ) : null}
              <span
                aria-current={s.status === "sekarang" ? "step" : undefined}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  s.status === "sekarang"
                    ? "border-[1.5px] border-forest bg-forest-tint font-semibold text-ink"
                    : s.status === "selesai"
                      ? "text-ink"
                      : s.status === "dilewati"
                        ? "text-ink-soft line-through"
                        : "text-ink-soft"
                }`}
              >
                {s.status === "selesai" ? <Check className="h-4 w-4 text-forest" aria-hidden /> : null}
                {s.status === "dilewati" ? <Minus className="h-4 w-4" aria-hidden /> : null}
                {t(`bagian.${s.section}`)}
                <span className="sr-only">
                  {" "}
                  ({t(`ui.status_${s.status}`)})
                </span>
              </span>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
