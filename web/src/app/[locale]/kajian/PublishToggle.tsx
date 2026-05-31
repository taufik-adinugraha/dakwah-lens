"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import {
  publishKajianAction,
  unpublishKajianAction,
} from "./actions";

export function PublishToggle({
  kajianId,
  initialPublished,
  labels,
}: {
  kajianId: string;
  initialPublished: boolean;
  labels: {
    publish: string;
    unpublish: string;
    publishedBadge: string;
    draftBadge: string;
  };
}) {
  const [published, setPublished] = useState(initialPublished);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onToggle() {
    startTransition(async () => {
      const result = published
        ? await unpublishKajianAction(kajianId)
        : await publishKajianAction(kajianId);
      if (result.ok) {
        setPublished((p) => !p);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={
          published
            ? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900"
            : "inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700"
        }
      >
        {published ? labels.publishedBadge : labels.draftBadge}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : published ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
        {published ? labels.unpublish : labels.publish}
      </button>
    </div>
  );
}
