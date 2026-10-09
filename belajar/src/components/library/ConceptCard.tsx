import type { Concept } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { parseLoc } from "@/lib/library";

import { DraftChip } from "../lesson/DraftChip";

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
 * the explanation, the Indonesian bridge and every example.
 */
export function ConceptCard({
  concept,
  labels,
  surahSlug,
  wordAr,
  compact = false,
}: {
  concept: Concept;
  labels: ConceptLabels;
  surahSlug: string;
  /** Arabic of each example word, keyed by loc (resolved by the page). */
  wordAr: Record<string, string>;
  compact?: boolean;
}) {
  return (
    <article className="rounded-2xl border border-hairline bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-forest-tint px-2 py-0.5 text-[11px] font-semibold text-forest">
          {concept.kind === "nahwu" ? labels.nahwu : labels.sharaf}
        </span>
        <h3 className="font-display text-lg font-medium">{concept.title}</h3>
      </div>
      <p className="mt-2 text-pretty leading-relaxed">{concept.summary}</p>

      {!compact && (
        <div className="mt-3 space-y-2 text-pretty text-sm leading-relaxed text-ink-muted">
          {concept.explanation.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}

      {concept.bridge && (
        <p className="mt-3 rounded-xl bg-paper-deep p-3 text-sm leading-relaxed">
          <span className="font-semibold">{labels.bridge}:</span> {concept.bridge}
        </p>
      )}

      {!compact && concept.examples.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {labels.examples}
          </p>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {concept.examples.map((ex) => {
              const { ayah } = parseLoc(ex.loc);
              return (
                <li key={ex.loc} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/${surahSlug}/${ayah}#w-${ex.loc.replaceAll(":", "-")}`}
                    className="text-forest underline decoration-forest/30 underline-offset-2"
                  >
                    {ex.loc}
                  </Link>
                  {wordAr[ex.loc] ? (
                    <span lang="ar" dir="rtl" className="font-arabic text-lg">
                      {wordAr[ex.loc]}
                    </span>
                  ) : null}
                  <span className="text-ink-muted">— {ex.note}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {compact ? (
          <Link href={`/konsep/${concept.id}`} className="text-sm font-semibold text-forest">
            {labels.more} →
          </Link>
        ) : (
          <p className="text-[11px] text-ink-faint">
            {labels.sources}: {concept.sources.map((s) => (s.ref ? `${s.kitab} ${s.ref}` : s.kitab)).join(" · ")}
          </p>
        )}
        {concept.status === "draft" ? <DraftChip label={labels.draft} /> : null}
      </div>
    </article>
  );
}
