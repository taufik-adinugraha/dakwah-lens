"use client";

import { useTranslations } from "next-intl";

import type { CurriculumLead } from "@/lib/autoplay/curriculum";

/**
 * A lesson-zero SLIDE in the word card's slot: a few cards side by side, each a word of one
 * language with its meaning (operator 2026-10-15: "we need another page/slide to explain that
 * kalimah in Arabic is different: kalimah in Arabic means word, while in bahasa it means
 * sentence/kalimat"). For the kalimah step: كَلِمَة (bahasa Arab) “satu kata” ≠ kalimat (bahasa
 * Indonesia) “rangkaian kata yang bermakna utuh”, which Arabic calls كَلَام.
 *
 * Shows what the line says and nothing else (narration rule 21): the cards are the slide's own
 * (content/curriculum.json `lead.cards`, built by pipeline/build_curriculum.py), every Arabic
 * string a term of the term table (its verified spelling, never typed here and never Qur'anic).
 * The meaning bold in forest (rule 18); colour is never the only cue — each card names its
 * language in words. Nothing here is spoken.
 */
export function TermContrastCard({ id, lead }: { id: string; lead: CurriculumLead }) {
  const t = useTranslations("Guided");
  return (
    <section
      data-autoplay="term-contrast"
      data-step={id}
      aria-label={t("lead_label")}
      className="mx-auto flex max-w-xl flex-wrap items-stretch justify-center gap-2 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-3 py-2 sm:gap-4 sm:px-5 sm:py-3"
    >
      {lead.cards.map((c, i) => (
        <div key={i} className="flex min-w-[min(11rem,100%)] flex-1 flex-col items-center rounded-xl border-2 border-hairline bg-white px-3 py-1.5 text-center">
          <p className="text-sm font-semibold text-ink-muted">{c.lang === "ar" ? t("lead_lang_ar") : t("lead_lang_id")}</p>
          {c.lang === "ar" && c.term ? (
            <>
              <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-lg whitespace-nowrap text-ink">
                {c.term.ar}
              </bdi>
              <span className="text-base text-ink-muted">{c.term.latin}</span>
            </>
          ) : (
            <span className="text-2xl font-medium text-ink">{c.word}</span>
          )}
          <span data-emph="meaning" className="text-base font-semibold text-pretty text-forest">
            “{c.means}”
          </span>
          {c.lang === "id" && c.term ? (
            <span className="mt-1 text-sm text-ink-muted">
              {t("lead_in_arabic")}{" "}
              <span className="whitespace-nowrap font-semibold text-ink">
                {c.term.latin} (
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm font-normal">
                  {c.term.ar}
                </bdi>
                )
              </span>
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}
