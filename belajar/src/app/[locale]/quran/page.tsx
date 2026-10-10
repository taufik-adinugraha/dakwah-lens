import type { Metadata } from "next";
import { ArrowRight, BookOpenCheck, ChevronDown, Library, Mic } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestGlow } from "@/components/ForestGlow";
import { MixedText } from "@/components/library/MixedText";
import { StatusChip } from "@/components/StatusChip";
import { Link } from "@/i18n/navigation";
import { hasDrafts, SURAHS } from "@/lib/content";
import { ayahHref, surahHref } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quran">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Quran" });
  return {
    title: t("title"),
    alternates: {
      canonical: `https://dakwah-lens.id/belajar/${locale}/quran`,
      languages: {
        id: "https://dakwah-lens.id/belajar/id/quran",
        en: "https://dakwah-lens.id/belajar/en/quran",
        "x-default": "https://dakwah-lens.id/belajar/id/quran",
      },
    },
  };
}

/**
 * Landing page of the Qur'anic Arabic track (plan L9, L13): what
 * the track is, the surahs available now, how a lesson works and how the
 * material is built. Design pass (operator, 2026-10-10: fewer links, more
 * colour): the forest glow behind the page; each surah card is ONE
 * whole-card link to its list of ayat; the straight-to-ayah chips (a
 * returning learner's shortcut) fold into one collapsed row under the
 * cards; no breadcrumb (the header's "Belajar" is the way back to the hub).
 */
export default async function QuranTrackPage({ params }: PageProps<"/[locale]/quran">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Quran");
  // The hub owns the status labels, so the hub card and this page show the
  // same words for the same state.
  const th = await getTranslations("Hub");
  const tl = await getTranslations("Lesson");

  // Authored per surah; a surah without an estimate shows only its counts.
  const pace: Record<string, string> = { "al-fatihah": t("fatihah_pace") };

  const steps = [t("how_1"), t("how_2"), t("how_3")];
  const principles = [
    { Icon: Mic, title: t("p1_title"), body: t("p1_body") },
    { Icon: Library, title: t("p2_title"), body: t("p2_body") },
    { Icon: BookOpenCheck, title: t("p3_title"), body: t("p3_body") },
  ];

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="max-w-2xl">
          {/* Copy naming surahs goes through MixedText: "Al-Qur'an", "Al-Fatihah"
              are never cut at the hyphen, "·" never starts a line (line breaks,
              operator 2026-10-10). */}
          <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-5xl">
            <MixedText text={t("title")} />
          </h1>
          <p className="mt-4 max-w-prose text-pretty text-lg text-ink-muted">
            <MixedText text={t("intro")} />
          </p>
        </section>

        <section className="mt-10" aria-labelledby="start">
          <h2 id="start" className="text-lg font-semibold text-ink">
            {t("start_heading")}
          </h2>
          <ul className="mt-3 space-y-4">
            {SURAHS.map((s) => {
              const words = s.ayat.reduce((n, a) => n + a.words.length, 0);
              const meta = [t("surah_meta", { ayat: s.ayat.length, words }), pace[s.slug]]
                .filter(Boolean)
                .join(" · ");
              const draft = hasDrafts(s);
              return (
                <li key={s.slug}>
                  {/* The whole card is the link; nothing inside it is
                      interactive (the status is a label, not a control). */}
                  <Link href={surahHref(s.slug)} className="glow-card block p-5 sm:p-7">
                    <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <span className="block">
                        <span className="block font-display text-2xl font-medium text-ink">{s.name_id}</span>
                        <span className="mt-1 block text-base text-ink-muted">
                          <MixedText text={meta} />
                        </span>
                      </span>
                      <span lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
                        {s.name_ar}
                      </span>
                    </span>
                    <span className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <StatusChip label={draft ? th("status_beta_draft") : th("status_beta")} draft={draft} />
                      <ArrowRight aria-hidden className="h-6 w-6 shrink-0 text-forest" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Straight to any ayah, folded away: one quiet row instead of a
              chip per ayah on every card. */}
          <details className="mt-4 rounded-2xl border border-hairline bg-white px-5">
            <summary className="disclosure-row text-ink">
              <span>{t("jump_heading")}</span>
              <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
            </summary>
            <div className="space-y-4 pt-1 pb-5">
              {SURAHS.map((s) => (
                <nav key={s.slug} aria-label={t("ayat_nav", { name: s.name_id })}>
                  <p className="text-base font-semibold text-ink">{s.name_id}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {s.ayat.map((a) => (
                      <li key={a.loc}>
                        <Link href={ayahHref(s.slug, a.ayah)} className="chip-link min-h-12! px-5!">
                          {tl("ayah", { n: a.ayah })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </details>

          <p className="mt-4 max-w-prose text-base text-ink-muted">
            <span className="font-semibold text-ink">{t("next_heading")}:</span>{" "}
            <MixedText text={t("next_body")} />
          </p>
        </section>

        <section className="mt-12" aria-labelledby="how">
          <h2 id="how" className="text-lg font-semibold text-ink">
            {t("how_heading")}
          </h2>
          <ol className="mt-3 max-w-prose space-y-3">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-3 text-base text-ink">
                <span
                  aria-hidden
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest-tint text-sm font-semibold text-forest"
                >
                  {i + 1}
                </span>
                <span className="pt-1">
                  <MixedText text={step} />
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12" aria-labelledby="principles">
          <h2 id="principles" className="text-lg font-semibold text-ink">
            {t("principles_heading")}
          </h2>
          {/* Container query, not a media query: columns collapse as the
              learner's text size grows (senior-ux.md §3.4). */}
          <div className="@container mt-3">
            <ul className="grid gap-4 @3xl:grid-cols-3">
              {principles.map(({ Icon, title, body }) => (
                <li key={title} className="rounded-2xl border border-hairline bg-white p-5">
                  <Icon className="h-6 w-6 text-forest" aria-hidden />
                  <p className="mt-3 font-display text-xl font-medium">
                    <MixedText text={title} />
                  </p>
                  <p className="mt-1.5 text-base text-ink-muted">
                    <MixedText text={body} />
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
