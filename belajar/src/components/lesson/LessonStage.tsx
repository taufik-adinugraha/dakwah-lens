"use client";

import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { EXERCISE_TITLE_KEY, GuidedExercise, type StageExerciseData } from "@/components/autoplay/GuidedExercise";
import { type Offscreen, Spotlight } from "@/components/autoplay/Spotlight";
import { SurahEndCard } from "@/components/autoplay/SurahEndCard";
import { continueToAyah, PLAY_WORD_EVENT, useAutoplay } from "@/components/autoplay/useAutoplay";
import { guideSelector } from "@/components/exercises/guide";
import { TextSizeOptions } from "@/components/TextSizeSwitch";
import type { RecitationSource } from "@/hooks/useSegmentPlayer";
import { Link } from "@/i18n/navigation";
import type { AutoplaySequence } from "@/lib/autoplay";
import { PACES } from "@/lib/lessonSteps";
import { ayahHref } from "@/lib/routes";

import { MushafLine, type PlayerWord } from "./AyahPlayer";

export type StageSource = RecitationSource & { label: string; credit: string };

/**
 * "▶ Dengar" for a word card (WordCard's optional `listen` slot). It asks
 * the lesson stage to play the word on its one player; a running lesson
 * pauses first.
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

/** Moves keyboard focus to a control when it appears in place of the one
 *  just pressed (stable function: React calls it on mount only). Never
 *  scrolls: the page does not move under the learner. */
const focusOnMount = (el: HTMLElement | null) => {
  el?.focus({ preventScroll: true });
};

/** Moves focus into the stage's new exercise (its heading, never
 *  scrolling) — only when focus was in the lesson area or nowhere, never
 *  away from the settings the learner is using. Stable: React calls it on
 *  mount (the heading is keyed per exercise). */
const focusIntoExercise = (el: HTMLElement | null) => {
  if (!el) return;
  const a = document.activeElement;
  const stage = el.closest('[data-autoplay="stage"]');
  const inLesson = !!a && !!stage?.contains(a) && !a.closest('[data-autoplay="settings"]');
  if (!a || a === document.body || inLesson) el.focus({ preventScroll: true });
};

/** The spotlight label of a control in the controls bar ("Ketuk di sini"
 *  + an arrow), drawn above it; the ring is on the button itself. `end`:
 *  anchored at the button's right edge (a button on the right of the bar),
 *  so it never runs past the screen; it wraps rather than overflow. */
function BarSpotLabel({ label, align = "center" }: { label: string; align?: "center" | "end" }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "pointer-events-none absolute bottom-full z-10 mb-3 inline-flex w-max max-w-[min(20rem,calc(100vw-2rem))] items-center gap-1.5 rounded-2xl border-2 border-white bg-forest px-3 py-1 text-base font-semibold text-paper shadow-md",
        align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
      )}
    >
      <ArrowDown aria-hidden className="h-5 w-5 shrink-0" strokeWidth={2.5} />
      <span className="min-w-0 text-balance">{label}</span>
    </span>
  );
}

/** Ring of a spotlit control in the controls bar (thick, with a white gap;
 *  never colour alone — the label above names it). */
const BAR_RING = "ring-4 ring-forest ring-offset-4 ring-offset-white";

/**
 * The lesson stage, now an AUTOPLAY player (operator, 2026-10-10): one tap
 * on "Mulai" and the whole ayah plays from start to finish — narration
 * (caption-only until the narration audio is rendered), the imam's
 * recitation with the mushaf word lit as he recites it, every word
 * explained, the new concepts, then each exercise inside the stage with
 * voice + spotlight guidance, the recap, and on to the next ayah by itself.
 * Engine: src/lib/autoplay (pure state machine); runner: useAutoplay.
 *
 * Layout (senior-friendly, nothing scrolls by itself):
 * - The stage stays in the page flow and everything happens INSIDE it: the
 *   step's content swaps in place (the mushaf line + the word or the
 *   translation while listening; the prompt + the exercise while
 *   practising), so the page never moves under the learner.
 * - The controls bar is sticky at the bottom of the viewport while the
 *   stage is on screen (a familiar media-player bar): Jeda / Lanjutkan,
 *   ‹ Sebelumnya and Berikutnya › (which becomes "Lewati latihan" during an
 *   exercise) are always one tap away, at 48–56px, whatever the text size.
 * - A spotlit control that is out of view is never scrolled to
 *   automatically: the bar offers "Lihat bagian yang ditandai", which
 *   scrolls only on the learner's tap.
 * - Settings (pace, imam speed, reciter, text size) sit under the bar,
 *   always visible and labelled.
 *
 * The narrator never voices Qur'anic words (plan §6.1 A1): with audio the
 * caption is the spoken text, which says "kata ini" / "kata kedua";
 * captions may show transliteration, never Arabic script. So a listener can
 * find "kata kedua", the mushaf line numbers its words while the lesson
 * runs and rings the ones the line on screen names. A screen reader hears
 * the sanitised spoken text from a polite live region — never the caption's
 * transliteration, and never over the imam. The rest of the page (word
 * cards, Latihan, Pelajari lebih dalam) stays for browsing.
 */
export function LessonStage({
  seq,
  title,
  ayah,
  surahName,
  nextSurah,
  words,
  sources,
  translation,
  exercise,
}: {
  seq: AutoplaySequence;
  /** Page title, also the lock-screen title (Media Session). */
  title: string;
  ayah: number;
  surahName: string;
  /** The surah after this one, for the end card (null after the last). */
  nextSurah: { slug: string; name: string } | null;
  words: PlayerWord[];
  sources: StageSource[];
  /** The ayah's translation with footnotes and source, rendered by the page. */
  translation: ReactNode;
  /** What the exercises need inside the stage. */
  exercise: StageExerciseData;
}) {
  const t = useTranslations("Guided");
  const tp = useTranslations("Player");
  const tx = useTranslations("Exercise");
  const uid = useId();
  const ap = useAutoplay(seq, sources, title);
  const { state, view, actions, player: p } = ap;

  const [offscreen, setOffscreen] = useState<Offscreen>(null);
  const [barHeight, setBarHeight] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  /** The previous step was an exercise (to catch focus it leaves behind). */
  const wasExerciseRef = useRef(false);

  const started = state.started;
  const finished = state.phase === "finished";
  const live = started && !finished;
  const showBar = live;

  // The sticky bar's height: the spotlight's "out of view" line.
  useEffect(() => {
    const el = barRef.current;
    if (!showBar || !el) return;
    const ro = new ResizeObserver(() => setBarHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [showBar]);

  const step = view.step;
  const spec = live ? step.exercise : undefined;
  const exerciseKey = spec?.key;
  const focusIndex = live ? (view.focusWord ?? undefined) : undefined;
  const focusWord = focusIndex === undefined ? undefined : words.find((w) => w.index === focusIndex);
  // The words the screen marks on the numbered mushaf line: the word being
  // explained, and the places the line on screen names ("kata kedua").
  const marked = live ? [...new Set([...(focusIndex === undefined ? [] : [focusIndex]), ...view.refWords])] : [];
  const showMushaf = !started || (live && !spec);
  const spotGuides = spec ? state.guides.filter((g) => g.target.startsWith("exercise:")) : [];
  const skipGuide = view.showSkip ? state.guides.find((g) => g.target === "skip") : undefined;
  const lanjutGuide = view.showLanjut ? state.guides.find((g) => g.target === "lanjut") : undefined;
  const exerciseSteps = seq.steps.filter((s) => s.kind === "exercise");
  const exerciseN = exerciseSteps.findIndex((s) => s.id === step.id) + 1;
  const pace = started ? state.pace : ap.pace;
  const lessonAudio = state.activity?.kind === "recite";
  const idlePlaying = p.playing && !lessonAudio;
  const source = sources[p.sourceIdx];
  const pct = Math.round(((view.index + 1) / view.total) * 100);

  const modeLabel =
    state.phase === "paused"
      ? t("paused")
      : spec
        ? t("mode_exercise")
        : pace === "tunggu"
          ? t("mode_wait")
          : t("mode_auto", { pace: t(`pace_${pace}`) });

  // The middle control: the one thing to do next in this state. Render
  // reads only this plain mode; the handler is chosen at click time.
  const middle = state.phase === "ready" ? "lanjut" : state.phase === "paused" ? "resume" : "pause";
  const middleLabel = { lanjut: t("next_wait"), resume: t("resume"), pause: t("pause") }[middle];
  const onMiddle = () => {
    if (middle === "lanjut") actions.lanjut();
    else if (middle === "resume") actions.resume();
    else actions.pause();
  };

  const guided = exerciseKey
    ? {
        onAnswer: (correct: boolean) => actions.answered(exerciseKey, correct),
        onDone: () => actions.exerciseDone(exerciseKey),
        onGuide: (target: string, info?: { word?: number }) => actions.exerciseGuide(target, info?.word),
        // The lesson moves a settled question on, and recites Dengar dan
        // ketuk's word itself: the learner only answers.
        advance: state.exercise?.advance ?? 0,
        heard: state.exercise?.heard ?? null,
      }
    : null;

  // An exercise just ended and took the focus with it (its last control
  // unmounted): put focus on the caption, so keyboard and screen-reader
  // users keep their place. Never scrolls.
  const isExerciseStep = !!spec;
  useEffect(() => {
    const was = wasExerciseRef.current;
    wasExerciseRef.current = isExerciseStep;
    if (!was || isExerciseStep) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    captionRef.current?.focus({ preventScroll: true });
  }, [step.id, isExerciseStep]);

  /** "Lihat bagian yang ditandai": the only scroll, and only on a tap. */
  const showTarget = () => {
    const g = spotGuides[0];
    const el = g ? areaRef.current?.querySelector(guideSelector(g.target)) : null;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  return (
    // overflow-x-clip: a backstop so nothing drawn over the stage (a
    // spotlight label at the largest text size) can make the page scroll
    // sideways; `clip` keeps the controls bar sticky.
    <div data-autoplay="stage" className="overflow-x-clip rounded-2xl border border-hairline bg-white shadow-sm">
      <section
        ref={areaRef}
        aria-labelledby={`${uid}-guided`}
        className="relative isolate rounded-t-2xl px-4 pt-4 pb-5 sm:px-7 sm:pt-7"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={`${uid}-guided`} className="font-display text-2xl font-medium">
            {t("title")}
          </h2>
          {live && (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
              <span className="tabular-nums">{t("step", { n: view.index + 1, total: view.total })}</span>
              <span aria-hidden>·</span>
              <span>{modeLabel}</span>
            </p>
          )}
        </div>
        {live && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
            <div className="h-full bg-forest motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}

        {showMushaf && (
          <>
            <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm text-ink-muted">
              <Volume2 aria-hidden className="h-5 w-5 shrink-0 text-forest" />
              {tp("hint_tap")}
            </p>
            <div className="mt-3">
              <MushafLine
                ayah={ayah}
                words={words}
                activeWord={p.activeWord}
                marked={marked}
                numbered={live}
                canPlay={p.hasWord}
                onTap={(i) => {
                  actions.takeOverPlayer();
                  p.playWord(i);
                }}
              />
            </div>
          </>
        )}

        {/* Context: the word being learned, else the translation. */}
        {focusWord ? (
          <div
            data-guide="word-card"
            className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-paper-deep px-4 py-2"
          >
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
        ) : showMushaf ? (
          <div className="mx-auto mt-5 max-w-prose">{translation}</div>
        ) : null}

        {!started ? (
          <div className="mt-6 border-t border-hairline pt-5">
            {/* A remembered place makes "Lanjutkan dari langkah N" the big
                button: a habitual tap on the primary one keeps the place. */}
            <div className="flex flex-wrap gap-3">
              {ap.savedIdx !== null && (
                <button
                  type="button"
                  data-autoplay="resume"
                  onClick={() => actions.start(ap.savedIdx ?? 0)}
                  className="btn-primary w-full sm:w-auto sm:min-w-56"
                >
                  <Play aria-hidden className="h-5 w-5" />
                  <span>{t("resume_from", { n: ap.savedIdx + 1 })}</span>
                </button>
              )}
              <button
                type="button"
                data-autoplay="start"
                onClick={() => actions.start()}
                className={clsx(ap.savedIdx === null ? "btn-primary" : "btn-secondary", "w-full sm:w-auto sm:min-w-56")}
              >
                {ap.savedIdx === null ? (
                  <>
                    <Play aria-hidden className="h-5 w-5" />
                    <span>{t("start")}</span>
                  </>
                ) : (
                  <>
                    <RotateCcw aria-hidden className="h-5 w-5" />
                    <span>{t("start_over")}</span>
                  </>
                )}
              </button>
            </div>
            <p className="mt-3 max-w-prose text-pretty text-base text-ink">{t("start_hint")}</p>
          </div>
        ) : finished ? (
          state.intent?.kind === "surah_end" ? (
            <SurahEndCard
              surahName={surahName}
              nextSurah={nextSurah}
              onRepeat={() => continueToAyah(ap.router, seq.slug, 1)}
              onNextSurah={() => nextSurah && continueToAyah(ap.router, nextSurah.slug, 1)}
            />
          ) : state.intent?.kind === "ayah" ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3" role="status">
              <p className="text-xl text-ink">{t("going_next", { n: state.intent.ayah })}</p>
              <Link href={ayahHref(state.intent.slug, state.intent.ayah)} className="btn-secondary">
                {t("open_next", { n: state.intent.ayah })}
                <ChevronRight aria-hidden className="h-5 w-5" />
              </Link>
            </div>
          ) : null
        ) : (
          <>
            {spec && (
              <p
                key={step.id}
                ref={focusIntoExercise}
                tabIndex={-1}
                className="mt-4 text-base font-semibold text-ink"
              >
                {t("exercise_heading", {
                  n: exerciseN,
                  total: exerciseSteps.length,
                  title: tx(EXERCISE_TITLE_KEY[spec.key]),
                })}
              </p>
            )}
            {/* The caption is plain text (it may show transliteration). A
                screen reader is told the sanitised spoken text instead, in
                its own live region: nothing while the imam recites or the
                narration speaks, nor "Benar." (the exercise's status box
                says that). */}
            <p
              ref={captionRef}
              tabIndex={-1}
              data-autoplay="caption"
              className={clsx(
                "max-w-prose text-pretty text-xl text-ink",
                spec ? "mt-2 min-h-[3em]" : "mt-4 min-h-[5.5em]",
              )}
            >
              {ap.caption}
            </p>
            {spec && guided && (
              <div data-autoplay="exercise" className="mt-4 pt-3">
                <GuidedExercise
                  key={step.id}
                  exercise={spec.key}
                  progressId={spec.progressId}
                  data={exercise}
                  tapWords={words}
                  tapSource={sources[0]}
                  guided={guided}
                />
              </div>
            )}
          </>
        )}

        {/* Always in the page, so a screen reader is listening before the
            first line: the sanitised spoken text of each line as it starts. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {live ? ap.announcement : ""}
        </p>

        {ap.blocked && (
          <p role="status" className="mt-4 max-w-prose rounded-xl bg-notice-bg px-4 py-3 text-base text-ink">
            {t("blocked")}
          </p>
        )}
        {view.error === "recite" && (
          <p role="status" className="mt-4 max-w-prose rounded-xl bg-notice-bg px-4 py-3 text-base text-ink">
            {t("recite_failed")}
          </p>
        )}

        {spotGuides.length > 0 && (
          <Spotlight
            guides={spotGuides}
            pulse={state.exercise?.reminders ?? 0}
            bottomInset={barHeight}
            onOffscreen={setOffscreen}
          />
        )}
      </section>

      {/* Controls: sticky at the bottom of the viewport while the stage is
          on screen. DOM order = phone order (the main control on its own
          row, then ‹ Sebelumnya · Berikutnya ›); from sm the order
          utilities put it between them. */}
      {showBar && (
        <div
          ref={barRef}
          className="sticky bottom-0 z-20 border-t border-hairline bg-white/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_rgb(27_26_23/0.08)] backdrop-blur-sm sm:px-7"
        >
          {offscreen && spotGuides.length > 0 && (
            <button type="button" onClick={showTarget} className="btn-secondary mb-3 w-full">
              {offscreen === "below" ? (
                <ArrowDown aria-hidden className="h-5 w-5" />
              ) : (
                <ArrowUp aria-hidden className="h-5 w-5" />
              )}
              {t("show_target")}
            </button>
          )}
          <div role="group" aria-label={t("controls_label")} className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:order-2 sm:w-auto sm:grow">
              {lanjutGuide && <BarSpotLabel label={lanjutGuide.label} />}
              <button
                ref={focusOnMount}
                type="button"
                data-autoplay="middle"
                data-guide={middle === "lanjut" ? "lanjut" : undefined}
                onClick={onMiddle}
                className={clsx(
                  middle === "pause" ? "btn-secondary" : "btn-primary",
                  "w-full min-h-14!",
                  lanjutGuide && BAR_RING,
                )}
              >
                {middle === "pause" ? (
                  <Pause aria-hidden className="h-5 w-5" />
                ) : middle === "lanjut" ? (
                  <ChevronRight aria-hidden className="h-5 w-5" />
                ) : (
                  <Play aria-hidden className="h-5 w-5" />
                )}
                {middleLabel}
              </button>
            </div>
            <button
              type="button"
              data-autoplay="prev"
              onClick={() => {
                if (view.index > 0) actions.prev();
              }}
              aria-disabled={view.index === 0}
              className="btn-secondary grow px-3! sm:order-1 sm:px-5!"
            >
              <ChevronLeft aria-hidden className="h-5 w-5" />
              {t("prev")}
            </button>
            <div className="relative grow sm:order-3">
              {skipGuide && <BarSpotLabel label={skipGuide.label} align="end" />}
              <button
                type="button"
                data-autoplay="next"
                data-guide={view.showSkip ? "skip" : undefined}
                onClick={actions.forward}
                className={clsx(
                  // Narrower side padding on phones keeps ‹ Sebelumnya and
                  // this button on one row at the normal text size.
                  "btn-secondary w-full px-3! sm:px-5!",
                  view.showSkip && "min-h-14! font-semibold",
                  skipGuide && BAR_RING,
                )}
              >
                {view.showSkip ? (
                  <>
                    <SkipForward aria-hidden className="h-5 w-5" />
                    {t("skip")}
                  </>
                ) : (
                  <>
                    {t("next")}
                    <ChevronRight aria-hidden className="h-5 w-5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings: pace, the imam, text size — always visible, labelled. */}
      <div data-autoplay="settings" className="rounded-b-2xl border-t border-hairline px-4 py-5 sm:px-7">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <SlidersHorizontal aria-hidden className="h-5 w-5 shrink-0 text-forest" />
          {t("settings")}
        </h3>

        <fieldset className="mt-3">
          <legend className="text-base font-semibold text-ink">{t("pace_heading")}</legend>
          {/* A drawn radio with a tick and the word "Dipilih", never colour
              alone (same pattern as TextSizeOptions). */}
          <div className="@container mt-2">
            <div className="grid gap-3 @xl:grid-cols-3">
              {PACES.map((v) => {
                const on = pace === v;
                return (
                  <label
                    key={v}
                    className={clsx(
                      "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2",
                      on ? "border-2 border-forest bg-forest-tint" : "border-[1.5px] border-border-ui bg-white hover:border-forest",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${uid}-pace`}
                      value={v}
                      checked={on}
                      onChange={() => actions.setPace(v)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={clsx(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2",
                        on ? "border-forest bg-forest text-paper" : "border-border-ui bg-white",
                      )}
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

        {/* The imam's recitation: listen freely, speed, reciter. */}
        <div role="group" aria-labelledby={`${uid}-imam`} className="mt-6">
          <p id={`${uid}-imam`} className="text-base font-semibold text-ink">
            {tp("heading")}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                if (idlePlaying) {
                  p.pause();
                  return;
                }
                actions.takeOverPlayer();
                p.playAll();
              }}
              className="btn-secondary"
            >
              {idlePlaying ? <Pause aria-hidden className="h-5 w-5" /> : <Play aria-hidden className="h-5 w-5" />}
              {idlePlaying ? tp("pause") : tp("play_ayah")}
            </button>
            <button
              type="button"
              onClick={() => {
                actions.takeOverPlayer();
                p.restart();
              }}
              className="btn-secondary"
            >
              <RotateCcw aria-hidden className="h-5 w-5" />
              {tp("restart")}
            </button>
            <button
              type="button"
              onClick={() => ap.setImamRate(ap.imamRate === 1 ? 0.75 : 1)}
              className="btn-secondary"
            >
              <Gauge aria-hidden className="h-5 w-5" />
              {tp("speed", { speed: ap.imamRate === 1 ? tp("speed_normal") : tp("speed_slow") })}
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
                  // Switching reciters stops the recording in play: pause
                  // the lesson rather than wait for audio that won't end.
                  if (lessonAudio) actions.pause();
                  p.chooseSource(Number(e.target.value));
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

          {p.failed && view.error !== "recite" && (
            <p role="status" className="mt-4 max-w-prose rounded-xl bg-notice-bg px-4 py-3 text-base text-ink">
              {tp("failed")}
            </p>
          )}
          {/* Recitation streams from the reciter's CDN; never re-hosted (plan §6.2). */}
          <p className="mt-3 text-xs text-ink-soft">{source?.credit}</p>
        </div>

        <details className="mt-6 rounded-xl border border-hairline bg-paper">
          <summary className="disclosure-row px-4 py-2">
            <span>{t("text_size")}</span>
            <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
          </summary>
          <div className="px-4 pt-2 pb-5">
            <TextSizeOptions />
          </div>
        </details>

        <p className="mt-4 max-w-prose text-sm text-ink-muted">
          {seq.hasAudio ? t("note_voice") : t("note_captions")} {t("note_imam")}
        </p>
      </div>
    </div>
  );
}
