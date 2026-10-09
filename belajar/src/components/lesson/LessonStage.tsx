"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { TextSizeOptions } from "@/components/TextSizeSwitch";
import { useImamRate, usePace } from "@/hooks/usePace";
import { type RecitationSource, useSegmentPlayer } from "@/hooks/useSegmentPlayer";
import { captionMs, type LessonStep, type Pace, PACES } from "@/lib/lessonSteps";

import { MushafLine, type PlayerWord } from "./AyahPlayer";

export type StageSource = RecitationSource & { label: string; credit: string };

/** Window event a word card's "Dengar" button sends; the stage plays the
 *  word on its one player (so word cards never start a second recording). */
const PLAY_WORD_EVENT = "belajar:play-word";

/**
 * "▶ Dengar" for a word card (WordCard's optional `listen` slot). It asks
 * the lesson stage to play the word; the stage pauses a running lesson first.
 */
export function WordListenButton({ index, label, detail }: { index: number; label: string; detail: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent<number>(PLAY_WORD_EVENT, { detail: index }))}
      className="chip-link shrink-0"
    >
      <Play aria-hidden className="h-5 w-5" />
      {label}
      <span className="sr-only"> {detail}</span>
    </button>
  );
}

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

/** Moves keyboard focus to a control when it appears in place of the one
 *  just pressed (stable function: React calls it on mount only). Never
 *  scrolls: the page does not move under the learner. */
const focusOnMount = (el: HTMLElement | null) => {
  el?.focus({ preventScroll: true });
};

/** Steps that wait for the imam's recording before they are complete. */
const audible = (s: LessonStep, hasWord: (w: number) => boolean) =>
  s.kind === "recite_ayah" || (s.kind === "recite_word" && hasWord(s.word));

/** The word a step is about, if any (1-based index in the ayah). */
const wordOf = (s: LessonStep) => (s.kind === "recite_word" || s.kind === "explain" ? s.word : undefined);

/**
 * The lesson stage: the ayah, its translation and the guided lesson around
 * ONE recitation player (senior-ux §3.5–3.6). Sharing the player means the
 * mushaf line highlights the word being recited during the guided lesson,
 * two recordings never play over each other, and the imam's speed applies
 * everywhere.
 *
 * Guided lesson ("Pelajaran dipandu"): the imam recites the ayah, each word
 * is recited and explained, new concepts and the sentence structure follow,
 * then it stops for practice and closes with the imam again.
 * - Pace (asked once, kept in Pengaturan belajar): "biasa" / "pelan" move on
 *   by themselves at a reading pace with no upper cap; "tunggu" never moves
 *   on by itself — a Lanjut button appears once the step is heard (WCAG
 *   2.2.1). A word step waits for BOTH the recitation and the reading time.
 * - Position remembered per ayah ("Lanjutkan dari langkah N").
 * - Explanations are captions until narration audio exists; the narrator
 *   will never voice Qur'anic words (plan §6.1 A1). Nothing scrolls the page.
 * - Lock-screen / earphone controls via the Media Session API.
 */
export function LessonStage({
  lessonId,
  title,
  ayah,
  words,
  sources,
  steps,
  translation,
}: {
  lessonId: string;
  title: string;
  ayah: number;
  words: PlayerWord[];
  sources: StageSource[];
  steps: LessonStep[];
  /** The ayah's translation with footnotes and source, rendered by the page. */
  translation: ReactNode;
}) {
  const t = useTranslations("Guided");
  const tp = useTranslations("Player");
  const uid = useId();
  const { pace, chosen: paceChosen, setPace } = usePace();
  const [imamRate, setImamRate] = useImamRate();

  const [idx, setIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  /** Step that is complete and waits for the learner's "Lanjut". */
  const [readyIdx, setReadyIdx] = useState<number | null>(null);
  /** Step to start from once the one-time pace question is answered. */
  const [asking, setAsking] = useState<number | null>(null);

  const runningRef = useRef(false);
  const idxRef = useRef(0);
  const paceRef = useRef<Pace>(pace);
  /** A recite_ayah step paused mid-recitation resumes there instead of
   *  starting over. */
  const resumeIdxRef = useRef<number | null>(null);
  /** Completion handler of the step being driven (set by the driver). */
  const finishRef = useRef<(() => void) | null>(null);
  const settingsRef = useRef<HTMLDetailsElement>(null);
  const saved = useSyncExternalStore(noopSubscribe, () => readSaved(lessonId), () => null);

  useEffect(() => {
    paceRef.current = pace;
  }, [pace]);

  const halt = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
  }, []);

  const p = useSegmentPlayer(sources, {
    rate: imamRate,
    onFinish: () => finishRef.current?.(),
    // The recording failed (offline, blocked): stop instead of waiting forever.
    onError: () => {
      if (runningRef.current) halt();
    },
    // Another recording on the page started (e.g. the Dengar dan ketuk
    // exercise) and paused ours: pause the lesson like "Jeda" would, so it
    // neither moves on nor waits for audio that will not finish.
    onInterrupt: () => {
      if (!runningRef.current) return;
      halt();
      resumeIdxRef.current = steps[idxRef.current]?.kind === "recite_ayah" ? idxRef.current : null;
    },
  });
  const { restart, playAll, playWord, hasWord, pause: pauseAudio, chooseSource } = p;

  const goTo = useCallback(
    (n: number) => {
      const i = Math.max(0, Math.min(steps.length - 1, n));
      idxRef.current = i;
      resumeIdxRef.current = null;
      setIdx(i);
      setReadyIdx(null);
      setDone(false);
      // Practice is the learner's turn: the lesson waits there.
      if (steps[i].kind === "practice") halt();
    },
    [steps, halt],
  );

  const advance = useCallback(() => {
    const i = idxRef.current;
    if (i >= steps.length - 1) {
      halt();
      setReadyIdx(null);
      setDone(true);
      try {
        window.localStorage.removeItem(KEY(lessonId));
      } catch {
        /* storage blocked: nothing was remembered */
      }
      return;
    }
    goTo(i + 1);
  }, [steps.length, halt, goTo, lessonId]);

  const autoAdvance = pace !== "tunggu";

  // Drive the current step while running. State changes only happen in the
  // timer / audio callbacks, never synchronously here.
  useEffect(() => {
    if (!running) return;
    const s = steps[idx];
    if (!s || s.kind === "practice") return;
    const withAudio = audible(s, hasWord);
    // "Tunggu saya" + a caption with no recitation: Lanjut shows at once.
    if (!withAudio && !autoAdvance) return;
    let heard = !withAudio;
    let read = !autoAdvance;
    let plays = 0;
    let live = true;
    const timers: number[] = [];
    const settle = () => {
      if (!live || !heard || !read) return;
      live = false;
      finishRef.current = null;
      if (autoAdvance) advance();
      else setReadyIdx(idx);
    };
    if (withAudio) {
      finishRef.current = () => {
        plays += 1;
        // Pelan: the imam says the word once more after a short gap.
        if (s.kind === "recite_word" && plays === 1 && paceRef.current === "pelan") {
          timers.push(
            window.setTimeout(() => {
              if (live) playWord(s.word);
            }, 1500),
          );
          return;
        }
        heard = true;
        settle();
      };
      if (s.kind === "recite_word") playWord(s.word);
      else if (resumeIdxRef.current === idx) playAll();
      else restart();
    }
    resumeIdxRef.current = null;
    if (autoAdvance) {
      const ms = captionMs(s.caption, paceRef.current === "pelan" ? "pelan" : "biasa");
      timers.push(
        window.setTimeout(() => {
          read = true;
          settle();
        }, ms),
      );
    }
    return () => {
      live = false;
      finishRef.current = null;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [running, idx, steps, autoAdvance, hasWord, playWord, playAll, restart, advance]);

  // "Dengar" on a word card: the same player, so audio never overlaps.
  useEffect(() => {
    const onPlayWord = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n !== "number") return;
      if (runningRef.current) halt();
      resumeIdxRef.current = null;
      playWord(n);
    };
    window.addEventListener(PLAY_WORD_EVENT, onPlayWord);
    return () => window.removeEventListener(PLAY_WORD_EVENT, onPlayWord);
  }, [halt, playWord]);

  // Remember the position.
  useEffect(() => {
    if (!started) return;
    try {
      window.localStorage.setItem(KEY(lessonId), String(idx));
    } catch {
      /* storage blocked: position just isn't remembered */
    }
  }, [idx, started, lessonId]);

  const begin = useCallback(
    (from: number) => {
      goTo(from);
      setStarted(true);
      const i = Math.max(0, Math.min(steps.length - 1, from));
      if (steps[i].kind === "practice") return;
      runningRef.current = true;
      setRunning(true);
    },
    [goTo, steps],
  );

  const resume = useCallback(() => {
    if (done) {
      begin(0);
      return;
    }
    if (steps[idxRef.current].kind === "practice") return;
    setStarted(true);
    runningRef.current = true;
    setRunning(true);
  }, [done, begin, steps]);

  const pauseLesson = useCallback(() => {
    halt();
    resumeIdxRef.current = steps[idxRef.current].kind === "recite_ayah" ? idxRef.current : null;
    pauseAudio();
  }, [halt, steps, pauseAudio]);

  const jump = useCallback(
    (delta: number) => {
      const to = idxRef.current + delta;
      // Already at the first/last step: the button is aria-disabled, and a
      // press (or an earphone skip) changes nothing.
      if (to < 0 || to > steps.length - 1) return;
      pauseAudio();
      goTo(to);
      setStarted(true);
    },
    [steps.length, pauseAudio, goTo],
  );

  /** A tap on the mushaf line or an imam control takes over the player:
   *  the lesson pauses and resumes its step later from the start. */
  const interrupt = () => {
    if (runningRef.current) halt();
    resumeIdxRef.current = null;
  };

  const requestStart = (from: number) => {
    if (paceChosen) begin(from);
    else setAsking(from);
  };

  const choosePace = (v: Pace) => {
    setPace(v);
    paceRef.current = v;
    const from = asking ?? 0;
    setAsking(null);
    begin(from);
  };

  const openSettings = () => {
    const d = settingsRef.current;
    if (!d) return;
    d.open = true;
    d.querySelector("summary")?.focus();
  };

  // Lock-screen / earphone controls.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !started) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title, artist: "Belajar Al-Qur'an · Dakwah-Lens" });
    ms.setActionHandler("play", () => resume());
    ms.setActionHandler("pause", () => pauseLesson());
    ms.setActionHandler("nexttrack", () => jump(1));
    ms.setActionHandler("previoustrack", () => jump(-1));
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) ms.setActionHandler(a, null);
    };
  }, [started, title, resume, pauseLesson, jump]);

  const step = steps[Math.min(idx, steps.length - 1)];
  const last = steps.length - 1;
  const atPractice = started && step.kind === "practice";
  const focusIndex = started && !done ? wordOf(step) : undefined;
  const focusWord = focusIndex === undefined ? undefined : words.find((w) => w.index === focusIndex);
  /** "Tunggu saya": ONE Lanjut button stays mounted for the whole run, so
   *  keyboard focus never drops when a step starts waiting for the imam. */
  const lanjutShown = running && pace === "tunggu" && !atPractice;
  /** …and it works once the step is heard (a caption-only step at once). */
  const lanjutReady = lanjutShown && (readyIdx === idx || !audible(step, hasWord));
  const middleId = `${uid}-middle`;
  const waitId = `${uid}-wait`;
  /** A no-op while the imam is still reciting (aria-disabled then). When the
   *  next step is the practice or the end, the button goes away: focus moves
   *  to the middle control, which stays mounted and now offers the next
   *  thing to do. */
  const onLanjut = () => {
    if (!lanjutReady) return;
    const i = idxRef.current;
    const leaving = i >= steps.length - 1 || steps[i + 1].kind === "practice";
    advance();
    if (leaving) document.getElementById(middleId)?.focus({ preventScroll: true });
  };
  const resumeAt = !started && saved !== null && saved > 0 && saved < steps.length ? saved : null;
  const idlePlaying = p.playing && !running;
  const paceLabel = t(`pace_${pace}`);
  const modeLabel = pace === "tunggu" ? t("mode_wait") : t("mode_auto", { pace: paceLabel });
  const pct = Math.round(((idx + 1) / steps.length) * 100);
  const source = sources[p.sourceIdx];

  // Middle control: the one thing to do next in this state.
  const middle = done
    ? { label: t("restart_lesson"), icon: <RotateCcw aria-hidden className="h-5 w-5" />, onClick: () => begin(0), primary: false }
    : atPractice
      ? { label: t("continue_after_practice"), icon: <Play aria-hidden className="h-5 w-5" />, onClick: () => begin(idx + 1), primary: true }
      : running
        ? { label: t("pause"), icon: <Pause aria-hidden className="h-5 w-5" />, onClick: pauseLesson, primary: false }
        : { label: t("resume"), icon: <Play aria-hidden className="h-5 w-5" />, onClick: resume, primary: true };

  return (
    <div className="rounded-2xl border border-hairline bg-white p-4 shadow-sm sm:p-7">
      <p className="flex items-center justify-center gap-2 text-center text-sm text-ink-muted">
        <Volume2 aria-hidden className="h-5 w-5 shrink-0 text-forest" />
        {tp("hint_tap")}
      </p>
      <div className="mt-3">
        <MushafLine
          ayah={ayah}
          words={words}
          activeWord={p.activeWord}
          focusWord={focusIndex}
          canPlay={hasWord}
          onTap={(i) => {
            interrupt();
            playWord(i);
          }}
        />
      </div>
      <div className="mx-auto mt-5 max-w-prose">{translation}</div>

      {/* Guided lesson */}
      <section aria-labelledby={`${uid}-guided`} className="mt-6 border-t border-hairline pt-5">
        <h2 id={`${uid}-guided`} className="font-display text-2xl font-medium">
          {t("title")}
        </h2>

        {!started && asking !== null ? (
          <fieldset ref={focusOnMount} tabIndex={-1} className="mt-3">
            <legend className="text-lg font-semibold text-ink">{t("ask_title")}</legend>
            <div className="mt-3 grid gap-3">
              {PACES.map((v) => (
                <button key={v} type="button" onClick={() => choosePace(v)} className="btn-secondary w-full">
                  {t(`ask_${v}`)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-muted">{t("ask_note")}</p>
          </fieldset>
        ) : !started ? (
          <>
            <p className="mt-2 max-w-prose text-pretty text-base text-ink">{t("ready")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => requestStart(0)} className="btn-primary w-full sm:w-auto">
                <Play aria-hidden className="h-5 w-5" />
                {t("start")}
              </button>
              {resumeAt !== null && (
                <button type="button" onClick={() => requestStart(resumeAt)} className="btn-secondary w-full sm:w-auto">
                  {t("resume_from", { n: resumeAt + 1 })}
                </button>
              )}
            </div>
            {paceChosen && (
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-muted">
                {modeLabel}
                <button type="button" onClick={openSettings} className="chip-link">
                  {t("change")}
                </button>
              </p>
            )}
          </>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
              <span className="tabular-nums">{t("step", { n: idx + 1, total: steps.length })}</span>
              <span aria-hidden>·</span>
              <span>{running ? modeLabel : done ? t("finished") : t("paused")}</span>
              <button type="button" onClick={openSettings} className="chip-link">
                {t("change")}
              </button>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
              <div className="h-full bg-forest motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
            </div>

            {focusWord && (
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-paper-deep px-4 py-2">
                <p lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
                  {focusWord.ar}
                </p>
                <div>
                  <p className="text-sm text-ink-muted">
                    {t("word_n", { n: focusWord.index })} · {focusWord.translit}
                  </p>
                  <p className="text-lg font-medium text-ink">{focusWord.gloss}</p>
                </div>
              </div>
            )}

            <p aria-live="polite" className="mt-4 min-h-[6em] max-w-prose text-pretty text-xl text-ink">
              {done ? t("done") : step.caption}
            </p>

            {lanjutShown && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={onLanjut}
                  aria-disabled={!lanjutReady}
                  aria-describedby={lanjutReady ? undefined : waitId}
                  className="btn-primary w-full sm:w-auto"
                >
                  {t("next_wait")}
                  <ChevronRight aria-hidden className="h-5 w-5" />
                </button>
                {!lanjutReady && (
                  <p id={waitId} className="text-base text-ink-muted">
                    {t("waiting_audio")}
                  </p>
                )}
              </div>
            )}

            {atPractice && (
              <p className="mt-2">
                <a href="#practice" className="chip-link">
                  {t("go_practice")}
                </a>
              </p>
            )}

            {/* DOM order = phone order (the main control on its own row,
                then ‹ Sebelumnya · Berikutnya ›); from sm the order utilities
                place it between them. At the first/last step prev/next stay
                in place, aria-disabled, so focus is never lost. */}
            <div role="group" aria-label={t("controls_label")} className="mt-5 flex flex-wrap items-center gap-4">
              <button
                id={middleId}
                ref={focusOnMount}
                type="button"
                onClick={middle.onClick}
                className={`${middle.primary ? "btn-primary" : "btn-secondary"} w-full sm:order-2 sm:w-auto sm:grow`}
              >
                {middle.icon}
                {middle.label}
              </button>
              <button
                type="button"
                onClick={() => jump(-1)}
                aria-disabled={idx === 0}
                className="btn-secondary grow sm:order-1"
              >
                <ChevronLeft aria-hidden className="h-5 w-5" />
                {t("prev")}
              </button>
              <button
                type="button"
                onClick={() => jump(1)}
                aria-disabled={idx === last}
                className="btn-secondary grow sm:order-3"
              >
                {t("next")}
                <ChevronRight aria-hidden className="h-5 w-5" />
              </button>
            </div>
          </>
        )}
      </section>

      {/* The imam's recitation */}
      <div role="group" aria-labelledby={`${uid}-imam`} className="mt-6 border-t border-hairline pt-5">
        <p id={`${uid}-imam`} className="text-base font-semibold text-ink">
          {tp("heading")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              if (idlePlaying) {
                pauseAudio();
                return;
              }
              interrupt();
              playAll();
            }}
            className="btn-secondary"
          >
            {idlePlaying ? <Pause aria-hidden className="h-5 w-5" /> : <Play aria-hidden className="h-5 w-5" />}
            {idlePlaying ? tp("pause") : tp("play_ayah")}
          </button>
          <button
            type="button"
            onClick={() => {
              interrupt();
              restart();
            }}
            className="btn-secondary"
          >
            <RotateCcw aria-hidden className="h-5 w-5" />
            {tp("restart")}
          </button>
          <button
            type="button"
            onClick={() => setImamRate(imamRate === 1 ? 0.75 : 1)}
            className="btn-secondary"
          >
            <Gauge aria-hidden className="h-5 w-5" />
            {tp("speed", { speed: imamRate === 1 ? tp("speed_normal") : tp("speed_slow") })}
          </button>
        </div>

        {sources.length > 1 && (
          <div className="mt-4">
            <label htmlFor={`${uid}-reciter`} className="block text-base font-semibold text-ink">
              {tp("reciter")}
            </label>
            <select
              id={`${uid}-reciter`}
              value={p.sourceIdx}
              onChange={(e) => {
                interrupt();
                chooseSource(Number(e.target.value));
              }}
              className="mt-2 min-h-12 w-full max-w-sm cursor-pointer rounded-xl border-[1.5px] border-border-ui bg-white px-3 text-base text-ink hover:border-forest"
            >
              {sources.map((s, i) => (
                <option key={s.reciter} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">{tp("husary_note")}</p>
          </div>
        )}

        {p.failed && (
          <p role="status" className="mt-4 max-w-prose rounded-xl bg-notice-bg px-4 py-3 text-base text-ink">
            {tp("failed")}
          </p>
        )}
        {/* Recitation streams from the reciter's CDN; never re-hosted (plan §6.2). */}
        <p className="mt-3 text-xs text-ink-soft">{source?.credit}</p>
      </div>

      {/* Learning settings: pace + text size */}
      <details ref={settingsRef} className="mt-6 rounded-xl border border-hairline bg-paper">
        <summary className="disclosure-row px-4 py-2">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden className="h-5 w-5 shrink-0 text-forest" />
            {t("settings")}
          </span>
          <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
        </summary>
        <div className="space-y-6 px-4 pt-2 pb-5">
          <fieldset>
            <legend className="text-base font-semibold text-ink">{t("pace_heading")}</legend>
            {/* Same pattern as TextSizeOptions: a drawn radio with a tick and
                the word "Dipilih", never colour alone. */}
            <div className="@container mt-2">
              <div className="grid gap-3 @xl:grid-cols-3">
                {PACES.map((v) => {
                  // Nothing is checked until the learner has chosen: a
                  // pre-checked default could not be "chosen" (tapping it
                  // fires no change), and the start would ask again.
                  const on = paceChosen && pace === v;
                  return (
                    <label
                      key={v}
                      className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2 ${
                        on ? "border-2 border-forest bg-forest-tint" : "border-[1.5px] border-border-ui bg-white hover:border-forest"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${uid}-pace`}
                        value={v}
                        checked={on}
                        onChange={() => setPace(v)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                          on ? "border-forest bg-forest text-paper" : "border-border-ui bg-white"
                        }`}
                      >
                        {on ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-base font-semibold text-ink">{t(`pace_${v}`)}</span>
                        {on ? (
                          <span aria-hidden className="text-sm font-medium text-forest">
                            {t("selected")}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 max-w-prose text-sm text-ink-muted">{t(`pace_hint_${pace}`)}</p>
          </fieldset>
          <div>
            <p className="text-base font-semibold text-ink">{t("text_size")}</p>
            <div className="mt-2">
              <TextSizeOptions />
            </div>
          </div>
        </div>
      </details>

      <p className="mt-4 max-w-prose text-sm text-ink-muted">{t("captions_note")}</p>
    </div>
  );
}
