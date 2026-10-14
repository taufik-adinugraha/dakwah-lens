/**
 * The voice of a Qur'anic word or form (operator 2026-10-14: "for all quran word by word should be
 * replaced by this, not using truncated voice from imam … because in some parts the truncation are
 * not clean"). One recording per word, by the narrator Kang Nandar (eleven_multilingual_v2), the
 * word written in PLAIN LETTERS — pipeline/wordvoice.py is the builder and the long explanation of
 * why; content/wordvoice.json the result. Pure: no React, no DOM.
 *
 * A recording is handed out as a `Clip` {url, start: 0, end: ms}, the shape the page's clip player
 * already plays (src/hooks/useClipPlayer.ts), so nothing downstream learns a new kind of source.
 */
import raw from "../../content/wordvoice.json";

import type { Clip } from "@/content/schema";

/** Alif wasla and dagger alif as alif, the small sukun as a sukun, the small high signs dropped
 *  and the dotless ya after a kasrah as a ya (pipeline/wordvoice.py `plain`; wordvoice.test.ts keeps
 *  the two equal on the content). */
const TO_LETTER: Readonly<Record<number, string>> = { 0x0671: "ا", 0x0670: "ا", 0x06e1: "ْ" };
const isDropped = (cp: number) => (cp >= 0x06d6 && cp <= 0x06dc) || cp === 0x06df || cp === 0x06e0 || (cp >= 0x06e2 && cp <= 0x06ed);

const VOWELS = (cp: number) => cp >= 0x064b && cp <= 0x0651; // tanwin, fathah, dhammah, kasrah, shaddah
const isMark = (cp: number) => (cp >= 0x064b && cp <= 0x0652) || cp === 0x0670 || isDropped(cp);
const MADD = new Set([0x0627, 0x0649, 0x064a, 0x0648]); // alif, alif maqsura, ya, waw

/** The word's last letter is a madd letter with no vowel of its own (fī, nā — not huwa). */
function endsInMadd(word: string): boolean {
  const cps = [...word].map((c) => c.codePointAt(0)!);
  let i = cps.length - 1;
  let voweled = false;
  while (i >= 0 && isMark(cps[i])) {
    if (VOWELS(cps[i])) voweled = true;
    i--;
  }
  return i >= 0 && MADD.has(cps[i]) && !voweled;
}

export function plainLetters(text: string): string {
  // an alif wasla right after a long vowel is not read (pipeline/wordvoice.py plain)
  const words = text.trim().split(/\s+/u);
  for (let i = 1; i < words.length; i++) if (words[i].startsWith("\u0671") && endsInMadd(words[i - 1])) words[i] = words[i].slice(1);
  let out = "";
  for (const ch of words.join(" ")) {
    const cp = ch.codePointAt(0)!;
    if (isDropped(cp)) continue;
    out += TO_LETTER[cp] ?? ch;
  }
  // kasrah + alif maqsura (alladhī, fī) is the long ī: a ya with its dots; after a fathah it stays (hudā)
  // a ta marbuta that carries a vowel (al-jinnati) is the open ta: the model reads ة as a final "h"
  return out.replaceAll("\u0650\u0649", "\u0650\u064a").replace(/\u0629(?=[\u064b-\u0650])/gu, "\u062a");
}

export type WordVoiceEntry = { audio?: { url: string; ms: number; sha256: string } };
export type WordVoiceManifest = { words: Readonly<Record<string, WordVoiceEntry>> };

/** The recording of `ar` (any Uthmani string of the content), as a Clip; null: none yet. */
export function voiceFrom(manifest: WordVoiceManifest, ar: string): Clip | null {
  const a = manifest.words[plainLetters(ar)]?.audio;
  return a ? { url: a.url, start: 0, end: a.ms } : null;
}

export const wordVoice = (ar: string): Clip | null => voiceFrom(raw as WordVoiceManifest, ar);
