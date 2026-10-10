"use client";

import clsx from "clsx";
import { Check, Lightbulb } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { CaseState, Word } from "@/content/schema";
import { useProgress } from "@/hooks/useProgress";
import { CASE_META, SORT_BINS } from "@/lib/cases";
import { seededShuffle } from "@/lib/shuffle";

import { CaseBadge, CaseShape } from "../lesson/CaseBadge";
import {
  ExerciseShell,
  Feedback,
  Finished,
  OptionMark,
  useGuide,
  useRestart,
  useStepFocus,
  type FeedbackKind,
} from "./ExerciseShell";
import { guideMarker, guideTarget, sortCaseGuidePart, type ExerciseGuide } from "./guide";

type Props = {
  id: string;
  words: Word[];
  /** Guided mode (see ExerciseShell.tsx). */
  guided?: ExerciseGuide;
  /** Hide the heading and instruction (the stage shows its own). */
  compact?: boolean;
};

/**
 * "Kelompokkan menurut akhiran" — sort the ayah's words into raf' / nasb /
 * jarr / mabni groups. Tap a word, then tap its group (no drag-and-drop:
 * works with a thumb and a keyboard); the two steps are spelled out on
 * screen. Words are the mushaf words, unaltered; nothing explodes or is
 * thrown away (plan §4.7).
 */
export function SortCase(props: Props) {
  const { round, restart } = useRestart();
  return <SortCaseRound key={round} {...props} restarted={round > 0} onRestart={restart} />;
}

type Say = { kind: FeedbackKind; word?: Word; n: number };

function SortCaseRound({
  id,
  words,
  guided,
  compact,
  restarted,
  onRestart,
}: Props & { restarted: boolean; onRestart: () => void }) {
  const t = useTranslations("Exercise");
  const { progress, markDone } = useProgress();
  const items = useMemo(
    () => seededShuffle(words.filter((w) => SORT_BINS.includes(w.case.state)), id),
    [words, id],
  );
  const [placed, setPlaced] = useState<Record<string, CaseState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  /** Groups already tried, wrongly, for the selected word. */
  const [wrongBins, setWrongBins] = useState<CaseState[]>([]);
  /** Wrong drops per word; two unlock "Tunjukkan jawaban". */
  const [misses, setMisses] = useState<Record<string, number>>({});
  const [firstTry, setFirstTry] = useState(0);
  const [say, setSay] = useState<Say | null>(null);

  const remaining = items.filter((w) => !placed[w.loc]);
  const finished = items.length > 0 && remaining.length === 0;
  const focusRef = useStepFocus(finished ? 1 : 0, !!guided);
  /** The words still to sort: focus lands here after "Tunjukkan jawaban",
   *  whose button disappears once the word is placed. */
  const wordsRef = useRef<HTMLDivElement>(null);
  const selectedWord = items.find((w) => w.loc === selected) ?? null;
  const canReveal = selectedWord !== null && (misses[selectedWord.loc] ?? 0) >= 2;
  const empty = items.length < 2;
  const part = empty ? null : sortCaseGuidePart({ finished, selected: selectedWord !== null, canReveal });
  useGuide(guided, part && guideTarget("sort-case", part), empty);
  const mark = guideMarker(guided, "sort-case");

  if (empty) return null;
  const tell = (kind: FeedbackKind, word?: Word) => setSay({ kind, word, n: (say?.n ?? 0) + 1 });

  const place = (word: Word, counts: boolean) => {
    const next = { ...placed, [word.loc]: word.case.state };
    const right = firstTry + (counts ? 1 : 0);
    setPlaced(next);
    setFirstTry(right);
    setSelected(null);
    setWrongBins([]);
    if (Object.keys(next).length === items.length) {
      markDone(id, right / items.length);
      guided?.onDone?.();
    }
  };

  const pick = (loc: string) => {
    if (loc === selected) return;
    setSelected(loc);
    setWrongBins([]);
    // A new word: drop the "try again"/"pick first" notes, but keep the rule
    // just learned on screen until the next drop.
    if (say?.kind === "retry" || say?.kind === "hint") setSay(null);
  };

  const drop = (bin: CaseState) => {
    if (finished) return;
    if (!selectedWord) {
      tell("hint");
      return;
    }
    if (selectedWord.case.state === bin) {
      // The answer is reported before place(), which reports onDone with
      // the last word.
      guided?.onAnswer?.(true);
      place(selectedWord, !misses[selectedWord.loc]);
      tell("ok", selectedWord);
    } else {
      setMisses({ ...misses, [selectedWord.loc]: (misses[selectedWord.loc] ?? 0) + 1 });
      if (!wrongBins.includes(bin)) setWrongBins([...wrongBins, bin]);
      tell("retry", selectedWord);
      guided?.onAnswer?.(false);
    }
  };

  const reveal = () => {
    if (!selectedWord) return;
    const last = remaining.length === 1;
    place(selectedWord, false);
    tell("reveal", selectedWord);
    // The pressed button unmounts with the placed word; keep keyboard focus
    // on the next step (picking a word). After the last word, useStepFocus
    // moves focus to the result instead. Inside the lesson stage the page
    // never scrolls by itself.
    if (!last) wordsRef.current?.focus({ preventScroll: !!guided });
  };

  const step = selectedWord ? 2 : 1;

  const title =
    say?.kind === "ok"
      ? t("right")
      : say?.kind === "reveal"
        ? t("revealed")
        : say?.kind === "retry"
          ? t("sort_not_yet")
          : t("sort_pick_first");

  return (
    <ExerciseShell
      title={t("sort_title")}
      instruction={t("sort_instruction")}
      done={finished || Boolean(progress[id])}
      doneLabel={t("done")}
      autoFocus={restarted}
      compact={compact}
    >
      {!finished && (
        <>
          {/* The two-step mode, visible; the current step is bold with a
              forest border (and aria-current), not colour alone. */}
          <ol aria-label={t("sort_steps_label")} className="flex flex-wrap items-center gap-2">
            <li
              aria-current={step === 1 ? "step" : undefined}
              className={clsx(
                "rounded-full px-3 py-1 text-base",
                step === 1 ? "border-2 border-forest bg-forest-tint font-semibold text-ink" : "border-2 border-transparent text-ink-muted",
              )}
            >
              {t("sort_step_word")}
            </li>
            <li aria-hidden className="text-base text-ink-muted">
              →
            </li>
            <li
              aria-current={step === 2 ? "step" : undefined}
              className={clsx(
                "rounded-full px-3 py-1 text-base",
                step === 2 ? "border-2 border-forest bg-forest-tint font-semibold text-ink" : "border-2 border-transparent text-ink-muted",
              )}
            >
              {t("sort_step_bin")}
            </li>
          </ol>

          {/* The words still to sort, in a shuffled order (RTL flow). A
              labelled group, so a screen reader announces step 1 when focus
              is moved here. */}
          <div
            ref={wordsRef}
            tabIndex={-1}
            role="group"
            aria-label={t("sort_step_word")}
            data-guide={mark("words")}
            dir="rtl"
            className="mt-4 flex min-h-14 flex-wrap justify-center gap-3 rounded-xl"
          >
            {remaining.map((w) => {
              const isSel = selected === w.loc;
              return (
                <button
                  key={w.loc}
                  type="button"
                  onClick={() => pick(w.loc)}
                  aria-pressed={isSel}
                  className={clsx(
                    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-4 py-1 text-ink transition-colors",
                    // 3px when selected; 2px + 1px margin at rest, so the
                    // row never shifts when the selection moves.
                    isSel
                      ? "border-[3px] border-forest bg-forest-tint"
                      : "m-px border-2 border-border-ui bg-paper-deep hover:border-forest",
                  )}
                >
                  <span lang="ar" className="quran text-ar-md">
                    {w.ar}
                  </span>
                  {isSel && (
                    <span dir="ltr" className="inline-flex items-center gap-1.5 text-sm font-semibold text-forest">
                      <Check className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
                      {t("sort_selected")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* The groups: always enabled (a tap with no word chosen explains the
          first step), a 2px case-colour border, the shape icon and an ink
          label. Container query: four across only while there is room. */}
      <div className={clsx("@container", !finished && "mt-5")}>
        <div data-guide={mark("bins")} className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
          {SORT_BINS.map((bin) => {
            const m = CASE_META[bin];
            const inBin = items.filter((w) => placed[w.loc] === bin);
            return (
              <button
                key={bin}
                type="button"
                onClick={() => drop(bin)}
                className={clsx(
                  "flex min-h-24 flex-col items-center gap-2 rounded-xl border-2 p-3 text-ink",
                  m.className,
                )}
              >
                <span className="inline-flex items-center gap-2 text-base font-semibold text-ink">
                  <CaseShape state={bin} />
                  {m.label}
                </span>
                {inBin.length > 0 ? (
                  <span dir="rtl" className="flex flex-wrap justify-center gap-x-3">
                    {inBin.map((w) => (
                      <span key={w.loc} lang="ar" className="quran text-ar-sm">
                        {w.ar}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-sm text-ink-soft">{t("sort_bin_empty")}</span>
                )}
                {wrongBins.includes(bin) && <OptionMark state="wrong" />}
              </button>
            );
          })}
        </div>
      </div>

      <Feedback kind={say?.kind ?? null} title={title} nonce={say?.n}>
        {(say?.kind === "ok" || say?.kind === "reveal") && say.word && (
          <>
            <bdi lang="ar" dir="rtl" className="quran text-ar-sm">
              {say.word.ar}
            </bdi>{" "}
            <CaseBadge state={say.word.case.state} sign={say.word.case.sign} /> {say.word.why}
          </>
        )}
      </Feedback>

      {canReveal && !finished && (
        <div className="mt-4">
          <button type="button" onClick={reveal} data-guide={mark("reveal")} className="btn-secondary">
            <Lightbulb className="h-5 w-5" aria-hidden />
            {t("reveal")}
          </button>
        </div>
      )}

      {finished && (
        <div ref={focusRef} tabIndex={-1} className="mt-4">
          <Finished right={firstTry} total={items.length} onRestart={guided ? undefined : onRestart} />
        </div>
      )}
    </ExerciseShell>
  );
}
