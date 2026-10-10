"use client";

import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipForward,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { CaptionView } from "@/components/autoplay/CaptionView";
import { EXERCISE_TITLE_KEY, GuidedExercise, type StageExerciseData } from "@/components/autoplay/GuidedExercise";
import { type Offscreen, Spotlight } from "@/components/autoplay/Spotlight";
import { SurahEndCard } from "@/components/autoplay/SurahEndCard";
import { continueToAyah, PLAY_WORD_EVENT, useAutoplay } from "@/components/autoplay/useAutoplay";
import { guideSelector } from "@/components/exercises/guide";
import { MixedText } from "@/components/library/MixedText";
import { TextSizeOptions } from "@/components/TextSizeSwitch";
import type { RecitationSource } from "@/hooks/useSegmentPlayer";
import { Link } from "@/i18n/navigation";
import type { AutoplaySequence } from "@/lib/autoplay";
import { PACES } from "@/lib/lessonSteps";
import { ayahHref } from "@/lib/routes";

import { MushafLine, type PlayerWord } from "./AyahPlayer";
import { type StageCompose, WordComposition } from "./WordComposition";

/** A recording the stage can play, with its reciter's name for the select.
 *  Its credit line is on the Kredit page, not on the stage. */
export type StageSource = RecitationSource & { label: string };

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

/** The spotlight label of a control in the controls bar ("Klik di sini"
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
 * The lesson stage, now an AUTOPLAY player (operator, 2026-10-10): one click
 * on "Mulai" and the whole ayah plays from start to finish — narration
 * (caption-only until the narration audio is rendered), the imam's
 * recitation with the mushaf word lit as he recites it, every word
 * explained, the new concepts, then each exercise inside the stage with
 * voice + spotlight guidance, the recap, and on to the next ayah by itself.
 * Engine: src/lib/autoplay (pure state machine); runner: useAutoplay.
 *
 * Layout — ONE focused stage (operator, 2026-10-10: "too crowded … focus on
 * the main feature"), senior-friendly, nothing scrolls by itself:
 * - Before "Mulai": the ayah with its words numbered (1 rightmost, as "kata
 *   pertama"), the translation, ONE primary "▶ Mulai pelajaran" (56px) and
 *   one short line under it. A remembered place makes "Lanjutkan dari
 *   langkah N" the primary button, with "Mulai dari awal" beside it.
 * - While it plays: the mushaf line (highlights + number badges) and the
 *   word card (in a slot that keeps its height, empty between words; one
 *   compact row on phones), then the bottom panel — no other buttons, and
 *   no translation (it is shown before "Mulai"). The step's content swaps
 *   in place (the prompt + the exercise while practising), so the page
 *   never moves under the learner. If the "Mulai" click leaves the card
 *   under the panel (a phone), that click brings the stage up once.
 * - The bottom panel is sticky at the bottom of the viewport while the
 *   stage is on screen (a familiar media player with subtitles): the
 *   karaoke caption (an exercise's prompt stays above the exercise
 *   instead), then ‹ Sebelumnya · Jeda / Lanjutkan · "↺ Ulangi langkah
 *   ini" (the current step again, from its start, also while paused) ·
 *   Berikutnya › (which becomes "Lewati latihan" during an exercise), at
 *   48–56px whatever the text size.
 * - A spotlit control that is out of view is never scrolled to
 *   automatically: the bar offers "Lihat bagian yang ditandai", which
 *   scrolls only on the learner's click.
 * - Every secondary control (pace Biasa / Pelan / Tunggu saya, the imam's
 *   speed, the reciter, text size) sits behind ONE labelled "⚙ Pengaturan"
 *   button at the top of the stage: an inline panel, closed by "Tutup
 *   pengaturan", Escape or the button again. The reciters' credit lines are
 *   on the Kredit page.
 *
 * The narrator never voices Qur'anic words (plan §6.1 A1): the caption
 * shows what is spoken — word by word as a karaoke caption once the
 * narration has word timings — with grammar terms as "na’t (نَعْت)" and a
 * letter as in the ayah (بِ). While the lesson runs, the mushaf line numbers
 * its words (1 rightmost, as "kata pertama") and highlights what the line on
 * screen is about: the whole ayah, the word explained, a concept's words,
 * the imam's current word as he recites. A large word card (Arabic ·
 * transliteration · "yang artinya …") sits above the caption while a word is
 * explained or recited; in its place, the harakat primer and a word's
 * COMPOSITION animation (operator 2026-10-10, narration rule 14: [بِ] +
 * [ٱسْمُ] → kasrah → joined → [بِسْمِ]) play frame by frame with their lines
 * (WordComposition; same slot, as tall as the word's tallest frame, so nothing
 * jumps between frames and nothing is clipped). A screen reader hears the line
 * without its Arabic
 * from a polite live region — never over the imam. The rest of the page
 * (word cards, Latihan, Pelajari lebih dalam) waits, collapsed, under the
 * stage in "Materi lengkap ayat ini".
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
  compose = null,
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
  /** This ayah's word compositions and harakat primer (content bytes), if any. */
  compose?: StageCompose | null;
}) {
  const t = useTranslations("Guided");
  const tp = useTranslations("Player");
  const tx = useTranslations("Exercise");
  const uid = useId();
  const ap = useAutoplay(seq, sources, title);
  const { state, view, actions, player: p } = ap;

  const [offscreen, setOffscreen] = useState<Offscreen>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardSlotRef = useRef<HTMLDivElement>(null);
  /** The previous step was an exercise (to catch focus it leaves behind). */
  const wasExerciseRef = useRef(false);
  /** The learner just clicked "Mulai" / "Lanjutkan dari langkah N". */
  const startClickRef = useRef(false);

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
  // What the line on screen is about (caption.ts stageMarks): the words the
  // numbered mushaf line marks, and the word of the large word card.
  const focusWord = ap.marks.focus === null ? undefined : words.find((w) => w.index === ap.marks.focus);
  const marked = ap.marks.marked;
  // The animation in the card's slot: the primer, or the word's composition.
  const anim = ap.frame && compose ? (ap.frame.step === "primer" ? compose.primer : ap.frame.word ? compose.words[ap.frame.word] : null) : null;
  const showMushaf = !started || (live && !spec);
  const spotGuides = spec ? state.guides.filter((g) => g.target.startsWith("exercise:")) : [];
  const skipGuide = view.showSkip ? state.guides.find((g) => g.target === "skip") : undefined;
  const lanjutGuide = view.showLanjut ? state.guides.find((g) => g.target === "lanjut") : undefined;
  const exerciseSteps = seq.steps.filter((s) => s.kind === "exercise");
  const exerciseN = exerciseSteps.findIndex((s) => s.id === step.id) + 1;
  const pace = started ? state.pace : ap.pace;
  const lessonAudio = state.activity?.kind === "recite";
  const pct = Math.round(((view.index + 1) / view.total) * 100);
  const settingsId = `${uid}-settings`;

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
        // klik's word itself: the learner only answers.
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

  /** "Mulai pelajaran" / "Lanjutkan dari langkah N" (the learner's click). */
  const begin = (from?: number) => {
    startClickRef.current = true;
    actions.start(from);
  };

  // Right after that click (and only then), bring the stage up when the
  // learner could not see the words and the word card above the bottom
  // panel: on a phone the "Mulai" button sits low on the stage, and the
  // panel (caption + controls) would cover the card. The one scroll the
  // lesson makes on its own, and only on the learner's click — like "Lihat
  // bagian yang ditandai".
  useEffect(() => {
    if (!started || !startClickRef.current) return;
    startClickRef.current = false;
    const stage = stageRef.current;
    const slot = cardSlotRef.current;
    const bar = barRef.current;
    if (!stage || !slot || !bar) return;
    const covered = slot.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1;
    if (stage.getBoundingClientRect().top >= 0 && !covered) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stage.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [started]);

  /** "Tutup pengaturan" / Escape: close the panel, focus back on its button. */
  const closeSettings = () => {
    setSettingsOpen(false);
    settingsButtonRef.current?.focus({ preventScroll: true });
  };

  /** "Lihat bagian yang ditandai": the only scroll, and only on a click. */
  const showTarget = () => {
    const g = spotGuides[0];
    const el = g ? areaRef.current?.querySelector(guideSelector(g.target)) : null;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  // The caption shows what is spoken: karaoke words following the narrator
  // once the narration has word timings, else the line's text. A screen
  // reader is told the line without its Arabic instead, in its own live
  // region: nothing while the imam recites or the narration speaks, nor
  // "Benar." (the exercise's status box says that). In the bottom panel it
  // keeps three lines' height, so the panel's edge does not jump per line.
  const caption = (
    <p
      ref={captionRef}
      tabIndex={-1}
      data-autoplay="caption"
      className={clsx(
        "mx-auto max-w-prose text-pretty text-xl text-ink",
        spec ? "mt-2 min-h-[3em]" : "min-h-[4.2em]",
      )}
    >
      <CaptionView caption={ap.caption} />
    </p>
  );

  // Notices: in the bottom panel while it shows (where the learner's eyes
  // and the controls that answer them are), else under the stage.
  const notice = clsx(
    "mx-auto max-w-prose rounded-xl bg-notice-bg px-4 py-3 text-base text-ink",
    showBar ? "mb-3" : "mt-4",
  );
  const notices = (
    <>
      {ap.blocked && (
        <p role="status" className={notice}>
          {t("blocked")}
        </p>
      )}
      {view.error === "recite" && (
        <p role="status" className={notice}>
          {t("recite_failed")}
        </p>
      )}
      {/* A word the learner clicked to hear could not stream (only theirs:
          the lesson's own recitation failing says so above, and a step
          change or replay hands the player back to the lesson). */}
      {p.failed && ap.learnerWord && view.error !== "recite" && (
        <p role="status" className={notice}>
          {tp("failed")}
        </p>
      )}
    </>
  );

  return (
    // overflow-x-clip: a backstop so nothing drawn over the stage (a
    // spotlight label at the largest text size) can make the page scroll
    // sideways; `clip` keeps the controls bar sticky.
    <div ref={stageRef} data-autoplay="stage" className="stage-card scroll-mt-2 overflow-x-clip">
      <h2 id={`${uid}-guided`} className="sr-only">
        {t("title")}
      </h2>

      {/* Head: where the lesson is, and the ONE door to every secondary
          control. Outside the spotlight's area, so it is never dimmed. */}
      {/* Escape closes the settings from anywhere in the head, the toggle
          included (focus stays on it when the panel opens). */}
      <div
        className="px-4 pt-4 sm:px-7 sm:pt-5"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !settingsOpen) return;
          e.stopPropagation();
          closeSettings();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {live && (
            <p data-autoplay="step" className="text-sm text-ink-muted tabular-nums">{t("step", { n: view.index + 1, total: view.total })}</p>
          )}
          <button
            ref={settingsButtonRef}
            type="button"
            data-autoplay="settings-toggle"
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            onClick={() => setSettingsOpen((o) => !o)}
            className="btn-secondary ml-auto px-4! sm:px-5!"
          >
            <Settings aria-hidden className="h-5 w-5" />
            {t("settings_button")}
          </button>
        </div>
        {live && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
            <div className="h-full bg-forest motion-safe:transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}

        {/* Settings: pace, the imam, text size — labelled, behind the one
            button. Always in the page (hidden when closed), so the button's
            aria-controls names a real element. */}
        <div
          id={settingsId}
          data-autoplay="settings"
          role="region"
          aria-label={t("settings")}
          hidden={!settingsOpen}
          className="mt-4 rounded-2xl border border-hairline bg-paper px-4 py-5 sm:px-6"
        >
          <p className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Settings aria-hidden className="h-5 w-5 shrink-0 text-forest" />
            {t("settings")}
          </p>

          <fieldset className="mt-4">
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

          {/* The imam's recitation: speed and reciter. */}
          <div role="group" aria-labelledby={`${uid}-imam`} className="mt-6">
            <p id={`${uid}-imam`} className="text-base font-semibold text-ink">
              {tp("heading")}
            </p>
            <button
              type="button"
              onClick={() => ap.setImamRate(ap.imamRate === 1 ? 0.75 : 1)}
              className="btn-secondary mt-2"
            >
              <Gauge aria-hidden className="h-5 w-5" />
              {tp("speed", { speed: ap.imamRate === 1 ? tp("speed_normal") : tp("speed_slow") })}
            </button>

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
          </div>

          <div className="mt-6">
            <TextSizeOptions showLegend />
          </div>

          <button type="button" onClick={closeSettings} className="btn-secondary mt-6">
            <X aria-hidden className="h-5 w-5" />
            {t("settings_close")}
          </button>
        </div>
      </div>

      <section ref={areaRef} aria-labelledby={`${uid}-guided`} className="relative isolate px-4 pt-3 pb-6 sm:px-7">
        {showMushaf && (
          <div className="mt-2">
            <MushafLine
              ayah={ayah}
              words={words}
              activeWord={p.activeWord}
              marked={marked}
              numbered
              canPlay={p.hasWord}
              onTap={(i) => {
                actions.takeOverPlayer();
                p.playWord(i);
              }}
            />
          </div>
        )}

        {/* Before "Mulai": the translation. While the lesson plays: the
            WORD CARD while a word is explained or recited — its Arabic
            (content bytes, never retyped), transliteration and "yang artinya
            …" — and otherwise nothing, in a slot that keeps the card's
            height, so nothing below jumps from step to step (the playing
            stage is the words, the card, then the caption and the controls
            in the bottom panel). Phones: one compact row, the Arabic on the
            right of its number, transliteration and meaning, so the words,
            the card and the panel fit one screen — while the longest of
            those words fits beside the Arabic; when it does not (large text
            sizes), the Arabic takes a row of its own above them instead of
            the words running into it (flex-wrap on their min-content; line
            breaks, 2026-10-10). From sm: stacked, centred. */}
        {!started ? (
          <div className="mx-auto mt-5 max-w-prose">{translation}</div>
        ) : live && !spec ? (
          <div ref={cardSlotRef} className="mt-4 min-h-36 sm:min-h-56">
            {anim && ap.frame && compose ? (
              <WordComposition
                unit={anim}
                kind={ap.frame.step}
                frame={ap.frame.frame}
                recited={ap.frame.recited}
                marks={compose.marks}
                word={ap.frame.word}
                stepKey={step.id}
              />
            ) : focusWord ? (
              <div
                data-guide="word-card"
                data-autoplay="word-card"
                className="mx-auto flex max-w-xl flex-wrap-reverse items-center gap-x-4 gap-y-1 rounded-2xl border-[1.5px] border-forest bg-forest-tint px-4 py-2 sm:flex-col sm:flex-nowrap sm:py-3 sm:text-center"
              >
                <div className="flex-[1_1_min-content] sm:contents">
                  <p className="text-base font-semibold text-forest sm:order-1">{t("word_n", { n: focusWord.index })}</p>
                  {/* MixedText: "al-ḥamdu", "orang-orang" are never cut at the hyphen while
                      they fit the column (line breaks, operator 2026-10-10). */}
                  <p className="text-lg text-ink-muted sm:order-3">
                    <MixedText text={focusWord.translit} />
                  </p>
                  <p className="text-xl font-semibold text-pretty text-ink sm:order-4">
                    <MixedText text={t("card_meaning", { gloss: focusWord.gloss })} />
                  </p>
                </div>
                <p lang="ar" dir="rtl" className="quran ml-auto text-ar-lg text-ink sm:order-2 sm:ml-0 sm:text-ar-xl">
                  {focusWord.ar}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {!started ? (
          <div className="mt-6 flex flex-col items-center border-t border-hairline pt-6 text-center">
            {/* A remembered place makes "Lanjutkan dari langkah N" the big
                button: a habitual click on the primary one keeps the place. */}
            <div className="flex w-full flex-wrap justify-center gap-3">
              {ap.savedIdx !== null && (
                <button
                  type="button"
                  data-autoplay="resume"
                  onClick={() => begin(ap.savedIdx ?? 0)}
                  className="btn-primary w-full sm:w-auto sm:min-w-64"
                >
                  <Play aria-hidden className="h-5 w-5" />
                  <span>{t("resume_from", { n: ap.savedIdx + 1 })}</span>
                </button>
              )}
              <button
                type="button"
                data-autoplay="start"
                onClick={() => begin()}
                className={clsx(ap.savedIdx === null ? "btn-primary" : "btn-secondary", "w-full sm:w-auto sm:min-w-64")}
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
            <p className="mt-3 max-w-prose text-pretty text-base text-ink-muted">{t("start_hint")}</p>
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
                {/* "Latihan 2 dari 5 · …": the dot never starts a line (line breaks, 2026-10-10). */}
                <MixedText
                  text={t("exercise_heading", {
                    n: exerciseN,
                    total: exerciseSteps.length,
                    title: tx(EXERCISE_TITLE_KEY[spec.key]),
                  })}
                />
              </p>
            )}
            {/* An exercise's prompt stays above the exercise it explains;
                every other line's caption is in the bottom panel. */}
            {spec && caption}
            {spec && guided && (
              <div data-autoplay="exercise" className="mt-4 pt-3">
                <GuidedExercise
                  // A replayed exercise starts over (fresh, at its first question).
                  key={`${step.id}:${ap.replays}`}
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

        {!showBar && notices}

        {spotGuides.length > 0 && (
          <Spotlight
            guides={spotGuides}
            pulse={state.exercise?.reminders ?? 0}
            bottomInset={barHeight}
            onOffscreen={setOffscreen}
          />
        )}
      </section>

      {/* The bottom panel: sticky at the bottom of the viewport while the
          stage is on screen, so what the narrator says and the controls
          never scroll away — on a phone the words and the card above are
          taller than the screen, and a caption in the page sat below the
          fold, behind the controls (CI shot, 2026-10-10). In order: a
          notice (sound blocked, a recording failed), the caption (not
          during an exercise: its prompt stays above it), then the controls.
          Phones: two rows — the main control with "↺ Ulangi" beside it,
          then ‹ Sebelumnya · Berikutnya ›. From sm the two row wrappers
          dissolve (display: contents) and the order utilities line all four
          up: ‹ Sebelumnya · main · ↺ Ulangi langkah ini · Berikutnya ›. */}
      {showBar && (
        <div
          ref={barRef}
          data-autoplay="panel"
          className="sticky bottom-0 z-20 rounded-b-2xl border-t border-hairline bg-white/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_28px_-14px_rgb(14_90_60/0.35)] backdrop-blur-sm sm:px-7"
        >
          {notices}
          {!spec && <div className="mb-4">{caption}</div>}
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
          <div
            role="group"
            aria-label={t("controls_label")}
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <div className="flex flex-wrap items-center gap-3 sm:contents">
              <div className="relative min-w-0 grow basis-40 sm:order-2 sm:basis-auto">
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
              {/* The current step again, from its start — also while
                  paused (it plays on from there). Phones show the short
                  word; the name is always the full "Ulangi langkah ini". */}
              <button
                type="button"
                data-autoplay="replay"
                onClick={actions.replay}
                aria-label={t("replay")}
                className="btn-secondary min-h-14! shrink-0 px-3! sm:order-3 sm:grow sm:px-5!"
              >
                <RotateCcw aria-hidden className="h-5 w-5" />
                <span aria-hidden className="sm:hidden">
                  {t("replay_short")}
                </span>
                <span aria-hidden className="hidden sm:inline">
                  {t("replay")}
                </span>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:contents">
              <button
                type="button"
                data-autoplay="prev"
                onClick={() => {
                  if (view.index > 0) actions.prev();
                }}
                aria-disabled={view.index === 0}
                className="btn-secondary grow px-2.5! sm:order-1 sm:px-5!"
              >
                <ChevronLeft aria-hidden className="h-5 w-5" />
                {t("prev")}
              </button>
              <div className="relative grow sm:order-4">
                {skipGuide && <BarSpotLabel label={skipGuide.label} align="end" />}
                <button
                  type="button"
                  data-autoplay="next"
                  data-guide={view.showSkip ? "skip" : undefined}
                  onClick={actions.forward}
                  className={clsx(
                    // Narrower side padding on phones (and no skip icon)
                    // keeps ‹ Sebelumnya and this button — "Lewati latihan"
                    // too, a label the voice says in full — on one row at
                    // the normal text size.
                    "btn-secondary w-full px-2.5! sm:px-5!",
                    view.showSkip && "min-h-14! font-semibold",
                    skipGuide && BAR_RING,
                  )}
                >
                  {view.showSkip ? (
                    <>
                      <SkipForward aria-hidden className="hidden h-5 w-5 sm:block" />
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
        </div>
      )}
    </div>
  );
}
