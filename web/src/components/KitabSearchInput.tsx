"use client";

import { useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Search input + submit button for the /kitab page.
 *
 * Client component (instead of inline server JSX) so the clear-X
 * button can react to the current input value: hidden while empty,
 * visible once the user starts typing. Clicking X wipes the field
 * and submits the parent form so the results page refreshes to
 * browse-mode (rather than showing stale hits for a query the user
 * just deleted).
 */
export function KitabSearchInput({
  defaultValue,
  placeholder,
  submitLabel,
  clearLabel,
}: {
  defaultValue: string;
  placeholder: string;
  submitLabel: string;
  clearLabel: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 focus-within:border-emerald-400 focus-within:bg-white">
      <Search className="h-4 w-4 shrink-0 text-slate-400" />
      <input
        ref={inputRef}
        type="text"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        maxLength={200}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            const input = inputRef.current;
            setValue("");
            // If the user had previously submitted a query (URL has q=…),
            // refresh the page to browse-mode (kitab filter preserved
            // via URL). If they were only typing without submitting,
            // just refocus. Sync the DOM value first so requestSubmit
            // sees the cleared field instead of the pre-state-flush one.
            if (input) {
              input.value = "";
              if (defaultValue.length > 0) {
                input.form?.requestSubmit();
              } else {
                input.focus();
              }
            }
          }}
          className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="submit"
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
      >
        {submitLabel}
      </button>
    </label>
  );
}
