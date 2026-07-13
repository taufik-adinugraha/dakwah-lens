import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Clock, Hourglass, Sparkles } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { GROUP_BY_SLUG } from "@/lib/dashboard-metrics";
import { localeAwareFormatDateTime } from "@/lib/date-id";
import { BriefingNarrative } from "@/components/BriefingNarrative";
import {
  getBriefingBySlug,
  getBriefingNavigation,
} from "@/lib/briefing-data";
import { BriefShareMenu } from "./BriefShareMenu";
import { BriefTOC } from "./BriefTOC";
import { BriefPagination } from "./BriefPagination";

/**
 * Server-component render of a single briefing.
 *
 * Shared between two routes:
 *   - /briefings/[id]               — base view; no modal preselected
 *   - /briefings/[id]/[deliverable] — opens a Section-4 modal on mount
 *
 * Keeping rendering in one place avoids 100 LOC of drift between the two
 * route files. The deep-link sub-route is a thin wrapper that passes
 * `initialDeliverable`.
 */
export type DeliverableSlug =
  | "khutbah"
  | "kultum"
  | "kajian"
  | "kisah"
  | "home"
  | "content"
  | "genz"
  | "action"
  | "artikel-1"
  | "artikel-2"
  | "artikel-3"
  | "artikel-4"
  | "tafsir-1"
  | "tafsir-2"
  | "tafsir-3"
  | "tafsir-4";

export async function BriefDetailContent({
  locale,
  id,
  initialDeliverable,
}: {
  locale: string;
  id: string;
  initialDeliverable: DeliverableSlug | null;
}) {
  setRequestLocale(locale);
  const t = await getTranslations("Briefing");

  const brief = await getBriefingBySlug(id);
  if (!brief) {
    // Bare group-slug (no date prefix) addressed to a group that has
    // no briefing yet → render a friendly placeholder instead of 404.
    // The /briefings hub cards point here directly so a click never
    // dead-ends the user. Unknown slugs (typo / dropped group / old
    // 4-segment URL) still 404.
    // Only bare group slugs land here — date-prefixed slugs that miss
    // their briefing still 404, since they pointed at a specific
    // edition that doesn't exist.
    const isDatePrefixed = /^\d{4}-\d{2}-\d{2}-/.test(id);
    const group = isDatePrefixed ? undefined : GROUP_BY_SLUG[id];
    if (!group) notFound();
    return (
      <section className="pt-14 pb-20 sm:pt-20 sm:pb-28">
        <div className="mx-auto max-w-2xl px-4 text-center sm:px-6">
          <Link
            href="/briefings"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("brief_back_to_hub")}
          </Link>
          <div className="mt-8 inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Hourglass className="h-6 w-6" />
          </div>
          <h1 className="mt-6 text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("brief_awaiting_title", { group })}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-slate-600 sm:text-base">
            {t("brief_awaiting_body")}
          </p>
          <Link
            href="/briefings"
            className="mt-7 inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            {t("brief_awaiting_cta")}
          </Link>
        </div>
      </section>
    );
  }
  // brief.themeGroup now carries the THEME_GROUPS label (e.g. "Hukum &
  // Keadilan"). Legacy null/4-segment briefings exist in the DB but
  // aren't reachable via this route since getBriefingBySlug only
  // resolves current group slugs. Treat missing segment defensively.
  const briefGroup = brief.themeGroup ?? "Lainnya";

  const navigation = await getBriefingNavigation(
    briefGroup,
    brief.generatedAt,
  );

  // EN generation paused 2026-05-23 for cost reasons (all current users
  // prefer Indonesian). Briefs after that date have `summaryMdEn = NULL`
  // — we fall back to the Indonesian body and show a soft banner above
  // the article explaining the situation + the "contact us" path for
  // users who actually need English.
  const wantsEnglish = locale === "en";
  const hasEnglish = !!brief.summaryMdEn;
  const showLangFallbackNote = wantsEnglish && !hasEnglish;
  const body =
    wantsEnglish && hasEnglish ? brief.summaryMdEn! : brief.summaryMd;

  const wordCount = body.trim().split(/\s+/).length;
  // ~200 wpm (Indonesian average); cap to whole minutes, min 1.
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const generatedLabel = localeAwareFormatDateTime(brief.generatedAt, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

  // Group labels (e.g. "Hukum & Keadilan", "Aqidah & Ibadah") are
  // already human-readable in Indonesian — use them verbatim instead
  // of mapping through i18n keys. Da'wah-specific terms are
  // first-class per AGENTS.md and don't get translated to English.
  const scopeLabel = briefGroup;

  const briefBasePath = `/briefings/${id}`;

  return (
    <section className="pt-10 pb-16 sm:pt-14 sm:pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Header block. */}
        <header className="border-b border-slate-200 pb-6">
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
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
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
          </div>
        </header>

        {/* Body: 2-column on desktop (sticky TOC + long body). */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start print:hidden">
            <BriefTOC body={body} label={t("brief_toc_label")} />
          </aside>

          <article className="brief-print min-w-0">
            {showLangFallbackNote && (
              <div
                role="note"
                className="mb-5 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4 text-sm leading-relaxed text-amber-900 shadow-sm print:hidden"
              >
                <p className="font-semibold">
                  {t("brief_lang_fallback_title")}
                </p>
                <p className="mt-1 text-amber-800">
                  {t("brief_lang_fallback_body")}
                </p>
              </div>
            )}
            <BriefingNarrative
              text={body}
              daleelRefs={brief.daleelRefs}
              adhkarRefs={brief.adhkarRefs}
              citedDaleelLabel={t("exec_daleel_label")}
              briefBasePath={briefBasePath}
              briefId={id}
              locale={locale}
              initialDeliverable={initialDeliverable}
              deliverableLabels={{
                open: t("brief_deliverable_open"),
                copy: t("brief_deliverable_copy"),
                copied: t("brief_deliverable_copied"),
                download: t("brief_deliverable_download"),
                print: t("brief_deliverable_print"),
                flyer: t("brief_deliverable_flyer"),
                visit: t("brief_deliverable_visit"),
                close: t("brief_deliverable_close"),
              }}
              posterLabels={{
                eyebrow: t("brief_poster_section_eyebrow"),
                title: t("brief_poster_section_title"),
                body: t("brief_poster_section_body"),
                openLarge: t("brief_poster_open_large"),
                download: t("brief_poster_download"),
                downloadPdf: t("brief_poster_download_pdf"),
                print: t("brief_poster_print"),
                loading: t("brief_poster_loading"),
                close: t("brief_poster_close"),
                show: t("brief_poster_section_show"),
                hide: t("brief_poster_section_hide"),
              }}
            />

            <BriefPagination
              locale={locale}
              navigation={navigation}
              currentGroup={briefGroup}
            />
          </article>
        </div>
      </div>
    </section>
  );
}
