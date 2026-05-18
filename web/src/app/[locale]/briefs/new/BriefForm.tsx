"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import clsx from "clsx";

import { generateBriefAction } from "@/app/[locale]/briefs/actions";
import { Spinner } from "@/components/Spinner";

const SEGMENTS = [
  "urban_gen_z",
  "working_professionals",
  "parents_families",
  "rural_communities",
  "students",
] as const;
const TONES = ["scholarly", "casual", "motivational", "empathetic"] as const;
const LOCALES = ["en", "id"] as const;

/** Preset snippets the user can click to seed the "extra context" textarea.
 *  Tone is intentionally directive — these are commands to the LLM, not
 *  user-facing copy. Keys resolve to translated labels in i18n. */
const CONTEXT_PRESETS = [
  "preset_khutbah_jumat",
  "preset_counter_misconception",
  "preset_current_events",
  "preset_social_video",
  "preset_action_steps",
  "preset_for_youth",
] as const;

export function BriefForm({
  defaultLocale,
  defaultTopic = "",
}: {
  defaultLocale: "en" | "id";
  defaultTopic?: string;
}) {
  const t = useTranslations("Briefs");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [extraContext, setExtraContext] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function appendPreset(key: string) {
    const snippet = t(`${key}_value` as Parameters<typeof t>[0]);
    setExtraContext((prev) => (prev.trim() ? `${prev.trim()}\n${snippet}` : snippet));
    // Defer focus to next tick so the new content is in the DOM.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await generateBriefAction(form);
      if (!result.ok) {
        setError(result.error);
      }
      // On success the action redirects to /briefs/[id] — no further work here.
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label={t("field_topic")} hint={t("field_topic_hint")}>
        <input
          name="topic_title"
          type="text"
          required
          minLength={4}
          maxLength={200}
          autoFocus={!defaultTopic}
          defaultValue={defaultTopic}
          placeholder={t("field_topic_placeholder")}
          className="block h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
      </Field>

      <Field label={t("field_segment")}>
        <SelectGrid
          name="segment"
          options={SEGMENTS.map((s) => ({
            value: s,
            label: t(`segment_${s}` as Parameters<typeof t>[0]),
          }))}
        />
      </Field>

      <Field label={t("field_tone")}>
        <SelectGrid
          name="tone"
          options={TONES.map((tn) => ({
            value: tn,
            label: t(`tone_${tn}` as Parameters<typeof t>[0]),
          }))}
        />
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
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Plus className="h-3 w-3 text-slate-400" />
              {t(`${key}_label` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          name="extra_context"
          maxLength={2000}
          rows={4}
          value={extraContext}
          onChange={(e) => setExtraContext(e.target.value)}
          placeholder={t("field_extra_context_placeholder")}
          className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <p className="mt-1 text-right text-[10px] tabular-nums text-slate-400">
          {extraContext.length} / 2000
        </p>
      </Field>

      <Field label={t("field_locale")}>
        <SelectGrid
          name="locale"
          options={LOCALES.map((l) => ({
            value: l,
            label: t(`locale_${l}` as Parameters<typeof t>[0]),
          }))}
          defaultValue={defaultLocale}
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
        disabled={isPending}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <Spinner size="md" />
            {t("submit_loading")}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            {t("submit")}
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </>
        )}
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
    <label className="block text-left">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {hint && <span className="ml-2 text-[11px] text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function SelectGrid({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
}) {
  const [selected, setSelected] = useState(defaultValue ?? options[0].value);
  return (
    <>
      <input type="hidden" name={name} value={selected} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const active = o.value === selected;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setSelected(o.value)}
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
