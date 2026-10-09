"use client";

import { Gauge, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";

import { useSegmentPlayer, type RecitationSource } from "@/hooks/useSegmentPlayer";

export type PlayerWord = { index: number; ar: string; translit: string; gloss: string };

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) =>
  String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

/**
 * The ayah as the imam recites it: words light up as they are read; tapping a
 * word replays just that word (seek within the streamed file). Reciters:
 * Husary Mu'allim (teaching recitation with a built-in "repeat after me"
 * gap) and Alafasy. No sound effects ever play over recitation (plan §4.7).
 */
export function AyahPlayer({
  ayah,
  words,
  sources,
}: {
  ayah: number;
  words: PlayerWord[];
  sources: (RecitationSource & { label: string; credit: string })[];
}) {
  const t = useTranslations("Player");
  const p = useSegmentPlayer(sources);

  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-7">
      {/* Mushaf-style line: RTL, Qur'an font, words are buttons. */}
      <p
        lang="ar"
        dir="rtl"
        className="quran flex flex-wrap justify-center gap-x-3 gap-y-2 text-[1.9rem] leading-[2.4] sm:text-[2.3rem]"
      >
        {words.map((w) => {
          const active = p.activeWord === w.index;
          return (
            <button
              key={w.index}
              type="button"
              onClick={() => p.playWord(w.index)}
              disabled={!p.hasWord(w.index)}
              aria-label={t("play_word", { translit: w.translit, gloss: w.gloss })}
              className={`rounded-lg px-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                active ? "bg-forest-tint text-forest" : "hover:bg-paper-deep"
              }`}
            >
              {w.ar}
            </button>
          );
        })}
        <span aria-hidden className="select-none text-ink-faint">
          ﴿{toArabicDigits(ayah)}﴾
        </span>
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={p.playing ? p.pause : p.playAll}
          className="inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper transition hover:bg-forest-hover"
        >
          {p.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {p.playing ? t("pause") : t("play_ayah")}
        </button>
        <button
          type="button"
          onClick={() => p.setRate(p.rate === 1 ? 0.75 : 1)}
          aria-pressed={p.rate === 0.75}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition ${
            p.rate === 0.75
              ? "border-forest bg-forest-tint text-forest"
              : "border-hairline text-ink-muted hover:bg-paper-deep"
          }`}
        >
          <Gauge className="h-4 w-4" />
          {p.rate === 0.75 ? "0.75×" : "1×"}
        </button>
        {sources.length > 1 && (
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
            <span className="sr-only">{t("reciter")}</span>
            <select
              value={p.sourceIdx}
              onChange={(e) => p.chooseSource(Number(e.target.value))}
              className="rounded-full border border-hairline bg-white px-3 py-2 text-sm"
            >
              {sources.map((s, i) => (
                <option key={s.reciter} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-ink-muted">{t("hint_tap")}</p>
      {/* Recitation streams from the reciter's CDN; never re-hosted (plan §6.2). */}
      <p className="mt-1 text-center text-[11px] text-ink-faint">{sources[p.sourceIdx]?.credit}</p>
    </div>
  );
}
