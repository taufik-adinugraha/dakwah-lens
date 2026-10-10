"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { msg, type FracView, type LegalRefView, type RuleRefView } from "@/lib/waris/report";

import { cardAnchor, revealTarget, useCards } from "./context";
import { useReportText } from "./text";

/**
 * Small shared pieces of the report: fractions (figure + words, the legal share), RuleNotes with
 * their references, and section shells. Every sentence shown is a RuleNote's own words or a
 * message key; every citation label is the dalil record's own (dalil.json), never typed here.
 */

/** A stacked fraction; screen readers get the figure, and the words always sit beside it. */
export function FracFigure({ f, big }: { f: FracView; big?: boolean }) {
  if (f.d === "1") return <span className={big ? "wr-whole-big" : "font-semibold"}>{f.n}</span>;
  return (
    <>
      <span aria-hidden="true" className={big ? "wr-frac wr-frac-big" : "wr-frac"}>
        <span className="wr-frac-n">{f.n}</span>
        <span className="wr-frac-d">{f.d}</span>
      </span>
      <span className="sr-only">{f.figure}</span>
    </>
  );
}

/** "1/8 (seperdelapan)". */
export function FracText({ f, big, withPercent }: { f: FracView; big?: boolean; withPercent?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <FracFigure f={f} big={big} />
      <span className="text-ink-muted">({f.words})</span>
      {withPercent ? <span className="text-ink-soft">{f.percent} %</span> : null}
    </span>
  );
}

/** Links to the dalil cards and the Indonesian legal sources a RuleNote cites. */
export function RefLinks({ dalilIds, legal }: { dalilIds: readonly string[]; legal: readonly LegalRefView[] }) {
  const t = useTranslations("Report.ui");
  const cards = useCards();
  const shown = dalilIds.filter((id) => cards.has(id));
  if (shown.length === 0 && legal.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {shown.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-ink-muted">{t("dalil_links")}</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {shown.map((id) => {
              const card = cards.get(id);
              const anchor = cardAnchor(id);
              return (
                <li key={id}>
                  <a href={`#${anchor}`} onClick={(e) => revealTarget(e, anchor)} className="chip-link">
                    {card?.citation.text ?? id}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {legal.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-ink-muted">{t("legal_links")}</p>
          <ul className="mt-1 space-y-1">
            {legal.map((l) => (
              <li key={`${l.source}|${l.locator}`} className="text-sm text-ink">
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-text inline-flex min-h-12 items-center">
                    {l.title}, {l.locator}
                    <span className="sr-only"> {t("new_tab")}</span>
                  </a>
                ) : (
                  <span>
                    {l.title}, {l.locator}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One RuleNote: its title and summary (rules.json), references, and "Pendapat lain" collapsed. */
export function RuleNote({ rule, refs = true }: { rule: RuleRefView; refs?: boolean }) {
  const { R } = useReportText();
  return (
    <div className="wr-keep">
      <p className="font-semibold text-ink">{rule.title}</p>
      <p className="mt-1 text-pretty text-ink-muted">{rule.summary}</p>
      {rule.method ? <p className="mt-1 text-pretty text-ink-muted">{rule.method}</p> : null}
      {refs ? <RefLinks dalilIds={rule.dalilIds} legal={rule.legal} /> : null}
      {rule.ikhtilaf ? (
        <details className="mt-2 rounded-xl border border-hairline bg-white px-4">
          <summary className="disclosure-row text-ink">
            {R(msg("laporan.dalil.pendapat_lain"))}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <div className="pb-3">
            <p className="text-pretty text-ink-muted">{rule.ikhtilaf.summary}</p>
            {refs ? <RefLinks dalilIds={rule.ikhtilaf.dalilIds} legal={rule.ikhtilaf.legal} /> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** A report section: same order on screen and in print (plan §6). */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-judul`} className="wr-section mt-12 scroll-mt-24">
      <h2 id={`${id}-judul`} className="font-display text-2xl font-medium text-ink sm:text-3xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
