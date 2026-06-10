"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";

import { updateIngestQuery } from "../actions";

/**
 * Client-side wrapper for the inline edit-query form.
 *
 * The server action used to call `redirect(returnTo)` after a successful
 * write. That works correctly but resets browser scroll to the top —
 * jarring when the operator is editing a row deep in a long table.
 *
 * This wrapper intercepts submit, awaits the action (which now just
 * revalidates without redirecting), then drops the `?edit=<id>` URL
 * param via `router.replace(returnTo, { scroll: false })` — same UX as
 * the existing search form / Cancel link.
 */
export function EditQueryRowForm({
  id,
  platform,
  initialQuery,
  initialCategory,
  returnTo,
  categories,
}: {
  id: string;
  platform: string;
  initialQuery: string;
  initialCategory: string | null;
  returnTo: string;
  categories: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queryValue, setQueryValue] = useState(initialQuery);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      await updateIngestQuery(formData);
      router.replace(returnTo, { scroll: false });
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <span className="inline-flex h-8 items-center rounded-md bg-slate-100 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
        {platform}
      </span>
      <input
        name="query"
        value={queryValue}
        onChange={(e) => setQueryValue(e.target.value)}
        required
        maxLength={160}
        autoFocus
        className="h-8 flex-1 min-w-[12rem] rounded-md border border-slate-300 px-2 font-mono text-xs"
      />
      <select
        name="category"
        defaultValue={initialCategory ?? ""}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
      >
        <option value="">(none)</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <Link
        href={returnTo}
        scroll={false}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Cancel edit"
      >
        <X className="h-4 w-4" />
      </Link>
    </form>
  );
}
