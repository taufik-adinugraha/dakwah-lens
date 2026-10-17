"use client";

import clsx from "clsx";
import { Volume2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { Clip } from "@/content/schema";
import { useClipPlayer } from "@/hooks/useClipPlayer";
import { glossSlot } from "@/lib/emphasis";
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

/** Same shape as the lesson player's words (structurally typed). `voice`: the narrator's
 *  recording of the word (src/lib/wordvoice.ts), what is played; null: none (not asked). */
type TapWordItem = { index: number; ar: string; translit: string; gloss: string; voice: Clip | null };
type Props = {
  id: string;
  /** Every word of the ayah, shown as the chips (mushaf order). */
  words: TapWordItem[];
  /** The words asked about (content/quiz: `n`, the question's number, and `word`, 1-based). */
  questions: readonly { n: number; word: number }[];
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Dengar dan klik" — one word of the ayah is heard; the learner taps it.
 * Trains listening-to-text mapping. The word is the narrator Kang Nandar's
 * recording of it, an AI voice (operator 2026-10-14: "for all quran word by
 * word should be replaced by this, not using truncated voice from imam";
 * src/lib/wordvoice.ts) — never the imam's recitation cut at the word. A word
 * with no recording is not asked. The mushaf words are shown unaltered, as
 * chips that look tappable; no sound effects. The player lives outside the
 * round so "Ulangi latihan" does not recreate the audio element. Starting it
 * pauses any other recording on the page (the lesson stage stops its guided
 * lesson), so recordings never overlap.
 *
 * Guided (the autoplay lesson): each question reports its word with "play",
 * and the LESSON plays that word's recording on its own player (the one the
 * "Mulai" tap unlocked) — no tap; `guided.heard` says when it has played.
 * "Dengarkan lagi" stays as an optional replay.
 *
 * A word written twice in one ayah (عَلَيْهِمْ, Al-Fatihah 7: words 4 and 7) sounds the same: a
 * click on either is right, and both chips show it (quiz audit 2026-10-11).
 */
export function TapWord(props: Props) {
  const { round, restart } = useRestart();
  /** The word "Dengarkan kata" last asked for (written in the click handler). */
  const askedRef = useRef<number | null>(null);
  /** The last word that played to its end. Guided mode moves the spotlight
   *  from "Dengarkan kata" to the words only then, so a voiced prompt never
   *  starts over the word. */
  const [heard, setHeard] = useState<number | null>(null);
  const onEnd = useCallback((key: string) => {
    if (key === String(askedRef.current)) setHeard(askedRef.current);
  }, []);
  const p = useClipPlayer({ onEnd });
  const { play: playClip } = p;
  const { words } = props;
  const play = useCallback(
    (index: number) => {
      const clip = words.find((w) => w.index === index)?.voice;
      if (!clip) return;
      askedRef.current = index;
      playClip(String(index), clip);
    },
    [playClip, words],
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
  // Only a word with a recording can be asked (the checks refuse a lesson word without one).
  const order = useMemo(() => {
    return seededShuffle(
      questions.map((x) => x.word).filter((w) => words.some((x) => x.index === w && x.voice)),
      id,
    );
  }, [words, questions, id]);
  const numbers = useMemo(() => order.map((w) => questions.find((x) => x.word === w)?.n ?? 0), [order, questions]);
  const q = useChoiceQuiz(id, order, guided, numbers);
  const focusRef = useStepFocus(q.i, !!guided);
  const empty = order.length < 2;
  const target = order[Math.min(q.i, order.length - 1)];
  // Heard: played by the lesson (guided), or by the learner's own replay.
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
                  <span lang="ar" className="quran ar-clear text-ar-md">
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
                    gloss wraps after them (line breaks, 2026-10-10), bold in forest
                    (a meaning, operator 2026-10-11). */}
                <KeepTogether>
                  <bdi lang="ar" dir="rtl" className="quran text-ar-sm">
                    {targetWord.ar}
                  </bdi>{" "}
                  ({targetWord.translit} —
                </KeepTogether>{" "}
                <MixedText {...glossSlot((g) => `${g})`, targetWord.gloss)} />
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
