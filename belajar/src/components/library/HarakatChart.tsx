import type { PreparedSign } from "@/lib/terms";

import { MarkCircle } from "./MarkCircle";

export type HarakatLabels = {
  /** "Bunyi" */
  sound: string;
  /** "Contoh" */
  example: string;
  /** "dari {word}" is built here: "dari" */
  from: string;
};

/**
 * The harakat, one card each (operator 2026-10-10: "expect also people dont understand what is
 * kasrah, dhommah, and fathah"): the sign alone, large, on a dotted circle; its name in Latin and
 * Arabic (term table); its sound, place and shape; and an example letter as an ayah writes it —
 * بِ of بِسْمِ is b + i. The sign and the letter are both cut from Tanzil bytes
 * (src/lib/terms.ts prepareSigns); the word is the lesson word they come from.
 */
export function HarakatChart({
  signs,
  words,
  labels,
}: {
  signs: PreparedSign[];
  /** Lesson word by loc (content bytes): the example's word and its transliteration. */
  words: Record<string, { ar: string; translit: string }>;
  labels: HarakatLabels;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {signs.map((s, i) => {
        const w = words[s.loc];
        return (
          <li key={i} className="flex items-start gap-4 rounded-2xl border-[1.5px] border-teal-line bg-white p-4">
            <MarkCircle mark={s.mark} />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">
                <span className="whitespace-nowrap">
                  {s.term?.latin}
                  {s.term?.ar ? (
                    <>
                      {" ("}
                      <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm font-normal text-forest">
                        {s.term.ar}
                      </bdi>
                      )
                    </>
                  ) : null}
                </span>
              </p>
              <p className="text-base text-ink">
                {labels.sound}: <span className="font-semibold">{s.sound}</span>
              </p>
              <p className="text-base text-ink-muted">
                {s.shape}, {s.place}
              </p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm text-ink-muted">{labels.example}:</span>
                <span lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
                  {s.letter}
                </span>
                <span className="text-base text-ink">= {s.reading}</span>
                {w ? (
                  <span className="whitespace-nowrap text-sm text-ink-muted">
                    {labels.from}{" "}
                    <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink">
                      {w.ar}
                    </bdi>{" "}
                    ({w.translit})
                  </span>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
