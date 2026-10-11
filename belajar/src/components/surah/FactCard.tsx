import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Fact } from "@/content/schema";
import { type Lookup, markedTokens, Scope } from "@/lib/terms";

import { SourcesDisclosure } from "../library/SourceList";
import { AyahChip } from "./AyahDialog";
import { Prose } from "../library/TermText";

/** Locations shown as chips before the rest fold into "Lihat semua letak". */
const FIRST_LOCATIONS = 8;

function LocationChips({ locs, label }: { locs: string[]; label: (loc: string) => string }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {locs.map((l) => (
        <li key={l}>
          <AyahChip loc={l} label={label(l)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * "Tahukah Anda?" — every number shows HOW it was counted and WHERE: the
 * full list of locations, each a 48px chip that opens that ayah in a popup
 * (plan §4.5: method + clickable locations, no numerology, no overclaiming;
 * operator 2026-10-12: a popup with the Arabic, the translation and the
 * imam's recitation, not quran.com in a new tab or app). Render it inside an
 * AyahDialogProvider (./AyahDialog.tsx), which holds the page's one dialog.
 * Long lists show the first few and keep the rest one click away; sources
 * sit behind a "Rujukan (n)" disclosure.
 *
 * With `lookup` (a marked lesson's facts, 2026-10-12), the title, body and method are drawn from
 * their marked twins: each term and Qur'anic word with its Arabic at its first use on the card
 * (one scope, in reading order).
 */
export function FactCard({
  fact,
  labels,
  lookup,
}: {
  fact: Fact;
  labels: { method: string; where: string; sources: string };
  lookup?: Lookup;
}) {
  const t = useTranslations("Surah");
  const mk = lookup ? fact.marked : undefined;
  const sc = new Scope(false); // no harakah reminders in a fact card: its methods are technical
  const title = lookup && mk ? markedTokens(mk.title, sc, lookup) : null;
  const body = lookup && mk ? markedTokens(mk.body, sc, lookup) : null;
  const method = lookup && mk ? markedTokens(mk.method, sc, lookup) : null;
  const label = (loc: string) => t("loc_label", { loc });
  const first = fact.locations.slice(0, FIRST_LOCATIONS);
  const rest = fact.locations.slice(FIRST_LOCATIONS);
  return (
    // In a @container grid (the surah page, a lesson's "Pelajari lebih dalam" row): narrow padding
    // while the grid is under 16rem (a lesson's row from Besar up on a phone), so the longest
    // words ("mencantumkannya") fit without being cut (CI 2026-10-11, rule 15).
    <article className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-3 @3xs:p-5">
      <h3 className="font-display text-lg font-medium text-ink">
        <Prose tokens={title} plain={fact.title} links={false} />
      </h3>
      <p className="mt-2 text-pretty text-base text-ink-muted">
        <Prose tokens={body} plain={fact.body} emphasis />
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
        <span className="font-semibold">{labels.method}:</span> <Prose tokens={method} plain={fact.method} />
      </p>
      <div className="mt-auto pt-2">
        <SourcesDisclosure sources={fact.sources} label={labels.sources} />
      </div>
    </article>
  );
}
