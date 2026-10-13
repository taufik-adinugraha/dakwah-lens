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

import { captionCue } from "@/components/autoplay/caption";
import { CaptionView } from "@/components/autoplay/CaptionView";
import { EXERCISE_TITLE_KEY, GuidedExercise, type StageExerciseData } from "@/components/autoplay/GuidedExercise";
import { type Offscreen, Spotlight } from "@/components/autoplay/Spotlight";
import { SurahEndCard } from "@/components/autoplay/SurahEndCard";
import { continueToAyah, PLAY_WORD_EVENT, useAutoplay } from "@/components/autoplay/useAutoplay";
import { type SurahRef, useUpNext } from "@/components/autoplay/useUpNext";
import { guideSelector } from "@/components/exercises/guide";
import { MixedText } from "@/components/library/MixedText";
import { TextSizeOptions } from "@/components/TextSizeSwitch";
import type { ComposeFile } from "@/content/compose-schema";
import type { RecitationSource } from "@/hooks/useSegmentPlayer";
import { Link } from "@/i18n/navigation";
import { MAP_GROUPS, type AutoplaySequence, type LessonMapInput, type StageExample } from "@/lib/autoplay";
import { glossSlot } from "@/lib/emphasis";
import { PACES } from "@/lib/lessonSteps";
import { ayahHref } from "@/lib/routes";

import { MushafLine, type PlayerWord } from "./AyahPlayer";
import { ExampleCard, type ExampleCardState } from "./ExampleCard";
import { LessonMapCard, type LessonMapCardGroup } from "./LessonMapCard";
import { type StageCompose, WordComposition } from "./WordComposition";

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

/** The loading mark (operator 2026-10-11, narration rule 19): a turning ring, or with reduced
 *  motion a still dot (senior-ux §3.8). Never the only cue: the words beside it say what loads. */
function LoadingMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("relative inline-block h-5 w-5 shrink-0", className)}>
      <span className="absolute inset-0 rounded-full border-[2.5px] border-current border-t-transparent motion-safe:animate-spin motion-reduce:hidden" />
      <span className="absolute inset-[0.3125rem] hidden rounded-full bg-current motion-reduce:block" />
    </span>
  );
}

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
 *   under the panel (a phone), that click brings the stage up once; and
 *   the card's slot sticks just above the panel, so where the screen is
 *   too short for the words, the card and the panel, the card covers the
 *   end of the mushaf line rather than the panel covering the card.
 * - The bottom panel is sticky at the bottom of the viewport while the
 *   stage is on screen (a familiar media player with subtitles): the
 *   karaoke caption (an exercise's prompt stays above the exercise
 *   instead), then ‹ Sebelumnya · Jeda / Lanjutkan · "↺ Ulangi langkah
 *   ini" (the current step again, from its start, also while paused) ·
 *   Berikutnya › (which becomes "Lewati latihan" during an exercise), at
 *   48–56px whatever the text size.
 * - Never a silent wait (operator 2026-10-11: "sometimes it takes time for
 *   autoplay to run … there is no info to user, user is confused what
 *   happen and dont know what to do"; narration rule 19). The "Mulai" click
 *   answers at once — its button says "Menyiapkan pelajaran…" with a
 *   turning mark (busy, further clicks ignored) until the first line is
 *   heard or shown, and only then does the playing stage replace it. While
 *   the lesson plays, a narration file or the imam's recitation that takes
 *   longer than 0.6 s to start (or stalls) is named in the bottom panel,
 *   above the caption ("Memuat suara narator…" / "Memuat bacaan imam…"),
 *   and from 8 s with what to do ("… tunggu sebentar, atau klik ↺
 *   Ulangi"); it goes as soon as the sound plays.
 * - A spotlit control that is out of view is never scrolled to
 *   automatically: the bar offers "Lihat bagian yang ditandai", which
 *   scrolls only on the learner's click.
 * - Every secondary control (pace Biasa / Pelan / Tunggu saya, the imam's
 *   speed, text size) sits behind ONE labelled "⚙ Pengaturan" button at the
 *   top of the stage: an inline panel, closed by "Tutup pengaturan", Escape
 *   or the button again. No reciter to choose: one imam everywhere, Mishary
 *   Alafasy (operator 2026-10-13, plan L21: "better to use alafasy for all?
 *   no need to give option to user to change"); his credit line is on the
 *   Kredit page.
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
 *
 * EXAMPLES (operator 2026-10-12: "in principel, each explanation should be
 * followed by examples (visual + voice)", "not only for harakah, but also for
 * all rules"; plan L20; src/lib/autoplay/examples.ts): after each "Konsep
 * baru" line the concept's example in this ayah is shown in the word card's
 * slot (ExampleCard: "Contoh", the word big, its transliteration and meaning)
 * and the IMAM recites it, the mushaf line lighting it; in a word's
 * composition, when the bentuk dasar is ringed, the imam recites that base
 * form from where it stands in the Qur'an (its tile filled as he does) — "ismu
 * (read by voice + show visual) … becomes ismi (read by voice + visual)": the
 * joined word is the lesson's own, recited when its step opens and not again at
 * the end, except an ayah's last word, after the line that says the imam stops
 * on it (operator 2026-10-13, plan L24). The beat's caption, in the bottom
 * panel, says what is shown and what is heard ("Contoh: ismu, di QS 55:78 … :
 * bersama kata sebelumnya terdengar “tabārakasmu”."); the narrator says
 * nothing. A clip that takes long shows "Memuat bacaan imam…" like any
 * recitation; one that does not come is given up after a few seconds — the
 * example stays a moment with "Suara contoh ini belum bisa diputar." and the
 * lesson goes on by itself (never a dead stop).
 *
 * THE LESSON MAP (operator 2026-10-13: "at the beginning of the ayat, better to
 * inform what concept we will learn in this ayat … in the end recap what we've
 * learnt"; "if some concept already done in previous ayat, we say we repeat
 * what we've learnt before"; plan L23 — and, with the basic curriculum, "but
 * separate new vs already knows concept, this is what new, this is what we've
 * learnt so far"; plan L26; src/lib/autoplay/lessonMap.ts): in a surah that has
 * one, the steps after the imam's recitation say what the ayah brings, ONE
 * GROUP AT A TIME — "map:new" (what is new), "map:learnt" (everything learnt so
 * far, what comes up again here marked) and "map:later" (what is taught later,
 * and the next-level topics) — and the step before the recap ("learned") what
 * it taught, with the running total. While one of them is on, its card sits in
 * the word card's slot (LessonMapCard) and shows that step's group alone: new
 * and already-learnt are never on screen together. The narrator names a few of
 * a long group, the card lists every one. No word of the mushaf line is marked
 * meanwhile.
 */
export function LessonStage({
  seq,
  title,
  ayah,
  surahName,
  following,
  words,
  source,
  translation,
  exercise,
  compose = null,
  examples = {},
  marks = null,
  lessonMap = null,
}: {
  seq: AutoplaySequence;
  /** Page title, also the lock-screen title (Media Session). */
  title: string;
  ayah: number;
  surahName: string;
  /** The surahs after this one, in mushaf order, on a surah's last ayah only (else empty): the
   *  end card offers the first published one (useUpNext.ts). */
  following: SurahRef[];
  words: PlayerWord[];
  /** The ayah's recording and its word timings: the one imam's (plan L21). */
  source: RecitationSource;
  /** The ayah's translation with footnotes and source, rendered by the page. */
  translation: ReactNode;
  /** What the exercises need inside the stage. */
  exercise: StageExerciseData;
  /** This ayah's word compositions and harakat primer (content bytes), if any. */
  compose?: StageCompose | null;
  /** What each example beat of this lesson shows (content bytes), by beat id. */
  examples?: Readonly<Record<string, StageExample>>;
  /** The marks an example can name with its sound (content/compose `marks`), if the surah has them. */
  marks?: ComposeFile["marks"] | null;
  /** This ayah's lesson map (content/map: what is new, learnt so far, taught later, next-level), if the surah has one. */
  lessonMap?: LessonMapInput | null;
}) {
  const t = useTranslations("Guided");
  const tp = useTranslations("Player");
  const tx = useTranslations("Exercise");
  /** The word card's "yang artinya “…”", its gloss emphasised (glossSlot). */
  const cardMeaning = (gloss: string) => glossSlot((g) => t("card_meaning", { gloss: g }), gloss);
  const uid = useId();
  const ap = useAutoplay(seq, source, title);
  const { state, view, actions, player: p } = ap;
  const upNext = useUpNext(following);
  // "Mulai" clicked and its first line not heard yet: the stage before "Mulai" stays, its button
  // saying "Menyiapkan pelajaran…" (useAutoplay `preparing`); then the playing stage shows.
  const preparing = ap.preparing;
  /** Which start button was clicked (the one that says "Menyiapkan pelajaran…"). */
  const [pressed, setPressed] = useState<"start" | "resume" | null>(null);

  const [offscreen, setOffscreen] = useState<Offscreen>(null);
  const [barHeight, setBarHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const areaRef = useRef<HTMLElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const cardSlotRef = useRef<HTMLDivElement>(null);
  /** The previous step was an exercise (to catch focus it leaves behind). */
  const wasExerciseRef = useRef(false);
  /** The learner just clicked "Mulai" / "Lanjutkan dari langkah N". */
  const startClickRef = useRef(false);

  const started = state.started && !preparing;
  const finished = state.phase === "finished";
  const live = started && !finished;
  const showBar = live;

  // The sticky bar's height: the spotlight's "out of view" line, and the
  // card slot's sticky offset (--panel-h, set on the stage before the frame
  // is painted, so the card never sits under a panel that just grew).
  useEffect(() => {
    const el = barRef.current;
    const stage = stageRef.current;
    if (!showBar || !el) return;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      stage?.style.setProperty("--panel-h", `${h}px`);
      setBarHeight(h);
    });
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
  // The example beat on screen (caption.ts stageExample): what it is doing, and its drawing.
  const beat = live ? ap.example : null;
  const beatState: ExampleCardState | null = beat ? (beat.failed ? "failed" : beat.reciting ? "reciting" : "shown") : null;
  const beatDrawing = beat ? examples[beat.beat.id] : undefined;
  // The lesson map's card (plan L23, L26), in the word card's slot: the one group of the step that
  // is on — "map:new" / "map:learnt" / "map:later", or the closing.
  const mapGroup: LessonMapCardGroup | null =
    live && lessonMap ? (step.kind === "learned" ? "learned" : step.kind === "map" ? (MAP_GROUPS.find((g) => step.id === `map:${g}`) ?? null) : null) : null;
  const showMushaf = !started || (live && !spec);
  const spotGuides = spec ? state.guides.filter((g) => g.target.startsWith("exercise:")) : [];
  const skipGuide = view.showSkip ? state.guides.find((g) => g.target === "skip") : undefined;
  const lanjutGuide = view.showLanjut ? state.guides.find((g) => g.target === "lanjut") : undefined;
  const exerciseSteps = seq.steps.filter((s) => s.kind === "exercise");
  const exerciseN = exerciseSteps.findIndex((s) => s.id === step.id) + 1;
  const pace = started ? state.pace : ap.pace;
  const pct = Math.round(((view.index + 1) / view.total) * 100);
  const settingsId = `${uid}-settings`;
  // The step and the narration line on screen, named on the stage and the
  // caption (data-step, data-line): the CI checks reach a step by what it
  // is, never by counting clicks (the primer and compose steps moved them).
  const lineOnScreen = live ? (captionCue(seq, state)?.line ?? null) : null;

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
        // A right answer and "Tunjukkan jawaban" are voiced with that question's explanation; a
        // wrong pick is not (operator 2026-10-10).
        onAnswer: (correct: boolean, question?: number) => actions.answered(exerciseKey, correct, question),
        onReveal: (question?: number) => actions.revealed(exerciseKey, question),
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

  /** "Mulai pelajaran" / "Lanjutkan dari langkah N" (the learner's click);
   *  ignored while the lesson is being prepared (a double click). */
  const begin = (which: "start" | "resume", from?: number) => {
    if (preparing) return;
    setPressed(which);
    startClickRef.current = true;
    actions.start(from);
  };
  /** The clicked start button's content while the lesson is prepared. */
  const preparingLabel = (
    <>
      <LoadingMark />
      <span>{t("preparing")}</span>
    </>
  );

  // Right after that click (and only then: when its first line is heard or
  // shown, the playing stage appears), bring the stage up when the
  // learner could not see the words and the word card above the bottom
  // panel: on a phone the "Mulai" button sits low on the stage, and the
  // panel (caption + controls) would cover the card. The one scroll the
  // lesson makes on its own, and only on the learner's click — like "Lihat
  // bagian yang ditandai". Measured where the card's slot sits in the flow,
  // under the words: its sticky offset (below) would always place it above
  // the panel, hiding the words instead.
  useEffect(() => {
    if (!started || !startClickRef.current) return;
    startClickRef.current = false;
    const stage = stageRef.current;
    const words = wordsRef.current;
    const slot = cardSlotRef.current;
    const bar = barRef.current;
    if (!stage || !words || !slot || !bar) return;
    const slotBottom = words.getBoundingClientRect().bottom + parseFloat(getComputedStyle(slot).marginTop) + slot.offsetHeight;
    const covered = slotBottom > bar.getBoundingClientRect().top + 1;
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
      data-line={lineOnScreen ?? undefined}
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
      {/* An example whose recording did not come: said, and the lesson goes on by itself. */}
      {beatState === "failed" && (
        <p role="status" data-autoplay="example-failed" className={notice}>
          {t("example_failed")}
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

  // The sound is loading (useAutoplay `loadingNotice`: only after 0.6 s, so a fast load never
  // flickers a line; from 8 s with what to do). In the bottom panel, above the caption. The live
  // region is always there (an empty box, no height), so a screen reader hears the line as it
  // appears; the line itself takes room only while shown — it opens and fades in over 200ms
  // (globals.css; at once with reduced motion) and leaves the moment the sound plays. The panel is
  // pinned to the bottom of the screen, so it grows upwards: the caption and the controls stay
  // where they are, and the word card's slot (sticky above the panel, --panel-h) glides up with it.
  const ln = ap.loadingNotice;
  const loadingStatus = (
    <div role="status" aria-live="polite">
      {ln && (
        <div data-autoplay="loading" data-kind={ln.kind} data-slow={ln.slow ? "true" : undefined} className="grid grid-rows-[1fr]">
          <p
            className={clsx(
              "mx-auto flex min-h-0 w-full max-w-prose items-start gap-2.5 overflow-hidden pb-3 text-base",
              ln.slow ? "text-ink" : "text-ink-muted",
            )}
          >
            <LoadingMark className="mt-0.5 text-forest" />
            <span className="min-w-0 text-pretty">
              {ln.slow ? t("loading_slow") : ln.kind === "narration" ? t("loading_narration") : t("loading_recitation")}
            </span>
          </p>
        </div>
      )}
    </div>
  );

  return (
    // overflow-x-clip: a backstop so nothing drawn over the stage (a
    // spotlight label at the largest text size) can make the page scroll
    // sideways; `clip` keeps the controls bar sticky.
    <div
      ref={stageRef}
      data-autoplay="stage"
      data-step={live ? step.id : undefined}
      // The example beat on screen, what the imam recites for it and what it is doing (the CI
      // checks of plan L20 find a beat by these, never by timing).
      data-example={beat?.beat.id}
      data-example-state={beatState ?? undefined}
      data-example-clip={beat?.beat.key}
      className="stage-card scroll-mt-2 overflow-x-clip"
    >
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

        {/* Settings: pace, the imam's speed, text size — labelled, behind the
            one button. Always in the page (hidden when closed), so the button's
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

          {/* The imam's recitation: its speed. One imam, so no reciter to choose (plan L21). */}
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
          <div ref={wordsRef} className="mt-2">
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
            breaks, 2026-10-10). From sm: stacked, centred.
            The slot is sticky just above the bottom panel (--panel-h): when
            the words, the card and the panel do not fit one screen — a long
            line makes the panel taller, a composition is taller than the
            card, a larger text size, the learner scrolled — the card (or the
            animation) rides up over the end of the mushaf line instead of
            sliding under the panel (CI 2026-10-11: word card 445–591 under
            the panel 436–844 on a 390×844 phone). It never moves while
            everything fits; when the panel's height changes with the line, it
            glides to its new place (motion-safe). Clicks pass through its
            empty part to the words. */}
        {!started ? (
          <div className="mx-auto mt-5 max-w-prose">{translation}</div>
        ) : live && !spec ? (
          <div
            ref={cardSlotRef}
            className="pointer-events-none sticky bottom-[calc(var(--panel-h,0px)+0.5rem)] z-10 mt-4 min-h-36 *:pointer-events-auto motion-safe:transition-[bottom] motion-safe:duration-200 sm:min-h-56"
          >
            {anim && ap.frame && compose ? (
              <WordComposition
                unit={anim}
                kind={ap.frame.step}
                frame={ap.frame.frame}
                recited={ap.frame.recited}
                marks={compose.marks}
                word={ap.frame.word}
                stepKey={step.id}
                example={beat && beatState && beat.beat.of === "base" ? { id: beat.beat.id, key: beat.beat.key, state: beatState } : null}
              />
            ) : beat && beatState && beatDrawing && beat.beat.of === "concept" ? (
              <ExampleCard id={beat.beat.id} example={beatDrawing} state={beatState} marks={marks} />
            ) : mapGroup && lessonMap ? (
              <LessonMapCard map={lessonMap} group={mapGroup} />
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
                  {/* The meaning bold in forest, "yang artinya" plain ink (operator 2026-10-11:
                      "use bold text or different color to highlight the meanings"; 7.3:1 on
                      forest-tint). The slot is found in the message, so it holds in English too. */}
                  <p className="text-xl text-pretty text-ink sm:order-4">
                    <MixedText {...cardMeaning(focusWord.gloss)} />
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
              {/* After the click, the clicked one says "Menyiapkan pelajaran…" (aria-busy) and
                  both ignore clicks (aria-disabled, so focus stays on the button) until the
                  playing stage shows (operator 2026-10-11). */}
              {ap.savedIdx !== null && (
                <button
                  type="button"
                  data-autoplay="resume"
                  onClick={() => begin("resume", ap.savedIdx ?? 0)}
                  aria-busy={preparing && pressed === "resume" ? true : undefined}
                  aria-disabled={preparing ? true : undefined}
                  className="btn-primary w-full sm:w-auto sm:min-w-64"
                >
                  {preparing && pressed === "resume" ? (
                    preparingLabel
                  ) : (
                    <>
                      <Play aria-hidden className="h-5 w-5" />
                      <span>{t("resume_from", { n: ap.savedIdx + 1 })}</span>
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                data-autoplay="start"
                onClick={() => begin("start")}
                aria-busy={preparing && pressed === "start" ? true : undefined}
                aria-disabled={preparing ? true : undefined}
                className={clsx(ap.savedIdx === null ? "btn-primary" : "btn-secondary", "w-full sm:w-auto sm:min-w-64")}
              >
                {preparing && pressed === "start" ? (
                  preparingLabel
                ) : ap.savedIdx === null ? (
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
          </div>
        ) : finished ? (
          state.intent?.kind === "surah_end" ? (
            <SurahEndCard
              surahName={surahName}
              nextSurah={upNext.next}
              comingSoon={upNext.soon?.name ?? null}
              onRepeat={() => continueToAyah(ap.router, seq.slug, 1)}
              onNextSurah={() => upNext.next && continueToAyah(ap.router, upNext.next.slug, 1)}
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
                  tapSource={source}
                  guided={guided}
                />
              </div>
            )}
          </>
        )}

        {/* Always in the page, so a screen reader is listening before the
            first line: the sanitised spoken text of each line as it starts
            (and, between the "Mulai" click and the first line, "Menyiapkan
            pelajaran…", which the busy button shows). */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {live ? ap.announcement : preparing ? t("preparing") : ""}
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
          notice (sound blocked, a recording failed), the loading line (the
          sound takes a while to start, 2026-10-11), the caption (not
          during an exercise: its prompt stays above it), then the controls.
          Three colours by role (operator, 2026-10-11): play / pause / resume
          forest (btn-primary), the replay amber (btn-replay), Sebelumnya and
          Berikutnya one warm grey and the same size (btn-nav). Phones: two
          rows — the main control and "↺ Ulangi" (3 : 2), then ‹ Sebelumnya ·
          Berikutnya › in equal halves. From sm the row wrappers dissolve
          (display: contents) into one 4-column grid, the order utilities
          lining them up: ‹ Sebelumnya · main · ↺ Ulangi langkah ini ·
          Berikutnya ›, the two ends equal. */}
      {showBar && (
        <div
          ref={barRef}
          data-autoplay="panel"
          className="sticky bottom-0 z-20 rounded-b-2xl border-t border-hairline bg-white/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-12px_28px_-14px_rgb(14_90_60/0.35)] backdrop-blur-sm sm:px-7"
        >
          {notices}
          {loadingStatus}
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
            className="flex flex-col gap-3 sm:grid sm:grid-cols-[1fr_1.15fr_1.3fr_1fr] sm:items-center"
          >
            {/* Phones, row 1: play / pause 3 : replay 2 (the replay a little wider than its word
                needs, operator 2026-10-11). From sm the row dissolves into the 4-column grid. */}
            <div className="grid grid-cols-[3fr_2fr] items-center gap-3 sm:contents">
              <div className="relative min-w-0 sm:order-2">
                {lanjutGuide && <BarSpotLabel label={lanjutGuide.label} />}
                <button
                  ref={focusOnMount}
                  type="button"
                  data-autoplay="middle"
                  data-mode={middle}
                  data-guide={middle === "lanjut" ? "lanjut" : undefined}
                  onClick={onMiddle}
                  // Almost no side padding on a phone (the label is centred in a wide pill either
                  // way): paused at the largest text size "Lanjutkan" needs 122px beside its icon,
                  // and the default padding left 75px, 0.5rem a side still only 118px (the
                  // line-break check, once it measured a paused lesson: CI 2026-10-13, twice).
                  className={clsx("btn-primary w-full min-h-14! px-1! sm:px-6!", lanjutGuide && BAR_RING)}
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
                className="btn-replay w-full min-h-14! px-3! sm:order-3 sm:px-5!"
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
            {/* Row 2: ‹ Sebelumnya and Berikutnya › (or "Lewati latihan"), one colour for moving
                between steps and always the same size (operator 2026-10-11): side by side while
                each gets 9.5rem (the "‹ Sebelumnya" label at any text size), else stacked, each
                full width (Sangat besar on a phone: the halves were 112px for a 132px label). */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] items-center gap-2 sm:contents">
              <button
                type="button"
                data-autoplay="prev"
                onClick={() => {
                  if (view.index > 0) actions.prev();
                }}
                aria-disabled={view.index === 0}
                className="btn-nav w-full sm:order-1 sm:px-5!"
              >
                <ChevronLeft aria-hidden className="h-5 w-5" />
                {t("prev")}
              </button>
              <div className="relative min-w-0 sm:order-4">
                {skipGuide && <BarSpotLabel label={skipGuide.label} align="end" />}
                <button
                  type="button"
                  data-autoplay="next"
                  data-guide={view.showSkip ? "skip" : undefined}
                  onClick={actions.forward}
                  className={clsx(
                    // Narrow side padding on phones (and no skip icon) keeps
                    // ‹ Sebelumnya and this button — "Lewati latihan" too, a
                    // label the voice says in full — in two equal halves of
                    // one row at the normal text size.
                    "btn-nav w-full sm:px-5!",
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
