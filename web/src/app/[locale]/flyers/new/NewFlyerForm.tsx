"use client";

/* eslint-disable @next/next/no-img-element */

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { QuotaSnapshot } from "@/lib/user-flyer/quota";
import { uploadUserFlyerImage } from "../upload-action";

type Layout = "hero-ayat" | "hero-headline" | "split-image" | "quote-card" | "dua-hero";

const LAYOUT_ORDER: Layout[] = [
  "hero-ayat",
  "hero-headline",
  "split-image",
  "quote-card",
  "dua-hero",
];

type Labels = {
  stepLayout: string;
  stepImage: string;
  stepContent: string;
  stepSettings: string;
  layouts: Record<Layout, { title: string; hint: string }>;
  imageTabCollection: string;
  imageTabUpload: string;
  imageUploadHint: string;
  imageUploadButton: string;
  imageUploadUploading: string;
  imageUploadSuccess: string;
  imageUploadErrorTooLarge: string;
  imageUploadErrorType: string;
  imageUploadErrorGeneric: string;
  contentLabel: string;
  contentPlaceholder: string;
  contentHelp: string;
  includeNewsLabel: string;
  includeNewsHint: string;
  visibilityLabel: string;
  visibilityPrivate: string;
  visibilityPrivateHint: string;
  visibilityPublic: string;
  visibilityPublicHint: string;
  submitButton: string;
  submitButtonLoading: string;
  quotaChipTpl: string;
  quotaResetTpl: string;
  quotaExhaustedTitle: string;
  quotaExhaustedBody: string;
  resultTitle: string;
  resultOpenLarge: string;
  resultDownload: string;
  resultViewMine: string;
  resultCreateAnother: string;
  errorGenerationFailed: string;
  errorInvalidInput: string;
};

type Photo = { id: string; src: string };

export function NewFlyerForm({
  photos,
  initialQuota,
  labels,
}: {
  photos: Photo[];
  initialQuota: QuotaSnapshot;
  labels: Labels;
}) {
  const [quota, setQuota] = useState<QuotaSnapshot>(initialQuota);
  const [layout, setLayout] = useState<Layout>("split-image");
  const [imageRef, setImageRef] = useState<string | null>(
    photos[0]?.id ?? null,
  );
  const [imagePreview, setImagePreview] = useState<string | null>(
    photos[0]?.src ?? null,
  );
  const [tab, setTab] = useState<"collection" | "upload">("collection");
  const [userPrompt, setUserPrompt] = useState("");
  const [includeNews, setIncludeNews] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "public">(
    "private",
  );
  const [uploadStatus, setUploadStatus] = useState<{
    state: "idle" | "uploading" | "ok" | "error";
    message?: string;
  }>({ state: "idle" });
  const [submitting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    pngUrl: string;
  } | null>(null);

  const quotaExhausted = quota.remaining <= 0;

  async function onUpload(file: File): Promise<void> {
    setUploadStatus({ state: "uploading" });
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setUploadStatus({
        state: "error",
        message: labels.imageUploadErrorTooLarge,
      });
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadStatus({
        state: "error",
        message: labels.imageUploadErrorType,
      });
      return;
    }
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await uploadUserFlyerImage(fd);
      setImageRef(`upload:${result.uploadId}`);
      setImagePreview(result.src);
      setUploadStatus({
        state: "ok",
        message: labels.imageUploadSuccess,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      let display = labels.imageUploadErrorGeneric;
      if (msg === "file_too_large") display = labels.imageUploadErrorTooLarge;
      if (msg === "unsupported_type") display = labels.imageUploadErrorType;
      setUploadStatus({ state: "error", message: display });
    }
  }

  async function onSubmit(): Promise<void> {
    if (!imageRef || !userPrompt.trim() || quotaExhausted) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/user-flyers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            layout,
            imageRef,
            userPrompt: userPrompt.trim(),
            includeNewsContext: includeNews,
            visibility,
          }),
        });
        const data = (await res.json()) as {
          id?: string;
          error?: string;
          quota?: QuotaSnapshot;
        };
        if (!res.ok) {
          if (data.quota) setQuota(data.quota);
          setError(
            data.error === "invalid_input"
              ? labels.errorInvalidInput
              : labels.errorGenerationFailed,
          );
          return;
        }
        if (data.quota) setQuota(data.quota);
        if (data.id) {
          setResult({
            id: data.id,
            pngUrl: `/api/user-flyers/${data.id}/png`,
          });
        }
      } catch {
        setError(labels.errorGenerationFailed);
      }
    });
  }

  if (result) {
    return (
      <ResultPanel
        result={result}
        labels={labels}
        onCreateAnother={() => {
          setResult(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <QuotaChip quota={quota} labels={labels} />

      {quotaExhausted && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">{labels.quotaExhaustedTitle}</p>
          <p className="mt-1 text-pretty text-xs leading-relaxed text-amber-800">
            {labels.quotaExhaustedBody
              .replace("{limit}", String(quota.limit))
              .replace(
                "{when}",
                new Date(quota.resetAt).toLocaleString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Jakarta",
                  timeZoneName: "short",
                }),
              )}
          </p>
        </div>
      )}

      {/* Step 1: Layout */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {labels.stepLayout}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LAYOUT_ORDER.map((l) => {
            const active = layout === l;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLayout(l)}
                className={`flex flex-col rounded-2xl border p-3 text-left transition ${
                  active
                    ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <span className="text-sm font-semibold text-slate-900">
                  {labels.layouts[l].title}
                </span>
                <span className="mt-1 text-xs leading-relaxed text-slate-600">
                  {labels.layouts[l].hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Step 2: Image */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {labels.stepImage}
        </h2>
        <div className="mb-3 inline-flex gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
          <TabButton
            active={tab === "collection"}
            onClick={() => setTab("collection")}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {labels.imageTabCollection}
          </TabButton>
          <TabButton
            active={tab === "upload"}
            onClick={() => setTab("upload")}
          >
            <Upload className="h-3.5 w-3.5" />
            {labels.imageTabUpload}
          </TabButton>
        </div>

        {tab === "collection" && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((p) => {
              const active = imageRef === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setImageRef(p.id);
                    setImagePreview(p.src);
                  }}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${
                    active
                      ? "border-emerald-500 ring-1 ring-emerald-200"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <img
                    src={p.src}
                    alt={p.id}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {active && (
                    <span className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <CheckCircle2 className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {tab === "upload" && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
            <p className="text-xs text-slate-600">{labels.imageUploadHint}</p>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
              <Upload className="h-3 w-3" />
              {uploadStatus.state === "uploading"
                ? labels.imageUploadUploading
                : labels.imageUploadButton}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                }}
              />
            </label>
            {uploadStatus.state === "ok" && imagePreview && (
              <div className="mt-3 flex items-center gap-3">
                <img
                  src={imagePreview}
                  alt="preview"
                  className="h-20 w-20 rounded-lg object-cover"
                />
                <p className="text-xs font-medium text-emerald-700">
                  {uploadStatus.message}
                </p>
              </div>
            )}
            {uploadStatus.state === "error" && (
              <p className="mt-2 text-xs font-medium text-rose-700">
                {uploadStatus.message}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Step 3: Content */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {labels.stepContent}
        </h2>
        <label className="block text-xs font-medium text-slate-700">
          {labels.contentLabel}
        </label>
        <textarea
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          rows={4}
          maxLength={400}
          placeholder={labels.contentPlaceholder}
          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-200"
        />
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          {labels.contentHelp}
        </p>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeNews}
            onChange={(e) => setIncludeNews(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            <span className="font-medium text-slate-800">
              {labels.includeNewsLabel}
            </span>
            <span className="block text-xs leading-relaxed text-slate-500">
              {labels.includeNewsHint}
            </span>
          </span>
        </label>
      </section>

      {/* Step 4: Settings */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          {labels.stepSettings}
        </h2>
        <fieldset>
          <legend className="text-xs font-medium text-slate-700">
            {labels.visibilityLabel}
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <VisibilityRadio
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
              title={labels.visibilityPrivate}
              hint={labels.visibilityPrivateHint}
            />
            <VisibilityRadio
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
              title={labels.visibilityPublic}
              hint={labels.visibilityPublicHint}
            />
          </div>
        </fieldset>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="sticky bottom-4 z-10">
        <button
          type="button"
          onClick={onSubmit}
          disabled={
            submitting || quotaExhausted || !imageRef || !userPrompt.trim()
          }
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-800 disabled:bg-slate-300"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {submitting ? labels.submitButtonLoading : labels.submitButton}
        </button>
      </div>
    </div>
  );
}

function QuotaChip({
  quota,
  labels,
}: {
  quota: QuotaSnapshot;
  labels: Labels;
}) {
  const resetLabel = new Date(quota.resetAt).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
        <Sparkles className="h-3 w-3" />
        {labels.quotaChipTpl
          .replace("{remaining}", String(quota.remaining))
          .replace("{limit}", String(quota.limit))}
      </span>
      <span className="text-slate-500">
        {labels.quotaResetTpl.replace("{when}", resetLabel)}
      </span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function VisibilityRadio({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 transition ${
        checked
          ? "border-emerald-500 bg-emerald-50"
          : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 text-emerald-600 focus:ring-emerald-500"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-900">
          {title}
        </span>
        <span className="block text-xs leading-relaxed text-slate-500">
          {hint}
        </span>
      </span>
    </label>
  );
}

function ResultPanel({
  result,
  labels,
  onCreateAnother,
}: {
  result: { id: string; pngUrl: string };
  labels: Labels;
  onCreateAnother: () => void;
}) {
  // `key={result.id}` on the <img> resets the loaded state when the
  // id changes (creating a new flyer in the same session) — no effect
  // needed, which avoids the cascading-render lint.
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="space-y-6 text-center">
      <h2 className="text-2xl font-bold text-slate-900">
        {labels.resultTitle}
      </h2>
      <div className="mx-auto aspect-square w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
        {!loaded && (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            …
          </div>
        )}
        <img
          key={result.id}
          src={result.pngUrl}
          alt="flyer preview"
          width={1080}
          height={1080}
          onLoad={() => setLoaded(true)}
          className={`h-full w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <a
          href={result.pngUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {labels.resultOpenLarge}
        </a>
        <a
          href={result.pngUrl}
          download={`dakwah-lens-flyer-${result.id}.png`}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          {labels.resultDownload}
        </a>
        <button
          type="button"
          onClick={onCreateAnother}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {labels.resultCreateAnother}
        </button>
        <Link
          href="/flyers/mine"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {labels.resultViewMine}
        </Link>
      </div>
    </div>
  );
}
