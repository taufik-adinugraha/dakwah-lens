"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";

import { deleteKajianAction } from "./actions";

export function KajianDeleteButton({
  kajianId,
  labels,
  redirectTo,
}: {
  kajianId: string;
  labels: { aria: string; confirm: string };
  /** Where to push after deletion. Defaults to /dashboard. Pass null to
   *  just hide the row in place (list contexts). */
  redirectTo?: string | null;
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
      const result = await deleteKajianAction(kajianId);
      if (result.ok) {
        if (redirectTo === null) {
          setHidden(true);
          router.refresh();
        } else {
          router.push(redirectTo ?? "/dashboard");
        }
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
