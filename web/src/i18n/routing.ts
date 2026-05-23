import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["id", "en"],
  defaultLocale: "id",
  localePrefix: "always",
  // Always land on `defaultLocale` (Indonesian — primary product
  // locale, per PRD) for unknown paths, regardless of the browser's
  // Accept-Language header. EN is available via the language switcher
  // for users who prefer it, but the platform serves an Indonesian
  // Muslim audience first.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
