"use client";

import { useTransition, useState } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { Spinner } from "@/components/Spinner";
import clsx from "clsx";

import { saveProfileAction, skipOnboardingAction } from "./actions";

// Loose translator signature — keeps the existing call sites
// (`t(key)`, `t(key, { vars })`) working without per-call key narrowing.
// next-intl's `useTranslations` returns a stricter type, but we route it
// through this alias so the rest of the file doesn't need to change.
type T = (key: string, vars?: Record<string, string | number>) => string;

type ChoiceOption = {
  /** Stable enum value persisted to DB. `"other"` is reserved for free-text. */
  value: string;
  /** Translation key tail. Resolved against the Onboarding namespace. */
  labelKey: string;
};

type SingleStep = {
  kind: "single";
  field: string;
  titleKey: string;
  hintKey: string;
  options: ChoiceOption[];
  /** Whether this step exposes a free-text `Other` input when selected. */
  allowOther?: boolean;
};

type MultiStep = {
  kind: "multi";
  field: string;
  titleKey: string;
  hintKey: string;
  options: ChoiceOption[];
  /** Min/max selections — 0/Infinity means no constraint. */
  min?: number;
  max?: number;
  /** Whether this step exposes a free-text `Other` input. */
  allowOther?: boolean;
};

type Step = SingleStep | MultiStep;

const STEPS: Step[] = [
  {
    kind: "single",
    field: "honorific",
    titleKey: "step_honorific_title",
    hintKey: "step_honorific_hint",
    allowOther: true,
    options: [
      { value: "ust", labelKey: "honorific_ust" },
      { value: "ustadzah", labelKey: "honorific_ustadzah" },
      { value: "kh", labelKey: "honorific_kh" },
      { value: "hj", labelKey: "honorific_hj" },
      { value: "habib", labelKey: "honorific_habib" },
      { value: "buya", labelKey: "honorific_buya" },
      { value: "prof", labelKey: "honorific_prof" },
      { value: "dr", labelKey: "honorific_dr" },
      { value: "drs", labelKey: "honorific_drs" },
      { value: "bapak", labelKey: "honorific_bapak" },
      { value: "ibu", labelKey: "honorific_ibu" },
      { value: "none", labelKey: "honorific_none" },
    ],
  },
  {
    kind: "single",
    field: "age_range",
    titleKey: "step_age_title",
    hintKey: "step_age_hint",
    allowOther: true,
    options: [
      { value: "18-24", labelKey: "age_18_24" },
      { value: "25-34", labelKey: "age_25_34" },
      { value: "35-49", labelKey: "age_35_49" },
      { value: "50plus", labelKey: "age_50_plus" },
    ],
  },
  {
    kind: "single",
    field: "location",
    titleKey: "step_location_title",
    hintKey: "step_location_hint",
    allowOther: true,
    options: [
      { value: "jabodetabek", labelKey: "loc_jabodetabek" },
      { value: "jawa_barat", labelKey: "loc_jawa_barat" },
      { value: "jawa_tengah_diy", labelKey: "loc_jawa_tengah_diy" },
      { value: "jawa_timur", labelKey: "loc_jawa_timur" },
      { value: "sumatera", labelKey: "loc_sumatera" },
      { value: "kalimantan", labelKey: "loc_kalimantan" },
      { value: "sulawesi", labelKey: "loc_sulawesi" },
      { value: "indonesia_timur", labelKey: "loc_indonesia_timur" },
      { value: "overseas", labelKey: "loc_overseas" },
    ],
  },
  {
    kind: "single",
    field: "profession",
    titleKey: "step_profession_title",
    hintKey: "step_profession_hint",
    allowOther: true,
    options: [
      { value: "ustadz_fulltime", labelKey: "prof_ustadz_fulltime" },
      { value: "ustadz_parttime", labelKey: "prof_ustadz_parttime" },
      { value: "content_creator", labelKey: "prof_content_creator" },
      { value: "student_of_knowledge", labelKey: "prof_student" },
      { value: "academic", labelKey: "prof_academic" },
      { value: "community_activist", labelKey: "prof_activist" },
    ],
  },
  {
    kind: "multi",
    field: "audience",
    titleKey: "step_audience_title",
    hintKey: "step_audience_hint",
    allowOther: true,
    max: 4,
    options: [
      { value: "urban_youth", labelKey: "aud_urban_youth" },
      { value: "young_families", labelKey: "aud_young_families" },
      { value: "professionals", labelKey: "aud_professionals" },
      { value: "santri_students", labelKey: "aud_santri_students" },
      { value: "elders", labelKey: "aud_elders" },
      { value: "online_followers", labelKey: "aud_online_followers" },
      { value: "local_mosque", labelKey: "aud_local_mosque" },
    ],
  },
  {
    kind: "multi",
    field: "focus",
    titleKey: "step_focus_title",
    hintKey: "step_focus_hint",
    max: 5,
    options: [
      { value: "aqidah", labelKey: "dawah_category_aqidah" },
      { value: "akhlaq", labelKey: "dawah_category_akhlaq" },
      { value: "muamalah", labelKey: "dawah_category_muamalah" },
      { value: "social_justice", labelKey: "dawah_category_social_justice" },
      { value: "family", labelKey: "dawah_category_family" },
      { value: "youth", labelKey: "dawah_category_youth" },
      { value: "education", labelKey: "dawah_category_education" },
      { value: "economic_ethics", labelKey: "dawah_category_economic_ethics" },
      { value: "health", labelKey: "dawah_category_health" },
    ],
  },
  {
    kind: "single",
    field: "output_lang",
    titleKey: "step_lang_title",
    hintKey: "step_lang_hint",
    options: [
      { value: "id", labelKey: "lang_id" },
      { value: "en", labelKey: "lang_en" },
      { value: "both", labelKey: "lang_both" },
      { value: "any", labelKey: "lang_any" },
    ],
  },
];

type Answers = {
  honorific?: string;
  honorific_other?: string;
  age_range?: string;
  age_range_other?: string;
  location?: string;
  location_other?: string;
  profession?: string;
  profession_other?: string;
  audience?: string[];
  audience_other?: string;
  focus?: string[];
  output_lang?: string;
};

export function OnboardingWizard() {
  // next-intl's strict generic types don't compose well with our generic
  // key strings (titleKey/hintKey are looked up at runtime). Cast through
  // the loose T alias so the call sites stay readable.
  const t = useTranslations("Onboarding") as unknown as T;
  const tInsights = useTranslations("Insights") as unknown as T;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [pending, startTransition] = useTransition();

  const current = STEPS[step];
  const total = STEPS.length;
  const progressPct = ((step + 1) / total) * 100;

  // Resolve "dawah_category_*" keys against the Insights namespace; other
  // labels live in Onboarding. Keeps Insights as the canonical source for
  // category copy across the app.
  const label = (key: string) =>
    key.startsWith("dawah_category_") ? tInsights(key) : t(key);

  function setSingle(field: string, value: string) {
    setAnswers((a) => ({ ...a, [field]: value }));
  }

  function setSingleOther(field: string, value: string) {
    setAnswers((a) => ({ ...a, [`${field}_other`]: value }));
  }

  function toggleMulti(field: string, value: string, max: number | undefined) {
    setAnswers((a) => {
      const list = ((a as Record<string, unknown>)[field] as string[]) ?? [];
      if (list.includes(value)) {
        return { ...a, [field]: list.filter((x) => x !== value) };
      }
      if (max && list.length >= max) return a;
      return { ...a, [field]: [...list, value] };
    });
  }

  const canAdvance = (() => {
    if (current.kind === "single") {
      const v = (answers as Record<string, unknown>)[current.field] as
        | string
        | undefined;
      if (!v) return false;
      if (v === "other") {
        const other = (answers as Record<string, unknown>)[
          `${current.field}_other`
        ] as string | undefined;
        return !!other && other.trim().length > 0;
      }
      return true;
    }
    const list = ((answers as Record<string, unknown>)[current.field] as
      | string[]
      | undefined) ?? [];
    return list.length >= (current.min ?? 1);
  })();

  function next() {
    if (step < total - 1) setStep(step + 1);
  }

  function back() {
    if (step > 0) setStep(step - 1);
  }

  function submit() {
    const fd = new FormData();
    if (answers.honorific) fd.set("honorific", answers.honorific);
    if (answers.honorific_other)
      fd.set("honorific_other", answers.honorific_other);
    if (answers.age_range) fd.set("age_range", answers.age_range);
    if (answers.age_range_other)
      fd.set("age_range_other", answers.age_range_other);
    if (answers.location) fd.set("location", answers.location);
    if (answers.location_other) fd.set("location_other", answers.location_other);
    if (answers.profession) fd.set("profession", answers.profession);
    if (answers.profession_other)
      fd.set("profession_other", answers.profession_other);
    for (const v of answers.audience ?? []) fd.append("audience", v);
    if (answers.audience_other) fd.set("audience_other", answers.audience_other);
    for (const v of answers.focus ?? []) fd.append("focus", v);
    if (answers.output_lang) fd.set("output_lang", answers.output_lang);

    startTransition(async () => {
      await saveProfileAction(fd);
    });
  }

  function skipAll() {
    startTransition(async () => {
      await skipOnboardingAction();
    });
  }

  const isLast = step === total - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      {/* Progress + skip */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t("progress_label", { current: step + 1, total })}
        </span>
        <button
          type="button"
          onClick={skipAll}
          disabled={pending}
          className="text-xs font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50"
        >
          {t("skip_all")}
        </button>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Step body */}
      <div className="mt-8">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t(current.titleKey)}
        </h1>
        {t(current.hintKey) && (
          <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
            {t(current.hintKey)}
          </p>
        )}

        <div
          className={clsx(
            "mt-6",
            current.kind === "multi"
              ? "grid gap-2 sm:grid-cols-2"
              : "grid gap-2 sm:grid-cols-2",
          )}
        >
          {current.options.map((opt) => {
            if (current.kind === "single") {
              const selected =
                (answers as Record<string, unknown>)[current.field] ===
                opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSingle(current.field, opt.value)}
                  className={pillClass(selected)}
                >
                  {label(opt.labelKey)}
                </button>
              );
            }
            const list = ((answers as Record<string, unknown>)[
              current.field
            ] as string[]) ?? [];
            const selected = list.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  toggleMulti(current.field, opt.value, current.max)
                }
                className={pillClass(selected)}
              >
                {label(opt.labelKey)}
              </button>
            );
          })}

          {current.kind === "single" && current.allowOther && (
            <button
              type="button"
              onClick={() => setSingle(current.field, "other")}
              className={pillClass(
                (answers as Record<string, unknown>)[current.field] === "other",
              )}
            >
              {t("other_option")}
            </button>
          )}
        </div>

        {/* Free-text input when the user picked "Other" (single-choice) */}
        {current.kind === "single" &&
          current.allowOther &&
          (answers as Record<string, unknown>)[current.field] === "other" && (
            <input
              type="text"
              autoFocus
              placeholder={t("other_placeholder")}
              maxLength={120}
              value={
                ((answers as Record<string, unknown>)[
                  `${current.field}_other`
                ] as string | undefined) ?? ""
              }
              onChange={(e) => setSingleOther(current.field, e.target.value)}
              className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          )}

        {/* Multi-select also gets an optional free-text bucket */}
        {current.kind === "multi" && current.allowOther && (
          <input
            type="text"
            placeholder={t("audience_other_placeholder")}
            maxLength={200}
            value={
              ((answers as Record<string, unknown>)[
                `${current.field}_other`
              ] as string | undefined) ?? ""
            }
            onChange={(e) => setSingleOther(current.field, e.target.value)}
            className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        )}

        {current.kind === "multi" && current.max && (
          <p className="mt-2 text-xs text-slate-500">
            {t("multi_pick_hint", { max: current.max })}
          </p>
        )}
      </div>

      {/* Footer controls */}
      <div className="mt-10 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          disabled={step === 0 || pending}
          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("back")}
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={submit}
            disabled={!canAdvance || pending}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? (
              <Spinner size="md" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {t("finish")}
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            disabled={!canAdvance}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {t("next")}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function pillClass(selected: boolean): string {
  return clsx(
    "inline-flex items-center justify-center rounded-xl border px-4 py-3 text-sm font-medium transition",
    selected
      ? "border-brand-500 bg-brand-50 text-brand-900 shadow-sm ring-1 ring-brand-200"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  );
}
