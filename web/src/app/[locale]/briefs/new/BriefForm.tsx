"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  Minus,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";

import {
  estimateBriefCostAction,
  generateBriefAction,
  type EstimateResult,
} from "@/app/[locale]/briefs/actions";
import { formatIdr, formatUsd } from "@/lib/brief-cost";
import { Spinner } from "@/components/Spinner";

const SEGMENTS = [
  "urban_gen_z",
  "working_professionals",
  "parents_families",
  "ibu_pengajian",
  "rural_communities",
  "students",
] as const;
const TONES = [
  "scholarly",
  "casual",
  "motivational",
  "empathetic",
  "fiery",
  "gentle",
] as const;
const LOCALES = ["en", "id"] as const;
const FORMATS = ["kajian_umum", "khutbah_jumat"] as const;

const CONTEXT_PRESETS = [
  "preset_khutbah_jumat",
  "preset_counter_misconception",
  "preset_current_events",
  "preset_social_video",
  "preset_action_steps",
  "preset_for_youth",
] as const;

type Step = "form" | "estimate";

type EstimateOk = Extract<EstimateResult, { ok: true }>;

export function BriefForm({
  defaultLocale,
  defaultTopic = "",
}: {
  defaultLocale: "en" | "id";
  defaultTopic?: string;
}) {
  const t = useTranslations("Briefs");
  const [step, setStep] = useState<Step>("form");
  const [estimate, setEstimate] = useState<EstimateOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEstimating, startEstimateTransition] = useTransition();
  const [isGenerating, startGenerateTransition] = useTransition();
  const [topic, setTopic] = useState(defaultTopic);
  const [extraContext, setExtraContext] = useState("");
  const [pages, setPages] = useState(2);
  // All SelectGrid + checkbox state lifted to this parent so it
  // survives the form's `step === "estimate"` re-mount cycle. Earlier
  // bug (2026-05-29): SelectGrid held its own useState, so after the
  // user clicked Cancel on the estimate step the form re-mounted and
  // every grid silently reverted to its default value while
  // `snapshotRef` still held the original selection. User saw "Kajian
  // umum" in the UI but got a Khutbah Jumat brief back.
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>(
    SEGMENTS[0],
  );
  const [tone, setTone] = useState<(typeof TONES)[number]>(TONES[0]);
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("kajian_umum");
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>(defaultLocale);
  const [includeProfile, setIncludeProfile] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const topicRef = useRef<HTMLInputElement | null>(null);
  // Snapshot of the form FormData taken at the moment the user clicked
  // "Estimate cost". We replay it on the final "Generate" submit so the
  // user can't tweak the form between steps and end up with a brief that
  // doesn't match the estimate they saw.
  const snapshotRef = useRef<FormData | null>(null);

  function appendPreset(key: string) {
    const snippet = t(`${key}_value` as Parameters<typeof t>[0]);
    setExtraContext((prev) => (prev.trim() ? `${prev.trim()}\n${snippet}` : snippet));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function onSubmitForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    snapshotRef.current = form;
    startEstimateTransition(async () => {
      const result = await estimateBriefCostAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEstimate(result);
      setStep("estimate");
    });
  }

  async function onConfirmGenerate() {
    if (!snapshotRef.current) return;
    setError(null);
    const form = snapshotRef.current;
    startGenerateTransition(async () => {
      const result = await generateBriefAction(form);
      if (!result.ok) {
        setError(result.error);
        setStep("form");
      }
      // On success the action redirects; nothing more to do here.
    });
  }

  function onCancelEstimate() {
    setEstimate(null);
    setStep("form");
  }

  if (step === "estimate" && estimate) {
    return (
      <EstimateConfirmCard
        estimate={estimate}
        isGenerating={isGenerating}
        onConfirm={onConfirmGenerate}
        onCancel={onCancelEstimate}
        error={error ? t(`error_${error}` as Parameters<typeof t>[0]) : null}
      />
    );
  }

  return (
    <form onSubmit={onSubmitForm} className="space-y-5">
      <Field label={t("field_topic")} hint={t("field_topic_hint")}>
        <div className="relative">
          <input
            ref={topicRef}
            name="topic_title"
            type="text"
            required
            minLength={4}
            maxLength={200}
            autoFocus={!defaultTopic}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t("field_topic_placeholder")}
            className="block h-11 w-full rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {topic.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTopic("");
                topicRef.current?.focus();
              }}
              aria-label="Clear"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </Field>

      <Field label={t("field_segment")}>
        <SelectGrid
          name="segment"
          value={segment}
          onChange={(v) => setSegment(v as (typeof SEGMENTS)[number])}
          options={SEGMENTS.map((s) => ({
            value: s,
            label: t(`segment_${s}` as Parameters<typeof t>[0]),
          }))}
        />
      </Field>

      <Field label={t("field_tone")}>
        <SelectGrid
          name="tone"
          value={tone}
          onChange={(v) => setTone(v as (typeof TONES)[number])}
          options={TONES.map((tn) => ({
            value: tn,
            label: t(`tone_${tn}` as Parameters<typeof t>[0]),
          }))}
        />
      </Field>

      <Field label={t("field_format")} hint={t("field_format_hint")}>
        <SelectGrid
          name="format"
          value={format}
          onChange={(v) => setFormat(v as (typeof FORMATS)[number])}
          options={FORMATS.map((f) => ({
            value: f,
            label: t(`format_${f}` as Parameters<typeof t>[0]),
          }))}
        />
      </Field>

      <Field label={t("field_include_profile")}>
        <label
          className="group inline-flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm transition hover:border-slate-300"
          title={t("field_include_profile_tooltip")}
        >
          <input
            type="checkbox"
            name="include_profile"
            checked={includeProfile}
            onChange={(e) => setIncludeProfile(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-slate-900">
              {t("field_include_profile_label")}
            </span>
            <span className="text-xs leading-relaxed text-slate-500">
              {t("field_include_profile_hint")}
            </span>
          </span>
        </label>
      </Field>

      <Field label={t("field_pages")} hint={t("field_pages_hint")}>
        <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setPages((p) => Math.max(1, p - 1))}
            disabled={pages <= 1}
            aria-label="Decrease pages"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-6 text-center text-sm font-semibold tabular-nums text-slate-900">
            {pages}
          </span>
          <button
            type="button"
            onClick={() => setPages((p) => Math.min(4, p + 1))}
            disabled={pages >= 4}
            aria-label="Increase pages"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <input type="hidden" name="pages" value={pages} />
      </Field>

      <Field
        label={t("field_extra_context")}
        hint={t("field_extra_context_hint")}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          {CONTEXT_PRESETS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => appendPreset(key)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Plus className="h-3 w-3 text-slate-400" />
              {t(`${key}_label` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        <div className="relative">
          <textarea
            ref={textareaRef}
            name="extra_context"
            maxLength={2000}
            rows={4}
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            placeholder={t("field_extra_context_placeholder")}
            className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          {extraContext.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setExtraContext("");
                textareaRef.current?.focus();
              }}
              aria-label="Clear"
              className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="mt-1 text-right text-[10px] tabular-nums text-slate-400">
          {extraContext.length} / 2000
        </p>
      </Field>

      <Field label={t("field_locale")}>
        <SelectGrid
          name="locale"
          value={locale}
          onChange={(v) => setLocale(v as (typeof LOCALES)[number])}
          options={LOCALES.map((l) => ({
            value: l,
            label: t(`locale_${l}` as Parameters<typeof t>[0]),
          }))}
        />
      </Field>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {t(`error_${error}` as Parameters<typeof t>[0])}
        </p>
      )}

      <button
        type="submit"
        disabled={isEstimating}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isEstimating ? (
          <>
            <Spinner size="md" />
            {t("estimate_loading")}
          </>
        ) : (
          <>
            <Coins className="h-4 w-4" />
            {t("estimate_submit")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}

/**
 * Cost confirmation card — appears after the user clicks "Estimate".
 * Shows token + USD + IDR breakdown, plus Confirm/Cancel buttons.
 */
function EstimateConfirmCard({
  estimate,
  isGenerating,
  onConfirm,
  onCancel,
  error,
}: {
  estimate: EstimateOk;
  isGenerating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  error: string | null;
}) {
  const t = useTranslations("Briefs");
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border-2 border-sky-200 bg-gradient-to-br from-sky-50 to-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <Coins className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">
              {t("estimate_eyebrow")}
            </p>
            <h3 className="mt-1 text-balance text-lg font-bold text-sky-950 sm:text-xl">
              {t("estimate_title")}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-sky-900">
              {t("estimate_body")}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label={t("estimate_tokens_in")} value={estimate.tokensIn.toLocaleString()} />
          <Stat label={t("estimate_tokens_out")} value={estimate.tokensOut.toLocaleString()} />
          <Stat label={t("estimate_cost_usd")} value={`~${formatUsd(estimate.totalUsd)}`} accent />
          <Stat label={t("estimate_cost_idr")} value={`~${formatIdr(estimate.totalIdr)}`} accent />
        </dl>

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          {t("estimate_disclaimer", {
            provider: estimate.provider,
            model: estimate.model,
          })}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onCancel}
          disabled={isGenerating}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-1/3"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("estimate_cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isGenerating}
          className="group inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white shadow-lg shadow-emerald-700/15 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? (
            <>
              <Spinner size="md" />
              {t("submit_loading")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {t("estimate_confirm")}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border bg-white px-3 py-2.5",
        accent ? "border-sky-300 bg-sky-50/60" : "border-slate-200",
      )}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd
        className={clsx(
          "mt-1 text-sm font-bold tabular-nums",
          accent ? "text-sky-900" : "text-slate-900",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-left">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/**
 * Controlled tile picker. State MUST live in the parent so it
 * survives the form's `step === "estimate"` re-mount cycle — see the
 * comment in BriefForm where the lifted state is declared.
 */
function SelectGrid({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-medium transition",
                active
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
