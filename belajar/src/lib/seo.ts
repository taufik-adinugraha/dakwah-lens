import type { Metadata } from "next";

/**
 * Small helpers for the pages' search-engine metadata (docs/belajar-plan.md L42). What may be indexed
 * is decided once, in lib/indexing.ts; a page only says its canonical address (lib/share.ts
 * alternatesFor), its own description, and, where it is never to be indexed, NOINDEX.
 */

/**
 * The robots tag of a page that must stay out of the index but may be crawled: `noindex, follow`.
 * Never block such a page in robots.txt instead (Google cannot see a `noindex` on a page it may not fetch).
 */
export const NOINDEX: NonNullable<Metadata["robots"]> = { index: false, follow: true };

/** The value of the `X-Robots-Tag` header that says the same (src/proxy.ts, next.config.ts). */
export const NOINDEX_HEADER = "noindex, follow";

/**
 * A meta description of at most `max` characters: the text itself when it fits, else cut after the last
 * whole word that fits and closed with an ellipsis. Whitespace is collapsed first.
 */
export function shorten(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—(]+$/u, "")}…`;
}
