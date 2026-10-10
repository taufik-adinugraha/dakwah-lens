import { Fragment } from "react";

import type { Ayah } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { conceptHref } from "@/lib/routes";

import { MixedText } from "./MixedText";
import { SourcesDisclosure } from "./SourceList";

/**
 * "Susunan kalimat ayat (tarkib)": how the words fit together (nahwu).
 * Words are shown as they are in the mushaf, each with its role beneath;
 * named groups (an idhafah chain, a na't pair, a badal) are listed with
 * their concept. `hideHeading` drops the section's own H2 when the page
 * already names it (e.g. inside a "Pelajari lebih dalam" disclosure row).
 */
export function StructureSection({
  ayah,
  labels,
  conceptTitle,
  hideHeading = false,
}: {
  ayah: Ayah;
  labels: { heading: string; groups: string; sources: string };
  conceptTitle: Record<string, string>;
  hideHeading?: boolean;
}) {
  const st = ayah.structure;
  if (!st) return null;
  return (
    <section
      className={`${hideHeading ? "" : "mt-10 "}rounded-2xl border border-hairline bg-white p-5 sm:p-6`}
      aria-labelledby={hideHeading ? undefined : "structure"}
    >
      {hideHeading ? null : (
        <h2 id="structure" className="font-display text-2xl font-medium">
          {labels.heading}
        </h2>
      )}
      <p className={`${hideHeading ? "" : "mt-1 "}text-sm font-semibold text-forest`}>
        <MixedText text={st.type} />
      </p>
      <p className="mt-2 max-w-prose text-pretty text-base text-ink">
        <MixedText text={st.summary} />
      </p>

      <ol dir="rtl" className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-5">
        {ayah.words.map((w) => (
          <li key={w.loc} className="flex flex-col items-center">
            <span lang="ar" className="quran text-ar-md text-ink">
              {w.ar}
            </span>
            {w.role ? (
              <span dir="ltr" className="max-w-36 text-center text-sm text-ink-muted">
                <MixedText text={w.role} />
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
            {st.groups.map((g) => (
              <li
                key={`${g.label}-${g.words.join("-")}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base text-ink"
              >
                {/* The words joined " · ", each kept with its dot so no line
                    starts with one; the dash inside the text, glued to the
                    label's first word (line breaks, operator 2026-10-10). */}
                <span lang="ar" dir="rtl" className="quran text-ar-sm text-ink">
                  {g.words
                    .map((i) => ayah.words[i - 1]?.ar)
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
                  <MixedText text={`— ${g.label}`} />
                </span>
                {g.concept && conceptTitle[g.concept] ? (
                  <Link href={conceptHref(g.concept)} className="chip-link">
                    <span>
                      <MixedText text={conceptTitle[g.concept]} />
                    </span>
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
