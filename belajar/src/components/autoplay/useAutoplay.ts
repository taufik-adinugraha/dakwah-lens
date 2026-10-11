"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { preconnect } from "react-dom";

import { useNarrationPlayer } from "@/hooks/useNarrationPlayer";
import { readPace, useImamRate, usePace } from "@/hooks/usePace";
import {
  AUDIO_START_EVENT,
  type PlayError,
  type RecitationSource,
  useSegmentPlayer,
  warmRecitation,
} from "@/hooks/useSegmentPlayer";
import { useRouter } from "@/i18n/navigation";
import {
  autoplayStorageKey,
  browserStorage,
  createAutoplayState,
  firstNarration,
  IDLE_TICK_MS,
  idlePreloadUrl,
  markContinue,
  positionToSave,
  readSavedIndex,
  recitationWarmPlan,
  reduceAutoplay,
  takeContinue,
  upcomingAudio,
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
} from "@/lib/autoplay";
import { ayahHref } from "@/lib/routes";

import {
  type CaptionClock,
  karaokeAt,
  lineVoiced,
  playingWords,
  srAnnouncement,
  stageCaption,
  stageFrame,
  stageMarks,
  type VoicePos,
} from "./caption";

/** Query flag of the hand-off to the next ayah (".../quran/al-ikhlas/2?lanjut=1"). */
export const CONTINUE_PARAM = "lanjut";

/** Window event a word card's "Dengar" button sends; the stage plays the
 *  word on its one player (so word cards never start a second recording). */
export const PLAY_WORD_EVENT = "belajar:play-word";

/** After the learner starts a recording of their own (e.g. "Dengarkan
 *  lagi" in an exercise), idle reminders hold off this long, so a reminder
 *  never cuts the imam short. */
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

/** The origin of a recording's address ("https://everyayah.com"), or null. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
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
 *   (useNarrationPlayer), the imam's recitation (the stage's one
 *   useSegmentPlayer, so the mushaf line follows the imam), a reading timer
 *   or a silent pause — and answers with that activity's token. Narration
 *   and recitation therefore never overlap.
 * - Exercises: forwards the guided exercise's answers, done and control
 *   reports; sends idle_tick once a second while one waits in silence.
 *   Dengar dan klik's word is recited here, on the stage's player (the one
 *   "Mulai" unlocked); the learner's own replay of it ends that recitation
 *   instead of pausing the lesson.
 * - The learner's own sound (a mushaf word, a word card's
 *   Dengar) pauses the lesson; a "Dengarkan kata" inside an exercise only
 *   ends the narration it cut short.
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
 *   while the narrator speaks the opening line, on the stage's own player; the
 *   next ayah's (`nextRecitation`) from the recap on, on a spare element.
 *   Never part of `loading`: that is the wait of the activity due to sound.
 * - Remembers the step per ayah; hands off to the next ayah; Media Session
 *   (lock screen, earphones) play/pause/next/previous.
 * - Never scrolls the page.
 */
export function useAutoplay(
  seq: AutoplaySequence,
  sources: RecitationSource[],
  title: string,
  /** The recording the next ayah's page plays first (its default reciter's); null on a surah's
   *  last ayah. Fetched ahead near the end of this ayah (warm.ts). */
  nextRecitation: string | null = null,
) {
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
  /** The learner played a word on the stage's player themselves (a mushaf
   *  word or a word card's "Dengar"), and nothing has taken the player back
   *  since: only then is a failed stream THEIR word ("klik kata itu sekali
   *  lagi"); the lesson's own recitation failing has its own notice. */
  const [learnerWord, setLearnerWord] = useState(false);
  const savedIdx = useSyncExternalStore(
    noopSubscribe,
    () => readSavedIndex(browserStorage("local"), seq),
    () => null,
  );

  const { play: playNarration, preload, owns: ownsNarration, positionMs, loading: narrationLoading } = useNarrationPlayer();
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

  const player = useSegmentPlayer(sources, {
    // The stage's element is kept across ayah pages, so the one "Mulai" tap
    // keeps it allowed to play (iOS Safari) when the lesson moves on.
    keep: true,
    rate: imamRate,
    onFinish: () => finishRef.current?.(),
    onError: (reason) => errorRef.current?.(reason),
    // Another recording on the page paused the imam mid-activity (e.g. the
    // standalone Dengar dan klik below the stage): pause the lesson like
    // "Jeda", so it neither moves on nor waits for audio that won't end —
    // except an exercise's word, which the learner's own replay just said.
    onInterrupt: () => interruptRef.current?.(),
  });
  const { playWord, playAll, restart, pause: pauseAudio, unlock, warm: warmPlayer } = player;
  // The imam's recitation streams from the reciter's CDN (next.config.ts RECITATION_HOSTS): a
  // preconnect hint to the chosen reciter's host (the connection set up ahead, operator
  // 2026-10-11) — never a preload of the recording itself before "Mulai": learners on mobile
  // data pay for every byte. React hoists it into <head>, once per origin.
  const reciteUrl = player.source?.url ?? null;
  const reciteOrigin = originOf(reciteUrl ?? undefined);
  if (reciteOrigin) preconnect(reciteOrigin);

  // ── Once the lesson has started: the imam's recitation, fetched early ──
  // (operator 2026-10-11; when and why: src/lib/autoplay/warm.ts). This ayah's recording by the
  // reciter chosen, on the stage's own player, while the narrator speaks the opening line — and
  // again when another reciter is chosen; from the recap on, the next ayah's, on the spare
  // element (each file once). Both only ask the browser to fetch: nothing plays, nothing is
  // reported, and the loading notice stays the waiting activity's alone.
  const lessonStarted = state.started;
  const stepKind = seq.steps[state.idx].kind;
  const nav = seq.nav;
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: ConnectionHints }).connection;
    const plan = recitationWarmPlan({ started: lessonStarted, currentUrl: reciteUrl, step: stepKind, nav, nextUrl: nextRecitation, conn });
    if (plan.current) warmPlayer(plan.current);
    if (plan.next) warmRecitation(plan.next);
  }, [lessonStarted, reciteUrl, stepKind, nav, nextRecitation, warmPlayer]);

  // Latest player functions for the executor, which must not restart its
  // activity when they change identity (e.g. the reciter changed).
  const playerRef = useRef({ playWord, playAll, restart, pauseAudio, unlock });
  useEffect(() => {
    playerRef.current = { playWord, playAll, restart, pauseAudio, unlock };
  }, [playWord, playAll, restart, pauseAudio, unlock]);

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

    // The imam: ends when the audio has ended AND minMs has passed.
    const p = playerRef.current;
    const quiz = activity.target === "word" && activity.inExercise === true;
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
      if (!reciteLiveRef.current) return;
      if (quiz) {
        // The learner replayed the exercise's word themselves: it is heard.
        heard = true;
        read = true;
        settle();
      } else {
        dispatch({ type: "pause" });
      }
    };
    const begin = () => {
      if (!live) return;
      reciteLiveRef.current = true;
      ownerRef.current = token;
      if (activity.target === "word") {
        // No timing for this word in the chosen recording: the step lasts its
        // reading time only.
        if (!p.playWord(activity.word)) heard = true;
      } else if (activity.resume) {
        p.playAll();
      } else {
        p.restart();
      }
      if (!read) {
        timers.push(
          window.setTimeout(() => {
            read = true;
            settle();
          }, activity.minMs),
        );
      } else if (heard) {
        timers.push(window.setTimeout(settle, 0));
      }
    };
    // An exercise's word waits for the learner's own replay to stop (one
    // voice at a time), as narration lines do.
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
      reciteLiveRef.current = false;
      waitFor?.removeEventListener("pause", go);
      waitFor?.removeEventListener("ended", go);
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

  // Warm the next narration file (same-origin only).
  const upcoming = upcomingAudio(seq, state);
  const nextUrl =
    upcoming.find((u) => !(activity?.kind === "narrate" && activity.url === u)) ?? null;
  useEffect(() => {
    preload(nextUrl);
  }, [nextUrl, preload]);

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

  // ── Idle reminders: one tick a second while an exercise waits ──
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

  // The learner's own recordings (not the narration, not the lesson's imam).
  useEffect(() => {
    const onStart = (e: Event) => {
      const el = (e as CustomEvent<HTMLAudioElement>).detail;
      if (ownsNarration(el) || reciteLiveRef.current) return;
      foreignAtRef.current = Date.now();
      foreignRef.current = el instanceof HTMLAudioElement ? el : null;
    };
    window.addEventListener(AUDIO_START_EVENT, onStart);
    return () => window.removeEventListener(AUDIO_START_EVENT, onStart);
  }, [ownsNarration]);

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
    set("nexttrack", () => dispatch({ type: forwardIsSkip ? "skip" : "next" }));
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

  // "Dengar" on a word card: the stage's player, so audio never overlaps.
  useEffect(() => {
    const onPlayWord = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n !== "number") return;
      ownerRef.current = null;
      setLearnerWord(true);
      dispatch({ type: "pause" });
      playerRef.current.playWord(n);
    };
    window.addEventListener(PLAY_WORD_EVENT, onPlayWord);
    return () => window.removeEventListener(PLAY_WORD_EVENT, onPlayWord);
  }, []);

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
  const loading =
    activity?.kind === "narrate" ? narrationLoading : activity?.kind === "recite" ? player.loading : null;
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
    playerRef.current.unlock();
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
      // The learner's own listening on the stage's player stops: the lesson
      // takes the voice back (a paused recitation keeps its spot).
      playerRef.current.pauseAudio();
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
    /** "Berikutnya ›", which is "Lewati latihan" on an open exercise. */
    forward() {
      tapped();
      dispatch({ type: view.showSkip ? "skip" : "next" });
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
    lineHasVoice,
    /** Replays so far (the stage keys its exercise with it). */
    replays,
    /** The learner's own word is on the stage's player (see learnerWord). */
    learnerWord,
    /** For the stage's polite live region: the line's sanitised spoken
     *  text, "" while the imam or the narration speaks. */
    announcement,
    player,
    actions,
    router,
  };
}
