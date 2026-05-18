import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "id"],
  defaultLocale: "en",
  localePrefix: "always",
  // Always land on `defaultLocale` (English) for unknown paths,
  // regardless of the browser's Accept-Language header.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
