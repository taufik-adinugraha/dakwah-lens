/**
 * Shared libraries (Konsep, Kosakata, Akar): written once, reviewed once,
 * reused by every surah (plan: re-use materials across ayat and surahs).
 * Validated at build time, including cross-references from the lessons —
 * a word pointing at a lemma or concept that doesn't exist fails CI.
 */
import raw from "../../content/library.json";

import {
  Library,
  type Concept,
  type Lexeme,
  type Root,
  type SurahContent,
} from "@/content/schema";

import { IS_PUBLIC } from "./flags";

const parsed = Library.safeParse(raw);
if (!parsed.success) {
  throw new Error(
    "content/library.json does not match the schema:\n" +
      JSON.stringify(parsed.error.issues.slice(0, 10), null, 2),
  );
}
export const LIBRARY: Library = parsed.data;

const conceptMap = new Map(LIBRARY.concepts.map((c) => [c.id, c]));
const lexemeMap = new Map(LIBRARY.lexicon.map((l) => [l.id, l]));
const rootMap = new Map(LIBRARY.roots.map((r) => [r.id, r]));

export const getConcept = (id: string): Concept | undefined => conceptMap.get(id);
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
    LIBRARY.lexicon.some((l) => l.status === "draft") ||
    LIBRARY.roots.some((r) => r.status === "draft")
  );
}

/** Concepts whose FIRST example is in this ayah: introduced here. */
export function conceptsIntroducedIn(ayahLoc: string): Concept[] {
  return LIBRARY.concepts.filter((c) => {
    const first = c.examples[0]?.loc;
    return first ? first.split(":").slice(0, 2).join(":") === ayahLoc : false;
  });
}

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
