/**
 * Which ayah questions may play the word's recording.
 *
 * Operator 2026-11-04, on Level 1's second test: "the screen highlight 'wa man' but the sound only
 * 'man', its confusing. i believe many similar cases like this." An ayah question marks the word in a
 * verse that shows its first meaning; the speaker plays the recording the word's list entry pins,
 * which was chosen for another reason (pipeline/kosakata_voice.py: the word's own spelling, with as
 * little attached as possible). Nothing tied the two together, so the verse marked وَمَن and the
 * speaker said مَن.
 *
 * It was not one word. Measured on the real data (2026-11-04), of the 1,727 tested words that get an
 * ayah question, the recording is of the marked word for 619 (36%). In the other 1,108 the marked token
 * is spelt otherwise than the recording: another form of the word (503), an extra prefix such as wa-,
 * fa- or al- (239), an extra ending such as a pronoun or the plural (192), the same letters with other
 * vowel marks (129), a phrase of several tokens (37), or the recording being the longer one (8).
 * In Level 1, batch 2, it was 4 of the 10 words.
 *
 * The rule: the speaker belongs to the question only when it says what is marked. Tanzil's tokens are
 * compared as written, because a different spelling is a different sound. A recording of an ayah's
 * last word is its stop form (project_voiced_examples_waqf), so it is the marked word only where that
 * word ends its ayah as well. A question that fails the rule keeps its verse and its options and has no
 * speaker, and plays nothing on a right answer. The question never promises a sound ("Apa arti kata
 * yang ditandai?"), the other kinds mark no word, and a card says which form is heard.
 *
 * It lives here and not in src/lib/kosakata-path-data.ts because a change under src/lib re-runs the
 * whole pipeline job in CI (deploy-belajar.yml, PIPELINE_INPUTS), about 1h50 against 40 minutes.
 */
import type { AyahLine } from "@/lib/kosakata-path-core";
import type { PathSource, TestData } from "@/lib/kosakata-path-data";

/** Whether the recording of `voice` is of every token the line marks. */
export function recordingIsMarkedWord(line: AyahLine, voice: { form: string; final?: true }): boolean {
  const last = line.tokens.length - 1;
  return line.hi.every((i) => line.tokens[i] === voice.form && (!voice.final || i === last));
}

/** The keys of a test's words whose ayah question may play the word's recording. */
export function soundedAyahKeys(src: PathSource, data: TestData): string[] {
  const keys: string[] = [];
  for (const item of data.fresh) {
    if (!item.ayah) continue;
    const word = src.word(Number(item.key.slice(1)));
    if (word && recordingIsMarkedWord(item.ayah, word.voice)) keys.push(item.key);
  }
  return keys;
}
