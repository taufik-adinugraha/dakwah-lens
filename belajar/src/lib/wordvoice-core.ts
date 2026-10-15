/**
 * The voice of a Qur'anic word or form (operator 2026-10-14: "for all quran word by word should be
 * replaced by this, not using truncated voice from imam … because in some parts the truncation are
 * not clean"). One recording per word: since 2026-10-15 (operator: the narrator's word takes were
 * "still lacking"; "use quran.com, mention the credit") Quran.com's word-by-word recording of every
 * text that is a word at a real place in the Qur'an, and the narrator Kang Nandar's
 * (eleven_multilingual_v2, the word written in PLAIN LETTERS) for the rest — pipeline/wordvoice.py
 * is the builder and the long explanation of why; content/wordvoice.json the result. Pure: no
 * React, no DOM.
 *
 * The pure part (no JSON import): the rule and the lookup, for the example engine and its checker.
 * A recording is handed out as a `Clip` {url, start, end, source}, the shape the page's clip player
 * already plays (src/hooks/useClipPlayer.ts); `source` only tells the buttons what to call it.
 */
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

/** Where a word's recording comes from (pipeline/wordvoice.py, operator 2026-10-15): Quran.com's
 *  word-by-word recording of the word's place in the Qur'an (copied unaltered to our media store),
 *  or the narrator Kang Nandar's AI voice (ElevenLabs) for a part of a word, a letter, a teaching
 *  form or a run — what each word button says it plays ("Rekaman Quran.com" / "suara AI"). */
export type VoiceSource = "quran.com" | "elevenlabs";

export type WordVoiceEntry = {
  source?: VoiceSource;
  loc?: string;
  audio?: { url: string; ms: number; sha256: string; start?: number; end?: number; upstream?: string };
};
export type WordVoiceManifest = { words: Readonly<Record<string, WordVoiceEntry>> };

/** The recording of `ar` (any Uthmani string of the content), as a Clip; null: none yet. A
 *  Quran.com file plays the word inside it, [start, end] (its silence left out, the file itself
 *  unaltered); the narrator's file is the word alone, from 0 to its length. */
export function voiceFrom(manifest: WordVoiceManifest, ar: string): Clip | null {
  const e = manifest.words[plainLetters(ar)];
  const a = e?.audio;
  if (!a) return null;
  if (e.source === "quran.com") return { url: a.url, start: a.start ?? 0, end: a.end ?? a.ms, source: "quran.com" };
  return { url: a.url, start: 0, end: a.ms, source: "elevenlabs" };
}

/** The recording is Quran.com's (a word at its place in the Qur'an), not the AI narrator's. */
export const isQuranCom = (c: { source?: VoiceSource } | null | undefined): boolean => c?.source === "quran.com";
