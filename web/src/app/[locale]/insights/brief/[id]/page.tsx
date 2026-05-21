import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Clock, Sparkles } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BriefingNarrative } from "@/components/BriefingNarrative";
import { getBriefingBySlug } from "@/lib/insights-data";
import { BriefShareMenu } from "./BriefShareMenu";
import { BriefDownloadMenu } from "./BriefDownloadMenu";
import { BriefTOC } from "./BriefTOC";

/**
 * Public full-view page for an AI-generated weekly briefing.
 *
 *   URL: /insights/brief/{YYYY-MM-DD}-{segment-or-all}
 *   e.g. /insights/brief/2026-05-21-all
 *        /insights/brief/2026-05-21-family
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
  const t = await getTranslations({ locale, namespace: "Insights" });
  const brief = await getBriefingBySlug(id);
  if (!brief) {
    return { title: t("brief_not_found_title") };
  }
  const scopeLabel = brief.segment
    ? t(`segment_${brief.segment}_title` as Parameters<typeof t>[0])
    : t("brief_scope_all");
  const dateStr = brief.generatedAt.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
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
  setRequestLocale(locale);
  const t = await getTranslations("Insights");

  const brief = await getBriefingBySlug(id);
  if (!brief) notFound();

  const body =
    locale === "en" && brief.summaryMdEn ? brief.summaryMdEn : brief.summaryMd;

  const wordCount = body.trim().split(/\s+/).length;
  // ~200 wpm (Indonesian average); cap to whole minutes, min 1.
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const generatedLabel = brief.generatedAt.toLocaleString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const scopeLabel = brief.segment
    ? t(`segment_${brief.segment}_title` as Parameters<typeof t>[0])
    : t("brief_scope_all");

  return (
    <section className="pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Top breadcrumb — hidden in print mode. */}
        <div className="print:hidden">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("brief_back_to_insights")}
          </Link>
        </div>

        {/* Header block. */}
        <header className="mt-4 border-b border-slate-200 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
              <Sparkles className="h-3 w-3" />
              {t("exec_briefing_label")}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
              {scopeLabel}
            </span>
          </div>
          <h1 className="mt-3 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("brief_page_h1", { scope: scopeLabel })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>{generatedLabel}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {t("brief_reading_time", { minutes: readingMinutes })}
            </span>
          </div>

          {/* Share + Download toolbar — hidden in print. */}
          <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
            <BriefShareMenu
              briefId={id}
              title={t("brief_page_h1", { scope: scopeLabel })}
              labels={{
                trigger: t("brief_share"),
                copyLink: t("brief_share_copy_link"),
                copyMarkdown: t("brief_share_copy_markdown"),
                whatsapp: t("brief_share_whatsapp"),
                telegram: t("brief_share_telegram"),
                x: t("brief_share_x"),
                facebook: t("brief_share_facebook"),
                line: t("brief_share_line"),
                email: t("brief_share_email"),
                emailSubject: t("brief_share_email_subject", {
                  scope: scopeLabel,
                }),
                copied: t("brief_share_copied"),
              }}
            />
            <BriefDownloadMenu
              briefId={id}
              labels={{
                trigger: t("brief_download"),
                pdf: t("brief_download_pdf"),
                markdown: t("brief_download_markdown"),
                text: t("brief_download_text"),
                print: t("brief_download_print"),
              }}
            />
          </div>
        </header>

        {/* Body: 2-column on desktop (sticky TOC + long body). */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start print:hidden">
            <BriefTOC body={body} label={t("brief_toc_label")} />
          </aside>

          <article className="brief-print min-w-0">
            <BriefingNarrative
              text={body}
              daleelRefs={brief.daleelRefs}
              citedDaleelLabel={t("exec_daleel_label")}
            />
          </article>
        </div>
      </div>
    </section>
  );
}
