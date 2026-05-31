"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import clsx from "clsx";

import type { BriefDaleel } from "@/db/schema";
import { generateKajianAction } from "./actions";

const FORMATS = ["khutbah_jumat", "kultum", "kajian_umum"] as const;
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
const LOCALES = ["id", "en"] as const;

export function DeliverableGeneratorForm({
  briefId,
  daleel,
  defaultLocale = "id",
}: {
  briefId: string;
  daleel: BriefDaleel[];
  defaultLocale?: "id" | "en";
}) {
  const t = useTranslations("Kajian");
  const tBriefs = useTranslations("Briefs");

  const [format, setFormat] = useState<(typeof FORMATS)[number]>("khutbah_jumat");
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]>(SEGMENTS[0]);
  const [tone, setTone] = useState<(typeof TONES)[number]>(TONES[0]);
  const [locale, setLocale] = useState<(typeof LOCALES)[number]>(defaultLocale);
  const [pages, setPages] = useState(2);
  const [includeProfile, setIncludeProfile] = useState(true);
  const [extraContext, setExtraContext] = useState("");
  // Default to all daleel ticked. 1-based indices stored.
  const [selected, setSelected] = useState<Set<number>>(
    new Set(daleel.map((_, i) => i + 1)),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDaleel(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError("no_daleel_selected");
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set(
      "daleel_indices",
      Array.from(selected).sort((a, b) => a - b).join(","),
    );
    startTransition(async () => {
      const result = await generateKajianAction(form);
      if (!result.ok) {
        setError(result.error);
      }
      // success path: action redirects via `redirect()`
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <input type="hidden" name="brief_id" value={briefId} />

      <h2 className="text-base font-semibold text-slate-900">
        {t("generator_title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("generator_subtitle")}</p>

      <div className="mt-5 space-y-5">
        <Field label={t("field_format")}>
          <RadioGroup
            name="format"
            value={format}
            onChange={(v) => setFormat(v as (typeof FORMATS)[number])}
            options={FORMATS.map((f) => ({
              value: f,
              label: t(`format_${f}` as Parameters<typeof t>[0]),
              hint: t(`format_${f}_hint` as Parameters<typeof t>[0]),
            }))}
          />
        </Field>

        <Field label={t("field_segment")}>
          <RadioGroup
            name="segment"
            value={segment}
            onChange={(v) => setSegment(v as (typeof SEGMENTS)[number])}
            options={SEGMENTS.map((s) => ({
              value: s,
              label: tBriefs(`segment_${s}` as Parameters<typeof tBriefs>[0]),
            }))}
          />
        </Field>

        <Field label={t("field_tone")}>
          <RadioGroup
            name="tone"
            value={tone}
            onChange={(v) => setTone(v as (typeof TONES)[number])}
            options={TONES.map((tn) => ({
              value: tn,
              label: tBriefs(`tone_${tn}` as Parameters<typeof tBriefs>[0]),
            }))}
          />
        </Field>

        <Field label={t("field_locale")}>
          <RadioGroup
            name="locale"
            value={locale}
            onChange={(v) => setLocale(v as (typeof LOCALES)[number])}
            options={LOCALES.map((l) => ({
              value: l,
              label: tBriefs(`locale_${l}` as Parameters<typeof tBriefs>[0]),
            }))}
          />
        </Field>

        <Field label={t("field_pages")} hint={t("field_pages_hint")}>
          <input
            type="number"
            name="pages"
            min={1}
            max={4}
            value={pages}
            onChange={(e) => setPages(Number.parseInt(e.target.value, 10) || 2)}
            className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </Field>

        <Field label={t("field_include_profile")}>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              name="include_profile"
              checked={includeProfile}
              onChange={(e) => setIncludeProfile(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-slate-700">{t("field_include_profile_label")}</span>
          </label>
        </Field>

        <Field label={t("field_daleel_select")} hint={t("field_daleel_select_hint")}>
          <ul className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
            {daleel.map((d, i) => {
              const idx = i + 1;
              const checked = selected.has(idx);
              return (
                <li key={idx}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDaleel(idx)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-brand-700">
                        {d.source}
                      </span>
                      {d.translation && (
                        <span className="mt-0.5 line-clamp-2 block text-xs italic text-slate-700">
                          &ldquo;{d.translation}&rdquo;
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-xs text-slate-500">
            {selected.size} / {daleel.length} {t("field_daleel_select_count")}
          </p>
        </Field>

        <Field
          label={t("field_extra_context")}
          hint={t("field_extra_context_hint")}
        >
          <textarea
            name="extra_context"
            maxLength={2000}
            rows={3}
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            placeholder={t("field_extra_context_placeholder")}
            className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </Field>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {t(`error_${error}` as Parameters<typeof t>[0])}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending || selected.size === 0}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {isPending ? t("generating") : t("generate_cta")}
      </button>
    </form>
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
    <div>
      <label className="block text-sm font-medium text-slate-900">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={clsx(
            "cursor-pointer rounded-xl border px-3 py-2 text-sm transition",
            value === o.value
              ? "border-brand-500 bg-brand-50 text-brand-900 shadow-sm"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          <span className="font-medium">{o.label}</span>
          {o.hint && (
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {o.hint}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
