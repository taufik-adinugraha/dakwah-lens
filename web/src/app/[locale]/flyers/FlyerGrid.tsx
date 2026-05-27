"use client";

/* eslint-disable @next/next/no-img-element */

import {
  ChevronDown,
  Download,
  Eye,
  Globe,
  Lock,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

type Flyer = {
  id: string;
  headline: string;
  visibility: "private" | "public";
  createdAt: string;
  /** "user" = generated via /flyers/new (has DELETE endpoint).
   *  "system" = derived from a weekly briefing; no delete.
   *  Defaults to "user" for back-compat. */
  kind?: "user" | "system";
  /** Override the PNG URL. User flyers default to /api/user-flyers/{id}/png;
   *  system flyers point at the briefing flyer endpoint. */
  pngUrl?: string;
  /** Type/topic — drive the gallery filters. Set for system flyers
   *  (type = "Doa Pekan Ini" etc, topic = segment). Undefined for user
   *  flyers (no fixed type/topic). */
  typeLabel?: string;
  topicLabel?: string;
};

type FilterLabels = {
  source: string;
  type: string;
  topic: string;
  month: string;
  all: string;
  sourceWeekly: string;
  sourceUser: string;
  empty: string;
};

type Labels = {
  visibilityBadgePublic: string;
  visibilityBadgePrivate: string;
  /** "Mingguan" / "Weekly" — badge for system flyers from briefings. */
  badgeSystem?: string;
  deleteButton: string;
  deleteConfirm: string;
  openLarge: string;
  download: string;
  /** When present, the gallery renders the source/type/topic/month
   *  filter bar. Omitted on /flyers/mine (single-source, no filters). */
  filters?: FilterLabels;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

export function FlyerGrid({
  flyers,
  showDelete,
  labels,
  locale,
}: {
  flyers: Flyer[];
  /** When true, each tile shows a delete affordance. /flyers/mine sets this;
   *  /flyers/public doesn't (viewers can't delete other people's flyers). */
  showDelete?: boolean;
  labels: Labels;
  /** For localized month labels in the filter dropdown. */
  locale?: string;
}) {
  const [items, setItems] = useState<Flyer[]>(flyers);
  const [source, setSource] = useState("all");
  const [type, setType] = useState("all");
  const [topic, setTopic] = useState("all");
  const [month, setMonth] = useState("all");

  const f = labels.filters;

  // Distinct option lists derived from the data (so options only show
  // when they actually exist in the gallery).
  const typeOptions = Array.from(
    new Set(items.map((x) => x.typeLabel).filter(Boolean)),
  ) as string[];
  const topicOptions = Array.from(
    new Set(items.map((x) => x.topicLabel).filter(Boolean)),
  ) as string[];
  const monthKeys = Array.from(new Set(items.map((x) => monthKey(x.createdAt))))
    .sort()
    .reverse();
  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale || undefined, {
      month: "long",
      year: "numeric",
    });
  };

  const filtered = items.filter((x) => {
    if (source !== "all" && (x.kind ?? "user") !== source) return false;
    if (type !== "all" && x.typeLabel !== type) return false;
    if (topic !== "all" && x.topicLabel !== topic) return false;
    if (month !== "all" && monthKey(x.createdAt) !== month) return false;
    return true;
  });

  return (
    <>
      {f && (
        <div className="mb-6 flex flex-wrap gap-2">
          <FilterSelect
            label={f.source}
            value={source}
            onChange={setSource}
            allLabel={f.all}
            options={[
              { value: "system", label: f.sourceWeekly },
              { value: "user", label: f.sourceUser },
            ]}
          />
          {typeOptions.length > 0 && (
            <FilterSelect
              label={f.type}
              value={type}
              onChange={setType}
              allLabel={f.all}
              options={typeOptions.map((o) => ({ value: o, label: o }))}
            />
          )}
          {topicOptions.length > 0 && (
            <FilterSelect
              label={f.topic}
              value={topic}
              onChange={setTopic}
              allLabel={f.all}
              options={topicOptions.map((o) => ({ value: o, label: o }))}
            />
          )}
          {monthKeys.length > 1 && (
            <FilterSelect
              label={f.month}
              value={month}
              onChange={setMonth}
              allLabel={f.all}
              options={monthKeys.map((k) => ({ value: k, label: monthLabel(k) }))}
            />
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
          {f?.empty ?? ""}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((flyer) => (
            <FlyerTile
              key={flyer.id}
              flyer={flyer}
              showDelete={!!showDelete}
              labels={labels}
              onDeleted={() =>
                setItems((xs) => xs.filter((x) => x.id !== flyer.id))
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-full border border-slate-200 bg-white py-1.5 pl-3.5 pr-8 text-xs font-semibold text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
      >
        <option value="all">
          {label}: {allLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

function FlyerTile({
  flyer,
  showDelete,
  labels,
  onDeleted,
}: {
  flyer: Flyer;
  showDelete: boolean;
  labels: Labels;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [zoomed, setZoomed] = useState(false);
  const kind = flyer.kind ?? "user";
  const png = flyer.pngUrl ?? `/api/user-flyers/${flyer.id}/png`;
  // System flyers (from weekly briefings) have no DELETE endpoint —
  // suppress the trash button regardless of `showDelete`.
  const canDelete = showDelete && kind === "user";

  function onDelete(): void {
    if (!confirm(labels.deleteConfirm)) return;
    startTransition(async () => {
      const res = await fetch(`/api/user-flyers/${flyer.id}`, {
        method: "DELETE",
      });
      if (res.ok) onDeleted();
    });
  }

  return (
    <li className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setZoomed(true)}
        aria-label={labels.openLarge}
        className="block aspect-square w-full overflow-hidden bg-slate-100"
      >
        <img
          src={png}
          alt={flyer.headline}
          loading="lazy"
          className="h-full w-full object-cover transition hover:scale-[1.02]"
        />
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold text-slate-900">
            {flyer.headline}
          </p>
          {kind === "system" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              <Sparkles className="h-2.5 w-2.5" />
              {labels.badgeSystem ?? "Weekly"}
            </span>
          ) : (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                flyer.visibility === "public"
                  ? "bg-sky-50 text-sky-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {flyer.visibility === "public" ? (
                <Globe className="h-2.5 w-2.5" />
              ) : (
                <Lock className="h-2.5 w-2.5" />
              )}
              {flyer.visibility === "public"
                ? labels.visibilityBadgePublic
                : labels.visibilityBadgePrivate}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          {new Date(flyer.createdAt).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3 w-3" />
            {labels.openLarge}
          </button>
          <a
            href={png}
            download={`dakwah-lens-flyer-${flyer.id}.png`}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3 w-3" />
            {labels.download}
          </a>
          {canDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              {labels.deleteButton}
            </button>
          )}
        </div>
      </div>

      {zoomed && (
        <ZoomOverlay
          src={png}
          alt={flyer.headline}
          downloadName={`dakwah-lens-flyer-${flyer.id}.png`}
          downloadLabel={labels.download}
          closeLabel={labels.openLarge}
          onClose={() => setZoomed(false)}
        />
      )}
    </li>
  );
}

function ZoomOverlay({
  src,
  alt,
  downloadName,
  downloadLabel,
  closeLabel,
  onClose,
}: {
  src: string;
  alt: string;
  downloadName: string;
  downloadLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-md transition hover:bg-white"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        className="relative flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[80vh] max-w-[88vw] rounded-2xl shadow-2xl"
        />
        <a
          href={src}
          download={downloadName}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-slate-900 shadow-md transition hover:bg-white"
        >
          <Download className="h-3.5 w-3.5" />
          {downloadLabel}
        </a>
      </div>
    </div>
  );
}
