"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A count with 56px "−" / "+" buttons and the number at 26px (senior-ux.md §3.3; ux.md §4.1 item
 * 8). The value is announced politely when it changes; at a bound the button is disabled, shown
 * by the dashed btn-secondary style and the "Paling banyak" line, never by colour alone.
 */
export function Stepper({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const t = useTranslations("Q");
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <p id={`${id}-label`} className="text-lg font-semibold text-ink">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-4" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          className="btn-secondary h-14 w-14 shrink-0 px-0!"
          onClick={() => onChange(value - 1)}
          disabled={atMin}
          aria-label={t("ui.kurangi", { label })}
        >
          <Minus className="h-6 w-6" aria-hidden />
        </button>
        <output
          id={`${id}-value`}
          aria-live="polite"
          className="min-w-[3ch] text-center text-2xl font-semibold tabular-nums text-ink"
        >
          {value}
        </output>
        <button
          type="button"
          className="btn-secondary h-14 w-14 shrink-0 px-0!"
          onClick={() => onChange(value + 1)}
          disabled={atMax}
          aria-label={t("ui.tambah", { label })}
        >
          <Plus className="h-6 w-6" aria-hidden />
        </button>
      </div>
      {atMax ? <p className="mt-2 text-base text-ink-muted">{t("ui.batas", { n: max })}</p> : null}
    </div>
  );
}
