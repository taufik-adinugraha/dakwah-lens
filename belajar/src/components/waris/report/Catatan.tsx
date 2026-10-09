"use client";

import { Stamp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Q_TEXT, type QTextKey } from "@/lib/waris/questionnaire";
import { msg, outcomeColumnLines, type CatatanView, type ColumnId, type RingkasanView } from "@/lib/waris/report";

import { FracText, RefLinks, RuleNote, Section } from "./bits";
import { useReportText } from "./text";

/**
 * Section 5, Catatan metode (plan §6 row 5): the assumptions taken from the answers, the
 * fikih-vs-KHI table for the heirs that differ (with the rule behind each difference), the radd
 * note (D7), the items to confirm ("Perlu dipastikan": «Tidak tahu», soft stops), other engine
 * notes, the table notes (tashih / ikhtisar, rounding) and the version line: engine and rules
 * version with their date. There is no reviewer, so no "last reviewed by" line (plan §2).
 */
export function Catatan({ c, g, qNotes }: { c: CatatanView; g: RingkasanView; qNotes: readonly QTextKey[] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const colLabel = (id: ColumnId) => R(g.columns[id].label);
  return (
    <Section id="catatan" title={R(c.title)}>
      <h3 className="text-xl font-semibold text-ink">{R(c.assumptionsTitle)}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-base text-ink">
        {c.assumptions.map((a, i) => (
          <li key={i} className="text-pretty">
            {a.text ? R(a.text) : null}
            {a.rule ? (
              <div className={a.text ? "mt-1" : ""}>
                <RuleNote rule={a.rule} />
              </div>
            ) : null}
          </li>
        ))}
        {/* Questionnaire notes the model does not already state (questionnaire/text.ts "catatan.*"). */}
        {qNotes.map((k) => (
          <li key={k} className="text-pretty">
            {Q_TEXT[k]}
          </li>
        ))}
      </ul>

      {c.diff ? (
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-ink">{R(c.diff.title)}</h3>
          <p className="mt-2 text-pretty text-base text-ink-muted">{R(c.diff.why)}</p>
          <div className="wr-table-wrap mt-4">
            <table className="wr-table" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    {R(msg("laporan.ringkasan.kolom_ahli"))}
                  </th>
                  <th scope="col" role="columnheader">
                    {colLabel("fikih")}
                  </th>
                  <th scope="col" role="columnheader" className="wr-court-cell">
                    {colLabel("court")}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {c.diff.rows.map((r, i) => (
                  <tr key={i} role="row">
                    <th scope="row" role="rowheader" className="font-semibold text-ink">
                      {R(r.label)}
                      {r.basis === "setelah_utang" ? <span className="block text-sm font-normal text-ink-muted">{t("dari_harta_setelah_utang")}</span> : null}
                    </th>
                    <td role="cell">
                      <span className="wr-cell-label" aria-hidden="true">
                        {colLabel("fikih")}
                      </span>
                      {r.fikih.total ? <FracText f={r.fikih.total} /> : r.fikih.none ? R(r.fikih.none) : "–"}
                    </td>
                    <td role="cell" className="wr-court-cell">
                      <span className="wr-cell-label" aria-hidden="true">
                        {colLabel("court")}
                      </span>
                      {r.court.total ? <FracText f={r.court.total} /> : r.court.none ? R(r.court.none) : "–"}
                      <p className="mt-1 text-sm text-ink-muted">{R(r.because)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The rules behind the differences, once each. */}
          <div className="mt-4 space-y-4">
            {[...new Map(c.diff.rows.flatMap((r) => r.rules).map((x) => [x.ruleId, x] as const)).values()].map((r) => (
              <RuleNote key={r.ruleId} rule={r} />
            ))}
          </div>
        </div>
      ) : null}

      {c.raddNote ? (
        <p className="mt-6 text-pretty rounded-xl border border-hairline bg-white p-4 text-base text-ink">
          <span className="font-semibold">{colLabel("court")}: </span>
          {R(c.raddNote.court.text)}
        </p>
      ) : null}

      {c.perlu.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-ink">{R(c.perluTitle)}</h3>
          <ul className="mt-3 space-y-3">
            {c.perlu.map((p, i) => (
              <li key={i} className="wr-keep flex gap-3 rounded-xl border-[1.5px] border-notice bg-notice-bg p-4">
                <Stamp className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden />
                <div className="min-w-0 flex-1 text-base text-ink">
                  {p.columns.length > 0 ? <p className="text-sm font-semibold text-notice">{p.columns.map(colLabel).join(", ")}</p> : null}
                  {p.text ? <p className="text-pretty">{R(p.text)}</p> : null}
                  {p.detail ? <p className="mt-1 text-pretty">{R(p.detail)}</p> : null}
                  {p.outcomes ? (
                    <ul className="mt-2 space-y-2">
                      {p.outcomes.map((o, k) => (
                        <li key={k}>
                          <p className="font-semibold">{R(o.option)}</p>
                          {(["fikih", "court"] as const).map((col) => {
                            const part = o[col];
                            if (!part) return null;
                            return (
                              <div key={col} className="text-sm">
                                <span className="text-ink-muted">{colLabel(col)}: </span>
                                {outcomeColumnLines(part, R)
                                  .map((line) => line.text)
                                  .join("; ")}
                              </div>
                            );
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {p.rule ? (
                    <div className="mt-2">
                      <RuleNote rule={p.rule} />
                    </div>
                  ) : null}
                  {p.legal.length > 0 ? <RefLinks dalilIds={[]} legal={p.legal} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {c.other.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-ink">{R(c.otherTitle)}</h3>
          <ul className="mt-3 space-y-3">
            {c.other.map((o) => (
              <li key={o.rule.ruleId} className="rounded-xl border border-hairline bg-white p-4">
                <p className="text-sm font-semibold text-ink-muted">{o.columns.map(colLabel).join(", ")}</p>
                <RuleNote rule={o.rule} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(c.table.fikih?.length ?? 0) + (c.table.court?.length ?? 0) > 0 || c.roundingRule ? (
        <div className="mt-8 space-y-2 text-base text-ink">
          {(["fikih", "court"] as const).map((col) =>
            (c.table[col] ?? []).map((m, i) => (
              <p key={`${col}-${i}`} className="text-pretty">
                <span className="text-ink-muted">{colLabel(col)}: </span>
                {R(m)}
              </p>
            )),
          )}
          {c.roundingRule ? <RuleNote rule={c.roundingRule} /> : null}
        </div>
      ) : null}

      <p className="mt-8 text-sm text-ink-soft">{R(c.version)}</p>
    </Section>
  );
}
