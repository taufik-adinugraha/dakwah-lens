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
          // NOTE: /*/radar is deliberately NOT blocked. It is a PUBLIC page
          // (200 anonymous) linked from /briefings, so blocking it here only
          // produced GSC "Indexed, though blocked by robots.txt" — the URL got
          // indexed with no crawlable content, i.e. a bare link with no snippet.
          // A robots-blocked page can never be seen to carry `noindex`, so the
          // correct way to keep it out of the index is: allow the crawl, and
          // let the page's own `robots: { index: false }` metadata do the work.
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
