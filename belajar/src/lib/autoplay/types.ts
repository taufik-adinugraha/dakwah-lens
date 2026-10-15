/**
 * Autoplay lesson ("Putar otomatis") — shared types.
 *
 * One ayah is played as a fixed SEQUENCE of steps (sequence.ts, built from
 * the content) driven by a pure, serialisable state MACHINE (machine.ts).
 * The UI executes exactly one ACTIVITY at a time (narration line, imam
 * recitation, silent wait) and reports back with events; so narration and
 * the imam's recitation can never overlap.
 *
 * EXAMPLE BEATS (operator 2026-10-12: "each explanation should be followed by
 * examples (visual + voice)", "not only for harakah, but also for all rules";
 * plan L20; which examples: examples.ts): after a rule is explained the stage
 * shows one example of it and it is HEARD — the narrator Kang Nandar's own
 * recording of that word or form (content/wordvoice.json, an AI voice;
 * operator 2026-10-14), never a cut of the imam's recitation. A beat has NO
 * narration line: its caption is on-screen text only (AutoplayTexts.example),
 * and nothing is rendered for it here (the word's recording already exists).
 *
 * EVERY QUR'ANIC WORD PLAYED ON ITS OWN (operator 2026-10-14: "for all quran word
 * by word should be replaced by this, not using truncated voice from imam"): a
 * word's opening step, the ayah's last word once more, an example beat, the
 * word Dengar dan klik asks about, a word the learner clicks — each is that
 * word's recording by the narrator (AutoplaySequence.wordVoices), played on
 * the lesson's example player. The imam (Mishary Alafasy) recites WHOLE ayat
 * only: the recitation step and the recap, the mushaf line following him.
 *
 * Narration lines are keyed by the step-id contract shared by every part of
 * the autoplay build (and by pipeline/build_narration.py + validate_narration.py):
 *   "${slug}:${ayah}:${part}"   part ∈ intro | recite | map:new | map:learnt |
 *                                      map:later | primer:${k} | w${n} |
 *                                      w${n}:compose:${k} | structure | structure:${k} |
 *                                      concept:${id} |
 *                                      ex:${exerciseKey}:intro |
 *                                      ex:${exerciseKey}:${n}:why |
 *                                      learned | recap | next | done
 *   (map:* / learned: the lesson map's lines, only in a surah that has one —
 *    what this ayah brings, said right after the imam's recitation, one line
 *    per group of its card (what is new; what has been learnt so far and comes
 *    up again; what is taught later and how many next-level topics), and what
 *    it taught, said right before the recap; operator 2026-10-13, plan L23 and
 *    L26, content/map/${slug}.json, lessonMap.ts;
 *    concept:${id}: a "Konsep baru" line of a step the curriculum teaches in
 *    this ayah's lesson — a Konsep record's id (a whole record) or the id of a
 *    step with its own text; content/curriculum.json, curriculum.ts;
 *    primer:${k}: the k-th line of the harakat primer that opens an ayah;
 *    w${n}:compose:${k}: the k-th line of word n's composition — both play
 *    over an animation frame, the manifest's `frame`; operator 2026-10-10,
 *    narration rule 14, content/compose/${slug}.json; ex:${key}:${n}:why:
 *    the explanation of question n's correct answer, said after "Benar." or
 *    "Ini jawabannya." — operator 2026-10-10; the questions are
 *    content/quiz/${slug}.json's)
 *   "shared:${key}"             start | resume | correct | revealed |
 *                               reminder | skip_offer | surah_done
 *   "shared:ex:${exerciseKey}:${part}"   the prompt for one control of an
 *                               exercise, the same on every ayah — unless the
 *                               ayah's manifest has its own
 *                               "${slug}:${ayah}:ex:${exerciseKey}:${part}"
 * A line longer than the narration pipeline's limit is stored split, as
 * "<id>:a", "<id>:b", … (two or more, contiguous); it is still ONE line
 * here, played part after part.
 * Manifests: content/narration/${slug}.json and content/narration/shared.json
 * (NarrationManifest below).
 *
 * Hard rules this module encodes (plan §6.1 A1, L11; operator review of the
 * Al-Fatihah 1 preview, 2026-10-10):
 *  - the narrator NEVER voices Qur'anic words: no transliteration of a
 *    lesson word in NARRATION text, and Arabic script there only as a
 *    pronunciation-dictionary term (pipeline/authored/pronunciation.json
 *    "speak": grammar terms such as نَعْت, said from Arabic script so the
 *    voice says them right);
 *  - captions show what is spoken: the manifest's `display` (dictionary
 *    terms as "na’t (نَعْت)", a letter as in the ayah, بِ) or, without a
 *    manifest, the engine's own caption, which carries no Arabic script;
 *  - narration audio is same-origin only, under /belajar/media/narration/;
 *  - nothing here promises a human review.
 *
 * Pure TypeScript: no React, no Next, no zod at runtime (type imports only),
 * so `npx tsx scripts/autoplay-check.ts` can run it without node_modules.
 */
import type { Pace } from "../lessonSteps";

export type { Pace };

// ───────────────────────────── Exercises ─────────────────────────────

/** The exercises, in the order the lesson page renders them: the warm-up that opens a lesson,
 *  then the five that follow its explanations. Mirrors EXERCISE_KEYS in
 *  components/exercises/guide.ts (parity-tested) and pipeline/quiz.py. */
export const EXERCISE_KEYS = ["word-kind", "tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory"] as const;
export type ExerciseKey = (typeof EXERCISE_KEYS)[number];

/**
 * The exercises a lesson asks BEFORE its words, right after what the ayah brings (the lesson
 * map's steps): the warm-up "isim, fi'il, or huruf?" (operator 2026-10-13: "i think it's better
 * in every ayat we identify first each words fall into which category: ismu, fi'il or harf. it's
 * kind of exercise, kind of warming up"). Every other exercise follows the structure. Mirrors
 * pipeline/quiz.py OPENING_EXERCISES.
 */
export const OPENING_EXERCISES: readonly ExerciseKey[] = ["word-kind"];

/** The control inside an exercise the learner should use next. Mirrors
 *  GUIDE_PARTS in components/exercises/guide.ts (parity-tested). */
export const GUIDE_PARTS = ["play", "options", "words", "bins", "reveal", "next"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

/** The parts each exercise can point at, in the order a question meets
 *  them (the first is where a fresh exercise starts). Mirrors
 *  EXERCISE_GUIDE_PARTS in components/exercises/guide.ts (parity-tested). */
export const PARTS_OF: Readonly<Record<ExerciseKey, readonly GuidePart[]>> = {
  "word-kind": ["options", "reveal", "next"],
  "tap-word": ["play", "options", "reveal", "next"],
  "why-harakat": ["options", "reveal", "next"],
  "sort-case": ["words", "bins", "reveal"],
  "label-role": ["options", "reveal", "next"],
  "wazn-factory": ["options", "reveal", "next"],
};

// ───────────────────────────── Guide targets ─────────────────────────────

/** A control inside one exercise, e.g. "exercise:tap-word:play". */
export type ExerciseGuideTarget = `exercise:${ExerciseKey}:${GuidePart}`;

/**
 * What the spotlight points at (the UI marks the element with
 * `data-guide="<target>"`):
 * - "mushaf-line"        the ayah as the imam recites it
 * - "mushaf-word:${n}"   word n (1-based) on the mushaf line
 * - "word-card"          the word shown inside the stage (Arabic + meaning)
 * - "exercise:…"         a control of the exercise (see GuidePart)
 * - "skip"               the large "Lewati latihan" button
 * - "lanjut"             the "Lanjut" button of the "Tunggu saya" mode
 */
export type GuideTarget =
  | "mushaf-line"
  | `mushaf-word:${number}`
  | "word-card"
  | "skip"
  | "lanjut"
  | ExerciseGuideTarget;

/** A spotlight: never colour-only — the UI draws a thick ring AND this
 *  label (senior-ux §3.2); with reduced motion the ring is static. */
export type Guide = { target: GuideTarget; label: string };

// ───────────────────────────── Narration ─────────────────────────────

/** Generic lines in content/narration/shared.json ("shared:${key}"),
 *  besides the exercise prompts "shared:ex:${key}:${part}". No "try_again"
 *  since 2026-10-11: a wrong pick is not voiced (operator 2026-10-10: "give
 *  narration/voice only for the correct answer"); the exercise shows its
 *  "Belum tepat" note on screen. */
export const SHARED_KEYS = [
  "start",
  "resume",
  "correct",
  "revealed",
  "reminder",
  "skip_offer",
  "surah_done",
] as const;
export type SharedKey = (typeof SHARED_KEYS)[number];

/** One rendered narration file (ElevenLabs, house settings; rendered only
 *  after the operator's go — never by this module). */
export type NarrationAudio = {
  /** Same-origin, under /belajar/media/narration/ (served by Caddy). */
  url: string;
  /** Duration in milliseconds. */
  ms: number;
  /** sha256 of the file (immutable, content-hashed media). */
  sha256: string;
};

/** One spoken word of a narration file, as the manifest stores it (from
 *  ElevenLabs /with-timestamps, whose alignment is 1:1 with the characters
 *  sent): `t` its on-screen text (a dictionary term in its display form,
 *  "na’t (نَعْت)"), `s` / `e` when the narrator starts / ends it, in seconds
 *  from the start of that file. */
export type CaptionToken = { t: string; s: number; e: number };

/** A caption word as the sequence ships it to the page (compact): text,
 *  start and end in milliseconds from the start of its file. */
export type KaraokeWord = readonly [text: string, startMs: number, endMs: number];

/** One file of a line as played: the manifest id it came from ("<id>", or
 *  "<id>:a", "<id>:b" … for a split line), and its words with their times
 *  when the manifest has them (the karaoke caption). */
export type NarrationSegment = NarrationAudio & { id: string; words?: KaraokeWord[] };

/** One manifest line (the contract between the narration pipeline and the
 *  stage; pipeline/README.md "Narasi"). */
export type NarrationLine = {
  /** The SPOKEN text, exactly as sent to the voice (dictionary applied). */
  text: string;
  /** The full caption: what is spoken, with dictionary terms in their
   *  display form and letters as in the ayah. Shown when there are no
   *  `tokens` (and as the caption-only text). */
  display?: string;
  /** Word numbers of this ayah the screen highlights while the line is on
   *  screen; [] none, [0] the whole ayah. */
  highlight?: number[];
  /** The word ("1:1:3") the large word card shows while the line plays. */
  focus?: string | null;
  /** A primer / compose line: the animation frame (1-based) on screen while
   *  it plays. */
  frame?: number;
  audio?: NarrationAudio;
  /** Word timings of `audio` (only with audio). */
  tokens?: CaptionToken[];
};

/** content/narration/${slug}.json and content/narration/shared.json. */
export type NarrationManifest = {
  version: number | string;
  voice: null | { id: string; name: string; model: string };
  lines: Record<string, NarrationLine>;
};

/** One entry of the pronunciation dictionary (kamus pelafalan,
 *  pipeline/authored/pronunciation.json): the term, the exact form the
 *  narrator is sent (`speak`: Arabic script, or a fixed Latin respelling
 *  for a heavy letter, "idhofah"), and its caption form (`display`). */
export type PronunciationTerm = { term: string; speak: string; display: string };
export type Pronunciation = { terms: PronunciationTerm[] };

// ───────────────────────────── Sequence ─────────────────────────────

/**
 * One narration line inside a step: its id (contract above), the caption
 * shown while it plays and where the spotlight points. The caption is the
 * manifest's `display` when the line has one (what is spoken, dictionary
 * terms as "na’t (نَعْت)"), else written from the content by the engine's
 * texts (Latin transliteration at most, never Arabic script). The SPOKEN
 * text lives in the manifest (`spoken`).
 */
export type Cue = {
  /** Contract id (never a ":a"/":b" split part). */
  line: string;
  /** Full caption, whitespace-normalised. */
  caption: string;
  /** The manifest's display text (split parts joined), or null: then the
   *  caption is the engine's own and carries no Arabic script. */
  display: string | null;
  /** Words (1-based) the mushaf line highlights while this line is on
   *  screen — the whole ayah, the word explained, a concept's words. From
   *  the manifest's `highlight` ([0] = every word), else by the line's
   *  kind. Empty for shared lines. */
  highlight: number[];
  /** The word (1-based) the large word card shows while this line is on
   *  screen (the manifest's `focus`, else the word a w${n} line explains);
   *  null: no card. */
  focus: number | null;
  /** A primer / compose line: the frame (1-based) of the step's animation
   *  shown while it plays (the manifest's `frame`, else the composition's
   *  own line plan); null otherwise. */
  frame: number | null;
  /** The caption cut into ≤180-character parts (senior-ux §3.5): shown one
   *  at a time — by reading time without audio, by audio position with. */
  parts: string[];
  /** Spotlight while this line plays (empty: keep the step's). */
  guides: Guide[];
  /** The line's audio files in play order (one, or the split parts); empty
   *  → caption-only (reading-time pace). All parts or none. */
  audio: NarrationSegment[];
  /** What the narrator says (the manifest's text, split parts joined);
   *  null without a manifest entry. Never a Qur'anic word, in any spelling;
   *  Arabic script only as a pronunciation-dictionary term (checked). */
  spoken: string | null;
  /** Word places (1-based) the spoken line names in its own ayah ("kata
   *  kedua", "kata ketiga dan keempat"). Empty without `spoken`. */
  refs: number[];
};

// ───────────────────────────── Example beats ─────────────────────────────

/** A recording the example player plays from `start` to `end` (ms): since 2026-10-14 the
 *  narrator's recording of a word or form, whole — {url, start: 0, end: its length}
 *  (src/lib/wordvoice.ts, content/wordvoice.json). Until then [start, end) of a word in an ayah's
 *  streamed EveryAyah recording (`last`: it ended its ayah). The player seeks and stops
 *  (src/hooks/useExamplePlayer.ts). */
export type ExampleClip = { url: string; start: number; end: number; last?: boolean };

/** What an example beat exemplifies: a concept just introduced, or the bentuk dasar a composition's
 *  `base` frame shows. (Until 2026-10-13 also "word": the lesson's own word recited again after
 *  its line; plan L24 — a word is recited once, at its opening step.) */
export type ExampleOf = "concept" | "base";

/**
 * One example beat of a step: the stage shows the example (its Arabic comes from the content
 * bytes, by `id`; the sequence carries none) with `caption`, and the imam recites it.
 */
export type ExampleBeat = {
  /** Unique in the sequence, and the key of the stage's drawing of it: "concept:huruf-jar:1",
   *  "w1:base:2" (word 1's composition, frame 2). */
  id: string;
  of: ExampleOf;
  /** The cue of its step it comes after (index); -1: it opens the step (an example step). */
  after: number;
  /** The clip key of what is recited: a word ("1:1:1") or a run ("55:78:1-2"). */
  key: string;
  /** A word of THIS ayah (1-based): lit on the mushaf line, and heard as that word's recording
   *  (AutoplaySequence.wordVoices); null: another ayah's word or a form, `clip` (its recording).
   *  Exactly one of `word` and `clip` is set. */
  word: number | null;
  clip: ExampleClip | null;
  /** The composition frame on screen while it plays (a base example), else null. */
  frame: number | null;
  /** On-screen text while it plays ("Contoh: …"): never spoken, never Arabic script. */
  caption: string;
  /** The caption cut into ≤180-character parts. */
  parts: string[];
};

export type StepKind =
  | "intro"
  | "recite_ayah"
  /** The lesson map's opening (plan L23, L26): what this ayah brings, ONE step per group of its
   *  card, in step with the narrator — "map:new" (what is new), "map:learnt" (what has been learnt
   *  so far, and what of it comes up again here), "map:later" (what is taught later, and the
   *  next-level topics). */
  | "map"
  /** The harakat primer (fathah a, kasrah i, dhammah u, …) opening an ayah. */
  | "primer"
  | "recite_word"
  | "explain"
  /** A word explained by its parts, over its animation; its last line is said
   *  over the last frame, the joined word. No recitation of its own (the word
   *  was heard at "recite_word", plan L24) — except the ayah's last word,
   *  heard once more after the line that says the recitation stops on it. */
  | "compose"
  | "structure"
  | "concept"
  /** The example(s) of the concept just introduced: no narration line, the word's recording only. */
  | "example"
  | "exercise"
  /** The lesson map's closing (plan L23, L26): what this ayah taught, and the running total. */
  | "learned"
  | "recap"
  | "next"
  | "done";

export type ExerciseSpec = {
  key: ExerciseKey;
  /** useProgress id of this exercise on the lesson page, e.g. "al-fatihah/2/tap". */
  progressId: string;
  /** The parts this exercise can point at (PARTS_OF[key]). */
  parts: readonly GuidePart[];
  /** Cues spoken when the step starts: "${slug}:${ayah}:ex:${key}:intro". */
  lead: number[];
  /** Cue index of each part's prompt ("${slug}:${ayah}:ex:${key}:${part}"
   *  when the ayah's manifest has it, else "shared:ex:${key}:${part}"). */
  promptCue: Partial<Record<GuidePart, number>>;
  /** Spotlight of each part. */
  guides: Partial<Record<GuidePart, Guide>>;
  /** Cue index of the explanation of question n's correct answer
   *  ("${slug}:${ayah}:ex:${key}:${n}:why"), by n — only for the lines the
   *  ayah's manifest has (none on a page without narration). */
  explain: Partial<Record<number, number>>;
};

export type ReciteTarget = { target: "ayah" } | { target: "word"; word: number };

export type AutoplayStep = {
  /** Unique within the sequence; also what is persisted (by id, not index,
   *  so a content change cannot resume at the wrong step). */
  id: string;
  kind: StepKind;
  /** Narration lines, played in order (empty for recite_word). */
  cues: Cue[];
  /** = cues.map((c) => c.line). */
  lines: string[];
  /** What the stage shows when no cue is playing (recite_word), and the
   *  step's caption in lists; never empty (Arabic script only from a
   *  manifest display, see Cue.caption). */
  caption: string;
  /** Default spotlight of the step. */
  guides: Guide[];
  /** 1-based word index the step is about (recite_word, explain, compose). */
  word?: number;
  /** primer / compose: how many animation frames the step has. */
  frames?: number;
  /** That word's loc ("1:2:3"). */
  loc?: string;
  /** What is recited after the cues (never during them): the whole ayah by the imam
   *  (recite_ayah, recap), or the step's word, as the narrator's recording of it (wordVoices) —
   *  recite_word, the one time a word is heard, and the composition of the ayah's last word,
   *  which is heard once more (plan L24). */
  recite?: ReciteTarget;
  exercise?: ExerciseSpec;
  /** The step's example beats, each after the cue it names (operator 2026-10-12, plan L20). */
  examples?: ExampleBeat[];
  /** A structure step that tells ONE item of the ayah's structure (operator 2026-10-13: "can we
   *  make this kind of explanation in items"): which item of how many, and the words (1-based)
   *  it is about — what its line lights and the stage shows. */
  item?: { n: number; of: number; words: number[] };
};

/** Where the learner goes when the ayah's sequence ends. */
export type NavIntent = { kind: "ayah"; slug: string; ayah: number } | { kind: "surah_end"; slug: string };

export type AutoplaySequence = {
  v: 1;
  slug: string;
  ayah: number;
  /** Same key the lesson page uses for its progress: "${slug}/${ayah}". */
  lessonKey: string;
  steps: AutoplayStep[];
  /** Shared lines (start, resume, feedback, reminders…), as cues. */
  shared: Record<SharedKey, Cue>;
  /** Spotlight of the "Lewati latihan" button (offered with the last reminder). */
  skipGuide: Guide;
  /** Spotlight of the "Lanjut" button ("Tunggu saya" mode). */
  lanjutGuide: Guide;
  nav: NavIntent;
  /** True when at least one line of this sequence has narration audio. */
  hasAudio: boolean;
  /** The narrator's recording of each word of the ayah (index = word − 1; src/lib/wordvoice.ts,
   *  content/wordvoice.json): what every step that plays ONE word plays (operator 2026-10-14) —
   *  never the imam's recitation cut at the word. null: the word has no recording, which the
   *  checks refuse (checks.ts wordVoiceProblems); the lesson then plays nothing for it. Empty in
   *  lesson zero (no ayah). */
  wordVoices: readonly (ExampleClip | null)[];
};

// ───────────────────────────── Texts ─────────────────────────────

/**
 * Caption templates (Indonesian: "Anda", sentence case, no ALL CAPS).
 * Captions are on-screen text: they may carry Latin transliteration and
 * digits, never Arabic script. ID_TEXTS (texts.ts) is the default set.
 */
export type AutoplayTexts = {
  intro: (a: { surah: string; ayah: number; total: number }) => string;
  /** Before the imam recites the whole ayah. */
  recite: string;
  /** While a word is heard by itself (the narrator's recording of it). */
  wordIntro: (a: { n: number; translit: string; gloss: string }) => string;
  /** Opens a word's explanation; the content's "why" sentence follows. */
  meaning: (a: { n: number; translit: string; gloss: string }) => string;
  structure: (summary: string) => string;
  /** The first ITEM of a structure told item by item (the others are said as they stand). */
  structureItems: (item: string) => string;
  /** A structure summary with no sentence free of Arabic script. */
  structureBrief: string;
  concept: (title: string, summary: string) => string;
  /** A concept whose summary has no sentence without Arabic script. */
  conceptBrief: (title: string) => string;
  /** Per exercise: its introduction and the prompt for each control. */
  exercise: Record<ExerciseKey, { intro: string } & Partial<Record<GuidePart, string>>>;
  /** The lesson map's opening without a narration display text (plan L23, L26), one caption per
   *  group: how many steps are new; how many have been learnt so far and how many of them come
   *  up again here; how many are taught later and how many belong to the next level. The card
   *  beside it names them, so the caption does not. */
  lessonMap: {
    new: (a: { new: number }) => string;
    learnt: (a: { learnt: number; here: number }) => string;
    later: (a: { later: number; lanjut: number }) => string;
  };
  /** … and its closing: how many new steps the ayah taught and how many are learnt in all — or,
   *  with nothing new, how many learnt steps it repeated. */
  learned: (a: { new: number; total: number; here: number }) => string;
  recap: string;
  next: (a: { ayah: number }) => string;
  done: (a: { surah: string }) => string;
  /** Lesson zero (the lesson with no ayah that opens the course): what it is for, and its
   *  hand-over to the surah's first ayah. */
  zeroIntro: (a: { surah: string }) => string;
  zeroNext: (a: { surah: string }) => string;
  /** The caption of an example beat (shown, never spoken; operator 2026-10-12, plan L20). Plain
   *  words for adults: "klik" never "ketuk", no ALL CAPS, Latin transliteration at most. */
  example: {
    /** A word of this ayah. */
    word: (a: { n: number; translit: string }) => string;
    /** One more example, a word of another ayah. */
    other: (a: { translit: string; surah: number; ayah: number }) => string;
    /** An example in lesson zero (no ayah): what it is an example of — `about`, the Konsep
     *  record's note of that example without the word it opens with ("fi'il, kata kerja."). */
    zero: (a: { translit: string; surah: number; ayah: number; about: string }) => string;
    /** The bentuk dasar a composition shows, where it stands in the Qur'an. */
    base: (a: { translit: string; surah: number; ayah: number }) => string;
    /** A bentuk dasar no ayah has (a teaching form): named, with no place. */
    form: (a: { translit: string }) => string;
    /** Added when the example ends its ayah and the imam's stop drops its last harakah. */
    waqf: string;
    /** Added when a word that starts with hamzat washal is played with the word before it. */
    washal: (a: { heard: string }) => string;
  };
  shared: Record<SharedKey, string>;
  /** Spotlight labels. */
  guide: {
    mushafLine: string;
    mushafWord: (n: number) => string;
    wordCard: string;
    skip: string;
    lanjut: string;
    part: Record<GuidePart, string>;
  };
};
