"use client";

import clsx from "clsx";
import { ArrowRight, Check, CheckCircle2, Info, Lightbulb, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useProgress } from "@/hooks/useProgress";

import { MixedText } from "../library/MixedText";

import type { ExerciseGuide, GuideInfo, GuideTarget } from "./guide";

export type { ExerciseGuide, ExerciseKey, GuideInfo, GuidePart, GuideTarget } from "./guide";

/*
 * Shared pieces of the five exercises (plan §4.7; senior-ux.md §3.7):
 * - state is NEVER shown by colour alone: an option's state is a 2px border
 *   (≥3:1) plus an icon plus words ("Jawaban benar" / "Pilihan Anda");
 * - a wrong pick does not give the answer away ("Belum tepat — coba pilih
 *   yang lain."); after two misses "Tunjukkan jawaban" marks the right option
 *   and shows the rule;
 * - the finished state offers "Ulangi latihan";
 * - no hearts, timers or sound effects, ever.
 *
 * ── Guided mode (the autoplay lesson runner) ──────────────────────────────
 *
 * Every exercise (TapWord, WhyHarakat, SortCase, LabelRole, WaznFactory)
 * takes two optional props. Without them it behaves exactly as before.
 *
 *   guided?: ExerciseGuide = {
 *     onAnswer?: (correct: boolean, question?: number) => void;
 *     onReveal?: (question?: number) => void;
 *     onDone?:   () => void;
 *     onGuide?:  (target: GuideTarget, info?: { word?: number }) => void;
 *     advance?:  number;          // the lesson moves a settled question on
 *     heard?:    number | null;   // Dengar dan klik: the word the lesson's imam recited
 *   }
 *   compact?: boolean
 *
 * onAnswer(correct, question) — on every answer: an option tapped in the
 *   choose-one exercises (a word chip in TapWord, heard or not), a group
 *   tapped with a word chosen in SortCase; `question` is the plan's number of
 *   the question answered (content/quiz), whose explanation the lesson says
 *   after "Benar." — a wrong pick is not voiced (operator 2026-10-10). Ignored
 *   taps (a settled question, an option already tried, a group with no word
 *   chosen) and "Tunjukkan jawaban" are not answers. Called from the click
 *   handler, before any onDone.
 *
 * onReveal(question) — "Tunjukkan jawaban" pressed (every exercise): the
 *   lesson says "Ini jawabannya." and the same explanation. Called from the
 *   click handler, before the exercise reports its next control (and, in
 *   SortCase, before onDone when it was the last word).
 *
 * onDone() — once, when the exercise is finished: after "Selesai" on the
 *   last question (the choose-one exercises), or with the last word placed
 *   (SortCase has no Selesai, so its last feedback and the result are on
 *   screen when onDone fires — give the learner a moment before moving on).
 *   An exercise with nothing to ask on this ayah (e.g. fewer than two timed
 *   words) renders nothing and calls onDone right after mounting, so the
 *   runner never waits on it.
 *
 * onGuide(target) — whenever the control the learner should use next
 *   changes, starting on mount. target = `exercise:${key}:${part}`:
 *     tap-word     : play → options → [reveal] → next   (per question)
 *     why-harakat  : options → [reveal] → next
 *     label-role   : options → [reveal] → next
 *     wazn-factory : options → [reveal] → next
 *     sort-case    : words → bins → [reveal]            (per word)
 *   - tap-word reports "play" with { word } (the question's word): the
 *     runner recites it on the lesson's own player and passes `heard`. It
 *     moves from "play" to "options" only when the imam's word has played to
 *     its end (`heard`, or its own "Dengarkan lagi"), so a voiced prompt
 *     never starts over the recitation. Its own player pauses every other
 *     player on the page when it starts (belajar:audio-start), firing their
 *     onInterrupt: a runner must not read that as the learner pausing the
 *     lesson.
 *   - "reveal" follows two misses on a question; the options stay usable,
 *     so the prompt can offer both ("coba lagi, atau Tunjukkan jawaban").
 *   - "next" is "Lanjut", or "Selesai" on the last question. In guided mode
 *     the runner moves a settled question on by itself: each time
 *     `guided.advance` goes up, the choose-one exercises call their own
 *     next() (a no-op unless the question is settled). The button stays, to
 *     go sooner.
 *   - No target once the exercise is finished; onDone reports that.
 *   Sent from an effect, after the marked control is in the DOM. The same
 *   target is never sent twice in a row; a voiced reminder for an idle
 *   learner is the runner's job (it knows the current target).
 *
 * data-guide — in guided mode the control each target names carries
 *   data-guide="<target>" (a standalone exercise carries none), so the
 *   spotlight finds it with document.querySelector(guideSelector(target)).
 *
 * compact — hides the exercise's own heading and instruction visually (both
 *   stay for screen readers, and the heading still names the section) for a
 *   stage that shows its own caption; feedback, counters and "Tunjukkan
 *   jawaban" after two misses are unchanged. In guided mode focus still
 *   moves to the next question, but never scrolls the page (the stage
 *   offers "Lihat bagian yang ditandai" instead).
 *
 * In guided mode the finished state shows the result without "Ulangi
 * latihan": the runner moves on, and a button that vanishes under the
 * learner's finger is worse than none (the standalone copy under "Latihan"
 * keeps it).
 *
 * Names, parsers and the pure "what is next" rules live in ./guide.ts (no
 * "use client"), so lesson-step builders and tests can import them.
 */

/** Frame for one exercise: title, instruction, a calm "done" badge. */
export function ExerciseShell({
  title,
  instruction,
  done,
  doneLabel,
  autoFocus = false,
  compact = false,
  children,
}: {
  title: string;
  instruction: string;
  done: boolean;
  doneLabel: string;
  /** Focus the title on mount — set after "Ulangi latihan" remounts the
   *  exercise, so keyboard and screen-reader users start again at the top. */
  autoFocus?: boolean;
  /** Guided mode inside the lesson stage: the stage shows the instruction,
   *  so the title and instruction are visually hidden (still read by
   *  screen readers). */
  compact?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [autoFocus]);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-hairline bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={compact ? "sr-only" : "min-w-0"}>
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-xl font-medium text-ink"
          >
            <MixedText text={title} />
          </h3>
          <p className="mt-1 max-w-prose text-base text-ink-muted">
            <MixedText text={instruction} />
          </p>
        </div>
        {done && (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ok-bg px-3 py-1 text-sm font-semibold text-forest">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            {doneLabel}
          </span>
        )}
      </div>
      <div className={clsx(compact ? done && "mt-4" : "mt-5")}>{children}</div>
    </section>
  );
}

/**
 * Guided mode's reports that are not tied to a tap: `onGuide(target)` each
 * time `target` changes (null = nothing to point at), and `onDone()` once
 * when the exercise turns out to be `empty`. The callbacks are read from a
 * ref kept current by an effect, so a parent passing new inline functions
 * on every render neither re-sends a target nor misses one.
 */
export function useGuide(
  guided: ExerciseGuide | undefined,
  target: GuideTarget | null,
  empty = false,
  /** Dengar dan klik, with "play": the question's word. */
  word?: number,
) {
  const onGuide = guided?.onGuide;
  const onDone = guided?.onDone;
  const latest = useRef({ onGuide, onDone });
  useEffect(() => {
    latest.current = { onGuide, onDone };
  }, [onGuide, onDone]);

  /** Last report sent (target + word), so the same one is never sent twice
   *  in a row (also when Strict Mode re-runs the effect in development). */
  const sent = useRef<string | null>(null);
  const listening = onGuide !== undefined;
  useEffect(() => {
    if (!listening || target === null) {
      sent.current = null;
      return;
    }
    const report = `${target}#${word ?? ""}`;
    if (report === sent.current) return;
    sent.current = report;
    const info: GuideInfo | undefined = word === undefined ? undefined : { word };
    latest.current.onGuide?.(target, info);
  }, [listening, target, word]);

  const emptied = useRef(false);
  useEffect(() => {
    if (!empty || emptied.current) return;
    emptied.current = true;
    latest.current.onDone?.();
  }, [empty]);
}

/** "Ulangi latihan": the exercise body is remounted under a new key, so every
 *  piece of its state starts over (no state is reset by hand). */
export function useRestart() {
  const [round, setRound] = useState(0);
  const restart = useCallback(() => setRound((r) => r + 1), []);
  return { round, restart };
}

/** Moves keyboard focus to the returned element whenever `step` moves past
 *  0. "Lanjut" unmounts itself on click, so without this focus would drop
 *  back to the top of the page; focusing the next question (or the result)
 *  also scrolls it into view on a phone — except with `preventScroll`
 *  (guided mode inside the lesson stage, which never scrolls by itself). */
export function useStepFocus(step: number, preventScroll = false) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step > 0) ref.current?.focus({ preventScroll });
  }, [step, preventScroll]);
  return ref;
}

export type Resolution = "right" | "revealed" | null;

/**
 * One-answer-per-question flow shared by Dengar dan klik, Kenapa harakat,
 * Tebak peran and Bentuk kata. `answers[i]` is question i's right option.
 * Score = questions answered right on the first try; a revealed answer
 * never counts.
 */
export function useChoiceQuiz<T extends string | number>(
  id: string,
  answers: readonly T[],
  /** Guided mode: onAnswer on every pick, onDone after the last "Selesai". */
  guided?: ExerciseGuide,
  /** The plan's number of each question (content/quiz `n`), reported with
   *  every answer and reveal; default: its position, 1-based. */
  numbers?: readonly number[],
) {
  const { progress, markDone } = useProgress();
  const [i, setI] = useState(0);
  const [tried, setTried] = useState<T[]>([]);
  const [resolved, setResolved] = useState<Resolution>(null);
  const [firstTry, setFirstTry] = useState(0);

  const total = answers.length;
  const finished = i >= total;
  const answer: T | undefined = answers[Math.min(i, total - 1)];
  const question = numbers?.[Math.min(i, total - 1)] ?? Math.min(i, total - 1) + 1;

  const choose = (opt: T) => {
    if (finished || resolved !== null || tried.includes(opt)) return;
    if (opt === answer) {
      setResolved("right");
      if (tried.length === 0) setFirstTry((n) => n + 1);
      guided?.onAnswer?.(true, question);
    } else {
      setTried((prev) => [...prev, opt]);
      guided?.onAnswer?.(false, question);
    }
  };

  const reveal = () => {
    if (finished || resolved !== null) return;
    setResolved("revealed");
    guided?.onReveal?.(question);
  };

  const next = () => {
    if (resolved === null) return;
    const n = i + 1;
    setI(n);
    setTried([]);
    setResolved(null);
    if (n >= total) {
      markDone(id, total ? firstTry / total : 0);
      guided?.onDone?.();
    }
  };

  // Guided mode: the lesson moves a settled question on by itself (each
  // time guided.advance counts up), as "Lanjut" / "Selesai" would; the
  // button stays to go sooner. next() is a no-op on an unsettled question,
  // so a late signal can never skip one. Called from a timer, after the
  // render that brought the new count.
  const advance = guided?.advance ?? 0;
  const [startAdvance] = useState(advance);
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });
  useEffect(() => {
    if (advance === startAdvance) return;
    const t = window.setTimeout(() => nextRef.current(), 0);
    return () => window.clearTimeout(t);
  }, [advance, startAdvance]);

  return {
    i,
    total,
    finished,
    answer,
    tried,
    resolved,
    firstTry,
    /** Completed before, in this browser (shown as the "Sudah dikerjakan" badge). */
    doneBefore: Boolean(progress[id]),
    /** "Tunjukkan jawaban" is offered after two misses on a question. */
    canReveal: resolved === null && tried.length >= 2,
    choose,
    reveal,
    next,
  };
}

export type OptionState = "idle" | "right" | "wrong";

/** An option's state: the right answer once it is found or revealed; a
 *  wrong option the learner already tried; otherwise idle. */
export function optionState<T>(opt: T, answer: T | undefined, tried: readonly T[], resolved: Resolution): OptionState {
  if (resolved !== null && opt === answer) return "right";
  if (tried.includes(opt)) return "wrong";
  return "idle";
}

/** The words + icon that carry an option's state (never colour alone). */
export function OptionMark({
  state,
  label,
  inverse = false,
}: {
  state: "right" | "wrong";
  /** Overrides the default "Jawaban benar" / "Pilihan Anda". */
  label?: string;
  /** Paper text, for a mark on a forest fill. */
  inverse?: boolean;
}) {
  const t = useTranslations("Exercise");
  return (
    <span
      dir="ltr"
      className={clsx(
        "inline-flex items-center gap-1.5 text-sm font-semibold",
        inverse ? "text-paper" : state === "right" ? "text-forest" : "text-notice",
      )}
    >
      {state === "right" ? (
        <Check className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
      ) : (
        <RotateCcw className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
      )}
      {label ?? (state === "right" ? t("option_right") : t("option_yours"))}
    </span>
  );
}

/**
 * A full-width answer option: 48px for text, 56px for Arabic, a 2px border
 * at rest (border-ui, ≥3:1) and in every state, so nothing shifts when it
 * changes. Taps on a settled question are ignored by the quiz, not disabled,
 * so focus never drops out of the list.
 */
export function OptionButton({
  state,
  onClick,
  arabic = false,
  optionKey,
  children,
}: {
  state: OptionState;
  onClick: () => void;
  arabic?: boolean;
  /** The option's key in the plan (content/quiz: the word it comes from, or a form label), as
   *  `data-option`: the CI exercise check picks a right and a wrong option by it. */
  optionKey?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-option={optionKey}
      className={clsx(
        "flex w-full flex-col justify-center gap-1 rounded-xl border-2 px-4 py-2 text-base text-ink transition-colors",
        arabic ? "min-h-14 items-center text-center" : "min-h-12 items-start text-left",
        state === "right" && "border-forest bg-ok-bg",
        state === "wrong" && "border-case-nasb bg-notice-bg",
        state === "idle" && "border-border-ui bg-white hover:border-forest",
      )}
    >
      {children}
      {state !== "idle" && <OptionMark state={state} />}
    </button>
  );
}

/** "Soal 2 dari 4". */
export function Counter({ n, total }: { n: number; total: number }) {
  const t = useTranslations("Exercise");
  return <p className="text-sm text-ink-muted">{t("counter", { n, total })}</p>;
}

export type FeedbackKind = "ok" | "retry" | "reveal" | "hint";

/** Icon + bold first line + the rule: calm green for right, calm amber
 *  (never red) for everything else. */
function FeedbackBox({ kind, title, children }: { kind: FeedbackKind; title: string; children?: ReactNode }) {
  const icon = clsx("mt-1 h-6 w-6 shrink-0", kind === "ok" ? "text-forest" : "text-notice");
  return (
    <div
      className={clsx(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-base text-ink",
        kind === "ok" ? "bg-ok-bg" : "bg-notice-bg",
      )}
    >
      {kind === "ok" && <CheckCircle2 className={icon} aria-hidden />}
      {kind === "retry" && <RotateCcw className={icon} aria-hidden />}
      {kind === "reveal" && <Lightbulb className={icon} aria-hidden />}
      {kind === "hint" && <Info className={icon} aria-hidden />}
      <div className="min-w-0">
        {/* "Belum tepat — coba …": the dash never starts a line (line breaks, 2026-10-10). */}
        <p className="font-semibold">
          <MixedText text={title} />
        </p>
        {children ? <div className="mt-1">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * The feedback live region. The role="status" wrapper is ALWAYS rendered
 * (empty when there is nothing to say) so screen readers reliably announce
 * what appears in it; `nonce` remounts the box so a repeated message (a
 * second wrong pick) is announced again.
 */
export function Feedback({
  kind,
  title,
  nonce,
  children,
}: {
  kind: FeedbackKind | null;
  title?: string;
  nonce?: string | number;
  children?: ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {kind && title ? (
        <div key={nonce} className="mt-4">
          <FeedbackBox kind={kind} title={title}>
            {children}
          </FeedbackBox>
        </div>
      ) : null}
    </div>
  );
}

/** "Tunjukkan jawaban" (after two misses) or "Lanjut"/"Selesai" (once the
 *  question is settled). */
export function QuizActions({
  resolved,
  canReveal,
  last,
  onReveal,
  onNext,
  revealGuide,
  nextGuide,
}: {
  resolved: Resolution;
  canReveal: boolean;
  last: boolean;
  onReveal: () => void;
  onNext: () => void;
  /** Guided mode: the data-guide targets of the two buttons. */
  revealGuide?: GuideTarget;
  nextGuide?: GuideTarget;
}) {
  const t = useTranslations("Exercise");
  if (resolved === null && !canReveal) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {resolved !== null ? (
        <button type="button" onClick={onNext} data-guide={nextGuide} className="btn-primary w-full sm:w-auto">
          {last ? t("finish") : t("next")}
          {last ? (
            <Check className="h-5 w-5" aria-hidden />
          ) : (
            <ArrowRight className="h-5 w-5" aria-hidden />
          )}
        </button>
      ) : (
        <button type="button" onClick={onReveal} data-guide={revealGuide} className="btn-secondary">
          <Lightbulb className="h-5 w-5" aria-hidden />
          {t("reveal")}
        </button>
      )}
    </div>
  );
}

/** Finished state: the first-try score and a 48px "Ulangi latihan" (left
 *  out when `onRestart` is not given — guided mode, where the runner moves
 *  on by itself). */
export function Finished({
  right,
  total,
  onRestart,
}: {
  right: number;
  total: number;
  onRestart?: () => void;
}) {
  const t = useTranslations("Exercise");
  return (
    <div>
      <FeedbackBox kind="ok" title={t("finished_title")}>
        {t("score", { right, total })}
      </FeedbackBox>
      {onRestart && (
        <button type="button" onClick={onRestart} className="btn-secondary mt-4">
          <RotateCcw className="h-5 w-5" aria-hidden />
          {t("restart")}
        </button>
      )}
    </div>
  );
}
