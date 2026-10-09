"use client";

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Q_TEXT, type QTextKey } from "@/lib/waris/questionnaire";
import {
  msg,
  outcomeColumnLines,
  type BarView,
  type CatatanView,
  type CellView,
  type ColumnHead,
  type ColumnId,
  type DalilCard,
  type DalilRow,
  type DalilSectionView,
  type DiagramView,
  type FracView,
  type HeirRow,
  type KepalaView,
  type LangkahView,
  type LegalRefView,
  type Msg,
  type NoneView,
  type PenutupView,
  type PrimaryDalilView,
  type RefusalView,
  type ReportModel,
  type RingkasanView,
  type TidakMendapatView,
} from "@/lib/waris/report";

import { PatternFill, pctOf } from "./Diagram";
import { mainOf } from "./Ringkasan";
import { useReportText } from "./text";

/**
 * The compact printout (plan §6 "Print and PDF", §10 M2.9: case 3 on at most 3 A4 pages). Print
 * media only: waris.css hides it on screen and hides the screen report on paper, so the screen
 * stays exactly as it is. Fed from the same view-model, in the same section order:
 *  0 Kepala: title, date, answer code, the mandatory label, the legal route and musyawarah;
 *  1 Ringkasan: the table (heir, count, fraction, percent, rupiah, the court column where it
 *    differs), the bequests taken first, the estate steps in one line, and one estate bar;
 *  3 who receives nothing and why, one line each;
 *  4 per row only its PRIMARY dalil (report/primary.ts: a verified slice, the matn only for a
 *    hadith, Arabic 14pt, one line of the corpus translation), then every other source once as a
 *    citation (kitab + number / section, legal sources by instrument): no kitab excerpt bodies;
 *  5 Catatan metode, 6 Langkah berikutnya as a tick list, 7 Penutup.
 * The family tree and the "Lihat sebagai tabel" toggles are screen only. Nothing here says that
 * anything was or will be reviewed. No links (paper cannot follow them; the citation names the
 * passage). No data-share attributes: the end-to-end check reads the screen table only.
 */

const otherOf = (c: ColumnId): ColumnId => (c === "fikih" ? "court" : "fikih");

function Frac({ f }: { f: FracView }) {
  return (
    <>
      <b>{f.figure}</b> ({f.words})
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="wr-c-section">
      <h2 className="wr-c-h2">{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// 0. Kepala
// ---------------------------------------------------------------------------------------------

function Kepala({ k }: { k: KepalaView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  return (
    <header className="wr-c-kepala">
      <h1 className="wr-c-h1">
        {R(k.title)} <span className="wr-c-subjudul">{R(k.subtitle)}</span>
      </h1>
      {/* Mandatory label (AGENTS.md; plan D16): printed at the top and again in the Penutup. */}
      <p className="wr-c-label">{R(k.label)}</p>
      {k.simulasiNote ? (
        <p className="wr-c-s">
          <b>{t("simulasi_tag")}</b> {R(k.simulasiNote)}
        </p>
      ) : null}
      <p className="wr-c-meta wr-c-s">
        {k.date ? <span>{R(msg("laporan.kepala.tanggal", { tanggal: k.date.text }))}</span> : null}
        <span>
          <b>{R(k.answerCodeLine)}</b>
        </span>
        <span>
          {R(k.leadColumnLine)}
          {k.methodLabel ? ` (${R(k.methodLabel)})` : ""}
        </span>
      </p>
      <p className="wr-c-xs">{t("kode_help")}</p>
      <p className="wr-c-s wr-c-gap">
        {R(k.route)} {R(k.musyawarah)}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Ringkasan (+ the estate steps and one estate bar)
// ---------------------------------------------------------------------------------------------

function reasonLine(x: RefusalView, R: (m: Msg) => string): string {
  if (x.rule) return `${x.rule.title} — ${x.rule.summary}`;
  return x.text ? R(x.text) : x.reason;
}

function noneLine(n: NoneView, R: (m: Msg) => string): string {
  const who = n.count > 1 ? R(msg("laporan.pohon.jumlah", { jumlah: n.count, kerabat: n.label }, true)) : R({ ...n.label, cap: true });
  const why = n.by
    ? R(msg("laporan.ringkasan.terhalang_oleh", { oleh: n.by }))
    : n.kind === "bukan"
      ? R(msg("laporan.ringkasan.bukan_ahli_waris"))
      : R(msg("laporan.ringkasan.tidak_mendapat"));
  return `${who}: ${why}`;
}

function Share({ head, cell, row }: { head: ColumnHead; cell: CellView; row: HeirRow }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const { value, per } = mainOf(head, cell);
  return (
    <>
      {value ? <Frac f={value} /> : cell.none.length === 0 ? R(msg("laporan.ringkasan.tidak_mendapat")) : null}
      {per && row.count > 1 ? <span className="wr-c-line">{R(msg("laporan.ringkasan.masing", { bagian: `${per.figure} (${per.words})` }))}</span> : null}
      {cell.persons
        ? cell.persons.map((p, i) => (
            <span key={p.personId} className="wr-c-line">
              {t("orang_ke", { n: i + 1 })}: {p.share.figure} ({p.share.words}){p.rupiah ? ` · ${p.rupiah.text}` : ""}
            </span>
          ))
        : null}
      {head.basis === "harta_waris" && cell.lineTotal && value && cell.lineTotal.figure !== value.figure ? (
        <span className="wr-c-line wr-c-xs">{R(msg("laporan.ringkasan.basis_baris", { bagian: cell.lineTotal.figure }))}</span>
      ) : null}
      {cell.change ? <span className="wr-c-line wr-c-xs">{R(cell.change.text)}</span> : null}
      {cell.none.map((n, i) => (
        <span key={`${n.kind}-${i}`} className="wr-c-line wr-c-xs">
          {noneLine(n, R)}
        </span>
      ))}
    </>
  );
}

/** One estate bar: the leading column's (the court column's differing shares are in the table). */
function Bar({ d, g }: { d: DiagramView; g: RingkasanView }) {
  const { R } = useReportText();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const lead: ColumnId = g.columns.fikih.lead ? "fikih" : "court";
  const bar: BarView | undefined = d.bars[lead];
  if (!bar) return null;
  return (
    <figure className="wr-c-figure">
      <figcaption className="wr-c-xs">
        <b>
          {R(d.bars.title)}
          {d.bars.fikih && d.bars.court ? ` · ${R(g.columns[lead].label)}` : ""}
        </b>
        {bar.table ? ` · ${R(bar.table.caption)}` : ""}
      </figcaption>
      <div className="wr-c-bar" aria-hidden="true">
        {bar.segments.map((s, i) => (
          <div key={s.key} className={`wr-c-seg ${s.kind === "sisa" ? "wr-c-sisa" : ""}`} style={{ width: `${pctOf(s.frac.n, s.frac.d)}%` }}>
            <PatternFill id={`c${uid}-${i}`} seg={s} />
            {!s.small ? <span>{s.frac.figure}</span> : null}
          </div>
        ))}
      </div>
      <ul className="wr-c-legend wr-c-xs">
        {bar.segments.map((s, i) => (
          <li key={s.key}>
            <span className={`wr-c-swatch ${s.kind === "sisa" ? "wr-c-sisa" : ""}`} aria-hidden="true">
              <PatternFill id={`k${uid}-${i}`} seg={s} />
            </span>
            {R({ ...s.label, cap: true })} {s.frac.figure}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Ringkasan({ g, d, diff }: { g: RingkasanView; d: DiagramView | null; diff: CatatanView["diff"] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const lead: ColumnId = g.columns.fikih.lead ? "fikih" : "court";
  const other = otherOf(lead);
  const leadHead = g.columns[lead];
  const otherHead = g.columns[other];
  const otherRefused = otherHead.shown && otherHead.status === "rujuk";
  const otherCells = otherHead.shown && otherHead.status === "hasil" && g.rows.some((r) => r.differs && !!r[other]);
  const because = (row: HeirRow): string | null => {
    const x = (diff?.rows ?? []).find((y) => y.personIds.some((p) => row.personIds.includes(p)));
    return x ? R(x.because) : null;
  };
  const colLabel = (c: ColumnId) => R(g.columns[c].label);
  // (a) of the screen diagram, shrunk to one line: from the whole estate to the harta waris
  const shrink = d?.shrink ?? null;
  return (
    <Section title={R(g.title)}>
      <p>
        {g.sentence.map((s) => R(s)).join(" ")}
        {otherRefused ? null : ` ${R(g.agreeLine)}`}
      </p>
      {otherRefused ? (
        <div className="wr-c-box wr-c-s">
          <p>
            <b>{R(g.agreeLine)}</b>
          </p>
          <ul className="wr-c-list">
            {(otherHead.refusal ?? []).map((x, i) => (
              <li key={`${x.reason}-${i}`}>{reasonLine(x, R)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {g.bergantung ? (
        <div className="wr-c-box wr-c-s">
          <p>
            <b>{R(g.bergantung.line)}</b>
          </p>
          <div className="wr-c-grid2">
            {g.bergantung.outcomes.map((o, i) => (
              <div key={i}>
                <p>
                  <b>{R(o.option)}</b>
                  {o.base ? ` (${t("dipakai_di_tabel")})` : ""}
                </p>
                {(["fikih", "court"] as const).map((col) => {
                  const part = o[col];
                  if (!part) return null;
                  return (
                    <p key={col} className="wr-c-xs">
                      {colLabel(col)}: {outcomeColumnLines(part, R).map((l) => l.text).join("; ")}
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {g.stamps.map((s, i) => (
        <p key={i} className="wr-c-stamp wr-c-s">
          <b>
            {t("perlu_konfirmasi")} · {s.columns.map(colLabel).join(", ")}:
          </b>{" "}
          {s.text ? R(s.text) : null}
          {s.rule ? `${s.text ? " " : ""}${s.rule.title} — ${s.rule.summary}` : null}
        </p>
      ))}

      {g.preLines.length > 0 ? (
        <div className="wr-c-gap wr-c-s">
          <p>
            <b>{R(msg("laporan.ringkasan.diambil_dulu"))}:</b>{" "}
            {g.preLines.map((p, i) => (
              <span key={p.key}>
                {i > 0 ? "; " : ""}
                {R({ ...p.label, cap: true })}
                {(["fikih", "court"] as const).map((col) => {
                  const c = p[col];
                  if (!c) return null;
                  return (
                    <span key={col}>
                      {" "}
                      {p.fikih && p.court ? `${colLabel(col)}: ` : ""}
                      <Frac f={c.frac} />
                      {c.rupiah ? ` · ${c.rupiah.text}` : ""}
                      {c.note ? ` (${R(c.note)})` : ""}
                    </span>
                  );
                })}
              </span>
            ))}
          </p>
          {g.basisNote ? <p className="wr-c-xs">{R(g.basisNote)}</p> : null}
        </div>
      ) : null}

      {shrink
        ? [lead, other].map((c) => {
            const steps = shrink[c];
            if (!steps || steps.length === 0) return null;
            const both = !!(shrink.fikih && shrink.court);
            return (
              <p key={`shrink-${c}`} className="wr-c-gap wr-c-s">
                <b>
                  {R(shrink.title)}
                  {both ? ` · ${colLabel(c)}` : ""}:
                </b>{" "}
                {steps
                  .map((s, i) => {
                    const label = R({ ...s.label, cap: true });
                    if (i === 0) return `${label}: ${s.amount.text}`;
                    if (i === steps.length - 1) return `= ${label}: ${s.amount.text}`;
                    return `− ${label}: ${s.amount.text}`;
                  })
                  .join(" ")}
              </p>
            );
          })
        : null}

      <table className="wr-c-table">
        <caption>
          <b>{R(leadHead.label)}</b>
          {leadHead.table ? ` · ${R(leadHead.table.caption)}` : ""}
          {g.bergantung ? ` · ${R(msg("laporan.ringkasan.tabel_kemungkinan", { kemungkinan: g.bergantung.baseOption }))}` : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">{R(msg("laporan.ringkasan.kolom_ahli"))}</th>
            <th scope="col">{R(msg("laporan.ringkasan.kolom_jumlah"))}</th>
            <th scope="col">{R(msg("laporan.ringkasan.kolom_bagian"))}</th>
            <th scope="col">{R(msg("laporan.ringkasan.kolom_persen"))}</th>
            {g.rupiahShown ? <th scope="col">{R(msg("laporan.ringkasan.kolom_rupiah"))}</th> : null}
            {otherCells ? <th scope="col">{R(otherHead.label)}</th> : null}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((row) => {
            const cell = row[lead];
            const main = cell ? mainOf(leadHead, cell) : { value: null, per: null };
            const oc = row.differs ? row[other] : undefined;
            const why = oc ? because(row) : null;
            return (
              <tr key={row.key}>
                <th scope="row">{R(row.label)}</th>
                <td className="wr-c-num">{row.count}</td>
                <td>{cell ? <Share head={leadHead} cell={cell} row={row} /> : null}</td>
                <td className="wr-c-num">{main.value ? `${main.value.percent} %` : "–"}</td>
                {g.rupiahShown ? (
                  <td className="wr-c-num">
                    {cell?.rupiahTotal ? <b>{cell.rupiahTotal.text}</b> : "–"}
                    {cell?.rupiahPerHead && row.count > 1 ? (
                      <span className="wr-c-line wr-c-xs">{R(msg("laporan.ringkasan.masing", { bagian: cell.rupiahPerHead.text }))}</span>
                    ) : null}
                  </td>
                ) : null}
                {otherCells ? (
                  <td>
                    {oc ? (
                      <>
                        <Share head={otherHead} cell={oc} row={row} />
                        {oc.rupiahTotal ? <span className="wr-c-line">{oc.rupiahTotal.text}</span> : null}
                        {why ? <span className="wr-c-line wr-c-xs">{why}</span> : null}
                      </>
                    ) : (
                      <span className="wr-c-xs">{t("sama_dengan_kolom_utama")}</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {g.residue ? (
        <p className="wr-c-box wr-c-s">
          <b>{R(msg("laporan.baris.sisa", undefined, true))}:</b>{" "}
          {(["fikih", "court"] as const).map((col) => {
            const c = g.residue?.[col];
            if (!c) return null;
            return (
              <span key={col}>
                {g.residue?.fikih && g.residue?.court ? `${colLabel(col)}: ` : ""}
                <Frac f={c.frac} />
                {c.rupiah ? ` · ${c.rupiah.text}` : ""}{" "}
              </span>
            );
          })}
          {R(g.residue.text)}
        </p>
      ) : null}

      <p className="wr-c-xs wr-c-gap">
        {R(g.fractionNote)}
        {g.rupiahNote ? ` ${R(g.rupiahNote)}` : ""}
      </p>

      {d ? <Bar d={d} g={g} /> : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Yang tidak mendapat bagian: one line each
// ---------------------------------------------------------------------------------------------

function Tidak({ v, g, cards }: { v: TidakMendapatView; g: RingkasanView; cards: ReadonlyMap<string, DalilCard> }) {
  const { R } = useReportText();
  if (v.groups.length === 0) return null;
  const courtLabel = R(g.columns.court.label);
  const colLabel = (c: ColumnId) => R(g.columns[c].label);
  // every group closes with the same QS 4:8 line on screen; on paper it is printed once
  const closing = v.groups[0].closing;
  const closingCard = cards.get(closing.dalilId);
  return (
    <Section title={R(v.title)}>
      {v.groups.map((grp) => (
        <div key={grp.kind} className="wr-c-group">
          <p className="wr-c-h3">{R(grp.title)}</p>
          {grp.entries.length > 0 ? (
            <ul className="wr-c-list">
              {grp.entries.map((e, i) => (
                <li key={`${e.label.key}-${i}`}>
                  {e.count > 1 ? <b>{R(msg("laporan.pohon.jumlah", { jumlah: e.count, kerabat: { ...e.label, cap: false } }, true))}: </b> : null}
                  {e.fikih ? R(e.fikih.text) : <b>{R(e.label)}</b>}
                  {e.court ? ` ${R(msg("laporan.tidak.kolom_lain", { kolom: courtLabel, alasan: e.court.text }))}` : ""}
                  {e.jalan.length > 0 ? (
                    <span className="wr-c-line wr-c-xs">
                      <b>{R(msg("laporan.tidak.jalan_judul"))}:</b>{" "}
                      {e.jalan
                        .map((j) => {
                          const figures = (["fikih", "court"] as const)
                            .map((c) => {
                              const f = j[c];
                              return f ? ` ${colLabel(c)}: ${f.figure} (${f.words}, ${f.percent} %).` : "";
                            })
                            .join("");
                          return `${R(j.text)}${figures}`;
                        })
                        .join(" ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {grp.notAsked.length > 0 ? (
            <ul className="wr-c-list wr-c-cols2">
              {grp.notAsked.map((n, i) => (
                <li key={i}>{R(n.text)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <p className="wr-c-s wr-c-gap">
        {R(closing.text)}
        {closingCard ? ` (${closingCard.citation.text})` : ""}
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Dalil: the primary clause per row, then every other source once as a citation
// ---------------------------------------------------------------------------------------------

function citationText(c: DalilCard): string {
  return `${c.citation.text}${c.citation.section ? ` · §${c.citation.section}` : ""}`;
}

/** Dalil citations grouped by work: "QS An-Nisa' [4]: 8, 10", "Sahih al-Bukhari 2742, 6739", "Fath al-Qarib … §116, §117". */
function groupCards(cards: readonly DalilCard[], R: (m: Msg) => string): string[] {
  const items = new Map<string, string[]>();
  const add = (key: string, item: string | null) => {
    let list = items.get(key);
    if (!list) {
      list = [];
      items.set(key, list);
    }
    if (item !== null && !list.includes(item)) list.push(item);
  };
  for (const c of cards) {
    const text = c.citation.text;
    // plan D10: Bukhari 6734 is Mu'adh's ruling (atsar), never a saying of the Prophet
    const atsar = c.tags.some((m) => m.key === "laporan.dalil.atsar_muadh") ? ` (${R(msg("laporan.dalil.atsar_muadh"))})` : "";
    const num = c.citation.number;
    const q = c.kind === "quran" ? /^(.*?):\s*([0-9]+)$/.exec(text) : null;
    const tf = c.kind === "tafsir" ? /^(.*),\s*([0-9]+:[0-9]+)$/.exec(text) : null;
    if (q) add(`${q[1]}:`, q[2]);
    else if (tf) add(`${tf[1]},`, tf[2]);
    else if (c.kind === "hadith" && num && text.endsWith(num)) add(text.slice(0, text.length - num.length).trim(), `${num}${atsar}`);
    else if (c.kind === "fiqh") add(text, c.citation.section ? `§${c.citation.section}` : null);
    else add(`${text}${atsar}`, null);
  }
  return [...items].map(([key, list]) => (list.length > 0 ? `${key} ${list.join(", ")}` : key.replace(/[:,]$/, "")));
}

/** Every Indonesian legal source anywhere in the model (RuleNotes, Pendapat lain, Langkah, Perlu dipastikan), once. */
function collectLegal(x: unknown, out: Map<string, LegalRefView>): Map<string, LegalRefView> {
  if (Array.isArray(x)) {
    for (const y of x) collectLegal(y, out);
  } else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o.source === "string" && typeof o.locator === "string" && typeof o.title === "string" && typeof o.pinned === "boolean") {
      const key = `${o.source}|${o.locator}`;
      if (!out.has(key)) out.set(key, o as unknown as LegalRefView);
    } else {
      for (const v of Object.values(o)) collectLegal(v, out);
    }
  }
  return out;
}

const firstNumber = (s: string): number => {
  const m = /[0-9]+/.exec(s);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
};

/** "Kompilasi Hukum Islam (…): Pasal 96 ayat (1); Pasal 171 huruf e; …", one entry per instrument. */
function groupLegal(refs: readonly LegalRefView[]): string[] {
  const by = new Map<string, string[]>();
  for (const l of refs) {
    const list = by.get(l.title) ?? [];
    if (!list.includes(l.locator)) list.push(l.locator);
    by.set(l.title, list);
  }
  return [...by].map(([title, locs]) => {
    const sorted = locs.map((x, i) => ({ x, i, n: firstNumber(x) })).sort((a, b) => a.n - b.n || a.i - b.i);
    return `${title}: ${sorted.map((s) => s.x).join("; ")}`;
  });
}

function Primary({ p, card, note, seeAbove }: { p: PrimaryDalilView; card: DalilCard | undefined; note: number | null; seeAbove: string }) {
  const cite = card ? citationText(card) : p.id;
  if (!p.first) {
    return (
      <p className="wr-c-xs">
        {cite} · {seeAbove}
      </p>
    );
  }
  return (
    <div className="wr-c-primary">
      <p lang="ar" dir="rtl" className="wr-c-ar">
        {p.cut.start ? "… " : ""}
        {p.arabic.text}
        {p.cut.end ? " …" : ""}
      </p>
      <p className="wr-c-s">
        <b>{cite}</b>
        {p.meaning ? ` — “${p.meaning.cut.start ? "… " : ""}${p.meaning.text}${p.meaning.cut.end ? " …" : ""}”` : ""}
        {note !== null ? <sup>{note}</sup> : null}
      </p>
    </div>
  );
}

function Dalil({ v, model }: { v: DalilSectionView; model: ReportModel }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const cards = new Map(model.dalilCards.map((c) => [c.id, c] as const));
  const rows: { row: DalilRow; figure: boolean }[] = [
    ...(v.sebelum ? [{ row: v.sebelum, figure: false }] : []),
    ...v.rows.map((row) => ({ row, figure: true })),
    ...(v.tidakMendapat ? [{ row: v.tidakMendapat, figure: false }] : []),
  ];
  // footnotes: the source label of each printed translation, or why a clause has none
  const notes: Msg[] = [];
  const noteOf = (p: PrimaryDalilView): number | null => {
    const m = p.meaning ? p.meaning.label : (cards.get(p.id)?.meaningMissing ?? null);
    if (!m) return null;
    const i = notes.findIndex((x) => x.key === m.key);
    if (i >= 0) return i + 1;
    notes.push(m);
    return notes.length;
  };
  const noteNo = new Map<string, number | null>();
  for (const { row } of rows) if (row.primary?.first) noteNo.set(row.anchor, noteOf(row.primary));
  const primaryIds = new Set(rows.flatMap(({ row }) => (row.primary ? [row.primary.id] : [])));
  const listed = model.dalilCards.filter((c) => !primaryIds.has(c.id));
  const dalilGroups = groupCards(listed, R);
  const legal = [...collectLegal(model, new Map()).values()];
  const legalGroups = groupLegal(legal);
  const seeAbove = R(v.seeAbove);
  return (
    <Section title={R(v.title)}>
      {rows.map(({ row, figure }) => (
        <div key={row.anchor} className="wr-c-dalil">
          <p>
            <b>{R({ ...row.title, cap: true })}</b>
            {figure && row.fikih ? ` (${row.fikih.figure})` : ""}
          </p>
          {row.rules.length > 0 ? <p className="wr-c-xs">{row.rules.map((r) => r.title).join(" · ")}</p> : null}
          {row.courtLine && row.courtRules.length > 0 ? (
            <p className="wr-c-xs">
              {R(row.courtLine)}: {row.courtRules.map((r) => r.title).join(" · ")}
            </p>
          ) : null}
          {row.primary ? <Primary p={row.primary} card={cards.get(row.primary.id)} note={noteNo.get(row.anchor) ?? null} seeAbove={seeAbove} /> : null}
        </div>
      ))}
      {dalilGroups.length + legalGroups.length > 0 ? (
        <div className="wr-c-sources">
          <p className="wr-c-h3">{t("dalil_lain", { jumlah: listed.length + legal.length })}</p>
          {dalilGroups.length > 0 ? (
            <p className="wr-c-xs">
              <b>{t("dalil_links")}</b> {dalilGroups.join(" · ")}
            </p>
          ) : null}
          {legalGroups.length > 0 ? (
            <p className="wr-c-xs">
              <b>{t("legal_links")}</b> {legalGroups.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {notes.length > 0 ? (
        <div className="wr-c-notes wr-c-xs">
          {notes.map((m, i) => (
            <p key={m.key}>
              <sup>{i + 1}</sup> {R(m)}
            </p>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Catatan metode
// ---------------------------------------------------------------------------------------------

function Catatan({ c, g, qNotes }: { c: CatatanView; g: RingkasanView; qNotes: readonly QTextKey[] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const colLabel = (id: ColumnId) => R(g.columns[id].label);
  const stamped = new Set(g.stamps.flatMap((s) => (s.rule ? [s.rule.ruleId] : [])));
  return (
    <Section title={R(c.title)}>
      <p className="wr-c-h3">{R(c.assumptionsTitle)}</p>
      <ul className="wr-c-list wr-c-s">
        {c.assumptions.map((a, i) => (
          <li key={i}>{a.text ? R(a.text) : a.rule ? `${a.rule.title} — ${a.rule.summary}` : null}</li>
        ))}
        {qNotes.map((k) => (
          <li key={k}>{Q_TEXT[k]}</li>
        ))}
      </ul>

      {c.diff ? (
        <>
          <p className="wr-c-h3">{R(c.diff.title)}</p>
          <p className="wr-c-xs">{R(c.diff.why)}</p>
          <table className="wr-c-table wr-c-s">
            <thead>
              <tr>
                <th scope="col">{R(msg("laporan.ringkasan.kolom_ahli"))}</th>
                <th scope="col">{colLabel("fikih")}</th>
                <th scope="col">{colLabel("court")}</th>
              </tr>
            </thead>
            <tbody>
              {c.diff.rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">
                    {R(r.label)}
                    {r.basis === "setelah_utang" ? <span className="wr-c-line wr-c-xs">{t("dari_harta_setelah_utang")}</span> : null}
                  </th>
                  <td>{r.fikih.total ? <Frac f={r.fikih.total} /> : r.fikih.none ? R(r.fikih.none) : "–"}</td>
                  <td>
                    {r.court.total ? <Frac f={r.court.total} /> : r.court.none ? R(r.court.none) : "–"}
                    <span className="wr-c-line wr-c-xs">{R(r.because)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {c.raddNote ? (
        <p className="wr-c-s wr-c-gap">
          <b>{colLabel("court")}:</b> {R(c.raddNote.court.text)}
        </p>
      ) : null}

      {c.perlu.length > 0 ? (
        <>
          <p className="wr-c-h3">{R(c.perluTitle)}</p>
          <ul className="wr-c-list wr-c-s">
            {c.perlu.map((p, i) => (
              <li key={i}>
                {p.columns.length > 0 ? <b>{p.columns.map(colLabel).join(", ")}: </b> : null}
                {p.text ? R(p.text) : null}
                {p.detail ? ` ${R(p.detail)}` : ""}
                {p.rule ? `${p.text ? " " : ""}${p.rule.title}${stamped.has(p.rule.ruleId) ? "" : ` — ${p.rule.summary}`}` : ""}
                {p.outcomes
                  ? p.outcomes.map((o, k) => (
                      <span key={k} className="wr-c-line wr-c-xs">
                        <b>{R(o.option)}:</b>{" "}
                        {(["fikih", "court"] as const)
                          .map((col) => {
                            const part = o[col];
                            return part ? `${colLabel(col)}: ${outcomeColumnLines(part, R).map((l) => l.text).join("; ")}` : "";
                          })
                          .filter((x) => x !== "")
                          .join(" · ")}
                      </span>
                    ))
                  : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {c.other.length > 0 ? (
        <>
          <p className="wr-c-h3">{R(c.otherTitle)}</p>
          <ul className="wr-c-list wr-c-xs">
            {c.other.map((o) => (
              <li key={o.rule.ruleId}>
                <b>
                  {o.rule.title} ({o.columns.map(colLabel).join(", ")}):
                </b>{" "}
                {o.rule.summary}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {(c.table.fikih?.length ?? 0) + (c.table.court?.length ?? 0) > 0 || c.roundingRule ? (
        <div className="wr-c-gap wr-c-xs">
          {(["fikih", "court"] as const).map((col) =>
            (c.table[col] ?? []).map((m, i) => (
              <p key={`${col}-${i}`}>
                {colLabel(col)}: {R(m)}
              </p>
            )),
          )}
          {c.roundingRule ? (
            <p>
              <b>{c.roundingRule.title}:</b> {c.roundingRule.method ?? c.roundingRule.summary}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="wr-c-xs wr-c-gap">{R(c.version)}</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// 6. Langkah berikutnya, 7. Penutup
// ---------------------------------------------------------------------------------------------

function Langkah({ v }: { v: LangkahView }) {
  const { R } = useReportText();
  const numbered: (number | null)[] = [];
  let count = 0;
  for (const it of v.items) {
    if (it.sub) numbered.push(null);
    else {
      count += 1;
      numbered.push(count);
    }
  }
  return (
    <Section title={R(v.title)}>
      <ol className="wr-c-check">
        {v.items.map((it, i) => (
          <li key={it.id} className={it.sub ? "wr-c-indent" : undefined}>
            <span className="wr-c-tick" aria-hidden="true" />
            {numbered[i] !== null ? <b>{numbered[i]}. </b> : null}
            {R(it.text)}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Penutup({ v }: { v: PenutupView }) {
  const { R } = useReportText();
  return (
    <footer className="wr-c-penutup">
      <p>
        <b>{R(v.label)}</b>
      </p>
      <p className="wr-c-s">{v.lines.map((m) => R(m)).join(" ")}</p>
    </footer>
  );
}

// ---------------------------------------------------------------------------------------------
// The printout
// ---------------------------------------------------------------------------------------------

export function Cetak({ model, qNotes }: { model: ReportModel; qNotes: readonly QTextKey[] }) {
  const g = model.ringkasan;
  if (model.kind !== "laporan" || !g) return null;
  const cards = new Map(model.dalilCards.map((c) => [c.id, c] as const));
  return (
    <div className="wr-cetak" data-print="only">
      <Kepala k={model.kepala} />
      <Ringkasan g={g} d={model.diagram} diff={model.catatan?.diff ?? null} />
      {model.tidakMendapat ? <Tidak v={model.tidakMendapat} g={g} cards={cards} /> : null}
      {model.dalil ? <Dalil v={model.dalil} model={model} /> : null}
      {model.catatan ? <Catatan c={model.catatan} g={g} qNotes={qNotes} /> : null}
      {model.langkah ? <Langkah v={model.langkah} /> : null}
      <Penutup v={model.penutup} />
    </div>
  );
}
