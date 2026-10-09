import type { Metadata } from "next";
import { ArrowRight, BookOpenCheck, Library, Mic } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { StatusChip } from "@/components/StatusChip";
import { Link } from "@/i18n/navigation";
import { hasDrafts, SURAHS } from "@/lib/content";
import { ayahHref, hubHref, surahHref } from "@/lib/routes";

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
 * Landing page of the Qur'anic Arabic + light tafsir track (plan L9): what
 * the track is, how a lesson works, how the material is built, and the
 * surahs available now, with one primary action.
 */
export default async function QuranTrackPage({ params }: PageProps<"/[locale]/quran">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Quran");
  const tb = await getTranslations("Breadcrumb");
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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <Breadcrumb
        label={tb("label")}
        items={[{ label: tb("hub"), href: hubHref() }, { label: tb("quran") }]}
      />

      <section className="mt-4 max-w-2xl">
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-4 max-w-prose text-pretty text-lg text-ink-muted">{t("intro")}</p>
      </section>

      <section className="mt-10" aria-labelledby="start">
        <h2 id="start" className="text-lg font-semibold text-ink">
          {t("start_heading")}
        </h2>
        <ul className="mt-3 space-y-4">
          {SURAHS.map((s, i) => {
            const words = s.ayat.reduce((n, a) => n + a.words.length, 0);
            const meta = [t("surah_meta", { ayat: s.ayat.length, words }), pace[s.slug]]
              .filter(Boolean)
              .join(" · ");
            const draft = hasDrafts(s);
            return (
              <li
                key={s.slug}
                className="rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-8"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-2xl font-medium">{s.name_id}</p>
                    <p className="mt-1 text-base text-ink-muted">{meta}</p>
                  </div>
                  <p lang="ar" dir="rtl" className="quran text-ar-lg text-ink">
                    {s.name_ar}
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {/* One primary action per screen: the first surah. */}
                  <Link
                    href={surahHref(s.slug)}
                    className={`${i === 0 ? "btn-primary" : "btn-secondary"} w-full sm:w-auto`}
                  >
                    {t("start_cta")}
                    <span className="sr-only"> {s.name_id}</span>
                    <ArrowRight className="h-5 w-5" aria-hidden />
                  </Link>
                  <StatusChip
                    label={draft ? th("status_beta_draft") : th("status_beta")}
                    draft={draft}
                  />
                </div>
                {/* Straight to any ayah: a returning learner reaches ayah N in
                    two taps from the hub (hub → track → ayah). */}
                <nav aria-label={t("ayat_nav", { name: s.name_id })} className="mt-4">
                  <ul className="flex flex-wrap gap-2">
                    {s.ayat.map((a) => (
                      <li key={a.loc}>
                        <Link href={ayahHref(s.slug, a.ayah)} className="chip-link">
                          {tl("ayah", { n: a.ayah })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 max-w-prose text-base text-ink-muted">
          <span className="font-semibold text-ink">{t("next_heading")}:</span>{" "}
          {t("next_body")}
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
              <span className="pt-1">{step}</span>
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
                <p className="mt-3 font-display text-xl font-medium">{title}</p>
                <p className="mt-1.5 text-base text-ink-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
