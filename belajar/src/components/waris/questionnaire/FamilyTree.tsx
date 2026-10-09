"use client";

import { EyeOff, List, Network } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { QKey } from "@/lib/waris/questionnaire";

import type { TreeFlag, TreeNode, TreeRow } from "./format";
import { growIn } from "./motion";

/**
 * The live family tree (ux.md §4.7): one band per generation, the pewaris in the middle band, a
 * node per relative entered (counts above three collapse into "×N"), drawn in HTML so its text
 * follows the learner's text size, with inline-SVG connectors between the bands. No shares are
 * shown before the report.
 *
 * State is never colour alone (senior-ux.md §3.2): a relative of another religion gets a hatched
 * pattern AND the words "berbeda agama"; a child who died first a dashed border AND "wafat lebih
 * dulu"; an adopted or step child a dotted border AND "bukan ahli waris"; the newest node a 3px
 * outline AND the word "baru". Groups the questionnaire skipped are not drawn: a muted line under
 * the tree says why ("Saudara tidak ditanyakan karena ada anak laki-laki"), which teaches hajb in
 * passing. Under reduced motion new nodes simply appear (motion.ts).
 */
export function FamilyTree({
  rows,
  skipped,
  summary,
  label,
  onEdit,
  growKey,
}: {
  rows: TreeRow[];
  /** "Saudara tidak ditanyakan karena …" lines, already worded. */
  skipped: string[];
  /** One sentence naming everyone entered, for screen readers and the list view. */
  summary: string;
  /** Node label for a role (already capitalised). */
  label: (role: string) => string;
  onEdit: ((key: QKey) => void) | null;
  /** Changes whenever the answers change, so new nodes animate once. */
  growKey: string;
}) {
  const t = useTranslations("Q");
  const [asList, setAsList] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.querySelectorAll('[data-baru="true"]').forEach((n) => growIn(n));
  }, [growKey]);

  const empty = rows.length === 0;
  return (
    <figure className="m-0">
      <figcaption className="sr-only">{summary}</figcaption>
      {empty ? (
        <p className="text-base text-ink-muted">{t("ui.keluarga_kosong")}</p>
      ) : (
        <>
          <button type="button" className="btn-secondary w-full" onClick={() => setAsList((x) => !x)}>
            {asList ? <Network className="h-5 w-5" aria-hidden /> : <List className="h-5 w-5" aria-hidden />}
            {asList ? t("ui.keluarga_lihat_bagan") : t("ui.keluarga_lihat_daftar")}
          </button>
          <div ref={box} className="mt-4">
            {asList ? <TreeList rows={rows} label={label} /> : <TreeBands rows={rows} label={label} onEdit={onEdit} />}
          </div>
          <p className="mt-3 text-sm text-ink-soft">{t("ui.keluarga_catatan")}</p>
        </>
      )}
      {skipped.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="text-base font-semibold text-ink-muted">{t("ui.keluarga_tidak_ditanya")}</p>
          <ul className="mt-1 space-y-1">
            {skipped.map((s) => (
              <li key={s} className="flex gap-2 text-base text-ink-muted">
                <EyeOff className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </figure>
  );
}

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--color-paper-deep) 0 6px, #ffffff 6px 12px)",
};

function flagKey(f: TreeFlag): string {
  return f === "beda_agama" ? "ui.keluarga_beda_agama" : f === "wafat_dulu" ? "ui.keluarga_wafat_dulu" : "ui.keluarga_bukan_ahli";
}

function nodeClass(n: TreeNode): string {
  const border = n.role === "pewaris" ? "border-[3px] border-double border-ink" : n.flags.includes("wafat_dulu") ? "border-2 border-dashed border-border-ui" : n.flags.includes("bukan_ahli") ? "border-2 border-dotted border-border-ui" : "border-[1.5px] border-border-ui";
  const outline = n.baru ? "outline outline-[3px] outline-offset-2 outline-forest" : "";
  return `flex min-h-12 min-w-[7.5rem] max-w-[12rem] flex-col items-center justify-center rounded-xl bg-white px-3 py-2 text-center text-base leading-snug text-ink ${border} ${outline}`;
}

function NodeBody({ n, label }: { n: TreeNode; label: (role: string) => string }) {
  const t = useTranslations("Q");
  return (
    <>
      <span className="font-semibold">
        {label(n.role)}
        {n.count > 1 ? <span className="whitespace-nowrap"> {t("ui.keluarga_kali", { n: n.count })}</span> : null}
      </span>
      {n.role === "pewaris" ? <span className="text-sm text-ink-muted">{t("ui.keluarga_tanda_pewaris")}</span> : null}
      {n.flags.map((f) => (
        <span key={f} className="text-sm text-ink-muted">
          {t(flagKey(f))}
        </span>
      ))}
      {n.baru ? <span className="mt-0.5 rounded-full bg-forest px-2 text-sm font-semibold text-paper">{t("ui.keluarga_baru")}</span> : null}
    </>
  );
}

const ROW_KEY: Record<TreeRow["id"], string> = {
  kakek_nenek: "ui.baris_kakek_nenek",
  orang_tua: "ui.baris_orang_tua",
  pewaris: "ui.baris_pewaris",
  anak: "ui.baris_anak",
  cucu: "ui.baris_cucu",
};

function TreeBands({ rows, label, onEdit }: { rows: TreeRow[]; label: (role: string) => string; onEdit: ((key: QKey) => void) | null }) {
  const t = useTranslations("Q");
  return (
    <ol className="space-y-0">
      {rows.map((row, i) => (
        <li key={row.id}>
          {i > 0 ? (
            <svg aria-hidden viewBox="0 0 24 24" className="mx-auto block h-6 w-6 text-border-ui" focusable="false">
              <line x1="12" y1="0" x2="12" y2="24" stroke="currentColor" strokeWidth="2" />
            </svg>
          ) : null}
          <div className={`rounded-2xl px-2 py-2 ${row.id === "pewaris" ? "bg-forest-tint" : "bg-paper-deep"}`}>
            <p className="px-1 text-sm font-semibold text-ink-muted">{t(ROW_KEY[row.id])}</p>
            <ul className="mt-1 flex flex-wrap justify-center gap-2">
              {row.nodes.map((n) => (
                <li key={n.id}>
                  {onEdit && n.edit ? (
                    <button
                      type="button"
                      data-baru={n.baru ? "true" : undefined}
                      className={`${nodeClass(n)} cursor-pointer hover:border-forest`}
                      style={n.flags.includes("beda_agama") ? HATCH : undefined}
                      onClick={() => (n.edit ? onEdit(n.edit) : undefined)}
                      aria-label={t("ui.keluarga_ubah", {
                        label: [n.count > 1 ? `${label(n.role)} ${t("ui.keluarga_kali", { n: n.count })}` : label(n.role), ...n.flags.map((f) => t(flagKey(f)))].join(", "),
                      })}
                    >
                      <NodeBody n={n} label={label} />
                    </button>
                  ) : (
                    <div data-baru={n.baru ? "true" : undefined} className={nodeClass(n)} style={n.flags.includes("beda_agama") ? HATCH : undefined}>
                      <NodeBody n={n} label={label} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TreeList({ rows, label }: { rows: TreeRow[]; label: (role: string) => string }) {
  const t = useTranslations("Q");
  return (
    <ul className="space-y-2">
      {rows.flatMap((row) =>
        row.nodes.map((n) => (
          <li
            key={n.id}
            data-baru={n.baru ? "true" : undefined}
            className="flex min-h-12 flex-wrap items-center gap-x-2 rounded-xl border border-hairline bg-white px-3 py-2 text-base text-ink"
          >
            <span className="font-semibold">{label(n.role)}</span>
            {n.count > 1 ? <span>{t("ui.keluarga_kali", { n: n.count })}</span> : null}
            {n.role === "pewaris" ? <span className="text-ink-muted">· {t("ui.keluarga_tanda_pewaris")}</span> : null}
            {n.flags.map((f) => (
              <span key={f} className="text-ink-muted">
                · {t(flagKey(f))}
              </span>
            ))}
            {n.baru ? <span className="rounded-full bg-forest px-2 text-sm font-semibold text-paper">{t("ui.keluarga_baru")}</span> : null}
          </li>
        )),
      )}
    </ul>
  );
}
