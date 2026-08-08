import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";

import { db, schema } from "@/db";
import { briefingSlug } from "@/lib/briefing-data";
import { SITE_URL } from "@/lib/seo";

// Render at request time against the live DB. (As a build-time static
// route the briefing query ran in the Docker build container, which has
// no DB reachability, so only the static routes were emitted.)
export const dynamic = "force-dynamic";

// Public, translated UI routes (localePrefix "always" -> both /id and /en).
const STATIC_PATHS = [
  "",
  "/briefings",
  "/kitab",
  "/about",
  "/how-it-works",
  "/transparency",
  "/privacy",
  "/terms",
  "/contact",
  "/pustaka-kajian",
  "/discussions",
  "/flyers/public",
] as const;

// Deliverable sub-page slugs by briefing type (keys of
// DELIVERABLE_HEADING_PATTERNS). Weekly + occasion briefings carry all 8
// sections (enforced by the save validators); Fiqh carries 4 articles.
const WEEKLY_DELIVERABLES = [
  "khutbah",
  "kultum",
  "kajian",
  "kisah",
  "home",
  "content",
  "action",
];
const FIQH_DELIVERABLES = ["artikel-1", "artikel-2", "artikel-3", "artikel-4"];
const TAFSIR_DELIVERABLES = ["tafsir-1", "tafsir-2", "tafsir-3", "tafsir-4"];

/** hreflang alternates. `en` is only asserted when an English body exists. */
function alternates(path: string, hasEn: boolean) {
  const languages: Record<string, string> = {
    id: `${SITE_URL}/id${path}`,
    "x-default": `${SITE_URL}/id${path}`,
  };
  if (hasEn) languages.en = `${SITE_URL}/en${path}`;
  return { languages };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  // 1) Static UI routes — bilingual.
  for (const path of STATIC_PATHS) {
    entries.push({
      url: `${SITE_URL}/id${path}`,
      lastModified: now,
      changeFrequency: path === "" || path === "/briefings" ? "daily" : "monthly",
      priority: path === "" ? 1 : 0.6,
      alternates: alternates(path, true),
    });
  }

  // 2) Every briefing hub + its deliverable pages.
  try {
    const rows = await db
      .select({
        generatedAt: schema.briefings.generatedAt,
        themeGroup: schema.briefings.themeGroup,
        occasionSlug: schema.briefings.occasionSlug,
        hasEn: sql<boolean>`${schema.briefings.summaryMdEn} is not null`,
      })
      .from(schema.briefings);

    for (const r of rows) {
      const slug = briefingSlug(r.generatedAt, r.themeGroup, r.occasionSlug);
      const hub = `/d/${slug}`;
      // The bare hub URL (`/d/<slug>`) is intentionally NOT emitted: it
      // renders a thin, noindexed card-grid, so submitting it in the sitemap
      // triggers a Google Search Console "Submitted URL marked noindex"
      // exclusion. Only the indexable deliverable pages below belong here.

      const isWeekly =
        r.themeGroup !== "Fiqh Pekan Ini" && r.themeGroup !== "Tafsir Pekan Ini";
      const deliverables = isWeekly
        ? WEEKLY_DELIVERABLES
        : r.themeGroup === "Fiqh Pekan Ini"
          ? FIQH_DELIVERABLES
          : TAFSIR_DELIVERABLES;

      for (const d of deliverables) {
        const path = `${hub}/${d}`;
        entries.push({
          url: `${SITE_URL}/id${path}`,
          lastModified: r.generatedAt,
          changeFrequency: "monthly",
          priority: 0.7,
          alternates: alternates(path, r.hasEn),
        });
      }

      // Mahasiswa pack's canonical home is `/m/{slug}`, not the
      // `/d/{slug}/genz` share URL (which now redirects there) —
      // submit the canonical page directly so it gets indexed.
      if (isWeekly) {
        entries.push({
          url: `${SITE_URL}/id/m/${slug}`,
          lastModified: r.generatedAt,
          changeFrequency: "monthly",
          priority: 0.7,
          alternates: alternates(`/m/${slug}`, r.hasEn),
        });
      }
    }
  } catch {
    // Never let a DB hiccup 500 the whole sitemap — serve static routes.
  }

  return entries;
}
