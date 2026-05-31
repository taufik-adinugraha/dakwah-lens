"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Plus, Sparkles, X } from "lucide-react";

import { generateBriefAction } from "@/app/[locale]/briefs/actions";
import { Spinner } from "@/components/Spinner";

const CONTEXT_PRESETS = [
  "preset_counter_misconception",
  "preset_action_steps",
] as const;

type PickerTopic = {
  id: string;
  label: string;
  postCount: number;
};

export function BriefForm({
  defaultLocale,
  defaultTopic = "",
  currentTopics = [],
}: {
  defaultLocale: "en" | "id";
  defaultTopic?: string;
  /** Topics surfaced in the "Berdasarkan topik yang sedang ramai"
   *  dropdown. Empty list hides the entire checkbox + dropdown UI. */
  currentTopics?: PickerTopic[];
}) {
  const t = useTranslations("Briefs");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, startGenerateTransition] = useTransition();
  const [topic, setTopic] = useState(defaultTopic);
  // "Berdasarkan topik yang sedang ramai" — when ticked, the dropdown
  // appears and the picked topic's label autofills `topic`. The picked
  // id is also threaded server-side to enrich daleel retrieval +
  // anchor headlines from the topic's actual posts. Off by default so
  // free-text typing remains the primary path.
  const [useCurrentTopic, setUseCurrentTopic] = useState(false);
  const [currentTopicId, setCurrentTopicId] = useState<string>("");
  const [extraContext, setExtraContext] = useState("");
  // Draft generation is audience-neutral — segment/tone/profile/pages/locale
  // are chosen later, when the da'i generates a deliverable from this draft.
  // The server action defaults these to neutral values (see actions.ts).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const topicRef = useRef<HTMLInputElement | null>(null);

  function appendPreset(key: string) {
    const snippet = t(`${key}_value` as Parameters<typeof t>[0]);
    setExtraContext((prev) => (prev.trim() ? `${prev.trim()}\n${snippet}` : snippet));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function onSubmitForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    startGenerateTransition(async () => {
      const result = await generateBriefAction(form);
      if (!result.ok) {
        setError(result.error);
      }
      // On success the action redirects; nothing more to do here.
    });
  }

  return (
    <form onSubmit={onSubmitForm} className="space-y-5">
      {currentTopics.length > 0 && (
        <Field label={t("field_current_topic")} hint={t("field_current_topic_hint")}>
          <label
            className="group inline-flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm transition hover:border-slate-300"
          >
            <input
              type="checkbox"
              checked={useCurrentTopic}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseCurrentTopic(checked);
                if (!checked) setCurrentTopicId("");
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-slate-900">
                {t("field_current_topic_label")}
              </span>
              <span className="text-xs leading-relaxed text-slate-500">
                {t("field_current_topic_checkbox_hint")}
              </span>
            </span>
          </label>
          {useCurrentTopic && (
            <div className="relative mt-2">
              <select
                value={currentTopicId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCurrentTopicId(id);
                  const picked = currentTopics.find((tp) => tp.id === id);
                  if (picked) setTopic(picked.label);
                }}
                className="block h-11 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">{t("field_current_topic_placeholder")}</option>
                {currentTopics.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.label} · {tp.postCount.toLocaleString("en-US")}
                  </option>
                ))}
              </select>
              <input
                type="hidden"
                name="current_topic_id"
                value={currentTopicId}
              />
            </div>
          )}
        </Field>
      )}

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
        disabled={isGenerating}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isGenerating ? (
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
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

