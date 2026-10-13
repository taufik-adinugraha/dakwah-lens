"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AudioLoading } from "@/lib/autoplay/loading";
import { createNarrationVoice, type NarrationHandlers, type NarrationVoice } from "@/lib/autoplay/voice";

import { AUDIO_START_EVENT } from "./useSegmentPlayer";

export type { NarrationHandlers } from "@/lib/autoplay/voice";

/**
 * The narration's Audio element, kept for the whole visit (like the stage's
 * recitation element in useSegmentPlayer): the lesson moves to the next ayah
 * by a client-side navigation, and an element that once played inside a tap
 * may keep playing without one (iOS Safari). The first line after "Mulai"
 * plays inside that tap, because React runs the effects of a click's update
 * before the click handling ends.
 */
let keptNarration: HTMLAudioElement | null = null;
function narrationAudio(): HTMLAudioElement {
  if (!keptNarration) keptNarration = new Audio();
  return keptNarration;
}

/**
 * The autoplay lesson's narration voice: ONE Audio element (created after
 * mount, never rendered) that plays one same-origin file at a time. What it
 * does with the element is src/lib/autoplay/voice.ts (createNarrationVoice,
 * unit-tested with a stand-in element); this hook gives it the two elements,
 * the page-wide start event and React's state.
 *
 * - `play(url, handlers)` starts a file and returns its stop function; the
 *   handlers of a stopped file are dropped, so a late "ended" can never
 *   report for it.
 * - It takes part in the page-wide "one recording at a time" rule
 *   (AUDIO_START_EVENT): starting pauses every other player, and another
 *   player starting stops the narration (onInterrupted).
 * - `preload(url)` warms the next file on a second, muted element that is
 *   never played.
 * - `held(url)` (operator 2026-10-12, plan L18): the object URL of the copy
 *   of a file the page fetched ahead and keeps (src/lib/autoplay/prefetch.ts),
 *   or null. play() and preload() point the element at the copy when one is
 *   held, else at the network URL exactly as before; a copy that does not
 *   play is reported (`onHeldFailed`) and the line starts again from the
 *   network URL — never silence.
 * - `owns(el)` tells whether an audio element is this narration's, for
 *   telling the lesson's own sound from the learner's.
 * - `positionMs()` is the playing file's position (for the karaoke caption,
 *   polled once a frame while a line plays).
 * - `loading` (operator 2026-10-11, narration rule 19: never a silent wait):
 *   from the moment a file this hook plays starts ("play") until sound flows
 *   ("playing"), and again while it stalls ("waiting"); null while it plays
 *   or nothing does. The stage says "Memuat suara narator…" once it lasts.
 * - One narration at a time on a page (the lesson stage's).
 *
 * Narration audio exists only once the operator approved a voice and the
 * render; until then the lesson is caption-only and this hook stays idle.
 */
export function useNarrationPlayer(held?: (url: string) => string | null, onHeldFailed?: (url: string) => void) {
  const voiceRef = useRef<NarrationVoice | null>(null);
  /** The page's copies as the caller last passed them (read when a file starts). */
  const heldRef = useRef(held);
  const failedRef = useRef(onHeldFailed);
  useEffect(() => {
    heldRef.current = held;
    failedRef.current = onHeldFailed;
  }, [held, onHeldFailed]);
  const [loading, setLoading] = useState<AudioLoading | null>(null);

  useEffect(() => {
    const a = narrationAudio();
    a.preload = "auto";
    const pre = new Audio();
    pre.preload = "auto";
    pre.muted = true;
    const voice = createNarrationVoice({
      audio: a,
      pre,
      setLoading,
      announce: () => window.dispatchEvent(new CustomEvent<HTMLAudioElement>(AUDIO_START_EVENT, { detail: a })),
      held: (url) => heldRef.current?.(url) ?? null,
      onHeldFailed: (url) => failedRef.current?.(url),
    });
    const onOtherStart = (e: Event) => voice.otherStarted((e as CustomEvent<HTMLAudioElement>).detail);
    window.addEventListener(AUDIO_START_EVENT, onOtherStart);
    voiceRef.current = voice;
    return () => {
      window.removeEventListener(AUDIO_START_EVENT, onOtherStart);
      voice.dispose();
      voiceRef.current = null;
    };
  }, []);

  /** Plays `url` from its start; returns the function that stops it. */
  const play = useCallback((url: string, h: NarrationHandlers): (() => void) => {
    const voice = voiceRef.current;
    if (!voice) {
      // Not mounted yet (cannot happen after the Mulai tap): report it as a
      // failed file, asynchronously, so the lesson falls back to captions.
      const id = window.setTimeout(h.onError, 0);
      return () => window.clearTimeout(id);
    }
    return voice.play(url, h);
  }, []);

  /** Starts fetching `url` ahead of time (same-origin narration only). */
  const preload = useCallback((url: string | null) => {
    voiceRef.current?.preload(url);
  }, []);

  const owns = useCallback((el: unknown) => voiceRef.current?.owns(el) ?? false, []);

  /** Where the file playing now is, in ms (null when none plays): read
   *  from requestAnimationFrame by the karaoke caption, never in render. */
  const positionMs = useCallback((): number | null => voiceRef.current?.positionMs() ?? null, []);

  return { play, preload, owns, positionMs, loading };
}
