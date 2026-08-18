import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { BriefDetailContent } from "../../briefings/[id]/BriefDetailContent";
import { getBriefingBySlug } from "@/lib/briefing-data";
import { localeAwareFormat } from "@/lib/date-id";
import { localeAlternates } from "@/lib/seo";

/**
 * Public briefing hub at the canonical short URL `/d/{slug}`.
 *
 * WHY THIS EXISTS (regression fix, 2026-08-18): `/briefings/{id}` has
 * always declared `canonical: /d/{id}` — see its generateMetadata, whose
 * comment reads "Duplicate of the public /d/{slug} hub — canonicalise
 * onto it". But only `/d/[brief]/[deliverable]/` was ever routed, so the
 * bare `/d/{slug}` fell through to the `[...slug]` catch-all and rendered
 * the branded 404 **with HTTP 200** (a soft 404).
 *
 * Two consequences, both live in production until this file landed:
 *   1. SEO — every briefing's canonical pointed at a soft-404 URL, so the
 *      strongest pages on the site were telling Google their authoritative
 *      version did not exist. A likely contributor to GSC's "Duplicate
 *      without user-selected canonical" / "Crawled - currently not indexed".
 *   2. USERS — anyone who shared a `/d/{slug}` hub link (the share button's
 *      own URL space) sent readers to a 404.
 *
 * Rendering `BriefDetailContent` here — the same component `/briefings/{id}`
 * uses — makes the canonical target real and keeps the intended URL
 * architecture (`/d/` public + short, `/briefings/` the in-app route).
 * This page self-canonicalises to `/d/{brief}`; `/briefings/{id}` continues
 * to point here, so the pair dedupes exactly as originally designed.
 *
 * NOTE: `/d/{slug}` is deliberately NOT added to the sitemap here — the
 * sitemap already submits the per-deliverable pages. This route exists so
 * the canonical resolves and shared links work.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; brief: string }>;
}): Promise<Metadata> {
  const { locale, brief } = await params;
  const t = await getTranslations({ locale, namespace: "Briefing" });
  const row = await getBriefingBySlug(brief);
  if (!row) {
    return { title: t("brief_not_found_title") };
  }

  const scopeLabel = row.themeGroup ?? t("brief_scope_all");
  const dateStr = localeAwareFormat(row.generatedAt, locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const title = t("brief_page_title", { scope: scopeLabel, date: dateStr });
  const description = (locale === "en" && row.summaryMdEn
    ? row.summaryMdEn
    : row.summaryMd
  )
    .replace(/^#+\s+.*$/gm, "")
    .replace(/[*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    title,
    description,
    // Self-canonical: this IS the canonical hub that /briefings/{id} points at.
    alternates: localeAlternates({
      locale,
      canonicalPath: `/d/${brief}`,
      hasEn: Boolean(row.summaryMdEn),
    }),
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: row.generatedAt.toISOString(),
    },
  };
}

export default async function BriefHubPage({
  params,
}: {
  params: Promise<{ locale: string; brief: string }>;
}) {
  const { locale, brief } = await params;
  return (
    <BriefDetailContent locale={locale} id={brief} initialDeliverable={null} />
  );
}
