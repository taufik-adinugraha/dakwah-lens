import { Fragment } from "react";

import type { Ayah } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { conceptHref } from "@/lib/routes";
import { type Lookup, markedTokens, Scope } from "@/lib/terms";

import { MixedText } from "./MixedText";
import { SourcesDisclosure } from "./SourceList";
import { Prose } from "./TermText";

/**
 * "Susunan kalimat ayat (tarkib)": how the words fit together (nahwu).
 * Words are shown as they are in the mushaf, each with its role beneath;
 * named groups (an idhafah chain, a na't pair, a badal) are listed with
 * their concept. `hideHeading` drops the section's own H2 when the page
 * already names it (e.g. inside a "Pelajari lebih dalam" disclosure row),
 * and its card frame with it: that row is already a white bordered card, and
 * a card inside it inside "Materi lengkap" left a 192px column on a phone at
 * Sangat besar, where "menerangkannya" or "membolehkannya" is wider than the
 * line (CI 2026-10-11, rule 15; never cut such a word, give it the room).
 *
 * With `lookup` (a marked lesson, 2026-10-12: "check also other parts"), the type, summary, roles
 * and group labels are drawn from their marked twins: each term and Qur'anic word with its Arabic
 * at its first use in the section (one scope, in reading order: type, summary, the words' roles,
 * the groups). A group's own words are shown in Arabic right before its label, so they count as
 * shown there. Concept chips carry their Arabic headword (`conceptHead`).
 */
export function StructureSection({
  ayah,
  labels,
  conceptTitle,
  conceptHead = {},
  hideHeading = false,
  lookup,
}: {
  ayah: Ayah;
  labels: { heading: string; groups: string; sources: string };
  conceptTitle: Record<string, string>;
  conceptHead?: Record<string, string | null>;
  hideHeading?: boolean;
  lookup?: Lookup;
}) {
  const st = ayah.structure;
  if (!st) return null;
  const mk = lookup ? st.marked : undefined;
  const sc = new Scope();
  const tok = (marked: string | undefined) => (lookup && mk ? markedTokens(marked, sc, lookup) : null);
  const type = tok(mk?.type);
  const summary = tok(mk?.summary);
  const roles = ayah.words.map((w) => (w.role ? tok(w.marked?.role) : null));
  // The word row shows every word of the ayah; a group's row shows its words again, right before
  // its label: they, and every run of them, count as shown there.
  for (const w of ayah.words) sc.shown.add(`q:${w.loc}`);
  const groups = st.groups.map((g, i) => {
    const ws = g.words;
    for (let x = 0; x < ws.length; x++)
      for (let y = x + 1; y < ws.length && ws[y] - ws[x] === y - x; y++) sc.shown.add(`q:${ayah.loc}:${ws[x]}-${ws[y]}`);
    return tok(mk?.groups[i]);
  });
  return (
    <section
      className={hideHeading ? undefined : "mt-10 rounded-2xl border border-hairline bg-white p-5 sm:p-6"}
      aria-labelledby={hideHeading ? undefined : "structure"}
    >
      {hideHeading ? null : (
        <h2 id="structure" className="font-display text-2xl font-medium">
          {labels.heading}
        </h2>
      )}
      <p className={`${hideHeading ? "" : "mt-1 "}text-sm font-semibold text-forest`}>
        <Prose tokens={type} plain={st.type} />
      </p>
      <p className="mt-2 max-w-prose text-pretty text-base text-ink">
        <Prose tokens={summary} plain={st.summary} emphasis />
      </p>

      <ol dir="rtl" className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-5">
        {ayah.words.map((w, i) => (
          <li key={w.loc} className="flex flex-col items-center">
            <span lang="ar" className="quran text-ar-md text-ink">
              {w.ar}
            </span>
            {w.role ? (
              <span dir="ltr" className="max-w-36 text-center text-sm text-ink-muted">
                <Prose tokens={roles[i]} plain={w.role} />
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {st.groups.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-ink">
            <MixedText text={labels.groups} />
          </h3>
          <ul className="mt-2 space-y-3">
            {st.groups.map((g, i) => (
              <li
                key={`${g.label}-${g.words.join("-")}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-ink"
              >
                {/* The words joined " · ", each kept with its dot so no line
                    starts with one; the dash inside the text, glued to the
                    label's first word (line breaks, operator 2026-10-10). */}
                <span lang="ar" dir="rtl" className="quran text-ar-sm text-ink">
                  {g.words
                    .map((k) => ayah.words[k - 1]?.ar)
                    .filter(Boolean)
                    .map((ar, k, all) => (
                      <Fragment key={k}>
                        {k > 0 ? " " : null}
                        <span className="whitespace-nowrap">
                          {ar}
                          {k < all.length - 1 ? " ·" : null}
                        </span>
                      </Fragment>
                    ))}
                </span>
                <span>
                  <Prose
                    tokens={groups[i] ? [{ kind: "text", text: "— " }, ...groups[i]!] : null}
                    plain={`— ${g.label}`}
                  />
                </span>
                {g.concept && conceptTitle[g.concept] ? (
                  <Link href={conceptHref(g.concept)} className="chip-link">
                    <span>
                      <MixedText text={conceptTitle[g.concept]} />
                    </span>
                    {conceptHead[g.concept] ? (
                      <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-forest">
                        {conceptHead[g.concept]}
                      </bdi>
                    ) : null}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SourcesDisclosure sources={st.sources} label={labels.sources} className="mt-5" />
    </section>
  );
}
