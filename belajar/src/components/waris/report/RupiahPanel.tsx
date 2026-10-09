"use client";

import { useId, useState } from "react";
import { Calculator, ChevronDown, Eraser } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Amounts } from "@/lib/waris/questionnaire";
import { numberWords } from "@/lib/waris/report";

import type { RupiahFields } from "./compute";

/**
 * "Isi nilai harta" (plan D5, §5.7 "Rupiah panel"; ux.md §4.3 R1–R6): optional amounts in whole
 * rupiah. Digits only, dot thousands separators as you type, a "× 1 juta" helper and an echo in
 * words. The engine divides with largest-remainder rounding on the exact fractions (engine.md §14),
 * so the rupiah always add up to the estate. Amounts stay in this page's memory: never stored, never
 * sent, and in a share link or text summary only when "Sertakan nilai rupiah" is ticked (plan D9).
 */

type FieldKey = "hartaBersama" | "hartaBawaan" | "biayaSakit" | "biayaJenazah" | "utang" | "wasiatLain" | "wasiatWaris";

const ORDER: readonly FieldKey[] = ["hartaBersama", "hartaBawaan", "biayaSakit", "biayaJenazah", "utang", "wasiatLain", "wasiatWaris"];

/** RuleNote shown under each field (rules.json, keyed by engine rule id). */
const FIELD_RULE: Readonly<Partial<Record<FieldKey, string>>> = {
  hartaBersama: "estate.harta_bersama",
  biayaJenazah: "estate.biaya",
  utang: "estate.utang",
  wasiatLain: "estate.wasiat",
  wasiatWaris: "estate.wasiat_ahli_waris_tanpa_persetujuan",
};

const MAX_DIGITS = 16;

function digitsOf(v: bigint | undefined): string {
  return v === undefined ? "" : v.toString();
}

/** "1200000" → "1.200.000". */
function dots(d: string): string {
  const out: string[] = [];
  for (let end = d.length; end > 0; end -= 3) out.unshift(d.slice(Math.max(0, end - 3), end));
  return out.join(".");
}

function clean(raw: string): string {
  const d = raw.replace(/[^0-9]/g, "").replace(/^0+(?=[0-9])/, "");
  return d.slice(0, MAX_DIGITS);
}

export interface RupiahPanelProps {
  initial: Amounts | undefined;
  fields: RupiahFields;
  /** messageVars(): {pewaris}, {pasangan}, … for the field labels. */
  vars: Readonly<Record<string, string>>;
  /** rule_id → the RuleNote's title, from rules.json. */
  notes: Readonly<Record<string, string>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (amounts: Amounts | undefined) => void;
  /** The current report shows rupiah. */
  applied: boolean;
}

export function RupiahPanel({ initial, fields, vars, notes, open, onOpenChange, onApply, applied }: RupiahPanelProps) {
  const t = useTranslations("Report.ui");
  const base = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [values, setValues] = useState<Record<FieldKey, string>>(() => ({
    hartaBersama: digitsOf(initial?.hartaBersama),
    hartaBawaan: digitsOf(initial?.hartaBawaan),
    biayaSakit: digitsOf(initial?.biayaSakit),
    biayaJenazah: digitsOf(initial?.biayaJenazah),
    utang: digitsOf(initial?.utang),
    wasiatLain: digitsOf(initial?.wasiatLain),
    wasiatWaris: digitsOf(initial?.wasiatWaris),
  }));
  const [semuaMilik, setSemuaMilik] = useState<boolean>(initial?.semuaMilikAlmarhum === true);
  const [problem, setProblem] = useState<string | null>(null);

  const shown = ORDER.filter((k) => {
    if (k === "hartaBersama") return fields.hartaBersama;
    if (k === "wasiatLain") return fields.wasiatLain;
    if (k === "wasiatWaris") return fields.wasiatWaris;
    return true;
  });

  const label = (k: FieldKey): string => {
    switch (k) {
      case "hartaBersama":
        return t("rp_harta_bersama", { pasangan: vars.pasangan ?? "" });
      case "hartaBawaan":
        return t("rp_harta_bawaan", { pewaris: vars.pewaris ?? "" });
      case "biayaSakit":
        return t("rp_biaya_sakit");
      case "biayaJenazah":
        return t("rp_biaya_jenazah");
      case "utang":
        return t("rp_utang", { pewaris: vars.pewaris ?? "" });
      case "wasiatLain":
        return t("rp_wasiat_lain");
      case "wasiatWaris":
        return t("rp_wasiat_waris");
    }
  };

  const set = (k: FieldKey, d: string) => setValues((v) => ({ ...v, [k]: d }));

  const apply = () => {
    const out: { -readonly [K in keyof Amounts]: Amounts[K] } = {};
    for (const k of shown) {
      const d = values[k];
      if (d) out[k] = BigInt(d);
    }
    if (fields.hartaBersama && semuaMilik) out.semuaMilikAlmarhum = true;
    if (out.hartaBawaan === undefined && out.hartaBersama === undefined) {
      setProblem(t("rp_perlu_dasar", { pewaris: vars.pewaris ?? "" }));
      return;
    }
    setProblem(null);
    onApply(out);
  };

  const reset = () => {
    setValues({ hartaBersama: "", hartaBawaan: "", biayaSakit: "", biayaJenazah: "", utang: "", wasiatLain: "", wasiatWaris: "" });
    setSemuaMilik(false);
    setProblem(null);
    onApply(undefined);
  };

  return (
    <section id="rupiah" aria-labelledby={`${base}-judul`} className="wr-section mt-8 scroll-mt-24" data-print="hide">
      <details open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)} className="rounded-2xl border-[1.5px] border-border-ui bg-white px-4 sm:px-6">
        <summary className="disclosure-row text-ink">
          <span id={`${base}-judul`} className="flex items-center gap-2 text-lg">
            <Calculator className="h-5 w-5 shrink-0 text-forest" aria-hidden />
            {t("rp_judul")}
          </span>
          <ChevronDown className="chev h-5 w-5 shrink-0" aria-hidden />
        </summary>
        <div className="pb-6">
          <p className="text-pretty text-base text-ink-muted">{t("rp_intro")}</p>
          <p className="mt-2 text-pretty text-sm text-ink-soft">{t("rp_contoh")}</p>
          <div className="mt-4 space-y-6">
            {shown.map((k) => {
              const id = `${base}-${k}`;
              const d = values[k];
              const rule = FIELD_RULE[k];
              const ruleTitle = rule ? notes[rule] : undefined;
              let words: string | null = null;
              if (d) {
                try {
                  words = t("rp_kata", { kata: numberWords(BigInt(d)) });
                } catch {
                  words = null;
                }
              }
              return (
                <div key={k}>
                  <label htmlFor={id} className="block text-base font-semibold text-ink">
                    {label(k)}
                  </label>
                  {ruleTitle ? <p className="text-sm text-ink-soft">{ruleTitle}</p> : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {/* Shrinks with the screen: a fixed width overflowed a phone at the largest text size. */}
                    <span className="flex min-h-12 w-full max-w-[18rem] items-center rounded-xl border-[1.5px] border-border-ui bg-white px-3 focus-within:border-forest sm:w-auto sm:max-w-none">
                      <span className="text-ink-muted" aria-hidden="true">
                        Rp
                      </span>
                      <input
                        id={id}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        className="ml-2 w-full min-w-0 flex-1 bg-transparent py-2 text-lg text-ink sm:w-56 sm:flex-none"
                        value={d ? dots(d) : ""}
                        onChange={(e) => set(k, clean(e.target.value))}
                        aria-describedby={`${id}-kata`}
                      />
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!d || d.length + 6 > MAX_DIGITS}
                      onClick={() => set(k, clean(`${d}000000`))}
                      aria-label={t("rp_juta_aria", { field: label(k) })}
                    >
                      {t("rp_juta")}
                    </button>
                  </div>
                  <p id={`${id}-kata`} className="mt-1 min-h-6 text-base text-ink-muted" aria-live="polite">
                    {d ? `Rp ${dots(d)}${words ? ` (${words})` : ""}` : ""}
                  </p>
                  {k === "hartaBersama" ? (
                    <label className="mt-2 flex min-h-12 cursor-pointer items-center gap-3 text-base text-ink">
                      <input type="checkbox" className="wr-check" checked={semuaMilik} onChange={(e) => setSemuaMilik(e.target.checked)} />
                      {t("rp_semua_milik", { pewaris: vars.pewaris ?? "" })}
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-pretty text-sm text-ink-soft">{t("rp_pensiun")}</p>
          {problem ? (
            <p role="alert" className="mt-4 rounded-xl border-[1.5px] border-notice bg-notice-bg px-4 py-3 text-base font-medium text-ink">
              {problem}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={apply}>
              <Calculator className="h-5 w-5" aria-hidden />
              {t("rp_hitung")}
            </button>
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={reset}>
              <Eraser className="h-5 w-5" aria-hidden />
              {t("rp_hapus")}
            </button>
          </div>
          {applied ? (
            <p className="mt-3 text-base text-ink" aria-live="polite">
              {t("rp_terapan")}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
