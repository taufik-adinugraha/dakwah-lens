"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { preconnect } from "react-dom";

import { useExamplePlayer } from "@/hooks/useExamplePlayer";
import { useNarrationPlayer } from "@/hooks/useNarrationPlayer";
import { readPace, useImamRate, usePace } from "@/hooks/usePace";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  AUDIO_START_EVENT,
  type PlayError,
  type RecitationSource,
  useSegmentPlayer,
} from "@/hooks/useSegmentPlayer";
import { useRouter } from "@/i18n/navigation";
import {
  aheadUpdate,
  autoplayStorageKey,
  browserStorage,
  createAutoplayState,
  createPrefetcher,
  EXAMPLE_WARM_DELAY_MS,
  exampleGivesUp,
  exampleToWarm,
  firstNarration,
  IDLE_TICK_MS,
  idlePreloadUrl,
  markContinue,
  nextLinePreload,
  nextNarration,
  positionToSave,
  readSavedIndex,
  recitationToWarm,
  reduceAutoplay,
  screenAwake,
  takeContinue,
  viewAutoplay,
  wantsIdleTicks,
  watchLoading,
  type AudioLoading,
  type AutoplayEvent,
  type AutoplaySequence,
  type AutoplayState,
  type ConnectionHints,
  type ExerciseKey,
  type LoadingKind,
  type LoadingStage,
  type Pace,
  type Prefetcher,
} from "@/lib/autoplay";
import { ayahHref } from "@/lib/routes";

import {
  type CaptionClock,
  karaokeAt,
  lineVoiced,
  playingWords,
  srAnnouncement,
  stageCaption,
  stageExample,
  stageFrame,
  stageMarks,
  type VoicePos,
} from "./caption";

/** Query flag of the hand-off to the next ayah (".../quran/al-ikhlas/2?lanjut=1"). */
export const CONTINUE_PARAM = "lanjut";

/** Window event a word card's "Dengar" button sends; the stage plays the
 *  word's recording by the narrator on the lesson's example player (so word
 *  cards never start a second recording). */
export const PLAY_WORD_EVENT = "belajar:play-word";

/** After the learner starts a recording of their own (e.g. "Dengarkan
 *  lagi" in an exercise), idle reminders hold off this long, so a reminder
 *  never cuts a word short. */
const FOREIGN_QUIET_MS = 4000;

const noopSubscribe = () => () => {};

/** What the bottom panel says about a load: whose sound, and whether it is past
 *  LOADING_SLOW_MS (then it says what to do); null while nothing needs saying. */
export type LoadingNotice = { kind: LoadingKind; slow: boolean };

/**
 * The stage's loading notice for `loading` (src/lib/autoplay/loading.ts): null for its first
 * LOADING_SHOW_MS (a fast load never flickers a message), then "loading", from LOADING_SLOW_MS
 * "slow"; null again as soon as the sound flows. Timers only (no clock read in render): the
 * stage a timer reported is kept with the load it belongs to, so a new load starts quiet.
 */
function useLoadingNotice(loading: AudioLoading | null): LoadingNotice | null {
  const [seen, setSeen] = useState<{ of: AudioLoading; stage: LoadingStage } | null>(null);
  useEffect(() => {
    if (!loading) return;
    return watchLoading(loading, Date.now(), (stage) => setSeen({ of: loading, stage }));
  }, [loading]);
  if (!loading || seen?.of !== loading || seen.stage === "quiet") return null;
  return { kind: loading.kind, slow: seen.stage === "slow" };
}

/** How long after load the page waits for an idle moment before warming the first line. */
const IDLE_PRELOAD_TIMEOUT_MS = 3000;

/** How often an example beat asks whether its recording has come (timing.ts exampleGivesUp). */
const EXAMPLE_WATCH_MS = 1000;

/** The origin of a recording's address ("https://everyayah.com"), or null. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Sends the lesson to another ayah and lets that page start by itself (the
 * engine's sessionStorage mark + the visible ?lanjut=1 flag; both are
 * needed, so a reload or a shared link never starts sound on its own). A
 * client-side navigation keeps the one "Mulai" tap's user activation.
 * `scroll: false`: the page does not jump; the stage stays where it was.
 */
export function continueToAyah(router: ReturnType<typeof useRouter>, slug: string, ayah: number) {
  markContinue(browserStorage("session"), { kind: "ayah", slug, ayah }, Date.now());
  router.push(`${ayahHref(slug, ayah)}?${CONTINUE_PARAM}=1`, { scroll: false });
}

/**
 * The autoplay lesson runner: the engine's pure state machine
 * (src/lib/autoplay/machine.ts) plus everything that touches the browser.
 *
 * - Executes `state.activity` — exactly ONE at a time: a narration file
 *   (useNarrationPlayer), the imam's recitation of the WHOLE ayah (the
 *   stage's one useSegmentPlayer, so the mushaf line follows the imam), ONE
 *   word's recording by the narrator (useExamplePlayer; below), a reading
 *   timer or a silent pause — and answers with that activity's token.
 *   Narration and recitation therefore never overlap.
 * - EVERY QUR'ANIC WORD PLAYED ON ITS OWN is the narrator Kang Nandar's
 *   recording of it (operator 2026-10-14: "for all quran word by word should
 *   be replaced by this, not using truncated voice from imam … because in
 *   some parts the truncation are not clean"; AutoplaySequence.wordVoices,
 *   content/wordvoice.json, an AI voice): a word's opening step and "Pelan"'s
 *   second hearing, the ayah's last word once more, Dengar dan klik's word,
 *   an example beat, a word card's "Dengar" and a word clicked on the mushaf
 *   line. Never a cut of the imam's recitation, and no fall-back to one: a
 *   word without a recording is refused by the checks, and reported failed
 *   here. While it loads the panel says "Memuat suara narator…".
 * - Exercises: forwards the guided exercise's answers, done and control
 *   reports; sends idle_tick once a second while one waits in silence (its
 *   reminders, then the screen lock's time limit), and while "Tunggu saya"
 *   holds a caption for "Lanjut" (that limit only: the lesson waits on).
 *   Dengar dan klik's word is played here, on the example player (the one
 *   "Mulai" unlocked); the learner's own replay of it ends that word
 *   instead of pausing the lesson.
 * - The learner's own sound (a mushaf word, a word card's
 *   Dengar: the word's recording, on the example player) pauses the lesson;
 *   a "Dengarkan kata" inside an exercise only ends the narration it cut short.
 * - Browser blocked the sound (autoplay policy, e.g. after a reload): the
 *   lesson pauses and asks for one click on "Lanjutkan".
 * - The karaoke caption: while a narration file with word timings plays,
 *   the narrator's position is read once a frame (requestAnimationFrame)
 *   and stored only when the word changes.
 * - "↺ Ulangi langkah ini" replays the current step from its start (also
 *   from a pause); an exercise is remounted fresh (`replays`).
 * - Never a silent wait (operator 2026-10-11, narration rule 19): `loading`
 *   is the current activity's sound asked for and not flowing yet (the
 *   narrator's or the imam's; the players' own value), `loadingNotice` what
 *   the bottom panel says about it, and `preparing` holds the "Mulai" button
 *   at "Menyiapkan pelajaran…" until the first line is heard or shown. Before
 *   "Mulai", the first narration file that click plays is warmed once the
 *   page is idle (never the imam's external recitation).
 * - The imam's recitation is fetched EARLY (operator 2026-10-11; rules in
 *   src/lib/autoplay/warm.ts): this ayah's as soon as the lesson has started,
 *   while the narrator speaks the opening line, on the stage's own player.
 *   Never another ayah's (each page fetches its own), and never part of
 *   `loading`: that is the wait of the activity due to sound.
 * - The narration is fetched AHEAD across steps (operator 2026-10-12; rules
 *   in src/lib/autoplay/lookahead.ts, prefetch.ts, ahead.ts): the rest of
 *   this step and the next two, one file at a time, INTO THE PAGE (a Blob
 *   each, kept until played), while the lesson runs and its sound is not
 *   loading. The narration player plays a line from the copy held when there
 *   is one (no request at all, on every browser), else from the network as
 *   before.
 * - The screen stays on while the lesson runs (operator 2026-10-12; Screen
 *   Wake Lock, src/lib/autoplay/wake.ts, src/hooks/useWakeLock.ts), and
 *   across the hand-off to the next ayah, whose lesson adopts the lock. Where
 *   the lesson waits for the learner (an exercise, "Tunggu saya") the lock is
 *   let go after two minutes of silence; the lesson waits on.
 * - EXAMPLE BEATS (operator 2026-10-12: "each explanation should be followed
 *   by examples (visual + voice)"; plan L20; machine.ts): a recite activity
 *   that names a beat — a word of this ayah or of another, or a form — whose
 *   recording plays on the example player (useExamplePlayer: its own kept
 *   element, unlocked in the same "Mulai" tap as the others), as every word
 *   does. The beat ends when the recording has ended and its caption has had
 *   its reading time. It is never a dead stop: a recording that fails, or
 *   does not sound within EXAMPLE_LOAD_LIMIT_MS, is reported as recite_error
 *   and the machine moves on; "Memuat suara narator…" shows meanwhile. The
 *   next word's or example's recording along the lesson's path (this step's,
 *   else the next step's: a word's step opens with its word) is fetched ahead
 *   on the example player (warm.ts exampleToWarm: only while the lesson runs,
 *   never with Save-Data); the narration look-ahead lists lines only.
 * - Remembers the step per ayah; hands off to the next ayah; Media Session
 *   (lock screen, earphones) play/pause/next/previous.
 * - Never scrolls the page.
 */
export function useAutoplay(seq: AutoplaySequence, source: RecitationSource, title: string) {
  const router = useRouter();
  const { pace, setPace: storePace } = usePace();
  const [imamRate, setImamRate] = useImamRate();
  const [state, dispatch] = useReducer(
    (s: AutoplayState, e: AutoplayEvent) => reduceAutoplay(seq, s, e),
    seq,
    (q: AutoplaySequence) => createAutoplayState(q),
  );
  /** The browser refused to play sound until the next tap. */
  const [blocked, setBlocked] = useState(false);
  const [clock, setClock] = useState<CaptionClock | null>(null);
  /** The narrator's place in the words of the file on screen. */
  const [voice, setVoice] = useState<VoicePos | null>(null);
  /** How often the learner replayed a step (keys the stage's exercise, so a
   *  replayed exercise starts over). */
  const [replays, setReplays] = useState(0);
  /** The learner played a word themselves (a mushaf word or a word card's
   *  "Dengar"), and nothing has taken the lesson back since. */
  const [learnerWord, setLearnerWord] = useState(false);
  /** The word the learner asked for could not be played (its recording failed, or it has none):
   *  "klik kata itu sekali lagi". The lesson's own sound failing has its own notice. */
  const [learnerFailed, setLearnerFailed] = useState(false);
  /** The word (1-based) the learner's own play is sounding now, lit on the mushaf line; null: none. */
  const [learnerActive, setLearnerActive] = useState<number | null>(null);
  /** The example player plays the LEARNER's word now (not the lesson's own): its start is the
   *  learner's own recording, which the lesson waits for (one voice at a time). */
  const learnerClipRef = useRef(false);
  /** Stops the learner's word (resume: the lesson takes the voice back). */
  const learnerStopRef = useRef<(() => void) | null>(null);
  const savedIdx = useSyncExternalStore(
    noopSubscribe,
    () => readSavedIndex(browserStorage("local"), seq),
    () => null,
  );

  /** The narration fetched ahead and kept by the page (prefetch.ts; created in an effect below). */
  const prefetchRef = useRef<Prefetcher | null>(null);
  /** Counts the fetches that ended (a copy arrived, or one failed): the preload below looks again. */
  const [aheadSeen, setAheadSeen] = useState(0);
  const heldNarration = useCallback((url: string) => prefetchRef.current?.held(url) ?? null, []);
  const dropNarration = useCallback((url: string) => prefetchRef.current?.discard(url), []);
  const {
    play: playNarration,
    preload,
    owns: ownsNarration,
    positionMs,
    loading: narrationLoading,
  } = useNarrationPlayer(heldNarration, dropNarration);
  /** Token of the first activity a "Mulai" click starts (null: no click yet). */
  const [prepFor, setPrepFor] = useState<number | null>(null);
  /** Token of the last narration file heard ("playing"). */
  const [heardFor, setHeardFor] = useState<number | null>(null);

  // The recite activity's completion, error and interruption handlers (set
  // by the executor below, read by the player's callbacks).
  const finishRef = useRef<(() => void) | null>(null);
  const errorRef = useRef<((reason: PlayError) => void) | null>(null);
  const interruptRef = useRef<(() => void) | null>(null);
  /** A recite activity is running right now. */
  const reciteLiveRef = useRef(false);
  /** Token of the recite activity that started the player's current
   *  playback; null once the learner took the player over. */
  const ownerRef = useRef<number | null>(null);
  /** When the learner last started a recording of their own, and its
   *  element (to know whether it is still playing). */
  const foreignAtRef = useRef(0);
  const foreignRef = useRef<HTMLAudioElement | null>(null);

  const player = useSegmentPlayer(source, {
    // The stage's element is kept across ayah pages, so the one "Mulai" tap
    // keeps it allowed to play (iOS Safari) when the lesson moves on.
    keep: true,
    rate: imamRate,
    onFinish: () => finishRef.current?.(),
    onError: (reason) => errorRef.current?.(reason),
    // Another recording on the page paused the imam mid-ayah (e.g. the
    // standalone Dengar dan klik below the stage, a word the learner
    // clicked): pause the lesson like "Jeda", so it neither moves on nor
    // waits for audio that won't end.
    onInterrupt: () => interruptRef.current?.(),
  });
  // (Only the whole ayah plays on it: a word is the narrator's recording, on the example player.)
  const { playAll, restart, pause: pauseAudio, unlock, warm: warmPlayer } = player;
  // The example player: every word heard on its own (the narrator's recording of it; operator
  // 2026-10-14), at the learner's chosen speed.
  const examplePlayer = useExamplePlayer({ rate: imamRate });
  const { play: playExample, unlock: unlockExample, warm: warmExample, flowing: exampleFlowing, owns: ownsExample } = examplePlayer;
  // The imam's recitation streams from the provider's CDN (next.config.ts RECITATION_HOSTS): a
  // preconnect hint to its host (the connection set up ahead, operator 2026-10-11) — never a
  // preload of the recording itself before "Mulai": learners on mobile data pay for every byte.
  // React hoists it into <head>, once per origin.
  const reciteUrl = source.url;
  const reciteOrigin = originOf(reciteUrl);
  if (reciteOrigin) preconnect(reciteOrigin);

  // ── Once the lesson has started: the imam's recitation, fetched early ──
  // (operator 2026-10-11; when and why: src/lib/autoplay/warm.ts). This ayah's recording, on the
  // stage's own player, while the narrator speaks the opening line. It only asks the browser to
  // fetch: nothing plays, nothing is reported, and the loading notice stays the waiting
  // activity's alone.
  const lessonStarted = state.started;
  useEffect(() => {
    const url = recitationToWarm({ started: lessonStarted, currentUrl: reciteUrl });
    if (url) warmPlayer(url);
  }, [lessonStarted, reciteUrl, warmPlayer]);

  // ── While the lesson runs: the example clip this step is about to play, fetched early ──
  // (operator 2026-10-12, plan L20; when and why: warm.ts exampleToWarm). On the example player's
  // own element; nothing plays, nothing is reported. Asked for only once the step has wanted it
  // for a moment (stepping through with "Berikutnya ›" fetches nothing), and never when the
  // browser asks to save data (the rule again, with the connection: read in the timer, not in render).
  const exampleUrl = exampleToWarm(seq, state);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    if (!exampleUrl) return;
    const id = window.setTimeout(() => {
      const conn = (navigator as Navigator & { connection?: ConnectionHints }).connection;
      if (exampleToWarm(seq, stateRef.current, conn) === exampleUrl) warmExample(exampleUrl);
    }, EXAMPLE_WARM_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [seq, exampleUrl, warmExample]);

  // Latest player functions for the executor, which must not restart its
  // activity when they change identity.
  const playerRef = useRef({ playAll, restart, pauseAudio, unlock, playExample, unlockExample, exampleFlowing });
  useEffect(() => {
    playerRef.current = { playAll, restart, pauseAudio, unlock, playExample, unlockExample, exampleFlowing };
  }, [playAll, restart, pauseAudio, unlock, playExample, unlockExample, exampleFlowing]);

  // ── The executor: one activity at a time ──
  const activity = state.activity;
  useEffect(() => {
    if (!activity) return;
    const token = activity.token;
    if (activity.kind === "read" || activity.kind === "wait") {
      const id = window.setTimeout(() => dispatch({ type: "timer", token }), activity.ms);
      return () => window.clearTimeout(id);
    }
    if (activity.kind === "narrate") {
      const { line, file, url, ms: fileMs, offsetMs, totalMs } = activity;
      let stop: (() => void) | null = null;
      const begin = () => {
        stop = playNarration(url, {
          onEnd: () => {
            setClock({ token, line, ms: offsetMs + fileMs, totalMs });
            // Every word of the file is said: none lit, none muted.
            setVoice({ token, line, file, now: -1, said: Number.MAX_SAFE_INTEGER });
            dispatch({ type: "narration_end", token });
          },
          onError: () => dispatch({ type: "narration_error", token }),
          onBlocked: () => {
            setBlocked(true);
            dispatch({ type: "pause" });
          },
          // E.g. "Dengarkan kata" inside an exercise: the line is over, the
          // lesson goes on (the engine's rule), it is not a pause.
          onInterrupted: () => dispatch({ type: "narration_end", token }),
          onTime: (ms) => setClock({ token, line, ms: offsetMs + ms, totalMs }),
          onPlaying: () => setHeardFor(token),
        });
      };
      // The learner's own recording is still playing (e.g. the imam's word
      // after "Dengarkan kata"): the next line waits for it to stop instead
      // of cutting it short — one voice at a time.
      const other = foreignRef.current;
      if (other && !other.paused && !other.ended) {
        const go = () => {
          other.removeEventListener("pause", go);
          other.removeEventListener("ended", go);
          begin();
        };
        other.addEventListener("pause", go);
        other.addEventListener("ended", go);
        return () => {
          other.removeEventListener("pause", go);
          other.removeEventListener("ended", go);
          stop?.();
        };
      }
      begin();
      return () => stop?.();
    }

    const p = playerRef.current;
    if (activity.target !== "ayah") {
      // ONE word (operator 2026-10-14: "for all quran word by word should be replaced by this, not
      // using truncated voice from imam"): a word of this ayah — its opening step, the ayah's last
      // word once more, Dengar dan klik's word, an example beat on it — or an example beat's word
      // or form of another ayah. Always the narrator's recording of it (`clip`), on the example
      // player; never the imam's recitation cut at the word, and no fall-back to it: a word with no
      // recording is reported failed (the checks refuse one). Ends when the recording has ended
      // AND minMs has passed (a caption's reading time where the machine asks for one; 0 for a
      // word the narrator explains next: the step ends with the word, plan L24).
      // - An example beat is never a dead stop: a recording that fails, or does not sound in time,
      //   is given up (the machine shows the example a moment longer and goes on). A word's own
      //   step that fails pauses the lesson (the machine's error "word"; "Lanjutkan" retries).
      // - Dengar dan klik's word: the learner's own replay of it ends it (it is heard), and it
      //   waits for that replay to stop before it starts (one voice at a time).
      // - The browser refusing sound pauses the lesson and asks for one click, as for any sound.
      const clip = activity.clip;
      const quiz = activity.target === "word" && activity.inExercise === true;
      const beat = activity.target === "clip" || activity.example !== undefined;
      let live = true;
      let heard = false;
      let read = activity.minMs <= 0;
      let stop: (() => void) | null = null;
      let watch: number | null = null;
      const timers: number[] = [];
      const settle = () => {
        if (!live || !heard || !read) return;
        live = false;
        dispatch({ type: "recite_end", token });
      };
      const fail = () => {
        if (!live) return;
        live = false;
        dispatch({ type: "recite_error", token });
      };
      const begin = () => {
        if (!live) return;
        if (!clip) {
          timers.push(window.setTimeout(fail, 0));
          return;
        }
        // The lesson's own sound on the example player (not the learner's word).
        learnerClipRef.current = false;
        stop = p.playExample(clip, {
          onEnd: () => {
            heard = true;
            settle();
          },
          onError: (reason) => {
            if (!live) return;
            if (reason === "blocked") {
              live = false;
              setBlocked(true);
              dispatch({ type: "pause" });
            } else fail();
          },
          onInterrupted: () => {
            if (!live) return;
            if (quiz) {
              // The learner replayed the exercise's word themselves: it is heard.
              heard = true;
              read = true;
              settle();
            } else {
              // Another recording started (the learner clicked a word): pause, like "Jeda".
              dispatch({ type: "pause" });
            }
          },
        });
        if (!read) {
          timers.push(
            window.setTimeout(() => {
              read = true;
              settle();
            }, activity.minMs),
          );
        }
        // An example beat never holds the lesson: once a second, has the recording come? Past the
        // limit, one that is neither heard nor sounding (it never started, or stalled for good) is
        // given up.
        if (beat) {
          const since = Date.now();
          watch = window.setInterval(() => {
            if (exampleGivesUp(Date.now() - since, { heard, flowing: p.exampleFlowing() })) fail();
          }, EXAMPLE_WATCH_MS);
        }
      };
      const other = foreignRef.current;
      const waitFor = quiz && other && !other.paused && !other.ended ? other : null;
      const go = () => {
        waitFor?.removeEventListener("pause", go);
        waitFor?.removeEventListener("ended", go);
        begin();
      };
      if (waitFor) {
        waitFor.addEventListener("pause", go);
        waitFor.addEventListener("ended", go);
      } else {
        begin();
      }
      return () => {
        live = false;
        waitFor?.removeEventListener("pause", go);
        waitFor?.removeEventListener("ended", go);
        if (watch !== null) window.clearInterval(watch);
        timers.forEach((id) => window.clearTimeout(id));
        stop?.();
      };
    }

    // The imam, the whole ayah (the recitation step, the recap): ends when the audio has ended AND
    // minMs has passed (a caption's reading time in a caption-only lesson). Paused mid-ayah, he
    // continues where he stopped (`resume`).
    let live = true;
    let heard = false;
    let read = activity.minMs <= 0;
    const timers: number[] = [];
    const settle = () => {
      if (!live || !heard || !read) return;
      live = false;
      reciteLiveRef.current = false;
      dispatch({ type: "recite_end", token });
    };
    finishRef.current = () => {
      heard = true;
      settle();
    };
    errorRef.current = (reason) => {
      if (!live) return;
      live = false;
      reciteLiveRef.current = false;
      if (reason === "blocked") {
        setBlocked(true);
        dispatch({ type: "pause" });
      } else {
        dispatch({ type: "recite_error", token });
      }
    };
    interruptRef.current = () => {
      if (reciteLiveRef.current) dispatch({ type: "pause" });
    };
    reciteLiveRef.current = true;
    ownerRef.current = token;
    if (activity.resume) p.playAll();
    else p.restart();
    if (!read) {
      timers.push(
        window.setTimeout(() => {
          read = true;
          settle();
        }, activity.minMs),
      );
    }
    return () => {
      live = false;
      reciteLiveRef.current = false;
      finishRef.current = null;
      errorRef.current = null;
      interruptRef.current = null;
      timers.forEach((id) => window.clearTimeout(id));
      // Stop the imam only if this activity still owns the playback (not
      // when the learner just started a word of their own).
      if (ownerRef.current === token) {
        ownerRef.current = null;
        playerRef.current.pauseAudio();
      }
    };
  }, [activity, playNarration]);

  // ── The karaoke caption: the narrator's word, once a frame ──
  // Only while a file with word timings plays; the state changes only when
  // the word does (a few times a second), never every frame.
  const words = playingWords(seq, state);
  useEffect(() => {
    if (activity?.kind !== "narrate" || !words) return;
    const { token, line, file } = activity;
    let raf = 0;
    let last = "";
    const tick = () => {
      const ms = positionMs();
      if (ms !== null) {
        const pos = karaokeAt(words, ms);
        const key = `${pos.now}:${pos.said}`;
        if (key !== last) {
          last = key;
          setVoice({ token, line, file, ...pos });
        }
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [activity, words, positionMs]);

  // ── Ahead of the lesson: the narration of the next lines and steps, held by the page ──
  // (operator 2026-10-12: "when i'm still in slide 1, it already start downloading for slide 2 or
  // even 3"; rules: src/lib/autoplay/lookahead.ts, prefetch.ts and ahead.ts). The page fetches
  // the lesson's path from here — the next line of this step, the rest of it, the next steps —
  // one file at a time, each into a Blob it keeps until the file has been played; the narration
  // player plays a line from the copy held (useNarrationPlayer's `held`), else from the network
  // as before. A new fetch starts only while the lesson runs and no sound it plays is loading
  // (the line just started is heard first); nothing before "Mulai"; a fetch is cancelled only
  // when its file has left the path, and everything is let go once the lesson has finished and
  // when the page unmounts (the hand-off).
  const awake = screenAwake(state);
  useEffect(() => {
    const p = createPrefetcher({
      fetch: (url, init) => window.fetch(url, init),
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      onChange: () => setAheadSeen((n) => n + 1),
    });
    prefetchRef.current = p;
    return () => {
      p.stop();
      prefetchRef.current = null;
    };
  }, []);
  // The next narration file of this step (ahead.ts nextNarration): the preload element's, as
  // before the look-ahead — unless the page's own fetch of it is under way or due
  // (nextLinePreload).
  const nextUrl = nextNarration(seq, state);
  const soundLoading = narrationLoading !== null || player.loading !== null || examplePlayer.loading !== null;
  useEffect(() => {
    const p = prefetchRef.current;
    const conn = (navigator as Navigator & { connection?: ConnectionHints }).connection;
    p?.update(aheadUpdate(seq, state, { conn, soundLoading, heardFor }));
    preload(nextLinePreload(nextUrl, p));
  }, [seq, state, soundLoading, heardFor, nextUrl, preload, aheadSeen]);

  // ── The screen stays on while the lesson runs ── (operator 2026-10-12: "why my phone goes
  // inactive while … listening to the lesson?"; when: src/lib/autoplay/wake.ts; how:
  // src/hooks/useWakeLock.ts). Never on a page view alone; let go on pause, at the end of the
  // surah and when the page is left mid-lesson. KEPT across the hand-off to the next ayah: that
  // page's lesson adopts it, or it is released after a short grace if that lesson does not run.
  // Let go, too, once the lesson has waited two minutes in silence for the learner (an exercise
  // past its reminders, "Tunggu saya"): the lesson waits on, their next action takes it again.
  useWakeLock(awake);

  // ── Before "Mulai": warm the first line that click plays ──
  // (operator 2026-10-11). The primary button's: "Lanjutkan dari langkah N" when a place is
  // remembered, else "Mulai". Once the page has loaded and is idle, never blocking; skipped when
  // the browser asks to save data, or the line is long (idlePreloadUrl). The narration player's
  // own preload element; once the lesson runs, the next-line preload above takes it over.
  const first = state.started ? null : firstNarration(seq, savedIdx, pace);
  const firstUrl = first?.url ?? null;
  const firstMs = first?.ms ?? 0;
  useEffect(() => {
    if (!firstUrl) return;
    // Arrived from the previous ayah (?lanjut=1): the lesson starts by itself, with the ayah's
    // own first line (no "Mulai", no shared:start) — nothing to warm.
    if (new URL(window.location.href).searchParams.get(CONTINUE_PARAM) === "1") return;
    let idle: number | null = null;
    let timer: number | null = null;
    const warm = () => {
      const conn = (navigator as Navigator & { connection?: ConnectionHints }).connection;
      preload(idlePreloadUrl({ url: firstUrl, ms: firstMs }, conn));
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(warm, { timeout: IDLE_PRELOAD_TIMEOUT_MS });
      else timer = window.setTimeout(warm, 1000);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => {
      window.removeEventListener("load", whenIdle);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [firstUrl, firstMs, preload]);

  // ── Silent waiting, one tick a second: an exercise's reminders, and the screen lock's limit ──
  // (machine.ts wantsIdleTicks: an exercise waiting, "Tunggu saya" holding a caption; the ticks
  // stop once the lock's time limit is reached, wake.ts.)
  const ticking = wantsIdleTicks(state);
  useEffect(() => {
    if (!ticking) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const ms = now - last;
      last = now;
      // A hidden tab, or the learner listening to a word: not idle time.
      const other = foreignRef.current;
      if (document.hidden || (other && !other.paused) || now - foreignAtRef.current < FOREIGN_QUIET_MS) return;
      dispatch({ type: "idle_tick", ms });
    }, IDLE_TICK_MS);
    return () => window.clearInterval(id);
  }, [ticking]);

  // The learner's own recordings (not the narration, not the lesson's imam or its words; a word the
  // learner asked for on the example player is theirs).
  useEffect(() => {
    const onStart = (e: Event) => {
      const el = (e as CustomEvent<HTMLAudioElement>).detail;
      if (ownsNarration(el) || (ownsExample(el) && !learnerClipRef.current) || reciteLiveRef.current) return;
      foreignAtRef.current = Date.now();
      foreignRef.current = el instanceof HTMLAudioElement ? el : null;
    };
    window.addEventListener(AUDIO_START_EVENT, onStart);
    return () => window.removeEventListener(AUDIO_START_EVENT, onStart);
  }, [ownsNarration, ownsExample]);

  // ── Remember the step (by id) ──
  const toSave = positionToSave(seq, state);
  const storageKey = autoplayStorageKey(seq.lessonKey);
  useEffect(() => {
    if (toSave === undefined) return;
    const storage = browserStorage("local");
    if (!storage) return;
    try {
      if (toSave === null) storage.removeItem(storageKey);
      else storage.setItem(storageKey, toSave);
    } catch {
      /* storage blocked: the position just isn't remembered */
    }
  }, [toSave, storageKey]);

  // ── Arrived from the previous ayah: start by itself ──
  const lessonKey = seq.lessonKey;
  useEffect(() => {
    const id = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get(CONTINUE_PARAM) !== "1") return;
      // Drop the flag, so a reload (which has no user activation) shows Mulai.
      url.searchParams.delete(CONTINUE_PARAM);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (!takeContinue(browserStorage("session"), lessonKey, Date.now())) return;
      dispatch({ type: "start", pace: readPace(), reason: "continue" });
    }, 0);
    return () => window.clearTimeout(id);
  }, [lessonKey]);

  // ── The ayah is through: on to the next one ──
  const intent = state.phase === "finished" ? state.intent : null;
  useEffect(() => {
    if (intent?.kind !== "ayah") return;
    continueToAyah(router, intent.slug, intent.ayah);
  }, [intent, router]);

  // ── Lock screen / earphones ──
  const view = viewAutoplay(seq, state);
  const started = state.started;
  const forwardIsSkip = view.showSkip;
  useEffect(() => {
    if (!started || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    };
    ms.metadata = new MediaMetadata({ title, artist: "Belajar Al-Qur'an · Dakwah-Lens" });
    set("play", () => {
      setBlocked(false);
      dispatch({ type: "resume" });
    });
    set("pause", () => dispatch({ type: "pause" }));
    // The same as the "Berikutnya ›" button (forward(), below): by frame on a step with frames.
    set("nexttrack", () => dispatch(forwardIsSkip ? { type: "skip" } : { type: "next", jump: true }));
    set("previoustrack", () => dispatch({ type: "prev" }));
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) set(a, null);
    };
  }, [started, title, forwardIsSkip]);
  const phase = state.phase;
  useEffect(() => {
    if (!started || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = phase === "paused" || phase === "finished" ? "paused" : "playing";
  }, [started, phase]);

  /** The learner plays word `n` themselves (a word card's "Dengar", a word clicked on the mushaf
   *  line): the narrator's recording of it on the example player — never the imam's recitation cut
   *  at the word (operator 2026-10-14). A running lesson pauses first; one voice at a time (the
   *  imam's ayah stops as the word starts, AUDIO_START_EVENT). */
  const playLearnerWord = useCallback(
    (n: number) => {
      const clip = seq.wordVoices[n - 1] ?? null;
      setLearnerWord(true);
      setLearnerFailed(false);
      dispatch({ type: "pause" });
      if (!clip) {
        setLearnerFailed(true);
        return;
      }
      learnerClipRef.current = true;
      setLearnerActive(n);
      const done = () => setLearnerActive((x) => (x === n ? null : x));
      learnerStopRef.current = playerRef.current.playExample(clip, {
        onEnd: done,
        onError: (reason) => {
          done();
          if (reason === "failed") setLearnerFailed(true);
        },
        onInterrupted: done,
      });
    },
    [seq],
  );
  /** Stops the learner's own word, if it plays: the lesson takes the voice back. */
  const stopLearnerWord = () => {
    learnerStopRef.current?.();
    learnerStopRef.current = null;
    setLearnerActive(null);
  };

  // "Dengar" on a word card: the word's recording, so audio never overlaps.
  useEffect(() => {
    const onPlayWord = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n !== "number") return;
      playLearnerWord(n);
    };
    window.addEventListener(PLAY_WORD_EVENT, onPlayWord);
    return () => window.removeEventListener(PLAY_WORD_EVENT, onPlayWord);
  }, [playLearnerWord]);

  // ── The caption on screen ── (caption.ts: the karaoke words or the
  // display text with audio, the engine's caption part without), what the
  // mushaf line marks, and what a screen reader is told
  const caption = stageCaption(seq, state, clock, voice);
  const voiced = caption.voiced;
  const marks = stageMarks(seq, state);
  // The composition / primer frame on screen (narration rule 14).
  const frame = stageFrame(seq, state);
  const announcement = srAnnouncement(seq, state, voiced);
  /** The line on screen has the narration voice (null: no line on screen). */
  const lineHasVoice = lineVoiced(seq, state);

  // ── Loading: the current activity's sound, asked for and not flowing yet ──
  // (a word is the narrator's recording on the example player: "Memuat suara narator…"; only the
  // whole ayah is the imam's, "Memuat bacaan imam…")
  const loading =
    activity?.kind === "narrate"
      ? narrationLoading
      : activity?.kind === "recite"
        ? activity.target === "ayah"
          ? player.loading
          : examplePlayer.loading
        : null;
  const loadingNotice = useLoadingNotice(loading);
  // "Menyiapkan pelajaran…": from the click until its first line is heard — or shown at once
  // (a caption-only line, a failed file, a blocked sound: each is a new activity or none), or
  // until the load turns slow, when the stage shows with what to do.
  const preparing =
    prepFor !== null &&
    activity?.kind === "narrate" &&
    activity.token === prepFor &&
    heardFor !== prepFor &&
    !loadingNotice?.slow;

  // ── Actions (event handlers) ──
  /** Every click that (re)starts the lesson: sound may now play without
   *  another click, and a "browser blocked the sound" notice is answered. */
  const tapped = () => {
    setBlocked(false);
    setLearnerWord(false);
    setLearnerFailed(false);
    playerRef.current.unlock();
    // The example player's element too: a clip of another ayah plays later, with no tap.
    playerRef.current.unlockExample();
  };
  const actions = {
    /** "Mulai" (from 0) or "Lanjutkan dari langkah N". */
    start(from?: number) {
      if (preparing) return; // a second click while the first line loads
      tapped();
      // The start's first activity is the next token the engine issues.
      setPrepFor(state.token + 1);
      dispatch({ type: "start", pace, from: from ?? 0, reason: from ? "restore" : "fresh" });
    },
    pause() {
      dispatch({ type: "pause" });
    },
    resume() {
      // The learner's own listening stops: the lesson takes the voice back (a paused recitation
      // keeps its spot).
      playerRef.current.pauseAudio();
      stopLearnerWord();
      tapped();
      dispatch({ type: "resume" });
    },
    /** "Lanjut" in the "Tunggu saya" mode. */
    lanjut() {
      setLearnerWord(false);
      dispatch({ type: "next" });
    },
    prev() {
      tapped();
      dispatch({ type: "prev" });
    },
    /** "Berikutnya ›", which is "Lewati latihan" on an open exercise. `jump`: on a step with
     *  frames it moves by frame, also while "Tunggu saya" holds a caption (where Lanjut, above,
     *  moves by caption). */
    forward() {
      tapped();
      dispatch(view.showSkip ? { type: "skip" } : { type: "next", jump: true });
    },
    skip() {
      dispatch({ type: "skip" });
    },
    /** "↺ Ulangi langkah ini": the current step from its start, playing
     *  (also from a pause). */
    replay() {
      tapped();
      setReplays((n) => n + 1);
      dispatch({ type: "replay" });
    },
    setPace(p: Pace) {
      storePace(p);
      dispatch({ type: "set_pace", pace: p });
    },
    /** The learner plays something on the stage's player themselves. */
    takeOverPlayer() {
      ownerRef.current = null;
      setLearnerWord(true);
      dispatch({ type: "pause" });
    },
    /** The learner clicks word `n` (1-based) to hear it: its recording by the narrator. */
    playWord(n: number) {
      playLearnerWord(n);
    },
    answered(key: ExerciseKey, correct: boolean, question?: number) {
      dispatch({ type: "answered", key, correct, question });
    },
    /** "Tunjukkan jawaban" on question `question`. */
    revealed(key: ExerciseKey, question?: number) {
      dispatch({ type: "revealed", key, question });
    },
    exerciseDone(key: ExerciseKey) {
      dispatch({ type: "exercise_done", key });
    },
    exerciseGuide(target: string, word?: number) {
      dispatch({ type: "exercise_guide", target, word });
    },
  };

  return {
    state,
    view,
    pace,
    imamRate,
    setImamRate,
    savedIdx,
    blocked,
    /** The current activity's sound asked for and not flowing yet (loading.ts), else null. */
    loading,
    /** What the bottom panel says about `loading` (after LOADING_SHOW_MS), else null. */
    loadingNotice,
    /** "Mulai" was clicked and its first line is not heard yet: the button says so. */
    preparing,
    /** The caption model (caption.ts StageCaption): karaoke words or text. */
    caption,
    /** The caption is spoken by the narration (no aria-live needed). */
    voiced,
    /** The words the mushaf line marks, and the word card's word. */
    marks,
    /** The animation frame in the word card's slot (primer / compose steps). */
    frame,
    /** The example beat on screen (caption.ts stageExample), or null. */
    example: stageExample(seq, state),
    lineHasVoice,
    /** Replays so far (the stage keys its exercise with it). */
    replays,
    /** The learner played a word themselves (see learnerWord). */
    learnerWord,
    /** The word the learner asked for could not be played: the stage says so. */
    learnerFailed,
    /** The word the learner's own play is sounding now (the mushaf line lights it), else null. */
    learnerActive,
    /** Word `n` (1-based) has a recording the learner can play. */
    canPlayWord: (n: number) => !!seq.wordVoices[n - 1],
    /** For the stage's polite live region: the line's sanitised spoken
     *  text, "" while the imam or the narration speaks. */
    announcement,
    player,
    actions,
    router,
  };
}
