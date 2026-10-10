"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ClipboardCopy, Link2, Pencil, Printer, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { fragmentFor, shareToken, type Amounts, type Answers } from "@/lib/waris/questionnaire";
import { buildTextSummary, type ReportModel, type ReportMsgKey } from "@/lib/waris/report";
import { warisHref } from "@/lib/routes";

import { clearAnswers } from "./source";

/**
 * The report's controls (plan §6 "Print and PDF", D9). None of them prints (data-print="hide").
 *  - "Cetak / Simpan sebagai PDF" (56px, the one primary action) calls window.print(); the browser's
 *    "Save as PDF" covers the PDF, there is no server PDF engine.
 *  - "Salin tautan laporan": the answers in the URL fragment only (never a query string), rupiah
 *    only when "Sertakan nilai rupiah" is ticked, with a plain warning about who can read a link.
 *  - "Salin ringkasan teks": plain text for WhatsApp with the disclaimer line, the same rupiah rule.
 *  - "Hapus jawaban dari perangkat ini", confirmed on the page (no browser dialog). Opening the
 *    confirmation moves focus to its safe button ("Batal"); "Batal" returns focus to "Hapus", so
 *    keyboard and screen-reader users keep their place.
 * Nothing here makes a request: copying uses the clipboard API, and a failed copy shows the text
 * to select by hand.
 */

/** "Ubah jawaban": back to the questionnaire; a report opened from a link carries its answers along in the fragment. */
export function hitungHref(token: string | undefined): string {
  return token ? `${warisHref.hitung()}#${fragmentFor(token)}` : warisHref.hitung();
}

export function ReportActions({ printAllowed, token }: { printAllowed: boolean; token?: string }) {
  const t = useTranslations("Report.ui");
  return (
    <div className="mt-8 flex flex-wrap gap-3" data-print="hide">
      {printAllowed ? (
        <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => window.print()}>
          <Printer className="h-5 w-5" aria-hidden />
          {t("cetak")}
        </button>
      ) : null}
      <Link prefetch={false} href={hitungHref(token)} className="btn-secondary w-full sm:w-auto">
        <Pencil className="h-5 w-5" aria-hidden />
        {t("ubah_jawaban")}
      </Link>
    </div>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareActions({
  model,
  answers,
  amounts,
  lookup,
}: {
  model: ReportModel;
  answers: Answers;
  amounts: Amounts | undefined;
  lookup: (key: ReportMsgKey) => string;
}) {
  const t = useTranslations("Report.ui");
  const [withRupiah, setWithRupiah] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirmHapus, setConfirmHapus] = useState(false);
  const hapusRef = useRef<HTMLButtonElement>(null);
  const batalRef = useRef<HTMLButtonElement>(null);
  const openHapus = () => {
    flushSync(() => setConfirmHapus(true));
    batalRef.current?.focus();
  };
  const closeHapus = () => {
    flushSync(() => setConfirmHapus(false));
    hapusRef.current?.focus();
  };
  const rupiahAvailable = !!amounts && !!model.ringkasan?.rupiahShown;
  const includeRupiah = rupiahAvailable && withRupiah;

  const makeLink = (): string => {
    const token = shareToken({ v: 1, answers, at: null }, amounts, { sertakanRupiah: includeRupiah });
    return `${window.location.origin}${window.location.pathname}#${fragmentFor(token)}`;
  };

  const onLink = async () => {
    const url = makeLink();
    setLink(url);
    if (await copy(url)) {
      setManual(null);
      setStatus(t("tautan_disalin"));
    } else {
      setManual(url);
      setStatus(t("salin_manual"));
    }
  };

  const onText = async () => {
    // a link made earlier is rebuilt with the current tick, so the text never carries rupiah
    // through a link the user has since unticked
    const current = link ? makeLink() : null;
    const text = buildTextSummary(model, { includeRupiah, ...(current ? { link: current } : {}), lookup });
    if (!text) return;
    if (await copy(text)) {
      setManual(null);
      setStatus(t("teks_disalin"));
    } else {
      setManual(text);
      setStatus(t("salin_manual"));
    }
  };

  return (
    <section aria-labelledby="bagikan-judul" className="mt-12 rounded-2xl border border-hairline bg-white p-5 sm:p-6" data-print="hide">
      <h2 id="bagikan-judul" className="font-display text-2xl font-medium text-ink">
        {t("bagikan_judul")}
      </h2>
      {model.shareAllowed ? (
        <>
          <p className="mt-2 text-pretty text-base text-ink-muted">{t("bagikan_peringatan")}</p>
          {rupiahAvailable ? (
            <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3 text-base text-ink">
              <input type="checkbox" className="wr-check" checked={withRupiah} onChange={(e) => setWithRupiah(e.target.checked)} />
              {t("sertakan_rupiah")}
            </label>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onLink}>
              <Link2 className="h-5 w-5" aria-hidden />
              {t("salin_tautan")}
            </button>
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onText}>
              <ClipboardCopy className="h-5 w-5" aria-hidden />
              {t("salin_teks")}
            </button>
          </div>
          <p className="mt-3 min-h-7 text-base font-medium text-ink" role="status" aria-live="polite">
            {status ?? ""}
          </p>
          {manual ? (
            <textarea
              readOnly
              value={manual}
              rows={6}
              aria-label={t("salin_manual")}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-xl border-[1.5px] border-border-ui bg-white p-3 text-base text-ink"
            />
          ) : null}
        </>
      ) : null}

      <div className="mt-6 border-t border-hairline pt-5">
        <p className="text-pretty text-base text-ink-muted">{t("hapus_info")}</p>
        {confirmHapus ? (
          <div role="alertdialog" aria-labelledby="waris-hapus-q" className="mt-3 rounded-xl border-[1.5px] border-notice bg-notice-bg p-4">
            <p id="waris-hapus-q" className="font-medium text-ink">
              {t("hapus_yakin")}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => clearAnswers()}>
                <Trash2 className="h-5 w-5" aria-hidden />
                {t("hapus_ya")}
              </button>
              <button ref={batalRef} type="button" className="btn-secondary w-full sm:w-auto" onClick={closeHapus}>
                {t("hapus_batal")}
              </button>
            </div>
          </div>
        ) : (
          <button ref={hapusRef} type="button" className="btn-secondary mt-3 w-full sm:w-auto" onClick={openHapus}>
            <Trash2 className="h-5 w-5" aria-hidden />
            {t("hapus")}
          </button>
        )}
      </div>
    </section>
  );
}
