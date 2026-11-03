import { z } from "zod";

/**
 * The Qur'an vocabulary list (content/kosakata/, built by pipeline/build_kosakata.py). The app reads
 * these files per request and trusts them: src/lib/kosakata.test.ts holds every file to these
 * shapes in CI, and pipeline/validate_kosakata.py checks the bytes against the pinned sources.
 */
const Locations = z.array(z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/)).min(1);

export const KosakataSense = z.object({
  /** The gloss in Indonesian. */
  id: z.string().min(1),
  /** The gloss in English. */
  en: z.string().min(1),
  /** Ayat where the word carries this sense: each opens the ayah popup. */
  ayat: Locations,
});

/**
 * The word's recording: our unaltered copy of Quran.com's recording of one real place in the Qur'an
 * (pipeline/kosakata_voice.py chooses it, kosakata_voice.json pins it). A lemma has no recording of
 * its own, so the page says which form is heard and where.
 */
export const KosakataVoice = z.object({
  /** The word as written at that place, verbatim from Tanzil: what is heard. */
  form: z.string().min(1),
  loc: z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}:[1-9]\d{0,2}$/),
  url: z.string().regex(/^\/belajar\/media\/narration\/quran-com\/wbw\/\d{3}_\d{3}_\d{3}\.mp3$/),
  ms: z.number().int().positive(),
  /** The word inside its file, in milliseconds. */
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** true (never false) when that place ends its ayah, so the word is read in its stop form. */
  final: z.literal(true).optional(),
});
export type KosakataVoice = z.infer<typeof KosakataVoice>;

export const KosakataWord = z.object({
  rank: z.number().int().positive(),
  /** QAC's lemma, in Buckwalter: the word's key. */
  lemma: z.string().min(1),
  ar: z.string().min(1),
  translit: z.string().min(1),
  count: z.number().int().positive(),
  ayat: z.number().int().positive(),
  surahs: z.number().int().positive(),
  root: z.array(z.string()),
  forms: z.array(z.string()).min(1),
  senses: z.array(KosakataSense).min(1).max(4),
  review: z.enum(["passed", "corrected", "disputed"]),
  /** The lesson Kosakata entry that explains this word in full, when there is one. */
  lexeme: z.string().optional(),
  voice: KosakataVoice,
});
export type KosakataWord = z.infer<typeof KosakataWord>;

export const KosakataWordsFile = z.object({ words: z.array(KosakataWord).min(1).max(100) });
export type KosakataWordsFile = z.infer<typeof KosakataWordsFile>;

export const KosakataRow = z.object({
  rank: z.number().int().positive(),
  ar: z.string().min(1),
  translit: z.string().min(1),
  count: z.number().int().positive(),
  /** Its first senses, for the list. */
  id: z.string().min(1),
  en: z.string().min(1),
  /** Share of the Qur'an's words covered up to and including this word, in basis points. */
  cum: z.number().int().min(0).max(10000),
  /** Folded search text: headword, transliteration and every gloss. */
  s: z.string().min(1),
  /** The word's recording, as "<loc> <start> <end>": one short string, because the index stays in the container's memory. */
  v: z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}:[1-9]\d{0,2} \d+ \d+$/),
});
export type KosakataRow = z.infer<typeof KosakataRow>;

export const KosakataIndex = z.object({
  /** Pipeline state: there is no review step (plan L11). A public build refuses "draft". */
  status: z.literal("draft"),
  data_versions: z.record(z.string(), z.string()),
  total_tokens: z.number().int().positive(),
  translation: z.object({ source_label: z.string().min(1), version: z.string().min(1) }),
  names: z.record(z.string(), z.string()),
  rows: z.array(KosakataRow).min(1),
});
export type KosakataIndex = z.infer<typeof KosakataIndex>;

export const KosakataAyatFile = z.object({
  sura: z.number().int().min(1).max(114),
  ayat: z.array(
    z.object({
      loc: z.string(),
      ar: z.string().min(1),
      translation: z.object({ text: z.string().min(1), footnotes: z.array(z.string()) }),
    }),
  ),
});
export type KosakataAyatFile = z.infer<typeof KosakataAyatFile>;
