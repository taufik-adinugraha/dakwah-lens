"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import type { QKey, SectionId } from "@/lib/waris/questionnaire";

/** One answered question as the review screen and the printout show it (already worded). */
export interface AnswerRow {
  key: QKey;
  section: SectionId;
  question: string;
  answer: string;
}

function bySection(rows: readonly AnswerRow[]): { section: SectionId; rows: AnswerRow[] }[] {
  const out: { section: SectionId; rows: AnswerRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.section === r.section) last.rows.push(r);
    else out.push({ section: r.section, rows: [r] });
  }
  return out;
}

/** The review screen's list (plan §5.2 H "every answer with Ubah"). */
export function ReviewList({ rows, onUbah }: { rows: readonly AnswerRow[]; onUbah: (key: QKey) => void }) {
  const t = useTranslations("Q");
  return (
    <div className="space-y-6">
      {bySection(rows).map((g, gi) => (
        <section key={`${g.section}-${gi}`} aria-labelledby={`waris-rv-${gi}`}>
          <h3 id={`waris-rv-${gi}`} className="text-lg font-semibold text-ink">
            {t(`bagian.${g.section}`)}
          </h3>
          <ul className="mt-2 space-y-2">
            {g.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-hairline bg-white px-4 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="text-base text-ink-muted">{r.question}</p>
                  <p className="text-lg font-semibold text-ink">{r.answer}</p>
                </div>
                <button type="button" className="btn-secondary" onClick={() => onUbah(r.key)} aria-label={t("ui.ubah_label", { pertanyaan: r.question })}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  {t("umum.ubah")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * "Cetak ringkasan jawaban Anda" (plan §5.4 item 5): printed only, so someone can bring it to an
 * ustadz, an ahli faraid or the Pengadilan Agama. Answers only, never a number. Not rendered at
 * all on E-BUNUH (the parent passes no rows there).
 */
export function AnswerPrintout({ rows, code, printedOn }: { rows: readonly AnswerRow[]; code: string | null; printedOn: string | null }) {
  const t = useTranslations("Q");
  const te = useTranslations("Exit");
  return (
    <section className="hidden print:mt-8 print:block">
      <h3 className="text-lg font-semibold text-ink">{te("cetak_judul")}</h3>
      <p className="text-base text-ink">{t("halaman.label")}</p>
      <p className="text-base text-ink">{te("cetak_info")}</p>
      {printedOn ? <p className="text-base text-ink">{te("dicetak", { tanggal: printedOn })}</p> : null}
      {code ? <p className="text-base text-ink">{te("kode", { kode: code })}</p> : null}
      {bySection(rows).map((g, gi) => (
        <div key={`${g.section}-${gi}`} className="mt-4 break-inside-avoid">
          <p className="text-base font-semibold text-ink">{t(`bagian.${g.section}`)}</p>
          <dl className="mt-1">
            {g.rows.map((r) => (
              <div key={r.key} className="break-inside-avoid py-1">
                <dt className="text-base text-ink">{r.question}</dt>
                <dd className="ml-0 text-base font-semibold text-ink">{r.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
