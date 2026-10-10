/**
 * Autoplay lesson ("Putar otomatis") — shared types.
 *
 * One ayah is played as a fixed SEQUENCE of steps (sequence.ts, built from
 * the content) driven by a pure, serialisable state MACHINE (machine.ts).
 * The UI executes exactly one ACTIVITY at a time (narration line, imam
 * recitation, silent wait) and reports back with events; so narration and
 * the imam's recitation can never overlap.
 *
 * Narration lines are keyed by the step-id contract shared by every part of
 * the autoplay build (and by pipeline/build_narration.py + validate_narration.py):
 *   "${slug}:${ayah}:${part}"   part ∈ intro | recite | w${n} | structure |
 *                                      concept:${conceptId} |
 *                                      ex:${exerciseKey}:intro |
 *                                      recap | next | done
 *   "shared:${key}"             start | resume | correct | try_again |
 *                               revealed | reminder | skip_offer | surah_done
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
 * Hard rules this module encodes (plan §6.1 A1, L11):
 *  - the narrator NEVER voices Qur'anic words (no Arabic script, no
 *    transliteration in NARRATION text); captions may carry transliteration
 *    but never Arabic script;
 *  - narration audio is same-origin only, under /belajar/media/narration/;
 *  - nothing here promises a human review.
 *
 * Pure TypeScript: no React, no Next, no zod at runtime (type imports only),
 * so `npx tsx scripts/autoplay-check.ts` can run it without node_modules.
 */
import type { Pace } from "../lessonSteps";

export type { Pace };

// ───────────────────────────── Exercises ─────────────────────────────

/** The five exercises, in the order the lesson page renders them. Mirrors
 *  EXERCISE_KEYS in components/exercises/guide.ts (parity-tested). */
export const EXERCISE_KEYS = ["tap-word", "why-harakat", "sort-case", "label-role", "wazn-factory"] as const;
export type ExerciseKey = (typeof EXERCISE_KEYS)[number];

/** The control inside an exercise the learner should use next. Mirrors
 *  GUIDE_PARTS in components/exercises/guide.ts (parity-tested). */
export const GUIDE_PARTS = ["play", "options", "words", "bins", "reveal", "next"] as const;
export type GuidePart = (typeof GUIDE_PARTS)[number];

/** The parts each exercise can point at, in the order a question meets
 *  them (the first is where a fresh exercise starts). Mirrors
 *  EXERCISE_GUIDE_PARTS in components/exercises/guide.ts (parity-tested). */
export const PARTS_OF: Readonly<Record<ExerciseKey, readonly GuidePart[]>> = {
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
 *  besides the exercise prompts "shared:ex:${key}:${part}". */
export const SHARED_KEYS = [
  "start",
  "resume",
  "correct",
  "try_again",
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

/** One file of a line as played: the manifest id it came from ("<id>", or
 *  "<id>:a", "<id>:b" … for a split line). */
export type NarrationSegment = NarrationAudio & { id: string };

/** content/narration/${slug}.json and content/narration/shared.json. */
export type NarrationManifest = {
  version: number | string;
  voice: null | { id: string; name: string; model: string };
  lines: Record<string, { text: string; audio?: NarrationAudio }>;
};

// ───────────────────────────── Sequence ─────────────────────────────

/**
 * One narration line inside a step: its id (contract above), the caption
 * shown while it plays and where the spotlight points. The caption is
 * written from the content (it may carry Latin transliteration, never
 * Arabic script); the SPOKEN text lives in the narration manifest and is
 * written separately (it may carry neither).
 */
export type Cue = {
  /** Contract id (never a ":a"/":b" split part). */
  line: string;
  /** Full caption, whitespace-normalised. */
  caption: string;
  /** The caption cut into ≤180-character parts (senior-ux §3.5): shown one
   *  at a time — by reading time without audio, by audio position with. */
  parts: string[];
  /** Spotlight while this line plays (empty: keep the step's). */
  guides: Guide[];
  /** The line's audio files in play order (one, or the split parts); empty
   *  → caption-only (reading-time pace). All parts or none. */
  audio: NarrationSegment[];
  /** What the narrator says (the manifest's text, split parts joined), for
   *  subtitles that match the voice word for word; null without a manifest
   *  entry. Never Arabic script or transliteration (checked). */
  spoken: string | null;
  /** Word places (1-based) the spoken line names in its own ayah ("kata
   *  kedua", "kata ketiga dan keempat"): the stage rings them on the
   *  numbered mushaf line while the line plays. Empty without `spoken`. */
  refs: number[];
};

export type StepKind =
  | "intro"
  | "recite_ayah"
  | "recite_word"
  | "explain"
  | "structure"
  | "concept"
  | "exercise"
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
   *  step's caption in lists; never empty, never Arabic script. */
  caption: string;
  /** Default spotlight of the step. */
  guides: Guide[];
  /** 1-based word index the step is about (recite_word, explain). */
  word?: number;
  /** That word's loc ("1:2:3"). */
  loc?: string;
  /** The imam's recitation, played after the cues (never during them). */
  recite?: ReciteTarget;
  exercise?: ExerciseSpec;
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
  /** While the imam recites one word. */
  wordIntro: (a: { n: number; translit: string; gloss: string }) => string;
  /** Opens a word's explanation; the content's "why" sentence follows. */
  meaning: (a: { n: number; translit: string; gloss: string }) => string;
  structure: (summary: string) => string;
  /** A structure summary with no sentence free of Arabic script. */
  structureBrief: string;
  concept: (title: string, summary: string) => string;
  /** A concept whose summary has no sentence without Arabic script. */
  conceptBrief: (title: string) => string;
  /** Per exercise: its introduction and the prompt for each control. */
  exercise: Record<ExerciseKey, { intro: string } & Partial<Record<GuidePart, string>>>;
  recap: string;
  next: (a: { ayah: number }) => string;
  done: (a: { surah: string }) => string;
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
