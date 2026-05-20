"use client";

import { useState } from "react";

/**
 * Visually-toggling kitab pill. Mirrors the visual style of the
 * server-rendered version, but `useState`-tracks the checkbox so the
 * pill colors update on click — before the user submits the form. The
 * underlying input keeps `name="kitab"` so the form submission still
 * carries the correct multi-select value to the server.
 */
export function KitabPill({
  corpusKey,
  label,
  count,
  initialChecked,
}: {
  corpusKey: string;
  label: string;
  count: number;
  initialChecked: boolean;
}) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 transition ${
        checked
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      <input
        type="checkbox"
        name="kitab"
        value={corpusKey}
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
        className="sr-only"
      />
      <span className="font-medium">{label}</span>
      {count > 0 && (
        <span
          className={`text-[10px] tabular-nums ${
            checked ? "text-emerald-700/70" : "text-slate-500"
          }`}
        >
          {count.toLocaleString()}
        </span>
      )}
    </label>
  );
}
