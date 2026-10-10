import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Fact } from "@/content/schema";

import { MixedText } from "../library/MixedText";
import { SourcesDisclosure } from "../library/SourceList";

/** Locations shown as chips before the rest fold into "Lihat semua letak". */
const FIRST_LOCATIONS = 8;

function LocationChips({ locs, label }: { locs: string[]; label: (loc: string) => string }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {locs.map((l) => (
        <li key={l}>
          <a href={`https://quran.com/${l.replace(":", "/")}`} rel="noopener" className="chip-link">
            {label(l)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Tahukah Anda?" — every number shows HOW it was counted and WHERE: the
 * full list of locations, each a 44px link chip to that ayah (plan §4.5:
 * method + clickable locations, no numerology, no overclaiming). Long lists
 * show the first few and keep the rest one tap away; sources sit behind a
 * "Rujukan (n)" disclosure.
 */
export function FactCard({
  fact,
  labels,
}: {
  fact: Fact;
  labels: { method: string; where: string; sources: string };
}) {
  const t = useTranslations("Surah");
  const label = (loc: string) => t("loc_label", { loc });
  const first = fact.locations.slice(0, FIRST_LOCATIONS);
  const rest = fact.locations.slice(FIRST_LOCATIONS);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5">
      <h3 className="font-display text-lg font-medium text-ink">
        <MixedText text={fact.title} />
      </h3>
      <p className="mt-2 text-pretty text-base text-ink-muted">
        <MixedText text={fact.body} />
      </p>
      {fact.locations.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink">{labels.where}:</p>
          <div className="mt-2">
            <LocationChips locs={first} label={label} />
          </div>
          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="disclosure-row text-ink">
                <span>{t("fact_more_where", { n: fact.locations.length })}</span>
                <ChevronDown aria-hidden="true" className="chev h-5 w-5 shrink-0 text-ink-muted" />
              </summary>
              <div className="pb-2">
                <LocationChips locs={rest} label={label} />
              </div>
            </details>
          )}
        </div>
      )}
      <p className="mt-4 text-sm text-ink-muted">
        <span className="font-semibold">{labels.method}:</span> <MixedText text={fact.method} />
      </p>
      <div className="mt-auto pt-2">
        <SourcesDisclosure sources={fact.sources} label={labels.sources} />
      </div>
    </article>
  );
}
