/**
 * Arabic whose marks stand too tall for a line of text (CI 2026-10-17, PR #119's ink check:
 * ٱلنَّفَّٰثَٰتِ of QS 113:4, inline in the Konsep pages, Al-Falaq's word cards and facts, ran 1.4–3.3px
 * into the line above it). Amiri lays a line out on its content area, 1.124em over the baseline;
 * an inline Arabic run at .arabic-inline's line height 2 owns 1.245em over it, and the line above
 * leaves about 0.12em more before its own text. A run whose ink stands higher than that needs a
 * taller line of its own (`ar-tall`, globals.css), and only such a run: every prose line with
 * Arabic given that room would grow by half an em.
 *
 * Which runs: measured with HarfBuzz on the served Amiri over every Arabic word the module shows
 * (1,189 words of the lessons, the Konsep and Kosakata pages, the curriculum, the cheat sheet, the
 * messages; and the 1,300 ayat of the fact cards' dialog), 2026-10-17. The words whose ink stands
 * more than 1.30em over the baseline are exactly those with a grapheme cluster that carries
 *   - a shaddah with a small alif, a tanwin above or a maddah (فَّٰ 1.460em in ٱلنَّفَّٰثَٰتِ;
 *     يٌّ / لٌّ 1.357em in the tashrif forms مَهْدِيٌّ, ضَالٌّ), or
 *   - three marks above one letter, or
 *   - a hamza above an alif with a dhammah or a dammatain (أُ 1.334em, the hadith and kitab quotes)
 * — 14 words of the lesson surfaces, no false alarm among them, none missed in the whole corpus
 * (87 words over 1.34em, the dialog's ayat included). The tallest stack the module draws without
 * one is رَبُّ's, 1.287em. A new stack shape this rule misses is caught by the browser check
 * (scripts/ci/linebreaks-measure.mjs inkMeasure), not silently drawn into its neighbour.
 */

const SHADDAH = "ّ";
const SMALL_ALIF = "ٰ";
const FATHATAN = "ً";
const DAMMATAN = "ٌ";
const DAMMAH = "ُ";
const MADDAH = "ٓ";
const HAMZA_ABOVE = "ٔ";
const ALIF = "ا";
const ALIF_HAMZA_ABOVE = "أ";
/** Marks drawn over the letter (harakat, tanwin, shaddah, sukun, maddah, hamza, small alif, the
 *  mushaf's small high signs). */
const ABOVE = new Set(
  "ًٌَُّْٰٓٔۖۗۘۙۚۛۜ۟ۡۢۥۦ۪ۭۨ۫۬",
);
const MARK = /\p{M}/u;

/** The letters of `text` with their marks: one cluster per base character. */
function clusters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (MARK.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** True when a letter of `text` carries a stack of marks taller than a line of text leaves room for. */
export function tallStack(text: string): boolean {
  for (const c of clusters(text)) {
    const marks = [...c].slice(1);
    if (marks.includes(SHADDAH) && marks.some((m) => m === SMALL_ALIF || m === FATHATAN || m === DAMMATAN || m === MADDAH)) return true;
    if (marks.filter((m) => ABOVE.has(m)).length >= 3) return true;
    const hamzaAlif = c[0] === ALIF_HAMZA_ABOVE || (c[0] === ALIF && marks.includes(HAMZA_ABOVE));
    if (hamzaAlif && (marks.includes(DAMMAH) || marks.includes(DAMMATAN))) return true;
  }
  return false;
}

/** The class an INLINE Arabic run takes for its marks: `ar-tall` when it has such a stack. (A box of
 *  Arabic — a tile, a word card's word — takes `ar-clear` instead, whatever its text.) */
export const arTall = (text: string): string => (tallStack(text) ? "ar-tall" : "");
