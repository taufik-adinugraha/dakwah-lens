"use client";

import { ArrowLeft, Pencil, Printer, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { ExitHit, QKey, RoleGroup } from "@/lib/waris/questionnaire";
import { isRuleId, type RuleId } from "@/lib/waris/registry";

import { AnswerPrintout, type AnswerRow } from "./AnswerList";
import { RuleList } from "./RuleList";
import type { RulePack } from "./rulePack";

type Vars = Record<string, string>;

/** Where an exit's role list takes its labels ("Siapa yang hilang?" and its siblings). */
const ROLE_NODE: Partial<Record<ExitHit["id"], "A3c" | "A3d" | "A3e">> = {
  "E-MAFQUD": "A3c",
  "E-HAML": "A3d",
  "E-BERSAMAAN": "A3e",
};

/**
 * An exit page ("Konsultasikan", plan §5.4; ux.md §4.5): what the situation is, why the tool
 * stops, the rule with its dalil where we have one, next steps, then "Ubah jawaban", "Cetak
 * ringkasan jawaban Anda" and "Kembali ke pelajaran". A refusal shows no number at all (plan
 * M2.8). E-BUNUH has no print button and no answer printout, and nothing about the answer that
 * led here was stored (plan §9.4): the parent passes answers = null for it.
 */
export function ExitPage({
  exit,
  print,
  lanjutSimulasi,
  vars,
  pack,
  questionText,
  answers,
  code,
  printedOn,
  backHref,
  onUbah,
  onUbahKey,
  onSimulasi,
  onPrint,
}: {
  exit: ExitHit;
  print: boolean;
  lanjutSimulasi: boolean;
  vars: Vars;
  pack: RulePack;
  /** The question text of a node on the path (E-TIDAK-TAHU lists them). */
  questionText: (key: QKey) => string | null;
  /** The printable answer summary; null on E-BUNUH. */
  answers: AnswerRow[] | null;
  code: string | null;
  /** Set from the print button's click (never read from the clock during render). */
  printedOn: string | null;
  backHref: string;
  onUbah: () => void;
  onUbahKey: ((key: QKey) => void) | null;
  onSimulasi: () => void;
  onPrint: () => void;
}) {
  const t = useTranslations("Q");
  const te = useTranslations("Exit");
  const id = exit.id;
  const refusal = id !== "E-HIDUP";

  const ruleIds: RuleId[] = [...(pack.exitRules[id] ?? [])];
  for (const r of [...(exit.reasons?.fikih ?? []), ...(exit.reasons?.pengadilan ?? [])]) {
    const rid = `rujuk.${r}`;
    if (isRuleId(rid) && !ruleIds.includes(rid)) ruleIds.push(rid);
  }
  const bothColumns = (exit.reasons?.fikih.length ?? 0) > 0 && (exit.reasons?.pengadilan.length ?? 0) > 0;
  const roleNode = ROLE_NODE[id];
  const roles: RoleGroup[] = roleNode ? (exit.roles ?? []) : [];
  const unknownKeys = id === "E-TIDAK-TAHU" ? (exit.nodes ?? []) : [];

  return (
    <section aria-labelledby="waris-exit-heading" className="max-w-2xl">
      <h2 id="waris-exit-heading" data-screen-heading tabIndex={-1} className="text-balance font-display text-2xl font-medium leading-snug text-ink sm:text-3xl">
        {t(`exit.${id}.judul`, vars)}
      </h2>
      {refusal ? <p className="mt-2 text-base text-ink-muted">{te("tanpa_angka")}</p> : null}

      <div className="mt-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-ink">{te("situasi")}</h3>
          <p className="mt-1 max-w-prose text-base text-ink">{t(`exit.${id}.situasi`, vars)}</p>
          {bothColumns ? <p className="mt-2 max-w-prose text-base text-ink">{te("kolom_keduanya")}</p> : null}
        </div>

        {roles.length > 0 && roleNode ? (
          <div>
            <h3 className="text-lg font-semibold text-ink">{te("peran")}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-6 text-base text-ink">
              {roles.map((r) => (
                <li key={r}>{t(`${roleNode}.opsi.${r}`, vars)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {unknownKeys.length > 0 ? (
          <div>
            <h3 className="text-lg font-semibold text-ink">{te("perlu_dipastikan")}</h3>
            <ul className="mt-2 space-y-2">
              {unknownKeys.map((k) => {
                const q = questionText(k);
                if (!q) return null;
                return (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
                    <span className="min-w-0 flex-1 text-base text-ink">{q}</span>
                    {onUbahKey ? (
                      <button type="button" className="btn-secondary print:hidden" onClick={() => onUbahKey(k)} aria-label={te("ubah_label", { pertanyaan: q })}>
                        <Pencil className="h-4 w-4" aria-hidden />
                        {te("ubah")}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div>
          <h3 className="text-lg font-semibold text-ink">{te("alasan")}</h3>
          <p className="mt-1 max-w-prose text-base text-ink">{t(`exit.${id}.alasan`, vars)}</p>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-ink">{te("langkah")}</h3>
          <p className="mt-1 max-w-prose text-base text-ink">{t(`exit.${id}.langkah`, vars)}</p>
        </div>

        {id === "E-BUNUH" ? (
          <p className="flex max-w-prose gap-2 rounded-xl bg-forest-tint px-4 py-3 text-base text-ink">
            <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-forest" aria-hidden />
            <span>{te("bunuh_privasi")}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap print:hidden">
        {lanjutSimulasi ? (
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={onSimulasi}>
            {t("exit.E-HIDUP.lanjut")}
          </button>
        ) : null}
        <button type="button" className={`${lanjutSimulasi ? "btn-secondary" : "btn-primary"} w-full sm:w-auto`} onClick={onUbah}>
          <ArrowLeft className="h-5 w-5" aria-hidden />
          {t("umum.ubah_jawaban")}
        </button>
        {print && answers ? (
          <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onPrint}>
            <Printer className="h-5 w-5" aria-hidden />
            {t("umum.cetak_ringkasan")}
          </button>
        ) : null}
        <Link href={backHref} className="btn-secondary w-full sm:w-auto">
          {t("umum.kembali_pelajaran")}
        </Link>
      </div>

      {ruleIds.length > 0 ? (
        <div className="mt-10">
          <h3 className="text-lg font-semibold text-ink">{te("aturan")}</h3>
          <div className="mt-3">
            <RuleList ids={ruleIds} pack={pack} withDalil />
          </div>
        </div>
      ) : null}

      {print && answers ? <AnswerPrintout rows={answers} code={code} printedOn={printedOn} /> : null}
    </section>
  );
}
