"use client";

import clsx from "clsx";
import { Volume2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useImamRate } from "@/hooks/usePace";
import { useSegmentPlayer, type RecitationSource } from "@/hooks/useSegmentPlayer";
import { seededShuffle } from "@/lib/shuffle";

import { KeepTogether, MixedText } from "../library/MixedText";

import {
  Counter,
  ExerciseShell,
  Feedback,
  Finished,
  OptionMark,
  QuizActions,
  optionState,
  useChoiceQuiz,
  useGuide,
  useRestart,
  useStepFocus,
} from "./ExerciseShell";
import { guideMarker, guideTarget, tapWordGuidePart, type ExerciseGuide } from "./guide";

/** Same shape as the lesson player's words (structurally typed). */
type TapWordItem = { index: number; ar: string; translit: string; gloss: string };
type Props = {
  id: string;
  /** Every word of the ayah, shown as the chips (mushaf order). */
  words: TapWordItem[];
  /** The words asked about (content/quiz: `n`, the question's number, and `word`, 1-based). */
  questions: readonly { n: number; word: number }[];
  source: RecitationSource;
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Dengar dan klik" — the imam says one word (seeked inside the streamed
 * ayah recording); the learner taps it. Trains listening-to-text mapping.
 * The mushaf words are shown unaltered, as chips that look tappable; no
 * sound effects. The player lives outside the round so "Ulangi latihan"
 * does not recreate the audio element. It plays at the learner's remembered
 * imam speed, and starting it pauses any other recording on the page (the
 * lesson stage stops its guided lesson), so recordings never overlap.
 *
 * Guided (the autoplay lesson): each question reports its word with "play",
 * and the LESSON's imam recites it on the stage's player (the one the
 * "Mulai" tap unlocked) — no tap; `guided.heard` says when it has played.
 * "Dengarkan lagi" stays as an optional replay.
 *
 * A word written twice in one ayah (عَلَيْهِمْ, Al-Fatihah 7: words 4 and 7) sounds the same: a
 * click on either is right, and both chips show it (quiz audit 2026-10-11).
 */
export function TapWord(props: Props) {
  const { round, restart } = useRestart();
  const [imamRate] = useImamRate();
  /** The word "Dengarkan kata" last asked for (written in the click handler). */
  const askedRef = useRef<number | null>(null);
  /** The last word that played to its end. Guided mode moves the spotlight
   *  from "Dengarkan kata" to the words only then, so a voiced prompt never
   *  starts over the imam. */
  const [heard, setHeard] = useState<number | null>(null);
  const p = useSegmentPlayer([props.source], {
    rate: imamRate,
    onFinish: () => setHeard(askedRef.current),
  });
  const { playWord } = p;
  const play = useCallback(
    (index: number) => {
      askedRef.current = index;
      playWord(index);
    },
    [playWord],
  );
  const again = useCallback(() => {
    askedRef.current = null;
    setHeard(null);
    restart();
  }, [restart]);
  return (
    <TapWordRound
      key={round}
      {...props}
      playWord={play}
      heard={heard}
      restarted={round > 0}
      onRestart={again}
    />
  );
}

function TapWordRound({
  id,
  words,
  questions,
  source,
  guided,
  compact,
  playWord,
  heard,
  restarted,
  onRestart,
}: Props & {
  playWord: (index: number) => void;
  heard: number | null;
  restarted: boolean;
  onRestart: () => void;
}) {
  const t = useTranslations("Exercise");
  const order = useMemo(() => {
    const timed = new Set(source.segments.map(([w]) => w));
    return seededShuffle(
      questions.map((x) => x.word).filter((w) => timed.has(w) && words.some((x) => x.index === w)),
      id,
    );
  }, [words, questions, id, source]);
  const numbers = useMemo(() => order.map((w) => questions.find((x) => x.word === w)?.n ?? 0), [order, questions]);
  const q = useChoiceQuiz(id, order, guided, numbers);
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = order.length < 2;
  const target = order[Math.min(q.i, order.length - 1)];
  // Heard: by the lesson's imam (guided), or by the learner's own replay.
  const heardNow = heard === target || guided?.heard === target;
  const part = empty
    ? null
    : tapWordGuidePart({
        finished: q.finished,
        settled: q.resolved !== null,
        canReveal: q.canReveal,
        heard: heardNow,
      });
  useGuide(guided, part && guideTarget("tap-word", part), empty, part === "play" ? target : undefined);
  const mark = guideMarker(guided, "tap-word");

  if (empty) return null;
  const targetWord = words.find((w) => w.index === target);
  /** The chip stands for the asked word: it is that word, or its twin (the same Arabic). */
  const asTarget = (w: TapWordItem) => (targetWord && w.ar === targetWord.ar ? target : w.index);

  return (
    <ExerciseShell
      title={t("tap_title")}
      instruction={t("tap_instruction")}
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
        <>
          <div ref={focusRef} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3">
            <Counter n={q.i + 1} total={q.total} />
            {/* The question's first action is the primary button; once the
                question is settled "Lanjut" takes that role. Guided, the
                lesson plays the word itself: this is an optional replay. */}
            <button
              type="button"
              onClick={() => playWord(target)}
              data-guide={mark("play")}
              className={q.resolved === null && !guided ? "btn-primary" : "btn-secondary"}
            >
              <Volume2 className="h-5 w-5" aria-hidden />
              {q.resolved === null && !heardNow ? t("tap_play") : t("tap_replay")}
            </button>
          </div>

          {/* Words in mushaf order (RTL), as chips: paper-deep fill and a
              ≥3:1 border so they read as buttons, not plain text. */}
          <div dir="rtl" data-guide={mark("options")} className="mt-5 flex flex-wrap justify-center gap-3">
            {words.map((w) => {
              const state = optionState(asTarget(w), q.answer, q.tried, q.resolved);
              return (
                <button
                  key={w.index}
                  type="button"
                  onClick={() => q.choose(asTarget(w))}
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
                {/* The word, its transliteration and the dash on one line; the
                    gloss wraps after them (line breaks, 2026-10-10). */}
                <KeepTogether>
                  <bdi lang="ar" dir="rtl" className="quran text-ar-sm">
                    {targetWord.ar}
                  </bdi>{" "}
                  ({targetWord.translit} —
                </KeepTogether>{" "}
                <MixedText text={`${targetWord.gloss})`} />
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
        </>
      )}
    </ExerciseShell>
  );
}
