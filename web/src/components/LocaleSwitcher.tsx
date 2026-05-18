"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import clsx from "clsx";

import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Flag + short label per locale. Flags render as native emoji on macOS /
 *  iOS / Android out of the box; modern Windows + ChromeOS via Segoe UI
 *  Emoji. For `en` we use 🇬🇧 (language-of-origin) rather than 🇺🇸 to stay
 *  neutral for the international/diaspora audience that mostly uses the
 *  English version. */
const LABELS: Record<
  (typeof routing.locales)[number],
  { flag: string; code: string; name: string }
> = {
  id: { flag: "🇮🇩", code: "ID", name: "Bahasa Indonesia" },
  en: { flag: "🇬🇧", code: "EN", name: "English" },
};

export function LocaleSwitcher() {
  const current = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 p-0.5 text-xs font-semibold shadow-sm backdrop-blur"
    >
      {routing.locales.map((locale) => {
        const { flag, code, name } = LABELS[locale];
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            disabled={isPending || active}
            onClick={() =>
              startTransition(() => {
                router.replace(pathname, { locale });
              })
            }
            title={name}
            aria-label={`Switch to ${name}`}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition",
              active
                ? "bg-slate-900 text-white shadow"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={active}
          >
            <span aria-hidden className="text-sm leading-none">
              {flag}
            </span>
            <span>{code}</span>
          </button>
        );
      })}
    </div>
  );
}
