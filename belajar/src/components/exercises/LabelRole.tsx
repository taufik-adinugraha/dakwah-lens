"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { Word } from "@/content/schema";
import { seededShuffle } from "@/lib/shuffle";

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
  words: Word[];
  pool: Word[];
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Tebak peran kata" — choose each word's role in the ayah (tarkib). Options
 * are role labels from the same ayah and the rest of the surah; the
 * explanation after each answer is the word's own "why".
 */
export function LabelRole(props: Props) {
  const { round, restart } = useRestart();
  return <LabelRoleRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function LabelRoleRound({
  id,
  words,
  pool,
  guided,
  compact,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      words
        .filter((w): w is Word & { role: string } => !!w.role)
        .map((w) => {
          const others = [...new Set(pool.map((p) => p.role).filter((r): r is string => !!r && r !== w.role))];
          const options = seededShuffle([w.role, ...seededShuffle(others, w.loc).slice(0, 3)], `${w.loc}/r`);
          return { word: w, options };
        }),
    [words, pool],
  );
  const q = useChoiceQuiz(id, items.map((it) => it.word.role), guided);
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = items.length < 2;
  const part = empty
    ? null
    : choiceGuidePart({ finished: q.finished, settled: q.resolved !== null, canReveal: q.canReveal });
  useGuide(guided, part && guideTarget("label-role", part), empty);
  const mark = guideMarker(guided, "label-role");

  if (empty) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const w = item.word;

  return (
    <ExerciseShell
      title={t("role_title")}
      instruction={t("role_instruction")}
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
            <p className="mt-1 text-lg font-semibold text-ink">{t("role_question")}</p>
            <div className="mt-3 flex flex-col items-center gap-1 rounded-xl bg-paper-deep px-4 py-3 text-center">
              <span lang="ar" dir="rtl" className="quran text-ar-md text-ink">
                {w.ar}
              </span>
              <span className="text-sm text-ink-muted">
                {w.translit} · {w.gloss}
              </span>
            </div>
          </div>

          {/* Container query: two columns only while there is room at the
              learner's chosen text size. */}
          <div className="@container mt-4">
            <ul data-guide={mark("options")} className="grid gap-3 @xl:grid-cols-2">
              {item.options.map((opt) => (
                <li key={opt}>
                  <OptionButton
                    state={optionState(opt, q.answer, q.tried, q.resolved)}
                    onClick={() => q.choose(opt)}
                  >
                    <span>{opt}</span>
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
              <>
                <strong className="font-semibold">{w.role}</strong>. {w.why}
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
