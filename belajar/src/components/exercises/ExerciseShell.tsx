"use client";

import clsx from "clsx";
import { ArrowRight, Check, CheckCircle2, Info, Lightbulb, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useProgress } from "@/hooks/useProgress";

/*
 * Shared pieces of the five exercises (plan §4.7; senior-ux.md §3.7):
 * - state is NEVER shown by colour alone: an option's state is a 2px border
 *   (≥3:1) plus an icon plus words ("Jawaban benar" / "Pilihan Anda");
 * - a wrong pick does not give the answer away ("Belum tepat — coba pilih
 *   yang lain."); after two misses "Tunjukkan jawaban" marks the right option
 *   and shows the rule;
 * - the finished state offers "Ulangi latihan";
 * - no hearts, timers or sound effects, ever.
 */

/** Frame for one exercise: title, instruction, a calm "done" badge. */
export function ExerciseShell({
  title,
  instruction,
  done,
  doneLabel,
  autoFocus = false,
  children,
}: {
  title: string;
  instruction: string;
  done: boolean;
  doneLabel: string;
  /** Focus the title on mount — set after "Ulangi latihan" remounts the
   *  exercise, so keyboard and screen-reader users start again at the top. */
  autoFocus?: boolean;
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
        <div className="min-w-0">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-xl font-medium text-ink"
          >
            {title}
          </h3>
          <p className="mt-1 max-w-prose text-base text-ink-muted">{instruction}</p>
        </div>
        {done && (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ok-bg px-3 py-1 text-sm font-semibold text-forest">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            {doneLabel}
          </span>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
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
 *  also scrolls it into view on a phone. */
export function useStepFocus(step: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step > 0) ref.current?.focus();
  }, [step]);
  return ref;
}

export type Resolution = "right" | "revealed" | null;

/**
 * One-answer-per-question flow shared by Dengar dan ketuk, Kenapa harakat,
 * Tebak peran and Bentuk kata. `answers[i]` is question i's right option.
 * Score = questions answered right on the first try; a revealed answer
 * never counts.
 */
export function useChoiceQuiz<T extends string | number>(id: string, answers: readonly T[]) {
  const { progress, markDone } = useProgress();
  const [i, setI] = useState(0);
  const [tried, setTried] = useState<T[]>([]);
  const [resolved, setResolved] = useState<Resolution>(null);
  const [firstTry, setFirstTry] = useState(0);

  const total = answers.length;
  const finished = i >= total;
  const answer: T | undefined = answers[Math.min(i, total - 1)];

  const choose = (opt: T) => {
    if (finished || resolved !== null || tried.includes(opt)) return;
    if (opt === answer) {
      setResolved("right");
      if (tried.length === 0) setFirstTry((n) => n + 1);
    } else {
      setTried((prev) => [...prev, opt]);
    }
  };

  const reveal = () => {
    if (!finished && resolved === null) setResolved("revealed");
  };

  const next = () => {
    if (resolved === null) return;
    const n = i + 1;
    setI(n);
    setTried([]);
    setResolved(null);
    if (n >= total) markDone(id, total ? firstTry / total : 0);
  };

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
  children,
}: {
  state: OptionState;
  onClick: () => void;
  arabic?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
        <p className="font-semibold">{title}</p>
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
}: {
  resolved: Resolution;
  canReveal: boolean;
  last: boolean;
  onReveal: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("Exercise");
  if (resolved === null && !canReveal) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {resolved !== null ? (
        <button type="button" onClick={onNext} className="btn-primary w-full sm:w-auto">
          {last ? t("finish") : t("next")}
          {last ? (
            <Check className="h-5 w-5" aria-hidden />
          ) : (
            <ArrowRight className="h-5 w-5" aria-hidden />
          )}
        </button>
      ) : (
        <button type="button" onClick={onReveal} className="btn-secondary">
          <Lightbulb className="h-5 w-5" aria-hidden />
          {t("reveal")}
        </button>
      )}
    </div>
  );
}

/** Finished state: the first-try score and a 48px "Ulangi latihan". */
export function Finished({
  right,
  total,
  onRestart,
}: {
  right: number;
  total: number;
  onRestart: () => void;
}) {
  const t = useTranslations("Exercise");
  return (
    <div>
      <FeedbackBox kind="ok" title={t("finished_title")}>
        {t("score", { right, total })}
      </FeedbackBox>
      <button type="button" onClick={onRestart} className="btn-secondary mt-4">
        <RotateCcw className="h-5 w-5" aria-hidden />
        {t("restart")}
      </button>
    </div>
  );
}
