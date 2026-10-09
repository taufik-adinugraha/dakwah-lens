"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { Word } from "@/content/schema";
import { seededShuffle } from "@/lib/shuffle";

import { CaseBadge } from "../lesson/CaseBadge";
import {
  Counter,
  ExerciseShell,
  Feedback,
  Finished,
  OptionButton,
  QuizActions,
  optionState,
  useChoiceQuiz,
  useRestart,
  useStepFocus,
} from "./ExerciseShell";

const GRADED = new Set(["marfu", "manshub", "majrur", "mabni"]);

type Props = { id: string; words: Word[]; pool: Word[] };

/**
 * "Kenapa harakat ini?" — choose the reason a word ends the way it does.
 * Options are EXPLANATION sentences (the correct word's reason + reasons of
 * words in a different case); the Qur'anic word is always shown as it is in
 * the mushaf, never altered (plan §4.7).
 */
export function WhyHarakat(props: Props) {
  const { round, restart } = useRestart();
  return <WhyHarakatRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function WhyHarakatRound({
  id,
  words,
  pool,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      words
        .filter((w) => GRADED.has(w.case.state))
        .map((w) => {
          const distractors = seededShuffle(
            [
              ...new Set(
                pool.filter((p) => p.case.state !== w.case.state && p.why !== w.why).map((p) => p.why),
              ),
            ],
            w.loc,
          ).slice(0, 2);
          return { word: w, options: seededShuffle([w.why, ...distractors], `${w.loc}/o`) };
        }),
    [words, pool],
  );
  const q = useChoiceQuiz(id, items.map((it) => it.word.why));
  const focusRef = useStepFocus(q.i);

  if (items.length === 0) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const w = item.word;

  return (
    <ExerciseShell
      title={t("why_title")}
      instruction={t("why_instruction")}
      done={q.finished || q.doneBefore}
      doneLabel={t("done")}
      autoFocus={restarted}
    >
      {q.finished ? (
        <div ref={focusRef} tabIndex={-1}>
          <Finished right={q.firstTry} total={q.total} onRestart={onRestart} />
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
                {w.translit} · {w.gloss}
              </span>
              {w.case.sign !== "—" && (
                <span className="text-sm text-ink-muted">{t("why_sign", { sign: w.case.sign })}</span>
              )}
            </div>
          </div>

          <ul className="mt-4 grid gap-3">
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

          <Feedback
            kind={q.resolved === "right" ? "ok" : q.resolved === "revealed" ? "reveal" : q.tried.length ? "retry" : null}
            title={q.resolved === "right" ? t("right") : q.resolved === "revealed" ? t("revealed") : t("not_yet")}
            nonce={`${q.i}/${q.tried.length}/${q.resolved ?? ""}`}
          >
            {q.resolved !== null && (
              <>
                <CaseBadge state={w.case.state} sign={w.case.sign} /> {w.why}
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
        </div>
      )}
    </ExerciseShell>
  );
}
