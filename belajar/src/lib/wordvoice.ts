/**
 * The voice of a Qur'anic word or form (operator 2026-10-14: "for all quran word by word should be
 * replaced by this, not using truncated voice from imam … because in some parts the truncation are
 * not clean"). One recording per word, by the narrator Kang Nandar (eleven_multilingual_v2), the
 * word written in PLAIN LETTERS — pipeline/wordvoice.py is the builder and the long explanation of
 * why; content/wordvoice.json the result. No React, no DOM.
 *
 * A recording is handed out as a `Clip` {url, start: 0, end: ms}, the shape the page's clip player
 * already plays (src/hooks/useClipPlayer.ts), so nothing downstream learns a new kind of source.
 */
import raw from "../../content/wordvoice.json";

import type { Clip } from "@/content/schema";

import { voiceFrom, type WordVoiceManifest } from "./wordvoice-core";

export { plainLetters, voiceFrom, type WordVoiceEntry, type WordVoiceManifest } from "./wordvoice-core";

/** The recording of `ar` (any Uthmani string of the content), as a Clip; null: none. */
export const wordVoice = (ar: string): Clip | null => voiceFrom(raw as WordVoiceManifest, ar);
