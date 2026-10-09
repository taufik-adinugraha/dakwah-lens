import type { Fact } from "@/content/schema";

import { DraftChip } from "../lesson/DraftChip";

/**
 * "Tahukah kamu?" — every number shows HOW it was counted and WHERE: the
 * full list of locations, each a link to that ayah (plan §4.5: method +
 * clickable locations, no numerology, no overclaiming).
 */
export function FactCard({
  fact,
  labels,
}: {
  fact: Fact;
  labels: { method: string; where: string; sources: string; draft: string };
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5">
      <p className="font-display text-lg font-medium leading-snug">{fact.title}</p>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-ink-muted">{fact.body}</p>
      {fact.locations.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{labels.where}:</span>{" "}
          {fact.locations.map((l, i) => (
            <span key={l}>
              {i > 0 ? ", " : ""}
              <a
                href={`https://quran.com/${l.replace(":", "/")}`}
                className="underline decoration-hairline underline-offset-2 hover:text-ink"
                rel="noopener"
              >
                {l}
              </a>
            </span>
          ))}
        </p>
      )}
      <p className="mt-2 text-[11px] text-ink-faint">
        {labels.method}: {fact.method}
      </p>
      <div className="mt-auto pt-2">
        <p className="text-[11px] text-ink-faint">
          {labels.sources}: {fact.sources.map((s) => (s.ref ? `${s.kitab} ${s.ref}` : s.kitab)).join(" · ")}
        </p>
        {fact.status === "draft" ? <DraftChip label={labels.draft} /> : null}
      </div>
    </article>
  );
}
