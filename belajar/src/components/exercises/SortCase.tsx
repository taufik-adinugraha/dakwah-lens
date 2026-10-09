"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { CaseState, Word } from "@/content/schema";
import { useProgress } from "@/hooks/useProgress";
import { CASE_META, SORT_BINS } from "@/lib/cases";
import { seededShuffle } from "@/lib/shuffle";

import { ExerciseShell, Feedback } from "./ExerciseShell";

/**
 * "Sortir Akhiran" — sort the ayah's words into raf' / nasb / jarr / mabni.
 * Tap a word, then tap its bin (no drag-and-drop: works with a thumb and a
 * keyboard). Words are the mushaf words, unaltered; they slide calmly into
 * place — nothing explodes or is thrown away (plan §4.7).
 */
export function SortCase({ id, words }: { id: string; words: Word[] }) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const items = useMemo(
    () => seededShuffle(words.filter((w) => SORT_BINS.includes(w.case.state)), id),
    [words, id],
  );
  const [placed, setPlaced] = useState<Record<string, CaseState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; word: Word } | null>(null);
  const [misses, setMisses] = useState(0);

  if (items.length < 2) return null;
  const remaining = items.filter((w) => !placed[w.loc]);
  const finished = remaining.length === 0;

  const drop = (bin: CaseState) => {
    const word = items.find((w) => w.loc === selected);
    if (!word) return;
    if (word.case.state === bin) {
      const next = { ...placed, [word.loc]: bin };
      setPlaced(next);
      setSelected(null);
      setFeedback({ ok: true, word });
      if (Object.keys(next).length === items.length) {
        markDone(id, Math.max(0, items.length - misses) / items.length);
      }
    } else {
      setMisses((m) => m + 1);
      setFeedback({ ok: false, word });
    }
  };

  return (
    <ExerciseShell
      title={t("sort_title")}
      instruction={t("sort_instruction")}
      done={finished || Boolean(progress[id])}
      doneLabel={t("done")}
    >
      <div lang="ar" dir="rtl" className="flex min-h-14 flex-wrap justify-center gap-2">
        {remaining.map((w) => (
          <button
            key={w.loc}
            type="button"
            onClick={() => setSelected(w.loc)}
            aria-pressed={selected === w.loc}
            className={`quran rounded-xl border px-3 py-1 text-2xl transition ${
              selected === w.loc ? "border-forest bg-forest-tint" : "border-hairline hover:bg-paper-deep"
            }`}
          >
            {w.ar}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SORT_BINS.map((bin) => {
          const m = CASE_META[bin];
          const inBin = items.filter((w) => placed[w.loc] === bin);
          return (
            <button
              key={bin}
              type="button"
              onClick={() => drop(bin)}
              disabled={!selected}
              className={`flex min-h-24 flex-col items-center rounded-xl p-2 ring-1 ring-inset transition disabled:opacity-70 ${m.className}`}
            >
              <span className="text-sm font-semibold">
                <span aria-hidden>{m.shape}</span> {m.label}
              </span>
              <span lang="ar" dir="rtl" className="quran mt-1 flex flex-wrap justify-center gap-1 text-lg">
                {inBin.map((w) => (
                  <span key={w.loc}>{w.ar}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <Feedback ok={feedback.ok}>
          {feedback.ok ? t("right") : t("not_yet")}{" "}
          <span lang="ar" dir="rtl" className="quran text-lg">{feedback.word.ar}</span> —{" "}
          {feedback.word.why}
        </Feedback>
      )}
      {finished && (
        <Feedback ok>
          {t("score", { right: Math.max(0, items.length - misses), total: items.length })}
        </Feedback>
      )}
    </ExerciseShell>
  );
}
