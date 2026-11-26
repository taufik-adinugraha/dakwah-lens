/**
 * What the module's content must hold for the module to be public (docs/belajar-plan.md L11, L42).
 * It replaces the refusal to build "while any record is still marked draft", which stood in
 * lib/content.ts, lib/library.ts and lib/kosakata.ts "to be revisited before any indexed build".
 *
 * Revisited. A record's `status` is PIPELINE STATE, not a review: since 2026-10-09 there is no human
 * (ustadz) review step (L11), the pipeline refuses to write anything but "draft" (build_surah.py,
 * build_library.py, kosakata.py), and no page renders the field. So "draft" never meant "not ready to
 * show", and a gate on it could never open: it would have refused every public build for good. What
 * it stood for was a promise to the reader: nothing unreviewed may be passed off as reviewed. That is
 * what is held now, at the build, whatever the flag:
 *   - no record claims a review: a `status` other than the pipeline state ("reviewed" would say a
 *     person checked it), and no sentence that says one did or will ("menunggu tinjauan ustadz", "reviewed
 *     by an ustadz" ...), anywhere in the content;
 *   - no text is left unfinished (TODO, TBD, lorem ipsum).
 * Beside it, other checks hold the rest: every page carries the AI-assisted label and the "bukan fatwa"
 * line (the layout's footer; src/lib/publishable.test.ts, and scripts/ci/seo-smoke.mjs on every page in
 * the sitemap), and what is not finished is simply not published (BELAJAR_SURAHS: a surah the operator has
 * not listed is a 404 or `noindex` and is not in the sitemap, lib/indexing.ts).
 */

/** The only `status` there is: what the pipeline writes. There is no "reviewed" (L11). */
export const PIPELINE_STATE = "draft";

/**
 * Phrases that say a person reviewed, or will review, the material. Nothing may, anywhere (a promise
 * the module cannot keep). The CI smoke checks look for the same phrases in every page's response
 * (.github/workflows/deploy-belajar.yml, scripts/ci/seo-smoke.mjs); "awaiting" alone is a word's meaning
 * (menunggu), so only the whole phrase counts.
 */
export const REVIEW_PROMISE = /tinjauan (?:oleh )?(?:ustadz|ulama)|ditinjau (?:oleh )?(?:ustadz|ulama|ahli)|diperiksa (?:oleh )?(?:ustadz|ulama|ahli)|(?:telah|sudah) (?:ditinjau|diperiksa|diverifikasi|ditashih)|ditashih|awaiting (?:an? )?(?:ustadz|scholar)|(?:reviewed|review|verified|checked) by (?:an? |the )?(?:ustadz|scholars?|ulama)/i;

/** Text that was meant to be replaced. */
export const PLACEHOLDER = /\b(?:TODO|TBD|FIXME)\b|lorem ipsum/i;

/** Every `status` value in a JSON-like value (what the records say about themselves). */
export function statusValues(value: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      for (const [key, x] of Object.entries(v)) {
        if (key === "status" && typeof x === "string") found.add(x);
        visit(x);
      }
    }
  };
  visit(value);
  return found;
}

/** What is wrong with `value` for a public module: one line per problem, with where it is. */
export function publishProblems(value: unknown, where: string): string[] {
  const problems: string[] = [];
  const visit = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      if (REVIEW_PROMISE.test(v)) problems.push(`${path}: promises a human review: ${JSON.stringify(v.slice(0, 100))}`);
      else if (PLACEHOLDER.test(v)) problems.push(`${path}: unfinished text: ${JSON.stringify(v.slice(0, 100))}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [key, x] of Object.entries(v)) {
        if (key === "status" && typeof x === "string" && x !== PIPELINE_STATE) {
          problems.push(`${path}.status is "${x}", but the only status is "${PIPELINE_STATE}" (no human review exists)`);
        }
        visit(x, `${path}.${key}`);
      }
    }
  };
  visit(value, where);
  return problems;
}

/** Throws, naming every problem (up to ten), when `value` may not go into a public module. */
export function assertPublishable(value: unknown, where: string): void {
  const problems = publishProblems(value, where);
  if (problems.length > 0) {
    throw new Error(`${where} cannot be shipped (docs/belajar-plan.md L11, L42):\n${problems.slice(0, 10).join("\n")}`);
  }
}
