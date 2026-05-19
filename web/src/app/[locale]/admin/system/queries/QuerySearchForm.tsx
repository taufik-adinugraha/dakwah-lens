"use client";

import { useState } from "react";
import { Search, X as XIcon } from "lucide-react";

import { Link, useRouter } from "@/i18n/navigation";

/**
 * Client-side search form for /admin/system/queries.
 *
 * Replaces the previous server-rendered `<form method=GET>`, which
 * caused the browser to do a full document load on submit (resetting
 * scroll position to the top). This version intercepts the submit,
 * builds the same query-string URL the server route understands, and
 * calls `router.push(href, { scroll: false })` — so the table updates
 * in place without losing the user's scroll position.
 *
 * The `buildHref` logic is duplicated from queries/page.tsx because
 * that file is a server component and re-importing across the
 * server/client boundary adds friction for ~5 lines of code.
 */

type PlatformFilter = string;
type CategoryFilter = string;

function buildHref(
  platform: PlatformFilter,
  category: CategoryFilter,
  search: string,
): string {
  const params = new URLSearchParams();
  if (platform !== "all") params.set("platform", platform);
  if (category !== "all") params.set("category", category);
  if (search) params.set("q", search);
  const qs = params.toString();
  return `/admin/system/queries${qs ? `?${qs}` : ""}`;
}

export function QuerySearchForm({
  initialSearch,
  platformFilter,
  categoryFilter,
  matchCount,
}: {
  initialSearch: string;
  platformFilter: PlatformFilter;
  categoryFilter: CategoryFilter;
  matchCount: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialSearch);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim().slice(0, 100);
    router.push(buildHref(platformFilter, categoryFilter, trimmed), {
      scroll: false,
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      <div className="relative flex-1 min-w-[200px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search query text (e.g. pinjol, ulama)…"
          maxLength={100}
          autoComplete="off"
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800"
      >
        Search
      </button>
      {initialSearch && (
        <Link
          href={buildHref(platformFilter, categoryFilter, "")}
          scroll={false}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
          onClick={() => setValue("")}
        >
          <XIcon className="h-3 w-3" />
          Clear
        </Link>
      )}
      <span className="text-[11px] tabular-nums text-slate-500">
        {matchCount} match{matchCount === 1 ? "" : "es"}
      </span>
    </form>
  );
}
