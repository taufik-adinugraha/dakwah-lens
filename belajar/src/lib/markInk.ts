/**
 * Where a harakah's ink sits on its dotted circle (components/library/MarkCircle.tsx). Amiri sets
 * a mark above or below the tatweel it is shown on, so centring the glyph's LINE BOX, as the
 * circle did, left fathah and dhammah on the circle's top edge and kasrah on its bottom one
 * (operator 2026-10-12: "the harakat overlaps with the circles, should be inside"). The circle now
 * centres the INK: it moves the glyph by the ink's offset from the line box's centre.
 *
 * Offsets in em of the glyph (+ = below the centre), measured from Amiri as next/font serves it
 * (Google Fonts, 1000 units per em, typo ascent/descent 1124/−634, USE_TYPO_METRICS) by shaping
 * each string with HarfBuzz and taking its ink box: the tatweel carrier and the mark together.
 * In em, so they hold at every text size. A font other than Amiri (it failed to load) gets the
 * same move and stays near the centre.
 */
const TATWEEL = "ـ";

/** Tatweel + one mark: the eight signs of the Harakat page. */
const MARK: Record<string, number> = {
  "َ": -0.272, // fathah
  "ُ": -0.328, // dhammah
  "ِ": 0.449, // kasrah
  "ْ": -0.282, // sukun
  "ّ": -0.257, // shaddah
  "ً": -0.318, // fathatain
  "ٌ": -0.369, // dhammatain
  "ٍ": 0.519, // kasratain
};

/** Whole letters with their marks (a letter that changes as parts join: عَلَىٰ's ىٰ → عَلَيْهِمْ's يْ). */
const LETTER: Record<string, number> = {
  "ىٰ": -0.239,
  "يْ": -0.063,
};

/** The em to move the circle's glyph DOWN by (negative: up) so that its ink sits on the centre.
 *  `letter`: `text` is a whole letter (MarkCircle's `letter`), else the marks set on a tatweel.
 *  Marks not measured one by one (two on one letter) take the mean of theirs; a letter not
 *  measured, none (markInk.test.ts lists every letter the library shows on a circle). */
export function inkShift(text: string, letter = false): number {
  if (letter) return -(LETTER[text] ?? 0);
  const known = [...text.replace(TATWEEL, "")].map((ch) => MARK[ch]).filter((v) => v !== undefined);
  return known.length ? -known.reduce((a, b) => a + b, 0) / known.length : 0;
}

/** Whether `inkShift` has a measurement for it (tests). */
export function inkMeasured(text: string, letter = false): boolean {
  return letter ? text in LETTER : [...text.replace(TATWEEL, "")].every((ch) => ch in MARK);
}
