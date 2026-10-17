"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { useTranslations } from "next-intl";

import type { QuizExerciseOf } from "@/content/quiz-schema";
import type { Word } from "@/content/schema";
import { glossSlot } from "@/lib/emphasis";

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
  /** The ayah's words (a question shows its word's transliteration and meaning). */
  words: Word[];
  /** The questions (content/quiz): every part of every word, in order, with its kind. */
  questions: QuizExerciseOf<"word-kind">["questions"];
  /** The three answers as the buttons show them, "isim (اِسْم)" (content/quiz `kinds`), in the
   *  order the lessons name them. */
  kinds: Record<string, string>;
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * THE WARM-UP — "isim, fi'il, atau huruf?" (operator 2026-10-13: "i think it's better in every
 * ayat we identify first each words fall into which category: ismu, fi'il or harf. it's kind of
 * exercise, kind of warming up"; he approved: the learner guesses first, and the answer gives the
 * visible sign). It opens an ayah's lesson, before its first word, and asks each PART of each
 * word in order: a word of two parts ("dengan" + "nama") is two questions.
 *
 * What a question shows: the word cut into its parts, in the ayah's own reading order (right to
 * left) — each part one whole piece cut by the pipeline (the lesson content's bytes: the word,
 * or its QAC segments), in its own isolated run, never a coloured stretch of a word (joining
 * across styled spans breaks the letters' shapes; WordComposition.tsx). The part asked is the
 * one in the thick frame, and the question names it by its number too ("Bagian 1 kata ini"):
 * never colour alone. Under the pieces, the word's place, its transliteration and its meaning,
 * as the other exercises show a word. Then three buttons, each with its Arabic term as the
 * lessons show it. After the answer: ONE sentence, the one the narrator says (content/quiz
 * `why`: the kind, its plain meaning, and a visible sign only where an earlier lesson taught it).
 *
 * Every text and every answer comes from content/quiz (pipeline/quiz.py "the warm-up"): the kind
 * is derived from the part's QAC tag and must agree with the lesson's own `pos`.
 */
export function WordKind(props: Props) {
  const { round, restart } = useRestart();
  return <WordKindRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

function WordKindRound({ id, words, questions, kinds, guided, compact, restarted, onRestart }: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const items = useMemo(
    () =>
      questions.flatMap((q) => {
        const word = words[q.word - 1];
        if (!word || q.ask !== "kind") return [];
        // The word's parts, for the pieces shown beside the one asked.
        const parts = questions.filter((x) => x.ask === "kind" && x.word === q.word).map((x) => ({ part: x.part, ar: x.ar }));
        return [{ q, word, parts }];
      }),
    [words, questions],
  );
  const options = Object.keys(kinds);
  const q = useChoiceQuiz(
    id,
    items.map((it) => it.q.kind as string),
    guided,
    items.map((it) => it.q.n),
  );
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = items.length === 0 || options.length === 0;
  const part = empty ? null : choiceGuidePart({ finished: q.finished, settled: q.resolved !== null, canReveal: q.canReveal });
  useGuide(guided, part && guideTarget("word-kind", part), empty);
  const mark = guideMarker(guided, "word-kind");

  if (empty) return null;
  const item = items[Math.min(q.i, items.length - 1)];
  const w = item.word;
  const compound = item.q.of > 1;

  return (
    <ExerciseShell
      title={t("kind_title")}
      instruction={t("kind_instruction")}
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
            <p className="mt-1 text-lg font-semibold text-ink">
              <MixedText text={compound ? t("kind_question_part", { part: item.q.part }) : t("kind_question_word")} />
            </p>
            <div
              data-kind-word={item.q.word}
              data-kind-part={item.q.part}
              className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-paper-deep px-4 py-3 text-center"
            >
              {/* The word's parts in reading order, right to left; the one asked in the thick frame. */}
              <ul dir="rtl" className="flex flex-wrap items-end justify-center gap-3">
                {item.parts.map((p) => {
                  const asked = p.part === item.q.part;
                  return (
                    <li key={p.part} className="flex flex-col items-center gap-1">
                      <span
                        lang="ar"
                        dir="rtl"
                        data-kind-piece={p.part}
                        data-asked={asked ? "true" : undefined}
                        className={clsx(
                          "quran ar-clear text-ar-lg flex min-h-14 min-w-14 items-center justify-center rounded-xl px-3 whitespace-nowrap",
                          asked ? "border-[3px] border-forest bg-white text-ink" : "border-[1.5px] border-dashed border-border-ui text-ink-muted",
                        )}
                      >
                        {p.ar}
                      </span>
                      {compound && (
                        <span dir="ltr" className={clsx("text-sm whitespace-nowrap", asked ? "font-semibold text-forest" : "text-ink-muted")}>
                          {t("kind_piece", { part: p.part })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {/* The word's meaning bold in forest (operator 2026-10-11): it names the word, it
                  does not answer the question. */}
              <span className="text-sm text-ink-muted">
                <MixedText {...glossSlot((g) => `${t("kind_word", { n: item.q.word })} · ${w.translit} · ${g}`, w.gloss)} />
              </span>
            </div>
          </div>

          {/* Container query: the three answers side by side only while there is room at the
              learner's chosen text size. */}
          <div className="@container mt-4">
            <ul data-guide={mark("options")} className="grid grid-cols-1 gap-3 @md:grid-cols-3">
              {options.map((opt) => (
                <li key={opt}>
                  <OptionButton state={optionState(opt, q.answer, q.tried, q.resolved)} onClick={() => q.choose(opt)} optionKey={opt}>
                    <span>
                      <MixedText text={cap(kinds[opt])} />
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
            {q.resolved !== null && <MixedText text={item.q.why} emphasis />}
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
