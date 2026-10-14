/**
 * Shared libraries (Konsep, Kosakata, Akar): written once, reviewed once,
 * reused by every surah (plan: re-use materials across ayat and surahs).
 * Validated at build time, including cross-references from the lessons —
 * a word pointing at a lemma or concept that doesn't exist fails CI.
 */
import raw from "../../content/library.json";
import voices from "../../content/wordvoice.json";

import {
  Library,
  type Basic,
  type Concept,
  type Lexeme,
  type Root,
  type SurahContent,
  type WordParts,
} from "@/content/schema";

import { IS_PUBLIC } from "./flags";
import { voiceFrom, type WordVoiceManifest } from "./wordvoice";
import { lookupFrom, type Lookup } from "./terms";

const parsed = Library.safeParse(raw);
if (!parsed.success) {
  throw new Error(
    "content/library.json does not match the schema:\n" +
      JSON.stringify(parsed.error.issues.slice(0, 10), null, 2),
  );
}
/**
 * The voice of every Qur'anic word, run and part of a word the library shows: the narrator's
 * recording of its bytes (content/wordvoice.json, pipeline/wordvoice.py), NEVER a cut of the
 * imam's recitation — the cuts were "not clean" in places (operator 2026-10-14). Keyed like
 * `quran` (a word "1:1:1", a run "112:1:2-4", a part "1:7:3/2"), so a page looks a clip up by the
 * q-ref it already has (src/lib/clips.ts clipFor). `library.json`'s own `clips` (the imam's cuts,
 * and the build's checks of them) are not used by the pages any more. A text with no recording has
 * no entry: its button is not drawn; CI keeps that set empty (build_wordvoice.py --check
 * --require-audio).
 */
function voiced(quran: Readonly<Record<string, string>>): Library["clips"] {
  const out: Library["clips"] = {};
  for (const [key, ar] of Object.entries(quran)) {
    const clip = voiceFrom(voices as WordVoiceManifest, ar);
    if (clip) out[key] = clip;
  }
  return out;
}

export const LIBRARY: Library = { ...parsed.data, clips: voiced(parsed.data.quran) };

const conceptMap = new Map(LIBRARY.concepts.map((c) => [c.id, c]));
const lexemeMap = new Map(LIBRARY.lexicon.map((l) => [l.id, l]));
const rootMap = new Map(LIBRARY.roots.map((r) => [r.id, r]));

export const getConcept = (id: string): Concept | undefined => conceptMap.get(id);
/** Dasar membaca (the Harakat page): listed first on /konsep, served at /konsep/{id} too. */
export const getBasic = (id: string): Basic | undefined => LIBRARY.basics.find((b) => b.id === id);
/** Words explained by their parts that a concept page shows (rule 14). */
export const partsFor = (conceptId: string): WordParts[] =>
  LIBRARY.parts.filter((p) => p.concepts.includes(conceptId));
/** Grammar terms in Arabic script + the Qur'anic bytes the marked prose names (src/lib/terms.ts). */
export const TERMS: Lookup = lookupFrom(LIBRARY);
export const getLexeme = (id: string): Lexeme | undefined => lexemeMap.get(id);
export const getRoot = (id: string): Root | undefined => rootMap.get(id);

/** Root entry for a set of root letters (Akar library). */
export function rootFor(letters: string[] | null): Root | undefined {
  if (!letters) return undefined;
  const key = letters.join("");
  return LIBRARY.roots.find((r) => r.letters.join("") === key);
}

export function libraryHasDrafts(): boolean {
  return (
    LIBRARY.concepts.some((c) => c.status === "draft") ||
    LIBRARY.basics.some((b) => b.status === "draft") ||
    LIBRARY.parts.some((p) => p.status === "draft") ||
    LIBRARY.lexicon.some((l) => l.status === "draft") ||
    LIBRARY.roots.some((r) => r.status === "draft")
  );
}

// Where a Konsep is TAUGHT is the curriculum's (src/lib/curriculum.ts taughtAt; operator-approved
// 2026-10-13, plan L26). Until then: conceptsIntroducedIn here, the ayah of its first example.

/** "1:2:1" → { surah: 1, ayah: 2, word: 1 } */
export function parseLoc(loc: string) {
  const [surah, ayah, word] = loc.split(":").map(Number);
  return { surah, ayah, word };
}

/** Throw at build time if any lesson points at a missing library record. */
export function assertReferences(surahs: SurahContent[]): void {
  const problems: string[] = [];
  for (const s of surahs) {
    for (const a of s.ayat) {
      for (const g of a.structure?.groups ?? []) {
        if (g.concept && !conceptMap.has(g.concept)) problems.push(`${a.loc} group → concept "${g.concept}"`);
      }
      for (const w of a.words) {
        if (w.lemma_id && !lexemeMap.has(w.lemma_id)) problems.push(`${w.loc} → lemma "${w.lemma_id}"`);
        for (const c of w.concepts) if (!conceptMap.has(c)) problems.push(`${w.loc} → concept "${c}"`);
      }
    }
  }
  for (const c of LIBRARY.concepts) for (const r of c.related) if (!conceptMap.has(r)) problems.push(`concept ${c.id} → related "${r}"`);
  for (const b of LIBRARY.basics) for (const r of b.related) if (!conceptMap.has(r)) problems.push(`basic ${b.id} → related "${r}"`);
  for (const p of LIBRARY.parts) for (const c of p.concepts) if (!conceptMap.has(c)) problems.push(`parts ${p.loc} → concept "${c}"`);
  for (const r of LIBRARY.roots) for (const l of r.lemmas) if (!lexemeMap.has(l)) problems.push(`root ${r.id} → lemma "${l}"`);
  if (problems.length) {
    throw new Error("Broken content references:\n" + problems.slice(0, 20).join("\n"));
  }
}

if (IS_PUBLIC && libraryHasDrafts()) {
  throw new Error(
    "BELAJAR_PUBLIC build refused: unreviewed records in content/library.json (plan §8).",
  );
}
