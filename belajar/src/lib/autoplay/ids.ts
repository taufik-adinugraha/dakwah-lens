/**
 * Narration line ids — the step-id contract (see types.ts). Builders and a
 * parser, so every part of the build spells the ids the same way (the same
 * grammar as pipeline/validate_narration.py).
 */
import {
  EXERCISE_KEYS,
  GUIDE_PARTS,
  SHARED_KEYS,
  type ExerciseKey,
  type GuidePart,
  type NarrationManifest,
  type SharedKey,
} from "./types";

/** The per-ayah part of a line id. */
export type LinePart =
  | "intro"
  | "recite"
  /** The lesson map's lines (lessonMap.ts MAP_LINES): the opening's per group, and the closing's
   *  running total, "map:total", after "learned". */
  | `map:${"new" | "again" | "later" | "focus" | "total"}`
  /** A group of the running total said unit by unit (lessonMap.ts mapClosingLines). */
  | `map:total:${number}`
  | `primer:${number}`
  | `w${number}`
  | `w${number}:compose:${number}`
  | "structure"
  /** One item of an ayah's structure told item by item (operator 2026-10-13). */
  | `structure:${number}`
  | `concept:${string}`
  /** Lesson zero: a step's slide before its line, and the narrator's line over its example n. */
  | `concept:${string}:lead`
  | `concept:${string}:ex:${number}`
  | `ex:${ExerciseKey}:intro`
  | `ex:${ExerciseKey}:${GuidePart}`
  | `ex:${ExerciseKey}:${number}:why`
  | "learned"
  | "recap"
  | "next"
  | "done";

/** "${slug}:${ayah}:${part}", e.g. "al-fatihah:2:w3". */
export const lineId = (slug: string, ayah: number, part: LinePart): string => `${slug}:${ayah}:${part}`;

/** "${slug}:${ayah}:ex:${key}:${n}:why": the line explaining question n's correct answer, said
 *  after "Benar." and after "Ini jawabannya." (operator 2026-10-10: "give narration/voice only
 *  for the correct answer, to give auditory explanation"). */
export const explainLineId = (slug: string, ayah: number, key: ExerciseKey, n: number): string =>
  lineId(slug, ayah, `ex:${key}:${n}:why`);

/** "shared:${key}", e.g. "shared:reminder". */
export const sharedLineId = (key: SharedKey): string => `shared:${key}`;

/** "shared:ex:${key}:${part}": the prompt for one control of an exercise. */
export const promptLineId = (key: ExerciseKey, part: GuidePart): string => `shared:ex:${key}:${part}`;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const ID = "[a-z0-9]+(?:-[a-z0-9]+)*";
const EX = EXERCISE_KEYS.join("|");
const PART = `intro|recite|map:(?:new|again|later|focus|total(?::[1-9][0-9]{0,2})?)|primer:[1-9][0-9]{0,2}|w[1-9][0-9]{0,2}(?::compose:[1-9][0-9]{0,2})?|structure(?::[1-9][0-9]{0,2})?|concept:${ID}(?::lead|:ex:[1-9][0-9]{0,2})?|ex:(?:${EX}):(?:[a-z]+(?:_[a-z]+)*|[1-9][0-9]{0,2}:why)|learned|recap|next|done`;
const SHARED = `${SHARED_KEYS.join("|")}|ex:(?:${EX}):(?:${GUIDE_PARTS.join("|")})`;
/** A split part of a long line: ":a", ":b", … */
const SPLIT = "(?::[a-z])?";

/** The "ayah" of a line id: an ayah's number — or 0, the place of LESSON ZERO's lines in the
 *  manifest of the surah that hosts it ("al-fatihah:0:intro"; the basic curriculum's lesson
 *  with no ayah, decision 1; pipeline/validate_narration.py lesson_zero). */
export const ZERO_AYAH = 0;
const AYAH = "(?:0|[1-9][0-9]{0,2})";

/** Every valid line id (a split part "<id>:a" included). */
export const LINE_ID_RE = new RegExp(`^(?:${SLUG}:${AYAH}:(?:${PART})|shared:(?:${SHARED}))${SPLIT}$`);

export type ParsedLineId = {
  /** The id without a split suffix. */
  base: string;
  /** "a", "b", … for a split part; null otherwise. */
  split: string | null;
} & (
  | { kind: "shared"; key: string }
  | { kind: "ayah"; slug: string; ayah: number; part: string }
);

/** The parts of a line id; null when it breaks the contract. */
export function parseLineId(id: string): ParsedLineId | null {
  if (!LINE_ID_RE.test(id)) return null;
  const m = /:([a-z])$/.exec(id);
  // ":a" is a split suffix only when what precedes it is itself a full id
  // (no contract part is a single letter).
  const split = m && LINE_ID_RE.test(id.slice(0, -2)) ? m[1] : null;
  const base = split ? id.slice(0, -2) : id;
  if (base.startsWith("shared:")) return { kind: "shared", key: base.slice("shared:".length), base, split };
  const first = base.indexOf(":");
  const second = base.indexOf(":", first + 1);
  return {
    kind: "ayah",
    slug: base.slice(0, first),
    ayah: Number(base.slice(first + 1, second)),
    part: base.slice(second + 1),
    base,
    split,
  };
}

/**
 * The manifest entries that make up line `id`, in play order: [id] when it
 * is stored whole, [id:a, id:b, …] when stored split (two or more,
 * contiguous from "a"), null when it is missing or malformed (both forms,
 * a single part, a gap).
 */
export function manifestParts(manifest: NarrationManifest, id: string): string[] | null {
  const whole = Object.prototype.hasOwnProperty.call(manifest.lines, id);
  const parts: string[] = [];
  for (let c = 97; c <= 122; c++) {
    const k = `${id}:${String.fromCharCode(c)}`;
    if (!Object.prototype.hasOwnProperty.call(manifest.lines, k)) break;
    parts.push(k);
  }
  const stray = Object.keys(manifest.lines).some((k) => k.startsWith(`${id}:`) && /^:[a-z]$/.test(k.slice(id.length)) && !parts.includes(k));
  if (whole) return parts.length === 0 ? [id] : null;
  if (parts.length >= 2 && !stray) return parts;
  return null;
}
