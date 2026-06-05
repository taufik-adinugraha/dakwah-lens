"use client";

/**
 * One row in the dashboard "Yang baru Anda simpan" card.
 *
 * Owns local hidden state for optimistic deletion — when the user
 * clicks the trash, we call toggleBookmark (which deletes when the row
 * exists) and hide the row immediately. No router refresh needed; the
 * server-fetched list catches up on next page navigation.
 *
 * Kitab rows open an inline modal showing the bookmark's stored Arabic
 * + translation. Brief / post rows route out via <Link>.
 */

import { useState, useTransition } from "react";
import {
  BookOpenCheck,
  Bookmark,
  ScrollText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { toggleBookmark } from "@/app/[locale]/saved/actions";

const KIND_ICON: Record<string, typeof Bookmark> = {
  kitab: BookOpenCheck,
  brief: ScrollText,
  post: Sparkles,
};

export type SavedItemRowProps = {
  id: string;
  kind: "kitab" | "brief" | "post";
  refId: string;
  title: string;
  /** Optional second line. Suppressed for kitab (the citation in the
   *  title is already self-descriptive). */
  subtitle?: string;
  payload: Record<string, unknown>;
  labels: {
    close: string;
    noArabic: string;
    noTranslation: string;
    removeAria: string;
    removeConfirm: string;
  };
};

export function SavedItemRow(props: SavedItemRowProps) {
  const { kind, refId, title, subtitle, payload, labels } = props;
  const Icon = KIND_ICON[kind] ?? Bookmark;
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);

  if (hidden) return null;

  function onRemove(): void {
    if (pending) return;
    if (!confirm(labels.removeConfirm)) return;
    startTransition(async () => {
      try {
        await toggleBookmark({ kind, ref_id: refId, payload });
        setHidden(true);
      } catch {
        // toggleBookmark failure — leave the row visible. User can retry.
      }
    });
  }

  return (
    <li className="flex items-stretch gap-1 p-3 sm:p-4">
      <div className="min-w-0 flex-1">
        {kind === "kitab" ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex w-full items-start gap-3 text-left transition hover:text-emerald-700"
          >
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">
                {title}
              </span>
            </span>
          </button>
        ) : (
          <Link
            href={
              kind === "brief"
                ? `/briefings/${refId}`
                : "/saved"
            }
            className="flex items-start gap-3 text-left transition hover:text-emerald-700"
          >
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">
                {title}
              </span>
              {subtitle && (
                <span className="block text-xs text-slate-500">{subtitle}</span>
              )}
            </span>
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        aria-label={labels.removeAria}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {kind === "kitab" && modalOpen && (
        <KitabModal
          payload={
            payload as {
              corpus?: string;
              citation?: string;
              arabic?: string;
              translation?: string;
            }
          }
          title={title}
          labels={labels}
          onClose={() => setModalOpen(false)}
        />
      )}
    </li>
  );
}

function KitabModal({
  payload,
  title,
  labels,
  onClose,
}: {
  payload: {
    corpus?: string;
    citation?: string;
    arabic?: string;
    translation?: string;
  };
  title: string;
  labels: SavedItemRowProps["labels"];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-kitab-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">
            {payload.corpus && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {payload.corpus}
              </p>
            )}
            <h3
              id="saved-kitab-modal-title"
              className="mt-0.5 text-balance text-lg font-bold text-slate-900 sm:text-xl"
            >
              {payload.citation || title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">
          {payload.arabic ? (
            <p
              className="text-right font-amiri text-lg leading-relaxed text-slate-900 sm:text-xl md:text-2xl"
              dir="rtl"
              lang="ar"
            >
              {payload.arabic}
            </p>
          ) : (
            <p className="text-xs italic text-slate-400">{labels.noArabic}</p>
          )}
          {payload.translation ? (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {payload.translation}
            </p>
          ) : (
            <p className="mt-4 text-xs italic text-slate-400">
              {labels.noTranslation}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
