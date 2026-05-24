/**
 * Shared translation-card sizing + truncation helpers.
 *
 * Every flyer layout that surfaces a kitab translation card has hit
 * the same bug at some point: a long hadith narration (e.g. 700+
 * chars of "ḥaddatsanā fulān…" with multiple clauses) spills past
 * the bottom edge of the 1080×1080 canvas, clipping the citation
 * line or — worse — getting cut mid-word.
 *
 * Centralising the truncation + sizing logic here so every layout
 * gets the same behaviour and a single tweak fixes all of them.
 */

/**
 * Cut `raw` at the last sentence/comma/word boundary BEFORE `maxChars`
 * so the ellipsis never lands mid-word. Preference order:
 *   1. last sentence-end (`. ! ?`) in the back half of the budget
 *   2. last comma / semicolon / colon
 *   3. last whitespace
 *   4. hard cut as the final fallback
 * Returns `raw` unchanged when it already fits.
 */
export function smartTruncateTranslation(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) return raw;
  const head = raw.slice(0, maxChars);
  const sentenceCut = head.search(/[.!?](?=[^.!?]*$)/);
  const halfway = Math.floor(maxChars * 0.5);
  if (sentenceCut >= halfway) {
    return head.slice(0, sentenceCut + 1) + " …";
  }
  const commaCut = head.lastIndexOf(",");
  if (commaCut >= halfway) {
    return head.slice(0, commaCut) + " …";
  }
  const wordCut = head.lastIndexOf(" ");
  if (wordCut > 0) {
    return head.slice(0, wordCut).replace(/[,;:.]$/, "") + " …";
  }
  return head + "…";
}

/**
 * Per-layout char budget for the translation card. Layouts that
 * dedicate ~half the canvas to the translation can hold more text;
 * the photo-split layouts need to be tighter so the image stays
 * dominant. Tweak via this map rather than scattered magic numbers.
 *
 * These values are calibrated against the user-facing layout HEIGHT
 * available for the translation block:
 *   - dua-hero    : ~280px @ 15-22px → up to ~760 chars
 *   - split-image : ~280px @ 18px    → up to ~520 chars
 *   - hero-ayat   : ~220px @ 18px    → up to ~440 chars
 *   - hero-headline: ~200px @ 18px   → up to ~400 chars
 *   - quote-card  : ~340px @ 20px    → up to ~640 chars
 */
export const TRANSLATION_MAX_CHARS = {
  duaHero: 760,
  splitImage: 520,
  heroAyat: 440,
  heroHeadline: 400,
  quoteCard: 640,
} as const;
