import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BackLink } from "@/components/BackLink";
import { CurriculumOutline, NextLevelList } from "@/components/curriculum/CurriculumOutline";
import { ForestGlow } from "@/components/ForestGlow";
import { MixedText } from "@/components/library/MixedText";
import { CURRICULUM } from "@/lib/curriculum";
import { curriculumOutline } from "@/lib/curriculumOutline";
import { visibleSurahs } from "@/lib/features";
import { getConcept, LIBRARY } from "@/lib/library";
import { curriculumHref, quranHref } from "@/lib/routes";
import { alternatesFor, shareMetadata } from "@/lib/share";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quran/kurikulum">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Curriculum" });
  const ta = await getTranslations({ locale, namespace: "App" });
  const to = await getTranslations({ locale, namespace: "Og" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternatesFor(locale, curriculumHref()),
    // Share preview with this page's own card (kurikulum/og/route.ts); og:url = the canonical.
    // Still noindex, like every page of the module (the locale layout, lib/flags.ts).
    ...shareMetadata({
      locale,
      path: curriculumHref(),
      title: ta("title_template").replace("%s", t("title")),
      description: t("description"),
      imageAlt: to("image_alt"),
    }),
  };
}

/** Ids that have a Konsep page (konsep/[id]/page.tsx generateStaticParams). */
const KONSEP_PAGES: ReadonlySet<string> = new Set([...LIBRARY.basics.map((b) => b.id), ...LIBRARY.concepts.map((c) => c.id)]);

/**
 * The basic curriculum, explained (operator 2026-10-13: "we should also explain this curriculum
 * in the page"; docs/belajar-plan.md L30 — the curriculum itself is L26,
 * docs/belajar-research/kurikulum-dasar.md decisions 1–9).
 *
 * Top to bottom: what the basic level covers and how it is paced; the curriculum unit by unit in
 * teaching order, each lesson with what is NEW in it and the running total learnt after it
 * (CurriculumOutline); what is left for the next level (the file's `lanjut` records).
 *
 * EVERYTHING it says is counted or copied from content/curriculum.json (src/lib/curriculum.ts,
 * src/lib/curriculumOutline.ts): the units and their order, the lessons, the steps and their
 * names, every number in the introduction. The messages hold the sentences, never a name or a
 * number of the curriculum.
 *
 * A lesson is a link only when visitors can reach it: the switch is BELAJAR_SURAHS
 * (lib/features.ts visibleSurahs(), the one the track page reads for its "Segera hadir" cards),
 * read per request, so this page renders at request time. A lesson of a surah that is not
 * published, a lesson that is not written (Ayat Kursi) and the introduction lesson (no route yet:
 * lib/routes.ts lessonHref) are plain text marked "Belum tersedia"; their paths are never built.
 * The page promises no date and no human review; the module's AI-assisted footer is the layout's.
 */
export default async function CurriculumPage({ params }: PageProps<"/[locale]/quran/kurikulum">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Curriculum");
  const tq = await getTranslations("Quran");
  const tb = await getTranslations("Breadcrumb");
  const tc = await getTranslations("Concept");
  const published = new Set(await visibleSurahs());
  const outline = curriculumOutline(CURRICULUM, { published, pages: KONSEP_PAGES });

  // "Al-Fatihah, An-Nas, Al-Falaq, Al-Ikhlas, dan Ayat Kursi": the file's units that are a surah
  // or an ayah, in its order, joined as the locale joins a list.
  const readings = outline.units.filter((u) => u.surah).map((u) => u.name);
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(readings);

  const nextLevel = outline.lanjut.flatMap((id) => {
    const c = getConcept(id);
    return c ? [c] : [];
  });
  const groups = (["sharaf", "nahwu"] as const).map((kind) => ({ kind, label: tc(kind), items: nextLevel.filter((c) => c.kind === kind) }));

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <BackLink href={quranHref()} label={tb("quran")} />
        <header className="mt-3">
          <p className="text-sm font-semibold text-forest">
            <MixedText text={tq("title")} />
          </p>
          <h1 className="mt-1 text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-4xl">
            <MixedText text={t("title")} />
          </h1>
          <p className="mt-4 max-w-prose text-pretty text-lg text-ink-muted">
            <MixedText text={t("intro_scope", { count: readings.length, list })} />
          </p>
          <div className="mt-3 max-w-prose space-y-3 text-pretty text-base text-ink">
            <p>
              <MixedText text={t("intro_pace", { max: outline.maxNew, lessons: outline.lessons, steps: outline.steps })} />
            </p>
            <p>
              <MixedText text={t("intro_later")} />
            </p>
          </div>
        </header>

        <section className="mt-10" aria-labelledby="urutan">
          <h2 id="urutan" className="font-display text-2xl font-medium text-ink">
            {t("list_heading")}
          </h2>
          <p className="mt-3 max-w-prose text-pretty text-base text-ink">
            <MixedText text={t("list_help")} />
          </p>
          <CurriculumOutline outline={outline} />
        </section>

        {nextLevel.length > 0 && (
          <section className="mt-12" aria-labelledby="lanjut">
            <h2 id="lanjut" className="font-display text-2xl font-medium text-ink">
              {t("next_heading")}
            </h2>
            <p className="mt-3 max-w-prose text-pretty text-base text-ink">
              <MixedText text={t("next_body", { n: nextLevel.length })} />
            </p>
            <NextLevelList groups={groups} />
          </section>
        )}
      </div>
    </div>
  );
}
