import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

// Public content (/, /briefings, /d, /kitab, /about, ...) is crawlable.
// App/auth/admin surfaces and the API are not. `/*/…` covers both the
// /id and /en locale prefixes (localePrefix "always").
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/*/admin",
          "/*/dashboard",
          "/*/login",
          "/*/auth/",
          "/*/onboarding",
          "/*/saved",
          "/*/flyers/new",
          "/*/radar",
          "/*/briefs",
          "/*/flyers/mine",
          "/*/kajian",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
