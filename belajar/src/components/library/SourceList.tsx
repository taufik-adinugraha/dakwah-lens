import { ChevronDown } from "lucide-react";

import type { SourceRef } from "@/content/schema";
import { displaySource } from "@/lib/sources";

import { MixedText } from "./MixedText";

/**
 * A Rujukan list: one item per source, each a link to the source passage
 * where a url exists (AGENTS.md: link back to the source). Learners see the
 * short kitab name, its edition (editor, publisher, printing, year) and the
 * readable part of the ref, all as visible text so nothing depends on a
 * hover-only title on a touch screen. Only dataset machine strings (QAC
 * tags, content hashes) are left out of view; the complete citation stays
 * on the link as its title. Each linked item is a ≥44px target.
 */
export function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {sources.map((s, i) => {
        const d = displaySource(s);
        const body = (
          <>
            <span className={s.url ? "link-text text-sm font-medium" : "text-sm font-medium text-ink-muted"}>
              {d.name}
            </span>
            {d.edition ? <span className="text-xs text-ink-soft">{d.edition}</span> : null}
            {d.detail ? (
              <span className="text-xs text-ink-soft">
                <MixedText text={d.detail} />
              </span>
            ) : null}
          </>
        );
        return (
          <li key={`${i}-${s.kitab}-${s.ref ?? ""}`}>
            {s.url ? (
              <a
                href={s.url}
                title={d.full}
                rel="noopener"
                className="flex min-h-11 flex-col justify-center gap-0.5 py-1"
              >
                {body}
              </a>
            ) : (
              <p title={d.full} className="flex flex-col gap-0.5 py-1">
                {body}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Sources behind one clearly labelled tap: "Rujukan (3)". Collapsing keeps
 * every citation one tap away while the card body stays readable
 * (senior-ux §3.6–3.7).
 */
export function SourcesDisclosure({
  sources,
  label,
  className = "mt-3",
}: {
  sources: SourceRef[];
  /** "Rujukan" — the count is appended. */
  label: string;
  className?: string;
}) {
  return (
    <details className={`border-t border-hairline ${className}`}>
      <summary className="disclosure-row text-ink">
        <span>
          {label} ({sources.length})
        </span>
        <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
      </summary>
      <div className="pb-2">
        <SourceList sources={sources} />
      </div>
    </details>
  );
}
