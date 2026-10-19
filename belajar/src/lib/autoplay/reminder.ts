/**
 * The REMINDER CARD of an earlier ayah (operator 2026-10-18: "in some ayat it's explain like this:
 * it becomes na'at from lafaz Allah in ayat-2, better to remind user what that previous ayat looks
 * like and give more clear explanation. check any similar cases").
 *
 * An ayah that continues an earlier one says so ("Ayat ini melanjutkan ayat kedua.") and cites the
 * earlier word its word depends on ("… na’t, yaitu sifat, bagi ٱللَّهِ (Allāhi) di ayat kedua");
 * which ayat continue which is the pipeline's data (authored/<slug>.structure.json `continues`).
 * While such a line is on, the stage shows the earlier ayah: its words in the content's bytes and
 * in their order, the cited word(s) HIGHLIGHTED, its translation (the content's own, verbatim) and
 * its number. The manifest line names the card (`reminder`: [{ayah, words}], built by
 * pipeline/validate_narration.py reminder_of and held to the data there both ways); this module
 * turns it, with the surah's content, into what the card draws — no Arabic is typed anywhere.
 *
 * Pure (type imports only).
 */
import type { ReminderRef } from "./types";

/** The surah content a card reads: each ayah's words (their bytes) and its translation. */
export type ReminderSource = {
  ayat: readonly { ayah: number; words: readonly { ar: string }[]; translation: { text: string } }[];
};

/** One earlier ayah as the page hands it to the stage: its words' bytes, in order, and its
 *  translation as the content gives it. */
export type ReminderText = { words: readonly string[]; translation: string };

/** One earlier ayah as the card draws it. */
export type ReminderAyah = {
  ayah: number;
  /** Its words in reading order (`n` 1-based; `hit`: a word the line cites, highlighted). */
  words: { n: number; ar: string; hit: boolean }[];
  translation: string;
};

/** The earlier ayat a lesson's cues show on a reminder card, as the page passes them to the
 *  stage: only those (a lesson's page carries the bytes it needs, not the whole surah). */
export function reminderTexts(
  seq: { steps: readonly { cues: readonly { reminder: readonly ReminderRef[] | null }[] }[] },
  surah: ReminderSource,
): Record<number, ReminderText> {
  const want = new Set(seq.steps.flatMap((s) => s.cues.flatMap((c) => (c.reminder ?? []).map((r) => r.ayah))));
  const out: Record<number, ReminderText> = {};
  for (const a of surah.ayat) {
    if (want.has(a.ayah)) out[a.ayah] = { words: a.words.map((w) => w.ar), translation: a.translation.text };
  }
  return out;
}

/** What the card draws for a line's `reminder` (null / empty: no card). An ayah the page did not
 *  hand over is left out (the stage then draws what it has; reminderProblems names it). */
export function reminderAyat(refs: readonly ReminderRef[] | null | undefined, texts: Readonly<Record<number, ReminderText>>): ReminderAyah[] {
  return (refs ?? []).flatMap((r) => {
    const t = texts[r.ayah];
    if (!t) return [];
    const hit = new Set(r.words);
    return [{ ayah: r.ayah, words: t.words.map((ar, i) => ({ n: i + 1, ar, hit: hit.has(i + 1) })), translation: t.translation }];
  });
}

/** What is wrong with a line's `reminder` in the lesson of ayah `current` (empty when fine): each
 *  card is of an EARLIER ayah of the surah, once, in order, and highlights words of that ayah. */
export function reminderProblems(refs: readonly ReminderRef[] | null | undefined, surah: ReminderSource, current: number): string[] {
  const out: string[] = [];
  let last = 0;
  for (const r of refs ?? []) {
    const a = surah.ayat.find((x) => x.ayah === r.ayah);
    if (!a || r.ayah >= current) out.push(`a card of ayah ${r.ayah}, which is no earlier ayah of the surah (the lesson is ayah ${current})`);
    else if (!r.words.length || r.words.some((w) => !Number.isInteger(w) || w < 1 || w > a.words.length)) {
      out.push(`the card of ayah ${r.ayah} highlights word(s) ${r.words.join(", ")}, and that ayah has ${a.words.length} words`);
    }
    if (r.ayah <= last) out.push(`the cards are not one per ayah in order (${r.ayah} after ${last})`);
    last = r.ayah;
  }
  return out;
}
