"use client";

import { Ban, Calculator, CircleCheck, Stamp } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  msg,
  outcomeColumnLines,
  type CellView,
  type ColumnHead,
  type ColumnId,
  type DiffRow,
  type FracView,
  type HeirRow,
  type NoneView,
  type OutcomeView,
  type RingkasanView,
} from "@/lib/waris/report";

import { FracFigure, FracText, RuleNote, Section } from "./bits";
import { revealTarget } from "./context";
import { Reasons } from "./Reasons";
import { useReportText } from "./text";

/**
 * Section 1, Ringkasan (plan §6 row 1; D2 = A). The fikih column leads; the court column
 * ("Menurut KHI dan praktik Pengadilan Agama") shows only for heirs whose share differs, with the
 * rule that made the difference. One table on wide screens; one card per heir in a narrow container
 * (waris.css), so the core numbers never scroll sideways. Each share cell carries
 * data-share="<fraction>" (with data-column / data-heir) for the end-to-end check (plan M2.6).
 * A refused column shows its reasons and no number (M2.8). When one «Tidak tahu» changes the
 * division (plan D15), every reading is shown side by side BEFORE the table, and the table's
 * caption names the reading it details: the page never prints one reading as "the" division.
 */

const otherOf = (c: ColumnId): ColumnId => (c === "fikih" ? "court" : "fikih");

/** The figure the column leads with (ColumnHead.basis): the share of the harta waris, or of the estate after debts. */
export function mainOf(head: ColumnHead, c: CellView): { value: FracView | null; per: FracView | null } {
  if (head.basis === "setelah_utang") return { value: c.lineTotal ?? c.total, per: c.linePerHead ?? c.perHead };
  return { value: c.total, per: c.perHead };
}

function NoneLines({ none }: { none: readonly NoneView[] }) {
  const { R } = useReportText();
  if (none.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {none.map((n, i) => (
        <li key={`${n.kind}-${i}`} className="flex items-start gap-2 text-base text-ink">
          <Ban className="mt-1 h-5 w-5 shrink-0 text-ink-soft" aria-hidden />
          <span>
            {n.count > 1 ? `${R(msg("laporan.pohon.jumlah", { jumlah: n.count, kerabat: n.label }, true))}: ` : `${R({ ...n.label, cap: true })}: `}
            {n.by
              ? R(msg("laporan.ringkasan.terhalang_oleh", { oleh: n.by }))
              : n.kind === "bukan"
                ? R(msg("laporan.ringkasan.bukan_ahli_waris"))
                : R(msg("laporan.ringkasan.tidak_mendapat"))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ShareCell({ head, cell, row, label }: { head: ColumnHead; cell: CellView; row: HeirRow; label: string }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const { value, per } = mainOf(head, cell);
  return (
    <>
      <span className="wr-cell-label" aria-hidden="true">
        {label}
      </span>
      {value ? (
        <span className="flex items-start gap-2">
          <CircleCheck className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
          <FracText f={value} big />
        </span>
      ) : cell.none.length === 0 ? (
        <span className="text-ink">{R(msg("laporan.ringkasan.tidak_mendapat"))}</span>
      ) : null}
      {per && row.count > 1 ? (
        <p className="mt-1 text-base text-ink">{R(msg("laporan.ringkasan.masing", { bagian: `${per.figure} (${per.words})` }))}</p>
      ) : null}
      {cell.persons ? (
        <ul className="mt-1 space-y-1 text-base text-ink">
          {cell.persons.map((p, i) => (
            <li key={p.personId}>
              {t("orang_ke", { n: i + 1 })}: <FracText f={p.share} />
              {p.rupiah ? <span className="text-ink-muted"> · {p.rupiah.text}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {head.basis === "harta_waris" && cell.lineTotal && value && cell.lineTotal.figure !== value.figure ? (
        <p className="mt-1 text-sm text-ink-muted">{R(msg("laporan.ringkasan.basis_baris", { bagian: `${cell.lineTotal.figure} (${cell.lineTotal.words})` }))}</p>
      ) : null}
      {cell.change ? <p className="mt-1 text-sm text-ink-muted">{R(cell.change.text)}</p> : null}
      <NoneLines none={cell.none} />
    </>
  );
}

/** One reading's column: the bequests taken first, the heirs, and what the shares are of (report/summary.ts). */
function OutcomeLines({ part }: { part: NonNullable<OutcomeView["fikih"]> }) {
  const { R } = useReportText();
  return (
    <ul className="space-y-1">
      {outcomeColumnLines(part, R).map((line, i) => (
        <li key={i} className={line.note ? "text-pretty text-sm text-ink-muted" : "text-pretty text-base text-ink"}>
          {line.text}
        </li>
      ))}
    </ul>
  );
}

function Outcome({ o, g }: { o: OutcomeView; g: RingkasanView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  return (
    <div className="wr-keep rounded-2xl border border-hairline bg-white p-4">
      <p className="font-semibold text-ink">{R(o.option)}</p>
      {o.base ? <p className="text-sm text-ink-soft">{t("dipakai_di_tabel")}</p> : null}
      {(["fikih", "court"] as const).map((col) => {
        const part = o[col];
        if (!part) return null;
        return (
          <div key={col} className="mt-3">
            <p className="text-sm font-semibold text-ink-muted">{R(g.columns[col].label)}</p>
            {"rows" in part ? <OutcomeLines part={part} /> : <Reasons reasons={part.refusal} refs={false} />}
          </div>
        );
      })}
    </div>
  );
}

export function Ringkasan({
  g,
  diff,
  dasarAnchors,
  onRupiah,
}: {
  g: RingkasanView;
  diff: readonly DiffRow[];
  /** Anchors of the dalil disclosure rows that exist (section 4). */
  dasarAnchors: ReadonlySet<string>;
  /** Opens the rupiah panel (null when the panel is not offered). */
  onRupiah: (() => void) | null;
}) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const lead: ColumnId = g.columns.fikih.lead ? "fikih" : "court";
  const other = otherOf(lead);
  const leadHead = g.columns[lead];
  const otherHead = g.columns[other];
  const otherRefused = otherHead.shown && otherHead.status === "rujuk";
  const otherCells = otherHead.shown && otherHead.status === "hasil" && g.rows.some((r) => r.differs && !!r[other]);
  const shareLabel = R(msg("laporan.ringkasan.kolom_bagian"));
  const because = (row: HeirRow): string | null => {
    const d = diff.find((x) => x.personIds.some((p) => row.personIds.includes(p)));
    return d ? R(d.because) : null;
  };

  return (
    <Section id="ringkasan" title={R(g.title)}>
      <p className="text-pretty text-lg text-ink">{g.sentence.map((s) => R(s)).join(" ")}</p>

      {otherRefused ? (
        <div className="mt-4 rounded-xl border-[1.5px] border-dashed border-border-ui bg-paper-deep p-4">
          <p className="font-semibold text-ink">{R(g.agreeLine)}</p>
          <div className="mt-3">
            <Reasons reasons={otherHead.refusal ?? []} />
          </div>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-hairline bg-forest-tint px-4 py-3 text-base font-medium text-ink">{R(g.agreeLine)}</p>
      )}

      {g.bergantung ? (
        <div className="mt-6">
          <p className="text-pretty rounded-xl border-[1.5px] border-notice bg-notice-bg px-4 py-3 font-medium text-ink">{R(g.bergantung.line)}</p>
          <div className="@container mt-4">
            <div className="grid gap-4 @2xl:grid-cols-2">
              {g.bergantung.outcomes.map((o, i) => (
                <Outcome key={i} o={o} g={g} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {g.stamps.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {g.stamps.map((s, i) => (
            <li key={i} className="wr-keep flex gap-3 rounded-xl border-[1.5px] border-notice bg-notice-bg p-4">
              <Stamp className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-notice">
                  {t("perlu_konfirmasi")} · {s.columns.map((c) => R(g.columns[c].label)).join(", ")}
                </p>
                {s.text ? <p className="mt-1 text-pretty text-ink">{R(s.text)}</p> : null}
                {s.rule ? (
                  <div className="mt-1">
                    <RuleNote rule={s.rule} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {g.preLines.length > 0 ? (
        <div className="wr-keep mt-6 rounded-xl border border-hairline bg-white p-4">
          <p className="font-semibold text-ink">{R(msg("laporan.ringkasan.diambil_dulu"))}</p>
          <ul className="mt-2 space-y-3">
            {g.preLines.map((p) => (
              <li key={p.key} className="text-base text-ink">
                <p className="font-medium">{R({ ...p.label, cap: true })}</p>
                {(["fikih", "court"] as const).map((col) => {
                  const c = p[col];
                  if (!c) return null;
                  return (
                    <div key={col} className="mt-1">
                      {p.fikih && p.court ? <span className="text-sm text-ink-muted">{R(g.columns[col].label)}: </span> : null}
                      <FracText f={c.frac} />
                      {c.rupiah ? <span className="text-ink-muted"> · {c.rupiah.text}</span> : null}
                      {c.note ? <p className="text-sm text-ink-muted">{R(c.note)}</p> : null}
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
          {g.basisNote ? <p className="mt-3 text-sm text-ink-muted">{R(g.basisNote)}</p> : null}
        </div>
      ) : null}

      <div className="wr-table-wrap mt-6">
        <table className="wr-table" role="table">
          <caption className="mb-2 text-left text-base text-ink">
            <span className="font-semibold">{R(leadHead.label)}</span>
            {g.bergantung ? (
              <span className="mt-1 block font-medium text-notice">{R(msg("laporan.ringkasan.tabel_kemungkinan", { kemungkinan: g.bergantung.baseOption }))}</span>
            ) : null}
            {leadHead.table ? <span className="block text-sm text-ink-muted">{R(leadHead.table.caption)}</span> : null}
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                {R(msg("laporan.ringkasan.kolom_ahli"))}
              </th>
              <th scope="col" role="columnheader">
                {shareLabel}
              </th>
              <th scope="col" role="columnheader">
                {R(msg("laporan.ringkasan.kolom_persen"))}
              </th>
              {g.rupiahShown ? (
                <th scope="col" role="columnheader">
                  {R(msg("laporan.ringkasan.kolom_rupiah"))}
                </th>
              ) : null}
              {otherCells ? (
                <th scope="col" role="columnheader" className="wr-court-cell">
                  {R(otherHead.label)}
                </th>
              ) : null}
              <th scope="col" role="columnheader" data-print="hide">
                {R(msg("laporan.ringkasan.kolom_dasar"))}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {g.rows.map((row) => {
              const cell = row[lead];
              const main = cell ? mainOf(leadHead, cell) : { value: null, per: null };
              const oc = row.differs ? row[other] : undefined;
              const om = oc ? mainOf(otherHead, oc) : null;
              const label = R(row.label);
              return (
                <tr key={row.key} role="row" className="wr-heir-row">
                  <th scope="row" role="rowheader" className="font-semibold text-ink">
                    <span className="text-lg">{label}</span>
                    {row.count > 1 ? <span className="block text-base font-normal text-ink-muted">{R(row.countText)}</span> : null}
                  </th>
                  <td role="cell" data-share={main.value?.figure ?? "0"} data-column={lead} data-heir={row.role}>
                    {cell ? <ShareCell head={leadHead} cell={cell} row={row} label={shareLabel} /> : null}
                  </td>
                  <td role="cell">
                    <span className="wr-cell-label" aria-hidden="true">
                      {R(msg("laporan.ringkasan.kolom_persen"))}
                    </span>
                    {main.value ? `${main.value.percent} %` : "–"}
                  </td>
                  {g.rupiahShown ? (
                    <td role="cell">
                      <span className="wr-cell-label" aria-hidden="true">
                        {R(msg("laporan.ringkasan.kolom_rupiah"))}
                      </span>
                      {cell?.rupiahTotal ? <span className="font-semibold">{cell.rupiahTotal.text}</span> : "–"}
                      {cell?.rupiahPerHead && row.count > 1 ? (
                        <span className="block text-sm text-ink-muted">{R(msg("laporan.ringkasan.masing", { bagian: cell.rupiahPerHead.text }))}</span>
                      ) : null}
                    </td>
                  ) : null}
                  {otherCells ? (
                    <td
                      role="cell"
                      className="wr-court-cell"
                      {...(oc && om ? { "data-share": om.value?.figure ?? "0", "data-column": other, "data-heir": row.role } : {})}
                    >
                      {oc ? (
                        <>
                          <ShareCell head={otherHead} cell={oc} row={row} label={R(otherHead.label)} />
                          {oc.rupiahTotal ? <p className="mt-1 text-base text-ink">{oc.rupiahTotal.text}</p> : null}
                          {because(row) ? <p className="mt-1 text-sm text-ink-muted">{because(row)}</p> : null}
                        </>
                      ) : (
                        <>
                          <span className="wr-cell-label" aria-hidden="true">
                            {R(otherHead.label)}
                          </span>
                          <span className="text-ink-muted">{t("sama_dengan_kolom_utama")}</span>
                        </>
                      )}
                    </td>
                  ) : null}
                  <td role="cell" data-print="hide">
                    {dasarAnchors.has(row.dasarAnchor) ? (
                      <a href={`#${row.dasarAnchor}`} onClick={(e) => revealTarget(e, row.dasarAnchor)} className="chip-link">
                        {R(msg("laporan.ringkasan.lihat_dasar"))}
                        <span className="sr-only"> {label}</span>
                        <span aria-hidden="true">›</span>
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {g.residue ? (
        <div className="wr-keep mt-4 rounded-xl border-[1.5px] border-dashed border-border-ui bg-white p-4">
          <p className="font-semibold text-ink">{R(msg("laporan.baris.sisa", undefined, true))}</p>
          {(["fikih", "court"] as const).map((col) => {
            const c = g.residue?.[col];
            if (!c) return null;
            return (
              <p key={col} className="mt-1 text-base text-ink">
                {g.residue?.fikih && g.residue?.court ? <span className="text-sm text-ink-muted">{R(g.columns[col].label)}: </span> : null}
                <FracFigure f={c.frac} /> <span className="text-ink-muted">({c.frac.words})</span>
                {c.rupiah ? <span className="text-ink-muted"> · {c.rupiah.text}</span> : null}
              </p>
            );
          })}
          <p className="mt-2 text-pretty text-ink">{R(g.residue.text)}</p>
        </div>
      ) : null}

      <div className="mt-4 space-y-1 text-sm text-ink-muted">
        <p>{R(g.fractionNote)}</p>
        {g.rupiahNote ? <p>{R(g.rupiahNote)}</p> : null}
      </div>

      {onRupiah && !g.rupiahShown && !g.rupiahNote ? (
        <button type="button" onClick={onRupiah} className="btn-secondary mt-4 w-full sm:w-auto" data-print="hide">
          <Calculator className="h-5 w-5" aria-hidden />
          {R(msg("laporan.ringkasan.hitung_rupiah"))}
        </button>
      ) : null}

    </Section>
  );
}
