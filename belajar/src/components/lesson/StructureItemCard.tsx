"use client";

import { ListTree } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";

/** A word of the ayah as the card shows it: its place, its Arabic (the lesson content's bytes,
 *  never retyped) and its transliteration. */
export type StructureItemWord = { index: number; ar: string; translit: string };

/**
 * ONE ITEM of the ayah's sentence structure, in the word card's slot (operator 2026-10-13: "can we
 * make this kind of explanation in items: harfjar in one item, idhafah in next item etc, it's kind
 * of confusing which for which in this paragraph"). Until then the structure was one paragraph
 * said over the whole ayah, every word lit, and nothing showed which words a sentence was about.
 *
 * An item is a step of the lesson with a line of its own: while it is said, the mushaf line marks
 * the item's words and this card shows THEM — the thing being explained — each under its place in
 * the ayah ("Kata ke-2"), which is how the narrator names a word (he never says a Qur'anic word),
 * in the ayah's own reading order, right to left. The heading says which item of how many.
 *
 * Built for the room a phone leaves (measured in CI at 390×844: about 270px above the caption
 * panel): a heading and the words in a wrapping row — four words, the most an item of Al-Fatihah
 * has, take two rows at the normal text size. The Arabic at the stage's large size, a word never
 * cut; nothing scrolls sideways. Nothing here is spoken.
 */
export function StructureItemCard({ n, total, words }: { n: number; total: number; words: readonly StructureItemWord[] }) {
  const t = useTranslations("Guided");
  return (
    <section
      data-autoplay="structure-item"
      data-item={n}
      aria-label={t("structure_item_label")}
      className="mx-auto max-w-xl rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-2 sm:py-3"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold text-forest sm:justify-center">
        <ListTree aria-hidden className="h-5 w-5 shrink-0" />
        <span>{t("structure_item", { n, total })}</span>
      </h3>
      <ul dir="rtl" className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-1">
        {words.map((w) => (
          <li key={w.index} data-item-word={w.index} className="flex min-w-0 flex-col items-center text-center">
            <span lang="ar" dir="rtl" className="quran text-ar-lg whitespace-nowrap text-ink">
              {w.ar}
            </span>
            <span dir="ltr" className="text-base text-ink-muted">
              <MixedText text={w.translit} />
            </span>
            <span dir="ltr" className="text-base font-semibold whitespace-nowrap text-forest">
              {t("word_n", { n: w.index })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
