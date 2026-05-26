"use client";

/* eslint-disable @next/next/no-img-element */

import { Download, Eye, Globe, Lock, Sparkles, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

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
};

export function FlyerGrid({
  flyers,
  showDelete,
  labels,
}: {
  flyers: Flyer[];
  /** When true, each tile shows a delete affordance. /flyers/mine sets this;
   *  /flyers/public doesn't (viewers can't delete other people's flyers). */
  showDelete?: boolean;
  labels: Labels;
}) {
  const [items, setItems] = useState<Flyer[]>(flyers);
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <FlyerTile
          key={f.id}
          flyer={f}
          showDelete={!!showDelete}
          labels={labels}
          onDeleted={() => setItems((xs) => xs.filter((x) => x.id !== f.id))}
        />
      ))}
    </ul>
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
      <a
        href={png}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-square overflow-hidden bg-slate-100"
      >
        <img
          src={png}
          alt={flyer.headline}
          loading="lazy"
          className="h-full w-full object-cover transition hover:scale-[1.02]"
        />
      </a>
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
          <a
            href={png}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Eye className="h-3 w-3" />
            {labels.openLarge}
          </a>
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
    </li>
  );
}
