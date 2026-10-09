"use client";

import clsx from "clsx";
import { Volume2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { useImamRate } from "@/hooks/usePace";
import { useSegmentPlayer, type RecitationSource } from "@/hooks/useSegmentPlayer";
import { seededShuffle } from "@/lib/shuffle";

import {
  Counter,
  ExerciseShell,
  Feedback,
  Finished,
  OptionMark,
  QuizActions,
  optionState,
  useChoiceQuiz,
  useRestart,
  useStepFocus,
} from "./ExerciseShell";

/** Same shape as the lesson player's words (structurally typed). */
type TapWordItem = { index: number; ar: string; translit: string; gloss: string };
type Props = { id: string; words: TapWordItem[]; source: RecitationSource };

/**
 * "Dengar dan ketuk" — the imam says one word (seeked inside the streamed
 * ayah recording); the learner taps it. Trains listening-to-text mapping.
 * The mushaf words are shown unaltered, as chips that look tappable; no
 * sound effects. The player lives outside the round so "Ulangi latihan"
 * does not recreate the audio element. It plays at the learner's remembered
 * imam speed, and starting it pauses any other recording on the page (the
 * lesson stage stops its guided lesson), so recordings never overlap.
 */
export function TapWord(props: Props) {
  const { round, restart } = useRestart();
  const [imamRate] = useImamRate();
  const p = useSegmentPlayer([props.source], { rate: imamRate });
  return (
    <TapWordRound
      key={round}
      {...props}
      playWord={p.playWord}
      restarted={round > 0}
      onRestart={restart}
    />
  );
}

function TapWordRound({
  id,
  words,
  source,
  playWord,
  restarted,
  onRestart,
}: Props & { playWord: (index: number) => void; restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const order = useMemo(() => {
    const timed = new Set(source.segments.map(([w]) => w));
    return seededShuffle(
      words.filter((w) => timed.has(w.index)).map((w) => w.index),
      id,
    );
  }, [words, id, source]);
  const q = useChoiceQuiz(id, order);
  const focusRef = useStepFocus(q.i);

  if (order.length < 2) return null;
  const target = order[Math.min(q.i, order.length - 1)];
  const targetWord = words.find((w) => w.index === target);

  return (
    <ExerciseShell
      title={t("tap_title")}
      instruction={t("tap_instruction")}
      done={q.finished || q.doneBefore}
      doneLabel={t("done")}
      autoFocus={restarted}
    >
      {q.finished ? (
        <div ref={focusRef} tabIndex={-1}>
          <Finished right={q.firstTry} total={q.total} onRestart={onRestart} />
        </div>
      ) : (
        <>
          <div ref={focusRef} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3">
            <Counter n={q.i + 1} total={q.total} />
            {/* The question's first action is the primary button; once the
                question is settled "Lanjut" takes that role. */}
            <button
              type="button"
              onClick={() => playWord(target)}
              className={q.resolved === null ? "btn-primary" : "btn-secondary"}
            >
              <Volume2 className="h-5 w-5" aria-hidden />
              {q.resolved === null ? t("tap_play") : t("tap_replay")}
            </button>
          </div>

          {/* Words in mushaf order (RTL), as chips: paper-deep fill and a
              ≥3:1 border so they read as buttons, not plain text. */}
          <div dir="rtl" className="mt-5 flex flex-wrap justify-center gap-3">
            {words.map((w) => {
              const state = optionState(w.index, q.answer, q.tried, q.resolved);
              return (
                <button
                  key={w.index}
                  type="button"
                  onClick={() => q.choose(w.index)}
                  className={clsx(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border-2 px-4 py-1 transition-colors",
                    state === "right" && "border-forest bg-forest text-paper",
                    state === "wrong" && "border-case-nasb bg-paper-deep text-ink",
                    state === "idle" && "border-border-ui bg-paper-deep text-ink hover:border-forest",
                  )}
                >
                  <span lang="ar" className="quran text-ar-md">
                    {w.ar}
                  </span>
                  {state === "right" && <OptionMark state="right" label={t("tap_target")} inverse />}
                  {state === "wrong" && <OptionMark state="wrong" />}
                </button>
              );
            })}
          </div>

          <Feedback
            kind={q.resolved === "right" ? "ok" : q.resolved === "revealed" ? "reveal" : q.tried.length ? "retry" : null}
            title={q.resolved === "right" ? t("right") : q.resolved === "revealed" ? t("revealed") : t("tap_not_yet")}
            nonce={`${q.i}/${q.tried.length}/${q.resolved ?? ""}`}
          >
            {q.resolved !== null && targetWord && (
              <>
                <bdi lang="ar" dir="rtl" className="quran text-ar-sm">
                  {targetWord.ar}
                </bdi>{" "}
                ({targetWord.translit} — {targetWord.gloss})
              </>
            )}
          </Feedback>

          <QuizActions
            resolved={q.resolved}
            canReveal={q.canReveal}
            last={q.i + 1 >= q.total}
            onReveal={q.reveal}
            onNext={q.next}
          />
        </>
      )}
    </ExerciseShell>
  );
}
