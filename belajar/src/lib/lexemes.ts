import { SURAHS } from "./content";
import { LIBRARY } from "./library";

/**
 * The lesson words' entries (/kosakata/{id}) with the surahs whose lessons use each word, from the
 * content (a word's `lemma_id`, the same link the entry's own "Muncul dalam pelajaran" list follows).
 * An entry is indexable, and in the sitemap, only while one of those surahs is published
 * (lib/indexing.ts lexemeIndexable): src/app/sitemap.ts and the entry's page read this; the proxy, which
 * must not import the content, leaves it to the page's robots tag.
 */
export const LEXEMES: readonly { id: string; surahs: readonly string[] }[] = LIBRARY.lexicon.map((l) => ({
  id: l.id,
  surahs: SURAHS.filter((s) => s.ayat.some((a) => a.words.some((w) => w.lemma_id === l.id))).map((s) => s.slug),
}));

const BY_ID = new Map(LEXEMES.map((l) => [l.id, l.surahs] as const));

/** The surahs that use this entry's word (none for an id that is no entry). */
export const lexemeSurahsOf = (id: string): readonly string[] => BY_ID.get(id) ?? [];
