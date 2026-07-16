import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getBriefingBySlug } from "@/lib/briefing-data";
import { localeAwareFormat } from "@/lib/date-id";
import { BriefDetailContent } from "./BriefDetailContent";

/**
 * Public full-view page for an AI-generated weekly briefing.
 *
 *   URL: /briefings/{YYYY-MM-DD}-{segment-or-all}
 *   e.g. /briefings/2026-05-21-all
 *        /briefings/2026-05-21-family
 *
 * The slug is human-readable for sharing (WhatsApp, Telegram, etc).
 * The server resolves it to the latest briefing matching that WIB date
 * + segment combination. Multiple briefings on the same day (e.g.
 * test re-runs) collapse — only the freshest is reachable.
 *
 * Public — no auth, no PII exposed. insights_summaries holds only
 * aggregated conversation stats + LLM narrative; we want this URL to
 * be shareable to anyone the da'i wants to send it to.
 *
 * Layout: 2-column on desktop (sticky TOC sidebar + long-form body),
 * single-column stack on mobile (TOC becomes a floating "Jump to
 * section" anchor list inline). Print mode hides chrome + share/
 * download buttons (see globals.css @media print).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "Briefing" });
  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return { title: t("brief_not_found_title") };
  }
  // 14-group labels (e.g. "Teknologi & AI") are human-readable Indonesian —
  // use verbatim instead of routing through legacy segment_${slug}_title
  // i18n keys that no longer exist (they only covered the old 5 segments).
  const scopeLabel = brief.themeGroup ?? t("brief_scope_all");
  const dateStr = localeAwareFormat(brief.generatedAt, locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const title = t("brief_page_title", { scope: scopeLabel, date: dateStr });
  // Use the first 200 chars of the body as a description for OG/social
  // unfurl. Strip markdown markers + collapse whitespace for clean preview.
  const description = (locale === "en" && brief.summaryMdEn
    ? brief.summaryMdEn
    : brief.summaryMd
  )
    .replace(/^#+\s+.*$/gm, "")
    .replace(/[*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      publishedTime: brief.generatedAt.toISOString(),
    },
  };
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return (
    <BriefDetailContent locale={locale} id={id} initialDeliverable={null} />
  );
}
