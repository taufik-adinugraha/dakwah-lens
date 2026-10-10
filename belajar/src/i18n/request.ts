import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  // Ilmu Waris strings live in their own files (docs/waris-plan.md §9.3; architecture.md §9), one
  // top-level namespace per owner ("Q", "Exit", "laporan", …), so the track never edits the shared
  // messages/{locale}.json. Shallow merge: a waris namespace never reuses a module namespace name.
  const base = (await import(`../../messages/${locale}.json`)).default;
  const waris = (await import(`../../messages/waris/${locale}.json`)).default;

  return {
    locale,
    messages: { ...base, ...waris },
  };
});
