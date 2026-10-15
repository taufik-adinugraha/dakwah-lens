/**
 * The voice of a Qur'anic word or form (operator 2026-10-14: "for all quran word by word should be
 * replaced by this, not using truncated voice from imam … because in some parts the truncation are
 * not clean"). One recording per word: Quran.com's word-by-word recording for a word at its place
 * in the Qur'an, the narrator Kang Nandar's AI voice for the rest (operator 2026-10-15; see
 * wordvoice-core.ts) — pipeline/wordvoice.py is the builder; content/wordvoice.json the result.
 * No React, no DOM.
 *
 * A recording is handed out as a `Clip` {url, start, end, source}, the shape the page's clip player
 * already plays (src/hooks/useClipPlayer.ts).
 */
import raw from "../../content/wordvoice.json";

import type { Clip } from "@/content/schema";

import { voiceFrom, type WordVoiceManifest } from "./wordvoice-core";

export { isQuranCom, plainLetters, voiceFrom, type VoiceSource, type WordVoiceEntry, type WordVoiceManifest } from "./wordvoice-core";

/** The recording of `ar` (any Uthmani string of the content), as a Clip; null: none. */
export const wordVoice = (ar: string): Clip | null => voiceFrom(raw as WordVoiceManifest, ar);
