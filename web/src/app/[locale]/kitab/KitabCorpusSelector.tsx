"use client";

import { useState } from "react";

/**
 * Multi-select kitab corpus picker for the /kitab search form.
 *
 * Replaces the previous loop of independent `KitabPill` components,
 * each tracking its own `useState`, with one client component that
 * owns the full selection set. That way Select All / Deselect All can
 * flip every pill in one click without re-rendering the parent
 * server component.
 *
 * The form below still submits as GET — we render real checkbox
 * `<input>`s (sr-only) for each selected corpus, so a non-JS
 * submission would degrade gracefully (modulo the toggle buttons,
 * which need JS).
 */
export function KitabCorpusSelector({
  corpora,
  initialSelection,
  counts,
  labels,
  selectAllLabel,
  deselectAllLabel,
  countLabel,
}: {
  corpora: readonly string[];
  initialSelection: readonly string[];
  counts: Record<string, number>;
  labels: Record<string, string>;
  selectAllLabel: string;
  deselectAllLabel: string;
  countLabel: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelection),
  );
  const allSelected = selected.size === corpora.length;

  function toggle(corpusKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(corpusKey)) {
        next.delete(corpusKey);
      } else {
        next.add(corpusKey);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(corpora));
  }
  function deselectAll() {
    setSelected(new Set());
  }

  return (
    <>
      {/* Toggle buttons row — placed AFTER the pills label and BEFORE
          the pills. type=button so they don't submit the GET form. */}
      <button
        type="button"
        onClick={allSelected ? deselectAll : selectAll}
        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-3 py-1 text-[11px] font-semibold text-ink-muted hover:bg-paper-deep"
        aria-label={allSelected ? deselectAllLabel : selectAllLabel}
      >
        {allSelected ? deselectAllLabel : selectAllLabel}
      </button>
      <span className="text-[11px] text-ink-faint tabular-nums">
        {countLabel.replace("{n}", String(selected.size)).replace(
          "{total}",
          String(corpora.length),
        )}
      </span>

      {corpora.map((c) => {
        const isOn = selected.has(c);
        const count = counts[c] ?? 0;
        return (
          <label
            key={c}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 transition ${
              isOn
                ? "border-forest/30 bg-forest-tint text-forest"
                : "border-hairline bg-white text-ink-faint"
            }`}
          >
            <input
              type="checkbox"
              name="kitab"
              value={c}
              checked={isOn}
              onChange={() => toggle(c)}
              className="sr-only"
            />
            <span className="font-medium">{labels[c] ?? c}</span>
            {count > 0 && (
              <span
                className={`text-[10px] tabular-nums ${
                  isOn ? "text-forest/70" : "text-ink-faint"
                }`}
              >
                {count.toLocaleString()}
              </span>
            )}
          </label>
        );
      })}

    </>
  );
}
