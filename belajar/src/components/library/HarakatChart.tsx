import { type Clip, clipFor } from "@/lib/clips";
import { hasWaqfNote } from "@/lib/heard";
import type { PreparedSign } from "@/lib/terms";

import { ClipButton, ClipPlayerProvider } from "./ClipButton";
import { ClipNote, clipNoteId } from "./ClipNote";
import { MarkCircle } from "./MarkCircle";
import { MixedText } from "./MixedText";

export type HarakatLabels = {
  /** "Bunyi" */
  sound: string;
  /** "Contoh" */
  example: string;
  /** "dari {word}" is built here: "dari" */
  from: string;
  /** Who recites the examples and where the timings come from (Clip.credit). */
  credit: string;
  /** Under a voice button whose word ends its ayah (Clip.waqf_note). */
  waqf: string;
};

/**
 * The harakat, one card each (operator 2026-10-10: "expect also people dont understand what is
 * kasrah, dhommah, and fathah"): the sign alone, large, on a dotted circle; its name in Latin and
 * Arabic (term table); its sound, place and shape; and an example letter as an ayah writes it —
 * بِ of بِسْمِ is b + i. The sign and the letter are both cut from Tanzil bytes
 * (src/lib/terms.ts prepareSigns); the word they come from is a lesson word (`words`) or, where
 * no lesson word lets the sign be heard, another ayah's (the sign's own `word`).
 *
 * The text sits beside the circle while its longest unbreakable piece fits there (10rem: a
 * term with its Arabic, "dhammah (ضَمَّة)", is about 9rem), else under it (flex-wrap): on a
 * 390px phone that is from Besar up. Beside it at Sangat besar the column was 128px, and
 * "dari ٱلْحَمْدُ (al-ḥamdu)", one nowrap run of 205px, made the page scroll sideways (CI
 * 2026-10-11). "dari" may end a line; the word stays with its transliteration (rule 15).
 *
 * Each card ends with the imam's voice of that word (operator 2026-10-12: "when explaining
 * dhommah, kasrah, etc provide example + additional voice"): "▶ Dengarkan" plays Mishary Alafasy
 * reciting بِسْمِ itself, cut from the ayah's recording (a letter alone is never recited; `clips`:
 * library.json's, keyed by the word, src/lib/clips.ts). One player for the page, around the list.
 *
 * A card teaches the SOUND of its sign, so its example is a place where the sign is heard (review
 * 2026-10-12: دٌ = d + un "dari أَحَدٌ (aḥadun)" played "aḥad", the ayah's last word, where the imam
 * stops): the build takes no sign from the last letter of an ayah's last word, and a tanwin only
 * before a letter that keeps its n clear — مٌ = m + un from سَلَٰمٌ (salāmun) of QS 97:5, followed
 * by hiya (pipeline/clips.py sign_heard_problems). A word that ends its ayah (its sign elsewhere
 * in the word) carries the waqf line of the example rows.
 */
export function HarakatChart({
  signs,
  words,
  labels,
  clips = {},
}: {
  signs: PreparedSign[];
  /** Lesson word by loc (content bytes): the example's word and its transliteration. */
  words: Record<string, { ar: string; translit: string }>;
  labels: HarakatLabels;
  clips?: Readonly<Record<string, Clip>>;
}) {
  return (
    <ClipPlayerProvider>
      <ul className="grid gap-3 sm:grid-cols-2">
        {signs.map((s, i) => {
          const w = words[s.loc] ?? s.word;
          const clip = clipFor(clips, s.loc);
          const waqfId = hasWaqfNote(clip, w?.ar) ? clipNoteId(`sign-${i + 1}`, s.loc) : undefined;
          return (
            <li key={i} className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-2xl border-[1.5px] border-teal-line bg-white p-4">
              <MarkCircle mark={s.mark} />
              <div className="min-w-[min(10rem,100%)] flex-1">
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
                    <span className="text-sm text-ink-muted">
                      {labels.from}{" "}
                      <span className="whitespace-nowrap">
                        <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-ink">
                          {w.ar}
                        </bdi>{" "}
                        ({w.translit})
                      </span>
                    </span>
                  ) : null}
                </p>
                {w && clip ? <ClipButton loc={s.loc} clip={clip} word={w.translit} noteId={waqfId} className="mt-2" /> : null}
                {w && clip && waqfId ? <ClipNote id={waqfId} kind="waqf" text={labels.waqf} className="mt-1 text-base" /> : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">
        <MixedText text={labels.credit} />
      </p>
    </ClipPlayerProvider>
  );
}
