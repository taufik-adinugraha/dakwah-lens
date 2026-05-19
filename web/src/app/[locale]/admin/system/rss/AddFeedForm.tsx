"use client";

import { useState } from "react";

import { addRssFeed } from "../actions";

/**
 * Client-side form for adding an RSS feed. Lives in a `"use client"` file
 * so the Region select can hide when Scope = National — pure CSS can't
 * react to `<select>` value changes across siblings without `:has()`
 * gymnastics that don't survive form resets. The submit is still a server
 * action; this component only owns the local toggle state.
 */
export function AddFeedForm({
  regionLabels,
}: {
  regionLabels: Record<string, string>;
}) {
  const [scope, setScope] = useState<"national" | "regional">("national");

  return (
    <form action={addRssFeed} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <input
          name="name"
          placeholder="Outlet name (e.g. Pikiran Rakyat)"
          required
          maxLength={64}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400"
        />
        <input
          name="url"
          type="url"
          placeholder="https://example.com/rss"
          required
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400"
        />
      </div>
      <div
        className={`grid gap-3 ${scope === "regional" ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_auto]"}`}
      >
        <select
          name="scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as "national" | "regional")}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="national">National (whole-country coverage)</option>
          <option value="regional">Regional (province / city)</option>
        </select>
        {scope === "regional" && (
          <select
            name="region"
            required
            defaultValue=""
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Select region…
            </option>
            {Object.entries(regionLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Add feed
        </button>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-slate-700">
        <input
          type="checkbox"
          name="fetch_body"
          defaultChecked
          className="h-3.5 w-3.5 rounded border-slate-300"
        />
        <span>
          Fetch full article body for each item
          <span className="ml-2 text-slate-500">
            (on by default — adds ~5s/item + 1s/host politeness; uncheck if
            the outlet&apos;s RSS lede is already enough)
          </span>
        </span>
      </label>
      <p className="text-[11px] text-slate-500">
        Regional feeds require a region — the dropdown appears once you pick
        the Regional scope. National feeds cover the whole country.
      </p>
    </form>
  );
}
