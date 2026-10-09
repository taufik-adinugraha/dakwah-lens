import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { DraftChip } from "@/components/lesson/DraftChip";
import { AyahProgressMark } from "@/components/surah/AyahProgressMark";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { getSurah, hasDrafts, SURAHS } from "@/lib/content";
import { ayahHref, hubHref, quranHref } from "@/lib/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return SURAHS.map((s) => ({ surah: s.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quran/[surah]">): Promise<Metadata> {
  const { surah: slug } = await params;
  const s = getSurah(slug);
  return { title: s ? s.name_id : "—" };
}

export default async function SurahPage({ params }: PageProps<"/[locale]/quran/[surah]">) {
  const { locale, surah: slug } = await params;
  setRequestLocale(locale);
  const s = getSurah(slug);
  if (!s) notFound();
  const t = await getTranslations("Surah");
  const tb = await getTranslations("Breadcrumb");
  const words = s.ayat.reduce((n, a) => n + a.words.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <Breadcrumb
        label={tb("label")}
        items={[
          { label: tb("hub"), href: hubHref() },
          { label: tb("quran"), href: quranHref() },
          { label: s.name_id },
        ]}
      />
      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-forest">{t("eyebrow")}</p>
          <h1 className="mt-1 font-display text-4xl font-medium">{s.name_id}</h1>
          <p className="mt-1 text-base text-ink-muted">{t("meta", { ayat: s.ayat.length, words })}</p>
        </div>
        <p lang="ar" dir="rtl" className="quran text-ar-xl text-ink">
          {s.name_ar}
        </p>
      </header>

      {hasDrafts(s) && (
        <p className="mt-6 rounded-2xl border border-notice bg-notice-bg p-4 text-pretty text-base text-ink">
          {t("draft_banner")}
        </p>
      )}

      <ol className="mt-8 space-y-4">
        {s.ayat.map((a) => (
          <li key={a.loc}>
            <Link
              href={ayahHref(s.slug, a.ayah)}
              className="block rounded-2xl border border-hairline bg-white p-5 transition-colors hover:border-forest"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="mt-2 inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-full bg-paper-deep px-2 text-sm font-semibold text-ink-muted">
                  <span className="sr-only">{t("ayah_label", { n: a.ayah })}</span>
                  <span aria-hidden="true">{a.ayah}</span>
                </span>
                <p lang="ar" dir="rtl" className="quran min-w-0 flex-1 text-ar-md text-ink sm:text-ar-lg">
                  {a.ar}
                </p>
              </div>
              <p className="mt-3 text-pretty text-base text-ink sm:pl-13">{a.translation.text}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 sm:pl-13">
                {/* A progress key in the learner's storage, not a URL: it
                    stays "{slug}/{ayah}" so saved progress survives the
                    move under /quran. */}
                <AyahProgressMark ayahKey={`${s.slug}/${a.ayah}`} label={t("ayah_done")} />
                <span className="inline-flex items-center gap-1.5 text-base font-semibold text-forest">
                  {t("learn_ayah")}
                  <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-ink-soft">
        {t("translation_source", { source: s.ayat[0].translation.source_label })}
      </p>

      {s.facts.length > 0 && (
        <section className="mt-12" aria-labelledby="facts">
          <h2 id="facts" className="font-display text-2xl font-medium">
            {t("facts_heading")}
          </h2>
          <div className="@container mt-4">
            <ul className="grid gap-4 @2xl:grid-cols-2">
              {s.facts.map((f) => (
                <li key={f.id}>
                  <FactCard
                    fact={f}
                    labels={{
                      method: t("fact_method"),
                      where: t("fact_where"),
                      sources: t("sources"),
                      draft: t("draft_chip"),
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {hasDrafts(s) ? (
        <p className="mt-10">
          <DraftChip label={t("draft_chip")} />
        </p>
      ) : null}
    </div>
  );
}
