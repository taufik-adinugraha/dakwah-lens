"use client";

import clsx from "clsx";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";
import type { ReminderAyah } from "@/lib/autoplay";

/** Eastern Arabic digits for the ayah marker (as the mushaf line prints it). */
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/**
 * The REMINDER CARD, in the word card's slot (operator 2026-10-18: "in some ayat it's explain like
 * this: it becomes na'at from lafaz Allah in ayat-2, better to remind user what that previous ayat
 * looks like and give more clear explanation"). While a line says that this ayah continues an
 * earlier one — "Ayat ini melanjutkan ayat kedua.", or a word's line that cites the earlier word
 * ("… bagi ٱللَّهِ (Allāhi) di ayat kedua") — the stage shows that earlier ayah: "Ayat 2", its words
 * in the mushaf's face and order (the content's bytes, never retyped; right to left, its marker
 * glued to its last word as the mushaf line prints it), the cited word(s) highlighted — a forest
 * border, a tint and a ring, never colour alone —, and its translation (the content's own,
 * verbatim). The mushaf line above stays the current ayah, its word lit: the two together show
 * which word depends on which. What a card shows is the manifest line's `reminder`
 * (src/lib/autoplay/reminder.ts reminderAyat); a line citing two earlier ayat shows both, in order.
 *
 * Built for a phone's small room (the slot has about 270px above the caption panel at 390×844, CI
 * 2026-10-13; not measured for this card — scripts/ci/screenshots.mjs reminderChecks reports it):
 * the Arabic one size below the mushaf line's on a phone (text-ar-md, the 24px floor kept), each
 * word an unbreakable box with room for its marks (ar-clear), a wrapping row that never scrolls
 * sideways, and the translation at the body size. Nothing here is spoken.
 */
export function ReminderCard({ cards }: { cards: readonly ReminderAyah[] }) {
  const t = useTranslations("Guided");
  return (
    <section
      data-autoplay="reminder"
      data-reminder-ayat={cards.map((c) => c.ayah).join(" ")}
      aria-label={t("reminder_label")}
      className="mx-auto max-w-xl space-y-2 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-2 sm:space-y-3 sm:py-3"
    >
      {cards.map((c) => (
        <div key={c.ayah} data-reminder-ayah={c.ayah} className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold text-forest sm:justify-center">
            <History aria-hidden className="h-5 w-5 shrink-0" />
            <span>{t("reminder_ayah", { n: c.ayah })}</span>
          </h3>
          {/* lang="ar" on the Arabic only; the row itself is RTL, a block, so it is isolated from
              the Latin around it (bidi). */}
          <p dir="rtl" className="quran mt-1 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-ar-md text-ink sm:text-ar-lg">
            {c.words.map((w, i) => {
              const word = (
                <span
                  key={w.n}
                  lang="ar"
                  data-reminder-word={w.n}
                  data-reminder-hit={w.hit ? "true" : undefined}
                  className={clsx(
                    "ar-clear inline-block rounded-lg border-[1.5px] px-1.5 whitespace-nowrap",
                    w.hit ? "border-forest bg-white ring-2 ring-forest" : "border-transparent",
                  )}
                >
                  {w.ar}
                </span>
              );
              return i < c.words.length - 1 ? (
                word
              ) : (
                // The ayah marker stays with the last word (line breaks, 2026-10-10).
                <span key="end" className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
                  {word}
                  <span aria-hidden lang="ar" className="ar-clear select-none text-ink-soft">
                    ﴿{toArabicDigits(c.ayah)}﴾
                  </span>
                </span>
              );
            })}
          </p>
          <p data-reminder-translation className="mt-1 text-base text-pretty text-ink sm:text-center">
            <MixedText text={`“${c.translation}”`} />
          </p>
        </div>
      ))}
    </section>
  );
}
