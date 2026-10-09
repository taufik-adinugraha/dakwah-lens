import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DraftChip } from "@/components/lesson/DraftChip";
import { AyahProgressMark } from "@/components/surah/AyahProgressMark";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { getSurah, hasDrafts, SURAHS } from "@/lib/content";

export const dynamicParams = false;

export function generateStaticParams() {
  return SURAHS.map((s) => ({ surah: s.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[surah]">): Promise<Metadata> {
  const { surah: slug } = await params;
  const s = getSurah(slug);
  return { title: s ? s.name_id : "—" };
}

export default async function SurahPage({ params }: PageProps<"/[locale]/[surah]">) {
  const { locale, surah: slug } = await params;
  setRequestLocale(locale);
  const s = getSurah(slug);
  if (!s) notFound();
  const t = await getTranslations("Surah");
  const words = s.ayat.reduce((n, a) => n + a.words.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 font-display text-4xl font-medium">{s.name_id}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("meta", { ayat: s.ayat.length, words })}
          </p>
        </div>
        <p lang="ar" dir="rtl" className="quran text-4xl">
          {s.name_ar}
        </p>
      </header>

      {hasDrafts(s) && (
        <p className="mt-6 rounded-2xl border border-dashed border-case-nasb/50 bg-white p-4 text-sm leading-relaxed text-ink-muted">
          {t("draft_banner")}
        </p>
      )}

      <ol className="mt-8 space-y-3">
        {s.ayat.map((a) => (
          <li key={a.loc}>
            <Link
              href={`/${s.slug}/${a.ayah}`}
              className="group block rounded-2xl border border-hairline bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-deep text-xs font-semibold text-ink-muted">
                  {a.ayah}
                </span>
                <p lang="ar" dir="rtl" className="quran flex-1 text-2xl text-ink sm:text-[1.7rem]">
                  {a.ar}
                </p>
              </div>
              <p className="mt-2 pl-11 text-sm leading-relaxed text-ink-muted">
                {a.translation.text}
              </p>
              <div className="mt-3 flex items-center justify-between pl-11">
                <AyahProgressMark ayahKey={`${s.slug}/${a.ayah}`} label={t("ayah_done")} />
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-forest">
                  {t("learn_ayah")}
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] text-ink-faint">
        {t("translation_source", { source: s.ayat[0].translation.source_label })}
      </p>

      {s.facts.length > 0 && (
        <section className="mt-12" aria-labelledby="facts">
          <h2 id="facts" className="font-display text-2xl font-medium">
            {t("facts_heading")}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
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
        </section>
      )}

      <p className="mt-10 text-xs text-ink-faint">
        {t("data_versions")}:{" "}
        {Object.entries(s.data_versions)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")}
      </p>
      {hasDrafts(s) ? <DraftChip label={t("draft_chip")} /> : null}
    </div>
  );
}
