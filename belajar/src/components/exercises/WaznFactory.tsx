"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

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
  lexemes: Lexeme[];
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Bentuk-bentuk kata (wazan)" — from a lemma's root and bab, pick the right
 * form for each tashrif label (fi'il madhi, mudhari', mashdar, …). The forms
 * are Arabic word forms from the Kosakata library, NOT ayat: shown in a plain
 * Arabic face (.arabic-inline, never the mushaf .quran style) and labelled
 * as such (plan §4.7).
 */
export function WaznFactory(props: Props) {
  const { round, restart } = useRestart();
  return <WaznFactoryRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function WaznFactoryRound({
  id,
  lexemes,
  guided,
  compact,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      lexemes.flatMap((lx) => {
        const forms = lx.tashrif?.forms ?? [];
        if (forms.length < 3) return [];
        return forms.map((f) => ({
          lex: lx,
          label: f.label,
          answer: f.ar,
          options: seededShuffle(
            [
              f.ar,
              ...seededShuffle(
                [...new Set(forms.filter((o) => o.ar !== f.ar).map((o) => o.ar))],
                `${lx.id}/${f.label}`,
              ).slice(0, 2),
            ],
            `${lx.id}/${f.label}/o`,
          ),
        }));
      }),
    [lexemes],
  );
  const q = useChoiceQuiz(id, items.map((it) => it.answer), guided);
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = items.length < 2;
  const part = empty
    ? null
    : choiceGuidePart({ finished: q.finished, settled: q.resolved !== null, canReveal: q.canReveal });
  useGuide(guided, part && guideTarget("wazn-factory", part), empty);
  const mark = guideMarker(guided, "wazn-factory");

  if (empty) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const root = item.lex.root ?? [];

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
            {root.length > 0 && (
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-base text-ink">
                {t("wazn_root")}
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
                  {root.join(" ")}
                </bdi>
              </p>
            )}
            {item.lex.tashrif?.bab && (
              <p className="mt-1 max-w-prose text-sm text-ink-muted">
                {t("wazn_bab")} <MixedText text={item.lex.tashrif.bab} />
              </p>
            )}
            <p className="mt-3 text-lg text-ink">
              {t.rich("wazn_question", {
                label: item.label,
                b: (chunks) => <strong className="font-semibold">{chunks}</strong>,
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
                {item.label}:{" "}
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
