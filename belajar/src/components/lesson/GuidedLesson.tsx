"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { useSegmentPlayer, type RecitationSource } from "@/hooks/useSegmentPlayer";
import { captionMs, type LessonStep } from "@/lib/lessonSteps";

const KEY = (id: string) => `belajar:v1:lesson:${id}`;

function readSaved(id: string): number | null {
  try {
    const v = window.localStorage.getItem(KEY(id));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
const noopSubscribe = () => () => {};

/**
 * "Mode Pelajaran": the ayah lesson plays by itself — the imam recites, each
 * word is recited and explained, new concepts and the ayah's structure are
 * introduced, then it pauses for practice and closes with the imam again.
 *
 * - Play / pause / resume (a recitation resumes mid-ayah; a caption step
 *   restarts its reading time), previous / next step, step progress.
 * - The position is remembered per ayah: "Lanjutkan dari langkah N".
 * - Explanation steps are captions at reading pace until narration audio is
 *   rendered (ElevenLabs v3, after the operator's go). The narrator will
 *   never voice Qur'anic words — those come only from the imam's recitation
 *   steps (plan §6.1 A1).
 * - Lock-screen / earphone controls via the Media Session API.
 */
export function GuidedLesson({
  lessonId,
  title,
  steps,
  sources,
}: {
  lessonId: string;
  title: string;
  steps: LessonStep[];
  sources: RecitationSource[];
}) {
  const t = useTranslations("Guided");
  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const runningRef = useRef(false);
  const idxRef = useRef(0);
  const saved = useSyncExternalStore(noopSubscribe, () => readSaved(lessonId), () => null);

  const step = steps[Math.min(idx, steps.length - 1)];

  const goTo = useCallback((n: number) => {
    idxRef.current = n;
    setIdx(n);
  }, []);

  const advance = useCallback(() => {
    const i = idxRef.current;
    const next = Math.min(i + 1, steps.length - 1);
    if (next === i || steps[next].kind === "practice") {
      // Stop at practice (the learner works the exercises) and at the end.
      runningRef.current = false;
      setRunning(false);
    }
    goTo(next);
  }, [steps, goTo]);

  const p = useSegmentPlayer(sources, {
    onFinish: () => {
      if (runningRef.current) advance();
    },
  });

  // Drive the current step while running.
  useEffect(() => {
    if (!running) return;
    if (step.kind === "recite_ayah") {
      p.restart();
      return;
    }
    if (step.kind === "recite_word") {
      p.playWord(step.word);
      return;
    }
    if (step.kind === "explain") {
      if (step.focus) {
        document
          .getElementById(`w-${step.focus.replaceAll(":", "-")}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      const timer = window.setTimeout(advance, captionMs(step.caption));
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per step, not per player re-render
  }, [running, idx]);

  // Remember the position.
  useEffect(() => {
    if (!started) return;
    try {
      window.localStorage.setItem(KEY(lessonId), String(idx));
    } catch {
      /* storage blocked: position just isn't remembered */
    }
  }, [idx, started, lessonId]);

  const play = useCallback(
    (from?: number) => {
      if (typeof from === "number") goTo(from);
      setStarted(true);
      runningRef.current = true;
      setRunning(true);
    },
    [goTo],
  );

  const pause = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    p.pause();
  }, [p]);

  const jump = useCallback(
    (delta: number) => {
      p.pause();
      goTo(Math.max(0, Math.min(steps.length - 1, idxRef.current + delta)));
      setStarted(true);
    },
    [p, steps.length, goTo],
  );

  // Lock-screen / earphone controls.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !started) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title, artist: "Belajar Al-Qur'an · Dakwah-Lens" });
    ms.setActionHandler("play", () => play());
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("nexttrack", () => jump(1));
    ms.setActionHandler("previoustrack", () => jump(-1));
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) ms.setActionHandler(a, null);
    };
  }, [started, title, play, pause, jump]);

  const pct = Math.round(((idx + 1) / steps.length) * 100);
  const atPractice = step.kind === "practice";

  return (
    <section
      aria-labelledby="guided"
      className="rounded-2xl border border-forest/30 bg-forest-tint/40 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="guided" className="font-display text-xl font-medium">
          {t("title")}
        </h2>
        <span className="text-xs text-ink-muted tabular-nums">
          {t("step", { n: idx + 1, total: steps.length })}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline" aria-hidden>
        <div className="h-full bg-forest transition-[width]" style={{ width: `${pct}%` }} />
      </div>

      <p
        aria-live="polite"
        className="mt-4 min-h-12 text-pretty text-base leading-relaxed"
      >
        {started ? step.caption : t("ready")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => jump(-1)}
          aria-label={t("prev")}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-white hover:bg-paper-deep"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        {running ? (
          <button
            type="button"
            onClick={pause}
            className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-paper hover:bg-forest-hover"
          >
            <Pause className="h-4 w-4" /> {t("pause")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (atPractice ? play(Math.min(idx + 1, steps.length - 1)) : play())}
            className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-2.5 text-sm font-semibold text-paper hover:bg-forest-hover"
          >
            <Play className="h-4 w-4" />
            {!started ? t("start") : atPractice ? t("continue_after_practice") : t("resume")}
          </button>
        )}
        <button
          type="button"
          onClick={() => jump(1)}
          aria-label={t("next")}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-white hover:bg-paper-deep"
        >
          <SkipForward className="h-4 w-4" />
        </button>
        {!started && saved !== null && saved > 0 && saved < steps.length && (
          <button
            type="button"
            onClick={() => play(saved)}
            className="rounded-full border border-forest px-4 py-2 text-sm font-semibold text-forest hover:bg-forest-tint"
          >
            {t("resume_from", { n: saved + 1 })}
          </button>
        )}
      </div>

      {atPractice && started && (
        <a href="#practice" className="mt-3 inline-block text-sm font-semibold text-forest underline">
          {t("go_practice")}
        </a>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">{t("captions_note")}</p>
    </section>
  );
}
