"use client";

import { Ban, CircleMinus, HandHeart } from "lucide-react";
import { useTranslations } from "next-intl";

import { msg, type ColumnId, type RingkasanView, type TidakMendapatView } from "@/lib/waris/report";

import { FracText, RuleNote, Section } from "./bits";
import { cardAnchor, revealTarget, useCards } from "./context";
import { useReportText } from "./text";

/**
 * Section 3, "Yang tidak mendapat bagian, dan mengapa" (plan §6 row 3): blocked relatives with who
 * blocks them and the rule; non-heirs with the ways that stay open (hibah, wasiat; the court
 * column's wasiat wajibah as a ceiling or an illustration, plan D8); groups never asked. Every group
 * ends with the gentle line of QS 4:8, its card from dalil.json (rahma: never "tidak berhak" alone).
 */
export function TidakMendapat({ v, g }: { v: TidakMendapatView; g: RingkasanView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const cards = useCards();
  if (v.groups.length === 0) return null;
  const courtLabel = R(g.columns.court.label);
  const fikihLabel = R(g.columns.fikih.label);
  const colLabel = (c: ColumnId) => (c === "fikih" ? fikihLabel : courtLabel);
  return (
    <Section id="tidak-mendapat" title={R(v.title)}>
      <div className="space-y-8">
        {v.groups.map((grp) => {
          const closingCard = cards.get(grp.closing.dalilId);
          const closingAnchor = cardAnchor(grp.closing.dalilId);
          return (
            <div key={grp.kind}>
              <h3 className="text-xl font-semibold text-ink">{R(grp.title)}</h3>
              {grp.entries.length > 0 ? (
                <ul className="mt-3 space-y-4">
                  {grp.entries.map((e, i) => (
                    <li key={`${e.label.key}-${i}`} className="wr-keep rounded-2xl border border-hairline bg-white p-4">
                      <p className="flex items-start gap-2 text-lg font-semibold text-ink">
                        {grp.kind === "bukan" ? (
                          <CircleMinus className="mt-1 h-5 w-5 shrink-0 text-ink-soft" aria-hidden />
                        ) : (
                          <Ban className="mt-1 h-5 w-5 shrink-0 text-ink-soft" aria-hidden />
                        )}
                        <span>
                          {e.count > 1 ? R(msg("laporan.pohon.jumlah", { jumlah: e.count, kerabat: { ...e.label, cap: false } }, true)) : R(e.label)}
                        </span>
                      </p>
                      {e.fikih ? (
                        <div className="mt-2">
                          <p className="text-pretty text-ink">{R(e.fikih.text)}</p>
                          <div className="mt-2">
                            <RuleNote rule={e.fikih.rule} />
                          </div>
                        </div>
                      ) : null}
                      {e.court ? (
                        <div className="mt-3 border-l-4 border-border-ui pl-3">
                          <p className="text-pretty text-ink">{R(msg("laporan.tidak.kolom_lain", { kolom: courtLabel, alasan: e.court.text }))}</p>
                          <div className="mt-2">
                            <RuleNote rule={e.court.rule} />
                          </div>
                        </div>
                      ) : null}
                      {e.jalan.length > 0 ? (
                        <div className="mt-3 rounded-xl bg-forest-tint p-3">
                          <p className="flex items-center gap-2 font-semibold text-ink">
                            <HandHeart className="h-5 w-5 shrink-0 text-forest" aria-hidden />
                            {R(msg("laporan.tidak.jalan_judul"))}
                          </p>
                          <ul className="mt-2 space-y-3">
                            {e.jalan.map((j, k) => (
                              <li key={k} className="text-base text-ink">
                                <p className="text-pretty">{R(j.text)}</p>
                                {(["fikih", "court"] as const).map((c) => {
                                  const f = j[c];
                                  return f ? (
                                    <p key={c} className="mt-1">
                                      <span className="text-sm text-ink-muted">{colLabel(c)}: </span>
                                      <FracText f={f} withPercent />
                                    </p>
                                  ) : null;
                                })}
                                {j.rules.map((r) => (
                                  <div key={r.ruleId} className="mt-2">
                                    <RuleNote rule={r} />
                                  </div>
                                ))}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {grp.notAsked.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {grp.notAsked.map((n, i) => (
                    <li key={i} className="rounded-2xl border border-hairline bg-white p-4">
                      <p className="text-pretty text-ink">{R(n.text)}</p>
                      {n.rule ? (
                        <div className="mt-2">
                          <RuleNote rule={n.rule} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-4 text-pretty rounded-xl border border-hairline bg-paper-deep p-4 text-base text-ink">
                {R(grp.closing.text)}{" "}
                {closingCard ? (
                  <a href={`#${closingAnchor}`} onClick={(ev) => revealTarget(ev, closingAnchor)} className="link-text">
                    {t("lihat_dalil", { sumber: closingCard.citation.text })}
                  </a>
                ) : null}
              </p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
