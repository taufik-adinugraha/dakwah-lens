"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { msg, type KepalaView } from "@/lib/waris/report";

import { AiChip } from "./AiChip";
import { RuleNote } from "./bits";
import { useReportText } from "./text";

/**
 * Section 0, Kepala (plan §6 row 0; D16 amended): "Rekomendasi Pembagian Waris" (or "Simulasi …"),
 * "berdasarkan jawaban Anda", the mandatory label, the chip, the date, the answer code, which
 * column leads, the legal route (Penetapan Ahli Waris) and musyawarah (KHI 183).
 */
export function Kepala({ k }: { k: KepalaView }) {
  const { R } = useReportText();
  const t = useTranslations("Report.ui");
  return (
    <header className="wr-keep">
      <AiChip label={R(k.chip)} />
      <h1 className="mt-3 text-balance font-display text-3xl font-medium tracking-[-0.015em] text-ink sm:text-5xl">
        {R(k.title)}
      </h1>
      <p className="mt-2 text-lg text-ink-muted">{R(k.subtitle)}</p>

      {/* Mandatory label (AGENTS.md; plan D16): visible, never collapsed, printed. */}
      <p className="mt-4 flex items-start gap-2 rounded-xl border-[1.5px] border-notice bg-notice-bg px-4 py-3 text-base font-medium text-ink">
        <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-notice" aria-hidden />
        <span>{R(k.label)}</span>
      </p>
      {k.simulasiNote ? (
        <p className="mt-3 rounded-xl border-[1.5px] border-dashed border-border-ui bg-paper-deep px-4 py-3 text-base text-ink">
          <span className="font-semibold">{t("simulasi_tag")}</span> {R(k.simulasiNote)}
        </p>
      ) : null}

      <dl className="mt-5 grid gap-x-6 gap-y-2 text-base sm:grid-cols-[auto_1fr]">
        {k.date ? (
          <>
            <dt className="font-semibold text-ink-muted">{t("tanggal")}</dt>
            <dd className="text-ink">{R(msg("laporan.kepala.tanggal", { tanggal: k.date.text }))}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-ink-muted">{t("kode")}</dt>
        <dd className="text-ink">
          {R(k.answerCodeLine)}
          <span className="block text-sm text-ink-soft">{t("kode_help")}</span>
        </dd>
        <dt className="font-semibold text-ink-muted">{t("metode")}</dt>
        <dd className="text-ink">
          {R(k.leadColumnLine)}
          {k.methodLabel ? <span className="block text-sm text-ink-soft">{R(k.methodLabel)}</span> : null}
        </dd>
      </dl>

      <div className="mt-5 space-y-2 text-base text-ink">
        <p className="text-pretty">{R(k.route)}</p>
        <p className="text-pretty">{R(k.musyawarah)}</p>
        <details className="rounded-xl border border-hairline bg-white px-4">
          <summary className="disclosure-row text-ink">
            {t("dasar_musyawarah")}
            <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
          </summary>
          <div className="pb-4">
            <RuleNote rule={k.musyawarahRule} />
          </div>
        </details>
      </div>
    </header>
  );
}
