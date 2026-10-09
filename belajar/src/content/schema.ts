/**
 * Content contract for Belajar Al-Qur'an lessons (plan §4, §7.5).
 *
 * Lessons are static JSON in belajar/content/<surah>/, produced by the
 * offline pipeline (belajar/pipeline/) and authored/reviewed by people. The
 * app validates every file against these schemas at build time, so a
 * malformed or unsourced value fails CI instead of reaching a learner.
 *
 * Hard rules encoded here:
 *  - every Qur'anic string is VERBATIM from the pinned Tanzil text (the
 *    pipeline checks bytes; this schema only shapes it);
 *  - every explanatory claim carries ≥1 SourceRef (kitab + vol/page or a
 *    dataset + version) — "retrieved, never invented";
 *  - every record has a review `status`; "draft" renders with a visible
 *    "menunggu tinjauan ustadz" label, and BELAJAR_PUBLIC builds refuse to
 *    ship drafts (enforced in lib/content.ts).
 */
import { z } from "zod";

export const ReviewStatus = z.enum(["draft", "reviewed"]);

export const SourceRef = z.object({
  /** Kitab or dataset, e.g. "Darwish, I'rab al-Qur'an wa Bayanuh" or "Quranic Arabic Corpus 0.4". */
  kitab: z.string().min(2),
  /** Volume/page, hadith number, or dataset query — whatever locates the claim. */
  ref: z.string().optional(),
  url: z.string().url().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** "1:2:1" = surah 1, ayah 2, word 1 (Hafs, Kufan count; basmalah = 1:1). */
export const WordLoc = z.string().regex(/^\d{1,3}:\d{1,3}:\d{1,3}$/);
export const AyahLoc = z.string().regex(/^\d{1,3}:\d{1,3}$/);

export const CaseState = z.enum([
  "marfu", // رفع
  "manshub", // نصب
  "majrur", // جر
  "majzum", // جزم
  "mabni", // built-in ending, does not change
  "none", // particles with no i'rab role shown
]);
export type CaseState = z.infer<typeof CaseState>;

export const Word = z.object({
  loc: WordLoc,
  /** Uthmani text of the word, verbatim from Tanzil (space-delimited token). */
  ar: z.string().min(1),
  /** Latin transliteration following SKB 158/1987 (Indonesian standard). */
  translit: z.string().min(1),
  /** Short Indonesian gloss for this word in this ayah (in-house, reviewed). */
  gloss: z.string().min(1),
  /** Root letters, e.g. ["ح","م","د"]; null for particles/pronouns. */
  root: z.array(z.string().length(1)).nullable(),
  lemma: z.string().nullable(),
  /** Indonesian word-class label shown to learners: isim, fi'il, huruf, … */
  pos: z.string().min(2),
  /** Pattern (wazn), e.g. "فَعْل"; null when not meaningful. */
  wazn: z.string().nullable(),
  case: z.object({
    state: CaseState,
    /** The sign carrying the case: "dhammah", "fathah", "kasrah", "ya'", "sukun", "—". */
    sign: z.string().min(1),
    /** Position when the ending is built-in, e.g. "mahall nashb". */
    mahall: z.string().optional(),
  }),
  /** ONE plain Indonesian sentence: why the word ends the way it does. */
  why: z.string().min(10),
  /** Lexicon entry for this word's lemma (shared across surahs). */
  lemma_id: z.string().regex(/^[a-z0-9-]+$/).nullable().default(null),
  /** Nahwu-sharaf concepts this word illustrates (Konsep library ids). */
  concepts: z.array(z.string().regex(/^[a-z0-9-]+$/)).default([]),
  /** Its role in the ayah's structure (tarkib), as taught: "mubtada'",
   *  "khabar", "mudhaf ilaih", "na't", "badal", "maf'ul bih", "fi'il",
   *  "huruf jar", "huruf 'athaf", "nā'ib fā'il", … */
  role: z.string().min(2).nullable().default(null),
  /** Collapsed "Pendapat lain" chip: scholarly alternatives, attributed. */
  ikhtilaf: z
    .array(z.object({ point: z.string(), options: z.array(z.string()).min(2) }))
    .default([]),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});
export type Word = z.infer<typeof Word>;

export const Recitation = z.object({
  /** Reciter id, e.g. "Husary_Muallim_128kbps". */
  reciter: z.string(),
  /** Streamed, never re-hosted (plan §6.2). */
  url: z.string().url(),
  /** quran-align segments: [wordIndex (1-based), startMs, endMs]. */
  segments: z.array(z.tuple([z.number().int().positive(), z.number().int().nonnegative(), z.number().int().positive()])),
  credit: z.string(),
});

export const Ayah = z.object({
  loc: AyahLoc,
  surah: z.number().int().positive(),
  ayah: z.number().int().positive(),
  /** Full ayah, verbatim Tanzil Uthmani. */
  ar: z.string().min(1),
  words: z.array(Word).min(1),
  translation: z.object({
    /** VERBATIM provider text, footnote markers ("[1]") included — QuranEnc
     *  forbids modifying its translations. */
    text: z.string().min(1),
    /** The provider's footnotes for this ayah, verbatim, shown under it. */
    footnotes: z.array(z.string().min(1)).default([]),
    /** EXACT label of the source as the provider names it (never "Kemenag 2019" unless it is). */
    source_label: z.string().min(3),
    version: z.string().optional(),
  }),
  recitation: z.array(Recitation).min(1),
  /** Sentence structure (nahwu) of the ayah, taught as a whole. */
  structure: z
    .object({
      /** e.g. "jumlah ismiyyah", "jumlah fi'liyyah", "jumlah fi'liyyah (doa)". */
      type: z.string().min(3),
      /** One or two plain Indonesian sentences: how the words fit together. */
      summary: z.string().min(20),
      /** Word groups worth naming, e.g. the idhafah chain مالك → يوم → الدين. */
      groups: z
        .array(
          z.object({
            /** 1-based word indices within the ayah, in reading order. */
            words: z.array(z.number().int().positive()).min(2),
            label: z.string().min(3),
            concept: z.string().regex(/^[a-z0-9-]+$/).optional(),
          }),
        )
        .default([]),
      sources: z.array(SourceRef).min(1),
      status: ReviewStatus,
    })
    .optional(),
  /** Light tafsir note in Indonesian, rendered from retrieved sources. */
  tafsir: z
    .object({ text: z.string().min(20), sources: z.array(SourceRef).min(1), status: ReviewStatus })
    .optional(),
  status: ReviewStatus,
});
export type Ayah = z.infer<typeof Ayah>;

export const Fact = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Short "Tahukah kamu?" headline. */
  title: z.string().min(5),
  body: z.string().min(10),
  /** Every place the fact refers to, clickable (plan §4.5). */
  locations: z.array(AyahLoc).default([]),
  /** How the number was obtained, shown on the card. */
  method: z.string().min(5),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});
export type Fact = z.infer<typeof Fact>;

export const Hadith = z.object({
  /** Canonical sunnah.com numbering, e.g. "Sahih Muslim 395a". */
  citation: z.string().min(5),
  ar: z.string().min(5),
  /** Reviewed Indonesian translation. */
  id: z.string().min(5),
  grade: z.string().min(3),
  /** Provenance: retrieved from the platform corpus (point id + sha256). */
  provenance: z.object({ collection: z.string(), point: z.string(), sha256: z.string() }).optional(),
  status: ReviewStatus,
});
export type Hadith = z.infer<typeof Hadith>;

// ───────────────────────── Shared libraries ─────────────────────────
// Written once, reviewed once, reused by every surah that needs them
// (plan: "re-use materials across verses/surah"). Spaced review is keyed by
// these ids, so revising رَبّ in An-Nas counts for Al-Fatihah too.

/** A nahwu/sharaf idea explained once ("Apa itu idhafah?"). */
export const Concept = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["nahwu", "sharaf"]),
  /** Learner-facing name, e.g. "Idhafah (sandaran kata)". */
  title: z.string().min(3),
  /** One sentence. */
  summary: z.string().min(15),
  /** 2–4 short plain-Indonesian paragraphs. */
  explanation: z.array(z.string().min(20)).min(1).max(4),
  /** Optional bridge to Indonesian ("sama seperti 'nama Allah'"). */
  bridge: z.string().optional(),
  /** Where it shows up in the lessons — word locs; the first is introduced first. */
  examples: z.array(z.object({ loc: WordLoc, note: z.string().min(5) })).min(1),
  related: z.array(z.string()).default([]),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});
export type Concept = z.infer<typeof Concept>;

/** One lemma's shared entry: meaning, derivation (tashrif), i'lal, counts. */
export const Lexeme = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Lemma in Arabic (from QAC, converted from Buckwalter). */
  lemma_ar: z.string().min(1),
  translit: z.string().min(1),
  root: z.array(z.string().length(1)).nullable(),
  /** Indonesian word class, as on word cards. */
  pos: z.string().min(2),
  /** Core meaning across the Qur'an (not the in-context gloss). */
  meaning: z.string().min(2),
  /** Sharaf: the tashrif row a pesantren learner knows (Amtsilah style). */
  tashrif: z
    .object({
      /** e.g. "bab istif'āl (wazan اِسْتَفْعَلَ)". */
      bab: z.string().min(3),
      /** Ordered forms: label (Indonesian) + Arabic. NOT Qur'anic quotes —
       *  morphological forms, so they are never shown in mushaf typography. */
      forms: z.array(z.object({ label: z.string().min(2), ar: z.string().min(1) })).min(2),
    })
    .optional(),
  /** I'lal: how the written form came about, e.g. nasta'wanu → nasta'īnu. */
  ilal: z
    .array(z.object({ from: z.string().min(1), to: z.string().min(1), rule: z.string().min(10) }))
    .default([]),
  occurrences: z
    .object({ count: z.number().int().nonnegative(), ayat: z.number().int().nonnegative(), method: z.string().min(5) })
    .optional(),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});
export type Lexeme = z.infer<typeof Lexeme>;

/** A root family (Detektif Akar across surahs). */
export const Root = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  letters: z.array(z.string().length(1)).min(2).max(4),
  /** Shared core meaning, with honest caveats where lemmas drift. */
  meaning: z.string().min(5),
  lemmas: z.array(z.string()).min(1),
  occurrences: z.object({ count: z.number().int().nonnegative(), method: z.string().min(5) }),
  sources: z.array(SourceRef).min(1),
  status: ReviewStatus,
});
export type Root = z.infer<typeof Root>;

export const Library = z.object({
  concepts: z.array(Concept),
  lexicon: z.array(Lexeme),
  roots: z.array(Root),
  data_versions: z.record(z.string(), z.string()),
});
export type Library = z.infer<typeof Library>;

export const SurahContent = z.object({
  surah: z.number().int().positive(),
  slug: z.string(),
  name_ar: z.string(),
  name_id: z.string(),
  ayat: z.array(Ayah).min(1),
  facts: z.array(Fact).default([]),
  hadith: z.array(Hadith).default([]),
  /** Pinned inputs, e.g. { tanzil: "uthmani-1.1 sha256:…", qac: "0.4", quran_align: "2016-11-24" }. */
  data_versions: z.record(z.string(), z.string()),
});
export type SurahContent = z.infer<typeof SurahContent>;
