"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { QuizExerciseOf } from "@/content/quiz-schema";
import type { Word } from "@/content/schema";
import { seededShuffle } from "@/lib/shuffle";

import { CaseBadge } from "../lesson/CaseBadge";
import { MixedText } from "../library/MixedText";
import {
  Counter,
  ExerciseShell,
  Feedback,
  Finished,
  OptionButton,
  QuizActions,
  optionState,
  useChoiceQuiz,
  useGuide,
  useRestart,
  useStepFocus,
} from "./ExerciseShell";
import { choiceGuidePart, guideMarker, guideTarget, type ExerciseGuide } from "./guide";

type Props = {
  id: string;
  /** The ayah's words (the question shows its word as the mushaf writes it). */
  words: Word[];
  /** The questions (content/quiz): each word's reason and the wrong ones, answer first. */
  questions: QuizExerciseOf<"why-harakat">["questions"];
  /** Each case state as its label, "majrur (مَجْرُور)" (content/quiz `states`). */
  states: Record<string, string>;
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Kenapa harakat ini?" — choose the reason a word ends the way it does. Options are EXPLANATION
 * sentences: the word's reason and the reasons of other words, all from the ayat studied so far
 * and each of another cause (content/quiz, pipeline/quiz.py: operator 2026-10-10, test only what
 * was taught); every grammar term in them shows its Arabic. The Qur'anic word is always shown as
 * it is in the mushaf, never altered (plan §4.7).
 */
export function WhyHarakat(props: Props) {
  const { round, restart } = useRestart();
  return <WhyHarakatRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function WhyHarakatRound({
  id,
  words,
  questions,
  states,
  guided,
  compact,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      questions.flatMap((q) => {
        const word = words[q.word - 1];
        if (!word) return [];
        const text = new Map(q.options.map((o) => [o.from, o.text]));
        return [{ q, word, text, options: seededShuffle(q.options.map((o) => o.from), `${word.loc}/o`) }];
      }),
    [words, questions],
  );
  const q = useChoiceQuiz(
    id,
    items.map((it) => it.word.loc),
    guided,
    items.map((it) => it.q.n),
  );
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = items.length === 0;
  const part = empty
    ? null
    : choiceGuidePart({ finished: q.finished, settled: q.resolved !== null, canReveal: q.canReveal });
  useGuide(guided, part && guideTarget("why-harakat", part), empty);
  const mark = guideMarker(guided, "why-harakat");

  if (empty) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const w = item.word;

  return (
    <ExerciseShell
      title={t("why_title")}
      instruction={t("why_instruction")}
      done={q.finished || q.doneBefore}
      doneLabel={t("done")}
      autoFocus={restarted}
      compact={compact}
    >
      {q.finished ? (
        <div ref={focusRef} tabIndex={-1}>
          <Finished right={q.firstTry} total={q.total} onRestart={guided ? undefined : onRestart} />
        </div>
      ) : (
        <div>
          <div ref={focusRef} tabIndex={-1}>
            <Counter n={q.i + 1} total={q.total} />
            <p className="mt-1 text-lg font-semibold text-ink">{t("why_question")}</p>
            <div className="mt-3 flex flex-col items-center gap-1 rounded-xl bg-paper-deep px-4 py-3 text-center">
              <span lang="ar" dir="rtl" className="quran text-ar-md text-ink">
                {w.ar}
              </span>
              <span className="text-sm text-ink-muted">
                <MixedText text={`${w.translit} · ${w.gloss}`} />
              </span>
              {item.q.sign && (
                <span className="text-sm text-ink-muted">
                  <MixedText text={t("why_sign", { sign: item.q.sign })} />
                </span>
              )}
            </div>
          </div>

          <ul data-guide={mark("options")} className="mt-4 grid grid-cols-1 gap-3">
            {item.options.map((opt) => (
              <li key={opt}>
                <OptionButton
                  state={optionState(opt, q.answer, q.tried, q.resolved)}
                  onClick={() => q.choose(opt)}
                  optionKey={opt}
                >
                  <span>
                    <MixedText text={item.text.get(opt) ?? ""} />
                  </span>
                </OptionButton>
              </li>
            ))}
          </ul>

          <Feedback
            kind={q.resolved === "right" ? "ok" : q.resolved === "revealed" ? "reveal" : q.tried.length ? "retry" : null}
            title={q.resolved === "right" ? t("right") : q.resolved === "revealed" ? t("revealed") : t("not_yet")}
            nonce={`${q.i}/${q.tried.length}/${q.resolved ?? ""}`}
          >
            {q.resolved !== null && (
              <>
                <CaseBadge state={w.case.state} sign={item.q.sign ?? undefined} label={states[w.case.state]} />{" "}
                <MixedText text={item.q.why} />
              </>
            )}
          </Feedback>

          <QuizActions
            resolved={q.resolved}
            canReveal={q.canReveal}
            last={q.i + 1 >= q.total}
            onReveal={q.reveal}
            onNext={q.next}
            revealGuide={mark("reveal")}
            nextGuide={mark("next")}
          />
        </div>
      )}
    </ExerciseShell>
  );
}
