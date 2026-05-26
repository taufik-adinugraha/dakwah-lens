"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteBriefAction } from "./actions";

/**
 * Tiny trash button placed alongside each row in /briefs. Confirms,
 * calls the server action, then `router.refresh()` re-renders the page
 * (the deleted row is gone). The button hides itself locally too, so
 * the user sees the row disappear immediately rather than waiting for
 * the round-trip + revalidation.
 */
export function BriefDeleteButton({
  briefId,
  labels,
}: {
  briefId: string;
  labels: { aria: string; confirm: string };
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function onClick(e: React.MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    if (!confirm(labels.confirm)) return;
    startTransition(async () => {
      const result = await deleteBriefAction(briefId);
      if (result.ok) {
        setHidden(true);
        router.refresh();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={labels.aria}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
