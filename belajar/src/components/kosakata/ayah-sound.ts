/**
 * What an ayah question may play.
 *
 * Operator 2026-11-04, on Level 1's second test: "the screen highlight 'wa man' but the sound only
 * 'man', its confusing. i believe many similar cases like this." An ayah question marks a word in a
 * verse; the speaker played the recording the word's list entry pins, which was chosen for another
 * reason (pipeline/kosakata_voice.py: the word's own spelling, with as little attached as possible).
 * Nothing tied the two together, so the verse marked وَمَن and the speaker said مَن. It was not one
 * word: of the 1,727 tested words with an ayah question, the recording was the marked token for 619.
 *
 * The rule: the speaker belongs to the question only when it says what is marked, and it plays one of
 * two recordings. Tanzil's tokens are compared as written, because a different spelling is a different
 * sound.
 *   1. the word's own recording, where every marked token is spelt exactly as it is; a recording of an
 *      ayah's last word is its stop form, so it counts only for a marked word that ends its ayah too;
 *   2. else the recording of the marked place itself, which the pipeline pins as `example.voice`
 *      where the marked tokens are spelt alike and the verse is short enough to be asked.
 * A question with neither keeps its verse and its options and has no speaker, and plays nothing on a
 * right answer. The question never promises a sound ("Apa arti kata yang ditandai?"), the other kinds
 * mark no word, and a card says which form is heard.
 */
import type { KosakataVoice, KosakataWord } from "@/content/kosakata-schema";
import type { Clip } from "@/content/schema";
import { wordClip } from "@/lib/kosakata-core";
import type { AyahLine } from "@/lib/kosakata-path-core";
import type { PathSource, TestData } from "@/lib/kosakata-path-data";

/** What an ayah question's speaker plays: the recording, where it stands, and the form it says. */
export type AyahSound = { loc: string; clip: Clip; form: string };

/** Whether the recording of `voice` is of every token the line marks. */
export function recordingIsMarkedWord(line: AyahLine, voice: { form: string; final?: true }): boolean {
  const last = line.tokens.length - 1;
  return line.hi.every((i) => line.tokens[i] === voice.form && (!voice.final || i === last));
}

/** Whether `voice` is the recording of a place the line marks, and of a token spelt as every marked one is. */
function recordsTheMark(line: AyahLine, voice: KosakataVoice): boolean {
  return line.hi.every((i) => line.tokens[i] === voice.form) && line.hi.some((i) => voice.loc === `${line.loc}:${i + 1}`);
}

const soundOf = (voice: KosakataVoice): AyahSound => ({ loc: voice.loc, clip: wordClip(voice), form: voice.form });

/** What the ayah question of `word`, marked as `line` says, may play; null when nothing says it. */
export function ayahSoundFor(line: AyahLine, word: Pick<KosakataWord, "voice" | "example">): AyahSound | null {
  if (recordingIsMarkedWord(line, word.voice)) return soundOf(word.voice);
  const own = word.example?.voice;
  return own && recordsTheMark(line, own) ? soundOf(own) : null;
}

/** The sound of each fresh word's ayah question in a test, by the word's key; a word with none is absent. */
export function ayahSounds(src: PathSource, data: TestData): Record<string, AyahSound> {
  const out: Record<string, AyahSound> = {};
  for (const item of data.fresh) {
    if (!item.ayah) continue;
    const word = src.word(Number(item.key.slice(1)));
    const sound = word && ayahSoundFor(item.ayah, word);
    if (sound) out[item.key] = sound;
  }
  return out;
}
