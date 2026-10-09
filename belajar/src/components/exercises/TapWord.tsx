"use client";

import { Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useProgress } from "@/hooks/useProgress";
import { useSegmentPlayer, type RecitationSource } from "@/hooks/useSegmentPlayer";
import { seededShuffle } from "@/lib/shuffle";

import type { PlayerWord } from "../lesson/AyahPlayer";
import { ExerciseShell, Feedback } from "./ExerciseShell";

/**
 * "Dengar & Ketuk" — the imam says one word (seeked inside the streamed ayah
 * recording); the learner taps it. Trains listening-to-text mapping. The
 * mushaf words are shown unaltered; no sound effects.
 */
export function TapWord({
  id,
  words,
  source,
}: {
  id: string;
  words: PlayerWord[];
  source: RecitationSource;
}) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const p = useSegmentPlayer([source]);
  const order = useMemo(() => {
    const timed = new Set(source.segments.map(([w]) => w));
    return seededShuffle(
      words.filter((w) => timed.has(w.index)).map((w) => w.index),
      id,
    );
  }, [words, id, source]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<number | null>(null);
  const [right, setRight] = useState(0);

  if (order.length < 2) return null;
  const finished = i >= order.length;
  const target = order[Math.min(i, order.length - 1)];
  const targetWord = words.find((w) => w.index === target);

  const tap = (index: number) => {
    if (answer !== null || finished) return;
    setAnswer(index);
    if (index === target) setRight((n) => n + 1);
  };

  const next = () => {
    const n = i + 1;
    setI(n);
    setAnswer(null);
    if (n >= order.length) markDone(id, right / order.length);
  };

  return (
    <ExerciseShell
      title={t("tap_title")}
      instruction={t("tap_instruction")}
      done={finished || Boolean(progress[id])}
      doneLabel={t("done")}
    >
      {finished ? (
        <Feedback ok>{t("score", { right, total: order.length })}</Feedback>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-faint">
              {i + 1} / {order.length}
            </p>
            <button
              type="button"
              onClick={() => p.playWord(target)}
              className="inline-flex items-center gap-2 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper hover:bg-forest-hover"
            >
              <Volume2 className="h-4 w-4" />
              {t("tap_play")}
            </button>
          </div>
          <p
            lang="ar"
            dir="rtl"
            className="quran mt-4 flex flex-wrap justify-center gap-x-3 gap-y-2 text-[1.8rem] leading-[2.3]"
          >
            {words.map((w) => {
              const isAnswer = answer === w.index;
              const isTarget = answer !== null && w.index === target;
              return (
                <button
                  key={w.index}
                  type="button"
                  onClick={() => tap(w.index)}
                  className={`rounded-lg px-1.5 transition-colors ${
                    isTarget
                      ? "bg-forest-tint text-forest"
                      : isAnswer
                        ? "bg-paper-deep"
                        : "hover:bg-paper-deep"
                  }`}
                >
                  {w.ar}
                </button>
              );
            })}
          </p>
          {answer !== null && targetWord && (
            <>
              <Feedback ok={answer === target}>
                {answer === target ? t("right") : t("tap_was")}{" "}
                <span lang="ar" dir="rtl" className="quran text-lg">{targetWord.ar}</span>{" "}
                ({targetWord.translit} — {targetWord.gloss})
              </Feedback>
              <button
                type="button"
                onClick={next}
                className="mt-3 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-paper hover:bg-forest-hover"
              >
                {i + 1 < order.length ? t("next") : t("finish")}
              </button>
            </>
          )}
        </>
      )}
      <audio ref={p.audioRef} src={p.source.url} preload="none" />
    </ExerciseShell>
  );
}
