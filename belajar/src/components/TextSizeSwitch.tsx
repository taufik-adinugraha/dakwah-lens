"use client";

import { useId } from "react";
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  dismissTextSizeHint,
  useTextSize,
  type TextSize,
} from "@/hooks/useTextSize";

/**
 * "Ukuran huruf" controls (docs/belajar-research/senior-ux.md §3.4):
 * - TextSizeOptions: the bare three-option radio group, used by the header's
 *   "Aa" panel (HeaderControls), the lesson's Pengaturan panel and the Home
 *   hint card.
 * - TextSizeHint: the one-time Home card "Tulisan kurang jelas? …".
 */

// Each option is shown in (roughly) its own size relative to Normal:
// 18px · 20.25px · 24px at the browser's default root size.
const OPTIONS: {
  value: TextSize;
  label: "size_normal" | "size_besar" | "size_sangat_besar";
  sample: string;
}[] = [
  { value: "normal", label: "size_normal", sample: "text-base" },
  { value: "besar", label: "size_besar", sample: "text-lg" },
  { value: "sangat-besar", label: "size_sangat_besar", sample: "text-[1.5rem]" },
];

/** `showLegend`: print the group's name ("Ukuran huruf") above the options,
 *  where nothing else on screen names them (the lesson's Pengaturan panel). */
export function TextSizeOptions({ showLegend = false }: { showLegend?: boolean }) {
  const t = useTranslations("Settings");
  const [size, setSize] = useTextSize();
  const name = useId();

  return (
    <fieldset>
      <legend className={showLegend ? "text-base font-semibold text-ink" : "sr-only"}>{t("group_label")}</legend>
      {/* Container query: options stack as the text grows. */}
      <div className={clsx("@container", showLegend && "mt-2")}>
        <div className="grid gap-3 @xl:grid-cols-3">
          {OPTIONS.map((o) => {
            const checked = size === o.value;
            return (
              <label
                key={o.value}
                className={clsx(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl px-4 py-2 transition-colors",
                  checked
                    ? "border-2 border-forest bg-forest-tint"
                    : "border-[1.5px] border-border-ui bg-white hover:border-forest",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={checked}
                  onChange={() => setSize(o.value)}
                  className="sr-only"
                />
                {/* A drawn radio: state shows as a filled circle with a tick
                    plus the word "Dipilih", never by colour alone. */}
                <span
                  aria-hidden
                  className={clsx(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2",
                    checked
                      ? "border-forest bg-forest text-paper"
                      : "border-border-ui bg-white",
                  )}
                >
                  {checked ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={clsx("font-semibold leading-tight text-ink", o.sample)}>
                    {t(o.label)}
                  </span>
                  {checked ? (
                    <span aria-hidden className="text-sm font-medium text-forest">
                      {t("selected")}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

/** One-time Home card; hidden for good once dismissed or a size is chosen. */
export function TextSizeHint({ className }: { className?: string }) {
  const t = useTranslations("Settings");
  const headingId = useId();

  const dismiss = () => {
    dismissTextSizeHint();
    // The card is gone: keep keyboard users oriented on the switch itself.
    document.querySelector<HTMLButtonElement>("[data-text-size-toggle]")?.focus();
  };

  return (
    <section
      aria-labelledby={headingId}
      className={clsx(
        "text-size-hint rounded-2xl border-[1.5px] border-forest bg-white p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        {t("hint_title")}
      </h2>
      <p className="mt-1 max-w-prose text-base text-ink-muted">{t("hint_body")}</p>
      <div className="mt-4">
        <TextSizeOptions />
      </div>
      <button type="button" onClick={dismiss} className="btn-secondary mt-4">
        <X className="h-5 w-5" aria-hidden />
        {t("hint_dismiss")}
      </button>
    </section>
  );
}
