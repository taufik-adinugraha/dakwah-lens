"use client";

import { useId, useState, type ReactNode } from "react";
import { Ban, CircleCheck, CircleMinus, Table } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  msg,
  type BarSegment,
  type BarView,
  type ColumnId,
  type DiagramView,
  type Msg,
  type RingkasanView,
  type ShrinkStep,
  type TreeNode,
  type TreeNodeColumn,
} from "@/lib/waris/report";

import { FracFigure, Section } from "./bits";
import { useReportText } from "./text";

/**
 * Section 2, Diagram (plan §6 row 2; architecture.md §8.1; ux.md §7): (a) from the estate to the
 * harta waris (only with rupiah), (b) the estate bar, (c) the family tree. Each is a <figure> with
 * a caption in words and a "Lihat sebagai tabel" toggle. Never colour alone: every bar segment has
 * a pattern, a text label and its fraction; every tree state has an icon and a word, and blocked
 * relatives are hatched with a dashed edge. Nothing animates, so reduced motion shows the same
 * final frame. Every number comes from the report model (that is, from solve()).
 */

const INK = "#1b1a17";

/** Monochrome SVG patterns, distinct in black-and-white print. */
function PatternDef({ id, index }: { id: string; index: number }) {
  const k = ((index % 8) + 8) % 8;
  switch (k) {
    case 0:
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke={INK} strokeWidth="2.5" />
        </pattern>
      );
    case 1:
      return (
        <pattern id={id} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="1.8" fill={INK} />
        </pattern>
      );
    case 2:
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          <line x1="0" y1="4" x2="8" y2="4" stroke={INK} strokeWidth="2" />
        </pattern>
      );
    case 3:
      return (
        <pattern id={id} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" stroke={INK} strokeWidth="1.5" />
          <line x1="0" y1="0" x2="9" y2="0" stroke={INK} strokeWidth="1.5" />
        </pattern>
      );
    case 4:
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          <line x1="4" y1="0" x2="4" y2="8" stroke={INK} strokeWidth="2" />
        </pattern>
      );
    case 5:
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke={INK} strokeWidth="1.5" />
        </pattern>
      );
    case 6:
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="5" height="5" fill={INK} fillOpacity="0.35" />
          <rect x="5" y="5" width="5" height="5" fill={INK} fillOpacity="0.35" />
        </pattern>
      );
    default:
      return (
        <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="6" cy="6" r="3" fill="none" stroke={INK} strokeWidth="1.5" />
        </pattern>
      );
  }
}

/** A pattern fill for a box; "sisa" (unassigned residue) is blank with a dashed edge instead. */
function PatternFill({ id, seg }: { id: string; seg: BarSegment }) {
  if (seg.kind === "sisa") return null;
  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
      <defs>
        <PatternDef id={id} index={seg.pattern} />
      </defs>
      <rect width="100%" height="100%" fill="#ffffff" />
      <rect width="100%" height="100%" fill={`url(#${id})`} fillOpacity="0.55" />
    </svg>
  );
}

function pctOf(n: string, d: string): number {
  const nn = Number(n);
  const dd = Number(d);
  return dd > 0 ? (nn * 100) / dd : 0;
}

/** A figure with its caption and a "Lihat sebagai tabel" toggle (a pressed button, not a colour). */
function ToggleFigure({ title, caption, graphic, table }: { title: string; caption: string; graphic: ReactNode; table: ReactNode }) {
  const { R } = useReportText();
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="wr-keep mt-6 rounded-2xl border border-hairline bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold text-ink">{title}</p>
        <button type="button" className="btn-secondary" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-print="hide">
          <Table className="h-5 w-5" aria-hidden />
          {R(msg("laporan.diagram.lihat_tabel"))}
        </button>
      </div>
      <div className="mt-4">{asTable ? table : graphic}</div>
      <figcaption className="mt-4 text-pretty text-base text-ink">{caption}</figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------
// (a) Dari harta peninggalan ke harta waris
// ---------------------------------------------------------------------------------------------

function shrinkWidth(step: ShrinkStep, first: ShrinkStep): number {
  try {
    const total = BigInt(first.amount.amount);
    if (total <= BigInt(0)) return 0;
    return Number((BigInt(step.remaining.amount) * BigInt(10000)) / total) / 100;
  } catch {
    return 0;
  }
}

function ShrinkGraphic({ steps }: { steps: readonly ShrinkStep[] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const first = steps[0];
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const end = i === 0 || i === steps.length - 1;
        return (
          <li key={s.key}>
            <p className="text-base text-ink">
              <span className="font-medium">{R({ ...s.label, cap: true })}</span>
              {end ? <span className="font-semibold">: {s.amount.text}</span> : <span className="text-ink-muted"> − {s.amount.text}</span>}
            </p>
            <div className="wr-bar mt-1 h-6 w-full rounded-md border-[1.5px] border-border-ui bg-white" aria-hidden="true">
              <div className="h-full rounded-[0.3rem] bg-forest" style={{ width: `${first ? shrinkWidth(s, first) : 0}%` }} />
            </div>
            {!end ? <p className="text-sm text-ink-soft">{t("sisa_rupiah", { jumlah: s.remaining.text })}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ShrinkTable({ steps }: { steps: readonly ShrinkStep[] }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-base">
        <thead>
          <tr className="border-b-2 border-border-ui">
            <th scope="col" className="py-2 pr-3">{t("langkah")}</th>
            <th scope="col" className="py-2 pr-3">{t("jumlah")}</th>
            <th scope="col" className="py-2">{t("sisa")}</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.key} className="border-b border-hairline">
              <th scope="row" className="py-2 pr-3 font-medium">{R({ ...s.label, cap: true })}</th>
              <td className="py-2 pr-3">{s.amount.text}</td>
              <td className="py-2">{s.remaining.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (b) Bilah pembagian
// ---------------------------------------------------------------------------------------------

function BarGraphic({ bar }: { bar: BarView }) {
  const { R } = useReportText();
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  return (
    <div>
      {bar.table ? <p className="text-sm text-ink-muted">{R(bar.table.caption)}</p> : null}
      <div className="wr-bar mt-2 flex h-16 w-full overflow-hidden rounded-lg border-2 border-ink bg-white" aria-hidden="true">
        {bar.segments.map((s, i) => (
          <div
            key={s.key}
            className={`relative flex min-w-[6px] items-center justify-center ${i > 0 ? "border-l-2 border-ink" : ""} ${s.kind === "sisa" ? "wr-dashed border-dashed" : ""}`}
            style={{ width: `${pctOf(s.frac.n, s.frac.d)}%` }}
          >
            <PatternFill id={`p${uid}-${i}`} seg={s} />
            {!s.small ? <span className="relative rounded bg-white px-1.5 text-base font-semibold text-ink">{s.frac.figure}</span> : null}
          </div>
        ))}
      </div>
      <ul className="mt-4 space-y-2">
        {bar.segments.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 text-base text-ink">
            <span className={`relative inline-block h-7 w-10 shrink-0 overflow-hidden rounded border-2 border-ink bg-white ${s.kind === "sisa" ? "border-dashed" : ""}`} aria-hidden="true">
              <PatternFill id={`l${uid}-${i}`} seg={s} />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{R({ ...s.label, cap: true })}</span>: <FracFigure f={s.frac} /> <span className="text-ink-muted">({s.frac.words}, {s.frac.percent} %)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarTable({ bar }: { bar: BarView }) {
  const { R } = useReportText();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-base">
        <thead>
          <tr className="border-b-2 border-border-ui">
            <th scope="col" className="py-2 pr-3">{R(msg("laporan.ringkasan.kolom_ahli"))}</th>
            <th scope="col" className="py-2 pr-3">{R(msg("laporan.ringkasan.kolom_bagian"))}</th>
            <th scope="col" className="py-2">{R(msg("laporan.ringkasan.kolom_persen"))}</th>
          </tr>
        </thead>
        <tbody>
          {bar.segments.map((s) => (
            <tr key={s.key} className="border-b border-hairline">
              <th scope="row" className="py-2 pr-3 font-medium">{R({ ...s.label, cap: true })}</th>
              <td className="py-2 pr-3">
                {s.frac.figure} ({s.frac.words}){s.units && bar.table ? ` · ${s.units}/${bar.table.dasar}` : ""}
              </td>
              <td className="py-2">{s.frac.percent} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// (c) Pohon keluarga
// ---------------------------------------------------------------------------------------------

interface Item {
  node: TreeNode;
  count: number;
  children: Item[];
}

function buildTree(nodes: readonly TreeNode[]): { root: Item | null; outside: Item[] } {
  const kids = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (!n.parent || n.outside) continue;
    const list = kids.get(n.parent) ?? [];
    list.push(n);
    kids.set(n.parent, list);
  }
  const make = (n: TreeNode): Item => ({ node: n, count: 1, children: group(kids.get(n.id) ?? [], n.id === "pewaris") });
  const group = (list: readonly TreeNode[], top: boolean): Item[] => {
    const ordered = top ? [...list].sort((a, b) => a.generation - b.generation) : list;
    const out: Item[] = [];
    for (const n of ordered) {
      const leaf = !kids.has(n.id);
      const same = leaf ? out.find((x) => x.children.length === 0 && x.node.groupKey === n.groupKey) : undefined;
      if (same) same.count += 1;
      else out.push(make(n));
    }
    return out;
  };
  const rootNode = nodes.find((n) => n.id === "pewaris") ?? null;
  const outside = group(
    nodes.filter((n) => n.outside),
    false,
  );
  return { root: rootNode ? make(rootNode) : null, outside };
}

function StatusLine({ col, label }: { col: TreeNodeColumn; label?: string }) {
  const { R } = useReportText();
  const prefix = label ? <span className="text-ink-muted">{label}: </span> : null;
  if (col.status === "bagian") {
    return (
      <p className="flex items-start gap-1.5 text-base text-ink">
        <CircleCheck className="mt-1 h-4 w-4 shrink-0 text-forest" aria-hidden />
        <span>
          {prefix}
          {R(msg("laporan.pohon.mendapat"))}
          {col.share ? (
            <>
              {" "}
              <span className="font-semibold">{col.share.figure}</span> <span className="text-ink-muted">({col.share.words})</span>
            </>
          ) : null}
        </span>
      </p>
    );
  }
  if (col.status === "terhalang") {
    return (
      <p className="flex items-start gap-1.5 text-base text-ink">
        <Ban className="mt-1 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
        <span>
          {prefix}
          {col.by ? R(msg("laporan.ringkasan.terhalang_oleh", { oleh: col.by })) : R(msg("laporan.pohon.terhalang"))}
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-base text-ink">
      <CircleMinus className="mt-1 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
      <span>
        {prefix}
        {R(msg("laporan.pohon.bukan"))}
      </span>
    </p>
  );
}

function NodeBox({ item, lead, otherLabel }: { item: Item; lead: ColumnId; otherLabel: string }) {
  const { R } = useReportText();
  const n = item.node;
  const other: ColumnId = lead === "fikih" ? "court" : "fikih";
  const leadCol = n[lead];
  const otherCol = n[other];
  const hatched = !!leadCol?.hatch;
  const label: Msg = item.count > 1 ? msg("laporan.pohon.jumlah", { jumlah: item.count, kerabat: { ...n.label, cap: false } }, true) : n.label;
  const box =
    n.kind === "pewaris"
      ? "border-2 border-ink bg-paper-deep"
      : n.kind === "wafat_lebih_dulu"
        ? "wr-dashed border-[1.5px] border-dashed border-border-ui bg-white"
        : hatched
          ? "wr-hatch border-[1.5px] border-border-ui bg-white"
          : "border-[1.5px] border-border-ui bg-white";
  return (
    <div className={`inline-block max-w-full rounded-xl px-3 py-2 ${box}`}>
      <p className="font-semibold text-ink">{R(label)}</p>
      {n.kind === "wafat_lebih_dulu" ? <p className="text-sm text-ink-muted">{R(msg("laporan.pohon.wafat_dulu"))}</p> : null}
      {leadCol ? <StatusLine col={leadCol} /> : null}
      {otherCol ? <StatusLine col={otherCol} label={otherLabel} /> : null}
    </div>
  );
}

function TreeItems({ items, lead, otherLabel }: { items: readonly Item[]; lead: ColumnId; otherLabel: string }) {
  return (
    <ul>
      {items.map((it) => (
        <li key={it.node.id}>
          <NodeBox item={it} lead={lead} otherLabel={otherLabel} />
          {it.children.length > 0 ? <TreeItems items={it.children} lead={lead} otherLabel={otherLabel} /> : null}
        </li>
      ))}
    </ul>
  );
}

function flatten(items: readonly Item[], out: Item[] = []): Item[] {
  for (const it of items) {
    out.push(it);
    flatten(it.children, out);
  }
  return out;
}

function colText(R: (m: Msg) => string, col: TreeNodeColumn | undefined): string {
  if (!col) return "–";
  if (col.status === "bagian") return `${R(msg("laporan.pohon.mendapat"))}${col.share ? ` ${col.share.figure} (${col.share.words})` : ""}`;
  if (col.status === "terhalang") return col.by ? R(msg("laporan.ringkasan.terhalang_oleh", { oleh: col.by })) : R(msg("laporan.pohon.terhalang"));
  return R(msg("laporan.pohon.bukan"));
}

function TreeTable({ items, lead, leadLabel, otherLabel, showOther }: { items: readonly Item[]; lead: ColumnId; leadLabel: string; otherLabel: string; showOther: boolean }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const other: ColumnId = lead === "fikih" ? "court" : "fikih";
  const rows = flatten(items).filter((it) => it.node.kind !== "pewaris");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-base">
        <thead>
          <tr className="border-b-2 border-border-ui">
            <th scope="col" className="py-2 pr-3">{t("kerabat")}</th>
            <th scope="col" className="py-2 pr-3">{leadLabel}</th>
            {showOther ? <th scope="col" className="py-2">{otherLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => {
            const n = it.node;
            const label: Msg = it.count > 1 ? msg("laporan.pohon.jumlah", { jumlah: it.count, kerabat: { ...n.label, cap: false } }, true) : n.label;
            return (
              <tr key={n.id} className="border-b border-hairline">
                <th scope="row" className="py-2 pr-3 font-medium">
                  {R(label)}
                  {n.kind === "wafat_lebih_dulu" ? <span className="block text-sm font-normal text-ink-muted">{R(msg("laporan.pohon.wafat_dulu"))}</span> : null}
                </th>
                <td className="py-2 pr-3">{n.kind === "wafat_lebih_dulu" ? "–" : colText(R, n[lead])}</td>
                {showOther ? <td className="py-2">{n[other] ? colText(R, n[other]) : t("sama_dengan_kolom_utama")}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------------------------

export function Diagram({ d, g }: { d: DiagramView; g: RingkasanView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  const lead: ColumnId = g.columns.fikih.lead ? "fikih" : "court";
  const other: ColumnId = lead === "fikih" ? "court" : "fikih";
  const leadLabel = R(g.columns[lead].label);
  const otherLabel = R(g.columns[other].label);
  const tree = buildTree(d.tree.nodes);
  const treeItems = tree.root ? [tree.root] : [];
  const showOtherInTree = d.tree.nodes.some((n) => !!n[other]);
  const ordered: ColumnId[] = [lead, other];

  return (
    <Section id="diagram" title={R(d.title)}>
      {d.shrink
        ? ordered.map((c) => {
            const steps = d.shrink?.[c];
            if (!steps || steps.length === 0) return null;
            const last = steps[steps.length - 1];
            const title = d.shrink?.fikih && d.shrink?.court ? `${R(d.shrink.title)} · ${R(g.columns[c].label)}` : R(d.shrink?.title ?? msg("laporan.diagram.urutan"));
            return (
              <ToggleFigure
                key={`shrink-${c}`}
                title={title}
                caption={`${R({ ...last.label, cap: true })}: ${last.amount.text}.`}
                graphic={<ShrinkGraphic steps={steps} />}
                table={<ShrinkTable steps={steps} />}
              />
            );
          })
        : null}

      {ordered.map((c) => {
        const bar = d.bars[c];
        if (!bar) return null;
        const title = d.bars.fikih && d.bars.court ? `${R(d.bars.title)} · ${R(g.columns[c].label)}` : R(d.bars.title);
        return (
          <ToggleFigure
            key={`bar-${c}`}
            title={title}
            caption={bar.caption.map((m) => R(m)).join(" ")}
            graphic={<BarGraphic bar={bar} />}
            table={<BarTable bar={bar} />}
          />
        );
      })}

      <ToggleFigure
        title={R(d.tree.title)}
        caption={R(d.tree.aria)}
        graphic={
          <div>
            <div className="wr-tree overflow-x-auto">
              <TreeItems items={treeItems} lead={lead} otherLabel={otherLabel} />
            </div>
            {tree.outside.length > 0 ? (
              <div className="mt-4 rounded-xl border-[1.5px] border-dashed border-border-ui p-3">
                <p className="font-semibold text-ink">{R(msg("laporan.pohon.kotak_luar"))}</p>
                <div className="wr-tree mt-1">
                  <TreeItems items={tree.outside} lead={lead} otherLabel={otherLabel} />
                </div>
              </div>
            ) : null}
            <p className="mt-3 text-sm text-ink-soft">{t("pohon_keterangan")}</p>
          </div>
        }
        table={<TreeTable items={[...treeItems, ...tree.outside]} lead={lead} leadLabel={leadLabel} otherLabel={otherLabel} showOther={showOtherInTree} />}
      />
      {d.tree.notAsked.length > 0 ? (
        <ul className="mt-3 space-y-1 text-base text-ink-muted">
          {d.tree.notAsked.map((m, i) => (
            <li key={i}>{R(m)}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
