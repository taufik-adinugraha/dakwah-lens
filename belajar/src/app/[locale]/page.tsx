import type { Metadata } from "next";
import { ArrowRight, BookOpen, Library, Scale } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { StatusChip } from "@/components/StatusChip";
import { TextSizeHint } from "@/components/TextSizeSwitch";
import { AiChip } from "@/components/waris/report/AiChip";
import { Link } from "@/i18n/navigation";
import { hasDrafts, SURAHS } from "@/lib/content";
import { LIBRARY } from "@/lib/library";
import { conceptIndexHref, quranHref, warisHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Hub" });
  return {
    title: { absolute: `${t("heading")} · Dakwah-Lens` },
    alternates: {
      canonical: `https://dakwah-lens.id/belajar/${locale}`,
      languages: {
        id: "https://dakwah-lens.id/belajar/id",
        en: "https://dakwah-lens.id/belajar/en",
        "x-default": "https://dakwah-lens.id/belajar/id",
      },
    },
  };
}

/**
 * The Belajar hub (plan L9): one card per learning track that exists today,
 * plus the shared grammar library later tracks reuse. No cards for tracks
 * that are only planned. Counts and draft status come from the content.
 */
export default async function HubPage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Hub");
  const tw = await getTranslations("Track");

  const quranDraft = SURAHS.some(hasDrafts);
  const surahList = SURAHS.map((s) =>
    t("surah_ayat", { name: s.name_id, ayat: s.ayat.length }),
  ).join(", ");
  const conceptsDraft = LIBRARY.concepts.some((c) => c.status === "draft");

  const tracks = [
    {
      href: quranHref(),
      Icon: BookOpen,
      title: t("quran_title"),
      body: t("quran_body"),
      available: t("quran_available", { list: surahList }),
      status: quranDraft ? t("status_beta_draft") : t("status_beta"),
      draft: quranDraft,
      cta: t("quran_cta"),
    },
    {
      href: conceptIndexHref(),
      Icon: Library,
      title: t("concepts_title"),
      body: t("concepts_body"),
      available: t("concepts_available", { n: LIBRARY.concepts.length }),
      status: conceptsDraft ? t("status_beta_draft") : t("status_beta"),
      draft: conceptsDraft,
      cta: t("concepts_cta"),
    },
    {
      // Ilmu Waris (Faraidh): what exists today is the calculator (docs/waris-plan.md §9.1, M2.13).
      // No human review (operator, 2026-10-09), so the chip states what it is, not a review status.
      href: warisHref.track(),
      Icon: Scale,
      title: tw("hub_title"),
      body: tw("hub_body"),
      available: tw("hub_available"),
      status: tw("chip"),
      draft: false,
      ai: true,
      cta: tw("hub_cta"),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="max-w-2xl">
        <h1 className="text-balance font-display text-4xl font-medium tracking-[-0.015em] sm:text-5xl">
          {t("heading")}
        </h1>
        <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted">{t("intro")}</p>
      </section>

      {/* One-time card: hidden before paint once the learner has chosen a
          size or closed it. The header switch is always there. */}
      <TextSizeHint className="mt-8" />

      <section className="mt-10" aria-labelledby="tracks">
        <h2 id="tracks" className="text-lg font-semibold text-ink">
          {t("tracks_heading")}
        </h2>
        {/* Container query, not a media query: columns collapse as the
            learner's text size grows (senior-ux.md §3.4). */}
        <div className="@container mt-3">
          <ul className="grid gap-4 @2xl:grid-cols-2">
            {tracks.map(({ href, Icon, title, body, available, status, draft, ai, cta }) => (
              <li key={href}>
                {/* The whole card is the link; nothing inside it is
                    interactive (the status is a label, not a control). */}
                <Link
                  href={href}
                  className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5 shadow-sm transition-colors hover:border-forest sm:p-6"
                >
                  <Icon className="h-7 w-7 text-forest" aria-hidden />
                  <h3 className="mt-3 font-display text-2xl font-medium text-ink">{title}</h3>
                  <p className="mt-1.5 text-pretty text-base text-ink-muted">{body}</p>
                  <p className="mt-3 text-base text-ink">{available}</p>
                  <span className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                    {ai ? <AiChip label={status} /> : <StatusChip label={status} draft={draft} />}
                    <span className="inline-flex items-center gap-1.5 text-base font-semibold text-forest">
                      {cta}
                      <ArrowRight aria-hidden className="h-5 w-5 shrink-0" />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
