"use client";

import { Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { MixedText } from "@/components/library/MixedText";
import type { ComposeFile } from "@/content/compose-schema";
import type { StageExample } from "@/lib/autoplay";
import { glossSlot } from "@/lib/emphasis";

/** What the stage says of its example beat right now, for the CI checks (data-example-state):
 *  the imam is reciting it, its recording could not be played, or it is just on screen. */
export type ExampleCardState = "reciting" | "failed" | "shown";

/**
 * The example of the rule just explained, in the word card's slot (operator 2026-10-12: "in
 * principel, each explanation should be followed by examples (visual + voice)", "not only for
 * harakah, but also for all rules"; plan L20): after a "Konsep baru" line, the concept's example
 * in this ayah — the word big (the content's Tanzil bytes, never retyped), its transliteration,
 * "yang artinya …", and, when the example is about the word's own harakah and that harakah is
 * heard there, the harakah named with its sound ("akhirnya kasrah (كَسْرَة) · bunyi i": the mark
 * table of content/compose; in words, never colour alone, and the Arabic is never split or
 * coloured in pieces) — while the imam recites it and the mushaf line lights the word. The tag
 * says "Contoh" and where the word stands: its number in this ayah, or "QS 112:1" for an example
 * from another ayah. In lesson zero (no ayah) it also says what the word is an example of
 * ("Fi'il, kata kerja."): the narrator named the three kinds, and the card names this one.
 *
 * ONE focused card (operator 2026-10-10: "too crowded"): it takes the word card's place, with the
 * word card's own layout — one compact row on a phone, the Arabic on the right; stacked and
 * centred from sm — so nothing on the stage moves when it comes or goes. Nothing here is spoken
 * by the narrator: the beat has a caption in the bottom panel ("Contoh: …") and the imam's voice.
 */
export function ExampleCard({
  id,
  example,
  state,
  marks,
}: {
  id: string;
  example: StageExample;
  state: ExampleCardState;
  /** The marks the stage can name (content/compose `marks`); null: no harakah is named. */
  marks: ComposeFile["marks"] | null;
}) {
  const t = useTranslations("Guided");
  const tc = useTranslations("Compose");
  const mark = example.ending && marks ? (marks[example.ending] ?? null) : null;
  const where =
    example.word !== null ? t("word_n", { n: example.word }) : t("example_place", { surah: example.place.surah, ayah: example.place.ayah });
  return (
    <div
      data-autoplay="example"
      data-example={id}
      data-example-state={state}
      data-clip={example.key}
      className="mx-auto flex max-w-xl flex-wrap-reverse items-center gap-x-4 gap-y-1 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-2 sm:flex-col sm:flex-nowrap sm:py-3 sm:text-center"
    >
      <div className="flex-[1_1_min-content] sm:contents">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-forest sm:order-1 sm:justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-forest px-2.5 py-px whitespace-nowrap text-paper">
            <Volume2 aria-hidden className="h-4 w-4 shrink-0" />
            {t("example_tag")}
          </span>
          <span className="whitespace-nowrap">{where}</span>
        </p>
        <p className="text-lg text-ink-muted sm:order-3">
          <MixedText text={example.translit} />
        </p>
        {example.gloss ? (
          <p className="text-xl text-pretty text-ink sm:order-4">
            <MixedText {...glossSlot((g) => t("card_meaning", { gloss: g }), example.gloss)} />
          </p>
        ) : null}
        {mark ? (
          // "akhirnya kasrah (كَسْرَة) · bunyi i": the term never leaves its Arabic nor the dot after
          // it, so a narrow column (Sangat besar on a phone) breaks only before "akhirnya"'s term
          // or before the sound — never a line that starts with "·" (line breaks, 2026-10-10).
          <p data-example-ending={example.ending ?? undefined} className="text-base text-pretty text-ink sm:order-5">
            {t("example_ending")}{" "}
            <span className="whitespace-nowrap">
              <MixedText text={mark.display} />
              {mark.sound ? " ·" : null}
            </span>
            {mark.sound ? (
              <>
                {" "}
                <span className="font-semibold whitespace-nowrap text-forest">{tc("sound", { v: mark.sound })}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {example.about ? (
          // Lesson zero: what the word is an example of ("Fi'il, kata kerja."), the record's note
          // (examples.ts aboutOf) — with no ayah on screen, nothing else on the stage says it.
          <p data-example-about className="text-base text-pretty font-semibold text-forest sm:order-5">
            <MixedText text={example.about.charAt(0).toUpperCase() + example.about.slice(1)} />
          </p>
        ) : null}
      </div>
      <p lang="ar" dir="rtl" className="quran ml-auto text-ar-lg text-ink sm:order-2 sm:ml-0 sm:text-ar-xl">
        {example.ar}
      </p>
    </div>
  );
}
