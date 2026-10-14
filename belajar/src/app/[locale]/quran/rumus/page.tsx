import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { BackLink } from "@/components/BackLink";
import { ForestGlow } from "@/components/ForestGlow";
import { MixedText } from "@/components/library/MixedText";
import { RumusSheetView } from "@/components/rumus/RumusSheet";
import { Link } from "@/i18n/navigation";
import { CURRICULUM, introOpen } from "@/lib/curriculum";
import { visibleSurahs } from "@/lib/features";
import { curriculumHref, quranHref, rumusHref } from "@/lib/routes";
import { RUMUS } from "@/lib/rumus";
import { rumusSheet } from "@/lib/rumusSheet";
import { alternatesFor, shareMetadata } from "@/lib/share";

export async function generateMetadata({ params }: PageProps<"/[locale]/quran/rumus">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Rumus" });
  const ta = await getTranslations({ locale, namespace: "App" });
  const to = await getTranslations({ locale, namespace: "Og" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternatesFor(locale, rumusHref()),
    // Share preview with this page's own card (rumus/og/route.ts); og:url = the canonical.
    // Still noindex, like every page of the module (the locale layout, lib/flags.ts).
    ...shareMetadata({
      locale,
      path: rumusHref(),
      title: ta("title_template").replace("%s", t("title")),
      description: t("description"),
      imageAlt: to("image_alt"),
    }),
  };
}

/**
 * The cheat sheet, "Rumus singkat" (operator 2026-10-13: "we can make some 'cheat sheet' to explain
 * the rules, for example: harf jar + ism = kasrah (give examples), isim followed by another ism is
 * mudhof ilaih etc. this cheat sheet is explained also along with formal explanation" and "of
 * course we need to refer to valid kitab, my example is just example"; 2026-10-14: "release cheat
 * sheet"; docs/belajar-plan.md L32).
 *
 * Top to bottom: what it is and what it rests on; then every step of the basic curriculum in
 * teaching order (RumusSheetView), each with its formula, one example from the lessons and the
 * kitab sentence it restates.
 *
 * EVERYTHING it says of grammar is content/rumus.json (pipeline/authored/rumus.json, built by
 * pipeline/build_rumus.py, each formula beside a quote of a pinned kitab page); the messages hold the
 * page's own sentences, never a name, a formula or a number of the sheet.
 *
 * A step's formula is drawn only when its lesson is available — the curriculum page's own rule
 * (lib/curriculumOutline.ts lessonLink: written, and its surah published by BELAJAR_SURAHS, the
 * introduction by lib/curriculum.ts introOpen) — read per request through visibleSurahs(), so this
 * page renders at request time. The formulas of a surah that is not published are in no HTML and no
 * RSC payload (src/lib/rumusSheet.ts leaves them out); their steps are named and marked "Belum
 * tersedia". The page promises no date and no human review; the module's AI-assisted footer is the
 * layout's (AGENTS.md).
 */
export default async function RumusPage({ params }: PageProps<"/[locale]/quran/rumus">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Rumus");
  const tq = await getTranslations("Quran");
  const tb = await getTranslations("Breadcrumb");
  const published = new Set(await visibleSurahs());
  const sheet = rumusSheet(RUMUS, CURRICULUM, { published, intro: introOpen(published) });

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div data-rumus-sheet="" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div data-print-hide="">
          <BackLink href={quranHref()} label={tb("quran")} />
        </div>
        <header className="mt-3">
          <p className="text-sm font-semibold text-forest">
            <MixedText text={tq("title")} />
          </p>
          <h1 className="mt-1 text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-4xl">
            <MixedText text={t("title")} />
          </h1>
          <div className="mt-4 max-w-prose space-y-3 text-pretty text-base text-ink">
            <p className="text-lg text-ink-muted">
              <MixedText text={t("intro_what")} />
            </p>
            <p>
              <MixedText text={t("intro_sources")} />
            </p>
            <p>
              <MixedText text={t("intro_label")} />
            </p>
            <p>
              <MixedText text={t("intro_with_lesson")} />
            </p>
          </div>
          <p data-print-hide="" className="mt-4">
            <Link href={curriculumHref()} data-curriculum-link="" className="link-text inline-flex min-h-12 items-center text-base font-medium">
              {t("curriculum_link")}
            </Link>
          </p>
        </header>

        <section className="mt-10" aria-labelledby="daftar">
          <h2 id="daftar" className="font-display text-2xl font-medium text-ink">
            {t("list_heading")}
          </h2>
          <p className="mt-3 max-w-prose text-pretty text-base text-ink">
            <MixedText text={t("list_help", { shown: sheet.shown, steps: sheet.steps })} />
          </p>
          <RumusSheetView sheet={sheet} />
        </section>
      </div>
    </div>
  );
}
