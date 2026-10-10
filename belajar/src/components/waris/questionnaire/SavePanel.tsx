"use client";

import { RotateCcw, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import type { Answers } from "@/lib/waris/questionnaire";

import { readSaved, removeFromDevice, saveOnDevice, serialize, serverSaved, subscribeSaved } from "./storage";

type Notice = "gagal" | "terhapus" | null;

/**
 * "Jawaban Anda" (plan §9.4): the working copy lives in this tab only; localStorage is written
 * only when the learner taps "Simpan di perangkat ini", with a visible "Hapus jawaban dari
 * perangkat ini". "Mulai dari awal" asks first, inside the page (the viewer has no confirm()):
 * opening the question moves focus to its safe button ("Batal"), and "Batal" returns it to
 * "Mulai dari awal", so keyboard and screen-reader users keep their place.
 * The saved copy is the same QState-without-cursor as the tab's draft: it can never hold k6.
 */
export function SavePanel({ answers, onUlang }: { answers: Answers; onUlang: () => void }) {
  const t = useTranslations("Q");
  const saved = useSyncExternalStore(subscribeSaved, readSaved, serverSaved);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirming, setConfirming] = useState(false);
  const ulangRef = useRef<HTMLButtonElement>(null);
  const batalRef = useRef<HTMLButtonElement>(null);
  const openConfirm = () => {
    flushSync(() => setConfirming(true));
    batalRef.current?.focus();
  };
  const closeConfirm = () => {
    flushSync(() => setConfirming(false));
    ulangRef.current?.focus();
  };
  const hasAnswers = Object.keys(answers).length > 0;
  const same = saved !== null && saved === serialize(answers);

  return (
    <section aria-labelledby="waris-save-heading" className="rounded-2xl border border-hairline bg-white p-4 sm:p-5 print:hidden">
      <h2 id="waris-save-heading" className="text-lg font-semibold text-ink">
        {t("ui.jawaban_judul")}
      </h2>
      <p className="mt-1 max-w-prose text-base text-ink-muted">{t("ui.jawaban_info")}</p>

      <p role="status" className="mt-2 max-w-prose text-base font-semibold text-ink">
        {notice === "gagal"
          ? t("ui.simpan_gagal")
          : saved !== null
            ? same
              ? t("ui.tersimpan")
              : t("ui.tersimpan_lain")
            : notice === "terhapus"
              ? t("ui.terhapus")
              : ""}
      </p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {hasAnswers && !same ? (
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            onClick={() => setNotice(saveOnDevice(answers) ? null : "gagal")}
          >
            <Save className="h-5 w-5" aria-hidden />
            {saved !== null ? t("ui.simpan_perbarui") : t("ui.simpan")}
          </button>
        ) : null}
        {saved !== null ? (
          <button
            type="button"
            className="btn-secondary w-full sm:w-auto"
            onClick={() => {
              removeFromDevice();
              setNotice("terhapus");
            }}
          >
            <Trash2 className="h-5 w-5" aria-hidden />
            {t("ui.hapus")}
          </button>
        ) : null}
        {hasAnswers && !confirming ? (
          <button ref={ulangRef} type="button" className="btn-secondary w-full sm:w-auto" onClick={openConfirm}>
            <RotateCcw className="h-5 w-5" aria-hidden />
            {t("ui.ulang")}
          </button>
        ) : null}
      </div>
      {hasAnswers && !same ? <p className="mt-2 max-w-prose text-base text-ink-soft">{t("ui.simpan_peringatan")}</p> : null}

      {confirming ? (
        <div role="alertdialog" aria-labelledby="waris-ulang-q" className="mt-4 rounded-xl border-[1.5px] border-dashed border-notice bg-notice-bg p-4">
          <p id="waris-ulang-q" className="text-base font-semibold text-ink">
            {t("ui.ulang_tanya")}
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={() => {
                setConfirming(false);
                setNotice(null);
                onUlang();
              }}
            >
              {t("ui.ulang_ya")}
            </button>
            <button ref={batalRef} type="button" className="btn-secondary w-full sm:w-auto" onClick={closeConfirm}>
              {t("ui.batal")}
            </button>
          </div>
        </div>
      ) : null}

    </section>
  );
}
