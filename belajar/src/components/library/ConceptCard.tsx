import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Concept } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { parseLoc } from "@/lib/library";
import { ayahHref, conceptHref } from "@/lib/routes";

import { MixedText } from "./MixedText";
import { SourcesDisclosure } from "./SourceList";

export type ConceptLabels = {
  nahwu: string;
  sharaf: string;
  bridge: string;
  examples: string;
  more: string;
  sources: string;
  draft: string;
};

/**
 * One nahwu/sharaf idea, explained once and reused wherever it appears.
 * `compact` shows the summary + a link (inside lessons); the full card shows
 * the explanation, the Indonesian bridge, every example and its Rujukan.
 */
export function ConceptCard({
  concept,
  labels,
  surahs,
  wordAr,
  compact = false,
}: {
  concept: Concept;
  labels: ConceptLabels;
  /** Surah number → slug + name (examples may come from any lesson surah). */
  surahs: Record<number, { slug: string; name: string }>;
  /** Arabic of each example word, keyed by loc (resolved by the page). */
  wordAr: Record<string, string>;
  compact?: boolean;
}) {
  const t = useTranslations("Concept");
  return (
    <article className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5">
      <p>
        <span className="inline-flex rounded-full bg-forest-tint px-3 py-1 text-sm font-semibold text-forest">
          {concept.kind === "nahwu" ? labels.nahwu : labels.sharaf}
        </span>
      </p>
      <h3 className="mt-2 font-display text-xl font-medium text-ink">
        <MixedText text={concept.title} />
      </h3>
      <p className="mt-2 max-w-prose text-pretty text-base text-ink">
        <MixedText text={concept.summary} />
      </p>

      {!compact && (
        <div className="mt-3 max-w-prose space-y-3 text-pretty text-base text-ink-muted">
          {concept.explanation.map((p) => (
            <p key={p}>
              <MixedText text={p} />
            </p>
          ))}
        </div>
      )}

      {concept.bridge && (
        <p className="mt-4 rounded-xl bg-paper-deep p-4 text-base text-ink">
          <span className="font-semibold">{labels.bridge}:</span> <MixedText text={concept.bridge} />
        </p>
      )}

      {!compact && concept.examples.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-ink">{labels.examples}</p>
          <ul className="mt-2 space-y-3">
            {concept.examples.map((ex) => {
              const { surah, ayah, word } = parseLoc(ex.loc);
              const s = surahs[surah];
              // An example from a surah with no lesson yet has nowhere to link.
              if (!s) return null;
              return (
                <li key={ex.loc} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={ayahHref(s.slug, ayah, ex.loc)}
                    className="chip-link"
                  >
                    {t("example_loc", { surah: s.name, ayah, word })}
                  </Link>
                  {wordAr[ex.loc] ? (
                    <span lang="ar" dir="rtl" className="quran text-ar-sm text-ink">
                      {wordAr[ex.loc]}
                    </span>
                  ) : null}
                  <span className="basis-full text-base text-ink-muted">
                    <MixedText text={ex.note} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-3">
        {compact ? (
          <Link href={conceptHref(concept.id)} className="chip-link">
            {labels.more}
            <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </Link>
        ) : (
          <SourcesDisclosure sources={concept.sources} label={labels.sources} className="mt-2" />
        )}
      </div>
    </article>
  );
}
