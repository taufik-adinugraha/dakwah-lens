import { ArrowRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { Taught } from "@/lib/autoplay";
import { TERMS } from "@/lib/library";
import { conceptHref } from "@/lib/routes";
import { annotate, Scope, titleParts } from "@/lib/terms";

import { SourcesDisclosure } from "./SourceList";
import { Headword, TermText } from "./TermText";

/**
 * A step of the curriculum taught from ITS OWN text (operator-approved 2026-10-13, plan L26;
 * content/curriculum.json `teach`): a part of a Konsep record that arrives in several lessons —
 * majrur, marfu', manshub of the i'rab record — or a step with no record (alif lam). The same card
 * as a Konsep record's in a lesson's "Pelajari lebih dalam" (ConceptCard `compact`): the title with
 * its Arabic headword, the one-sentence summary, each term with its Arabic at its first use — then
 * its kitab sources, which a record keeps on its own page and a step has nowhere else to show,
 * and, for a part of a record, the link to that record's page (the i'rab page). A step with no
 * record has no link.
 */
export function StepCard({ taught, labels }: { taught: Taught; labels: { more: string; sources: string } }) {
  const sc = new Scope();
  const mk = taught.marked;
  const title = mk ? titleParts(mk.title, sc, TERMS) : { tokens: [{ kind: "text" as const, text: taught.title }], head: [] };
  const summary = mk ? annotate(mk.summary, sc, TERMS) : [{ kind: "text" as const, text: taught.summary }];
  return (
    <article data-step-card={taught.step} className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-3 @3xs:p-5">
      <h3 className="font-display text-xl font-medium text-ink">
        <TermText tokens={title.tokens} emphasis="meaning" />
      </h3>
      <Headword head={title.head} className="mt-1 text-ar-sm" />
      <p className="mt-2 max-w-prose text-pretty text-base text-ink">
        <TermText tokens={summary} emphasis />
      </p>
      <div className="mt-auto pt-3">
        {taught.sources.length ? <SourcesDisclosure sources={[...taught.sources]} label={labels.sources} className="mb-3" /> : null}
        {taught.concept ? (
          <Link href={conceptHref(taught.concept)} className="chip-link">
            {labels.more}
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
