"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { QuizExerciseOf } from "@/content/quiz-schema";
import type { Lexeme } from "@/content/schema";
import { seededShuffle } from "@/lib/shuffle";

import { KeepTogether, MixedText } from "../library/MixedText";
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
  /** The lexemes of the ayah's words (their tashrif tables give the forms). */
  lexemes: Lexeme[];
  /** The questions (content/quiz): a lexeme, the form asked for, the form labels offered. */
  questions: QuizExerciseOf<"wazn-factory">["questions"];
  /** Each form label with its Arabic, "fi'il mudhari' (فِعْل مُضَارِع)" (content/quiz `labels`). */
  labels: Record<string, string>;
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Bentuk-bentuk kata (wazan)" — pick the right form for each tashrif label
 * (fi'il mudhari', isim fa'il, …). Only the labels the lesson has taught are
 * asked or offered (content/quiz; operator 2026-10-10: "there is also quiz
 * about bentuk kata (wazan), i did not see lesson about this before"), and
 * the "Akar kata" / "Pola (bab)" lines are gone: the lesson never teaches
 * them as such (decision 5, 2026-10-11). The forms are Arabic word forms from
 * the Kosakata library, NOT ayat: shown in a plain Arabic face
 * (.arabic-inline, never the mushaf .quran style) and labelled as such (plan
 * §4.7).
 */
export function WaznFactory(props: Props) {
  const { round, restart } = useRestart();
  return <WaznFactoryRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function WaznFactoryRound({
  id,
  lexemes,
  questions,
  labels,
  guided,
  compact,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      questions.flatMap((qq) => {
        const lx = lexemes.find((l) => l.id === qq.lexeme);
        const forms = new Map((lx?.tashrif?.forms ?? []).map((f) => [f.label, f.ar]));
        const answer = forms.get(qq.label);
        if (!lx || !answer) return [];
        const options = qq.options.flatMap((label) => {
          const ar = forms.get(label);
          return ar ? [ar] : [];
        });
        return [{ q: qq, lex: lx, label: qq.label, answer, options: seededShuffle(options, `${lx.id}/${qq.label}/o`) }];
      }),
    [lexemes, questions],
  );
  const q = useChoiceQuiz(
    id,
    items.map((it) => it.answer),
    guided,
    items.map((it) => it.q.n),
  );
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = items.length === 0;
  const part = empty
    ? null
    : choiceGuidePart({ finished: q.finished, settled: q.resolved !== null, canReveal: q.canReveal });
  useGuide(guided, part && guideTarget("wazn-factory", part), empty);
  const mark = guideMarker(guided, "wazn-factory");

  if (empty) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const shown = labels[item.label] ?? item.label;

  return (
    <ExerciseShell
      title={t("wazn_title")}
      instruction={t("wazn_instruction")}
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
            <p className="mt-3 text-lg text-ink">
              {/* The label with its Arabic ("fi'il mudhari' (فِعْل مُضَارِع)"), kept together. */}
              {t.rich("wazn_question", {
                label: item.label,
                b: () => (
                  <strong className="font-semibold">
                    <MixedText text={shown} />
                  </strong>
                ),
              })}
            </p>
          </div>

          {/* Container query: three columns only while there is room at the
              learner's chosen text size; full width on phones. */}
          <div className="@container mt-4">
            <ul data-guide={mark("options")} className="grid gap-3 @md:grid-cols-3">
              {item.options.map((opt) => (
                <li key={opt}>
                  <OptionButton
                    arabic
                    state={optionState(opt, q.answer, q.tried, q.resolved)}
                    onClick={() => q.choose(opt)}
                    optionKey={item.q.options.find((l) => item.lex.tashrif?.forms.find((f) => f.label === l)?.ar === opt)}
                  >
                    <span lang="ar" dir="rtl" className="arabic-inline text-ar-md">
                      {opt}
                    </span>
                  </OptionButton>
                </li>
              ))}
            </ul>
          </div>

          <Feedback
            kind={q.resolved === "right" ? "ok" : q.resolved === "revealed" ? "reveal" : q.tried.length ? "retry" : null}
            title={q.resolved === "right" ? t("right") : q.resolved === "revealed" ? t("revealed") : t("not_yet")}
            nonce={`${q.i}/${q.tried.length}/${q.resolved ?? ""}`}
          >
            {q.resolved !== null && (
              // The label and its form on one line: never "label:" ⏎ form.
              <KeepTogether>
                <MixedText text={`${shown}:`} />{" "}
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
                  {item.answer}
                </bdi>
              </KeepTogether>
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

          <p className="mt-4 max-w-prose text-sm text-ink-soft">
            <MixedText text={t("wazn_note")} />
          </p>
        </div>
      )}
    </ExerciseShell>
  );
}
