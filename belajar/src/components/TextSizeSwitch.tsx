"use client";

import { useId } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { useTextSize, type TextSize } from "@/hooks/useTextSize";

/**
 * "Ukuran huruf" controls (docs/belajar-research/senior-ux.md §3.4):
 * - TextSizeOptions: the bare three-option radio group, used by the header's
 *   "Aa" panel (HeaderControls) and the lesson's Pengaturan panel. (The
 *   one-time Home card "Tulisan kurang jelas? …" was removed 2026-10-14: the
 *   header's "Aa" button is the one place to change the size.)
 */

// Each option is shown in its own size: body 16px · 18px · 20.25px at the browser's default
// root size (2026-10-14: Normal is the main site's size; the 24px option was dropped).
const OPTIONS: {
  value: TextSize;
  label: "size_normal" | "size_besar" | "size_sangat_besar";
  sample: string;
}[] = [
  { value: "normal", label: "size_normal", sample: "text-base" },
  { value: "besar", label: "size_besar", sample: "text-lg" },
  { value: "sangat-besar", label: "size_sangat_besar", sample: "text-[1.265625rem]" },
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
