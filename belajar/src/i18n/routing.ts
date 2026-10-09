import { defineRouting } from "next-intl/routing";

// Mirrors web/src/i18n/routing.ts so a learner moving between the main site
// (/id/…) and the module (/belajar/id/…) keeps the same locale shape.
// Content is Indonesian-first; English chrome exists but lessons stay
// Indonesian in v1 (plan §3, B12).
export const routing = defineRouting({
  locales: ["id", "en"],
  defaultLocale: "id",
  localePrefix: "always",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
