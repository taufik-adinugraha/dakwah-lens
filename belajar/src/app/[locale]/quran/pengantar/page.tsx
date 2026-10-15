import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { zeroExamplesFor, zeroSequence } from "@/components/autoplay/build";
import { BackLink } from "@/components/BackLink";
import { ForestGlow } from "@/components/ForestGlow";
import { LessonStage } from "@/components/lesson/LessonStage";
import { ConceptCard } from "@/components/library/ConceptCard";
import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { LESSON_ZERO, stageExamples } from "@/lib/autoplay";
import { composeFor } from "@/lib/compose-content";
import { SURAH_INDEX } from "@/lib/content";
import { CURRICULUM, taughtInZero, ZERO_HOST } from "@/lib/curriculum";
import { getConcept } from "@/lib/library";
import { quizAyah } from "@/lib/quiz-content";
import { ayahHref, conceptHref, introHref, quranHref } from "@/lib/routes";
import { alternatesFor } from "@/lib/share";

export async function generateMetadata({ params }: PageProps<"/[locale]/quran/pengantar">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Intro" });
  return { title: t("title"), alternates: alternatesFor(locale, introHref()) };
}

/**
 * LESSON ZERO — "Pengantar: harakat dan tiga jenis kata" (the basic curriculum,
 * docs/belajar-research/kurikulum-dasar.md decision 1, operator-approved 2026-10-13: "A 'lesson
 * zero' with no ayah opens the course. It teaches harakat and the three kinds of word (kalimah:
 * isim, fi'il, huruf), so ayah 1 is lighter. The harakat primer and kalimah move out of 1:1 into
 * lesson zero."). Until then Al-Fatihah 1 opened with the nine lines of the primer and the
 * kalimah line, and counted five new things; its lesson map now says "two things already learnt"
 * of something a lesson really taught.
 *
 * The SAME stage as an ayah's lesson (LessonStage: one "Mulai pelajaran", the same controls,
 * settings, resume and autoplay), with no ayah on it: its sequence (zeroSequence) is the opening
 * line, the harakat primer over its frames, the "Konsep baru" line of the three kinds of word
 * with its examples (the imam's clips), and the hand-over — it then goes on to the first ayah of
 * the surah that hosts it by itself, the way an ayah goes on to the next. The stage's own
 * player is given that first ayah's recording: lesson zero recites no ayah, and the recording
 * it warms is the one the next lesson starts with.
 *
 * Under the stage: where it leads, and the two records behind it (the Harakat page, the kalimah
 * record's card) for a learner who wants to read rather than listen.
 */
export default async function IntroPage({ params }: PageProps<"/[locale]/quran/pengantar">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const host = ZERO_HOST;
  const first = host?.ayat[0];
  if (!host || !first) notFound();

  const t = await getTranslations("Intro");
  const tc = await getTranslations("Concept");
  const tw = await getTranslations("Word");
  const seq = zeroSequence(host, locale);
  const examples = stageExamples(zeroExamplesFor(host).examples);
  const composeFile = composeFor(host.slug);
  const compose = composeFile?.primer ? { marks: composeFile.marks, primer: composeFile.primer, words: {} } : null;
  const [recitation] = first.recitation;
  const records = taughtInZero().flatMap((x) => {
    const record = x.whole && x.concept ? getConcept(x.concept) : undefined;
    return record ? [record] : [];
  });
  const wordAr = Object.fromEntries(host.ayat.flatMap((x) => x.words.map((w) => [w.loc, w.ar])));
  // The slide each step says before its line (kalimah is one word, the Indonesian kalimat is kalam:
  // operator 2026-10-15), by its step id: the cards the stage shows while it is said.
  const leads = Object.fromEntries(taughtInZero().flatMap((x) => (x.lead ? [[`concept:${x.id}:lead`, x.lead] as const] : [])));
  // The foundation page behind the primer: the basics record the curriculum's lesson zero
  // teaches (its step `basics`: the Harakat page), never a typed id.
  const basics = CURRICULUM.steps.flatMap((x) => (x.lesson === LESSON_ZERO && x.basics ? [x.basics] : []));

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
        <BackLink href={quranHref()} label={t("eyebrow")} hint={t("back_hint")} />
        <h1 className="mt-2 text-balance font-display text-3xl font-medium">
          <MixedText text={t("title")} />
        </h1>

        <div className="mt-5" data-intro-lesson>
          <LessonStage
            key={seq.lessonKey}
            seq={seq}
            title={t("title")}
            ayah={seq.ayah}
            surahName={host.name_id}
            following={[]}
            words={[]}
            source={{ url: recitation.url, segments: recitation.segments }}
            translation={
              <p className="text-pretty text-base text-ink">
                <MixedText text={t("about", { surah: host.name_id })} />
              </p>
            }
            exercise={{ words: [], lexemes: [], quiz: quizAyah(host.slug, seq.ayah) }}
            compose={compose}
            examples={examples}
            marks={composeFile?.marks ?? null}
            lessonMap={null}
            leads={leads}
          />
        </div>

        <nav className="mt-10 flex justify-end border-t border-hairline pt-6" aria-label={t("next", { surah: host.name_id })}>
          <Link href={ayahHref(host.slug, first.ayah)} data-intro-next className="btn-secondary">
            {/* One span: inside a flex container every piece of MixedText would be a flex item of
                its own, and "Al-Fatihah," lost its kept box (CI line breaks, 2026-10-14). */}
            <span>
              <MixedText text={t("next", { surah: host.name_id })} />
            </span>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
          </Link>
        </nav>

        <section className="mt-10" aria-labelledby="deeper">
          <h2 id="deeper" className="font-display text-2xl font-medium">
            {t("deeper")}
          </h2>
          {basics.map((id) => (
            <p key={id} className="mt-3">
              <Link href={conceptHref(id)} data-intro-basics={id} className="link-text inline-flex min-h-12 items-center gap-1 text-base font-medium">
                <span>
                  <MixedText text={t("harakat_page")} />
                </span>
                <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
              </Link>
            </p>
          ))}
          <div className="@container mt-3">
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {records.map((record) => (
                <ConceptCard
                  key={record.id}
                  concept={record}
                  labels={{ nahwu: tc("nahwu"), sharaf: tc("sharaf"), bridge: tc("bridge"), examples: tc("examples"), more: tc("more"), sources: tw("sources") }}
                  surahs={SURAH_INDEX}
                  wordAr={wordAr}
                  compact
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
