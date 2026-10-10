import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { stageSequence } from "@/components/autoplay/build";
import { BackLink } from "@/components/BackLink";
import { LabelRole } from "@/components/exercises/LabelRole";
import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WaznFactory } from "@/components/exercises/WaznFactory";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import { ForestGlow } from "@/components/ForestGlow";
import { LessonStage, WordListenButton } from "@/components/lesson/LessonStage";
import { MaterialsDisclosure } from "@/components/lesson/MaterialsDisclosure";
import { WordCard } from "@/components/lesson/WordCard";
import { ConceptCard } from "@/components/library/ConceptCard";
import { MixedText } from "@/components/library/MixedText";
import { SourceList } from "@/components/library/SourceList";
import { StructureSection } from "@/components/library/StructureSection";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { composeFor } from "@/lib/compose-content";
import { getAyah, getSurah, SURAH_INDEX, SURAHS } from "@/lib/content";
import { orderRecitations } from "@/lib/autoplay";
import { conceptsIntroducedIn, getConcept, getLexeme, LIBRARY } from "@/lib/library";
import { ayahHref, surahHref } from "@/lib/routes";

export const dynamicParams = false;

// Generates BOTH dynamic segments: neither quran/ nor [surah] has a layout,
// so the surah page's generateStaticParams never reaches this route —
// relying on a parent `params.surah` here produced zero paths (every ayah
// page 404'd under dynamicParams=false; caught by the image smoke test).
export function generateStaticParams() {
  return SURAHS.flatMap((s) =>
    s.ayat.map((a) => ({ surah: s.slug, ayah: String(a.ayah) })),
  );
}

const RECITER_LABEL: Record<string, string> = {
  Husary_Muallim_128kbps: "Al-Husary (Mu'allim)",
  Alafasy_128kbps: "Mishary Alafasy",
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quran/[surah]/[ayah]">): Promise<Metadata> {
  const { surah: slug, ayah } = await params;
  const s = getSurah(slug);
  return { title: s ? `${s.name_id} ${ayah}` : "—" };
}

/**
 * One row of "Pelajari lebih dalam": a collapsed 48px disclosure. No per-row
 * "Dibantu AI" tag: the operator removed those chips (2026-10-10) because each
 * record shows its Rujukan; the page footer carries the AI-assisted label.
 */
function Deeper({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-hairline bg-white">
      <summary className="disclosure-row px-5 py-2 text-ink">
        <span>{title}</span>
        <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
      </summary>
      <div className="px-5 pt-1 pb-5">{children}</div>
    </details>
  );
}

/**
 * Lesson page = ONE focused stage (operator, 2026-10-10: "too crowded … focus
 * on the main feature with less distraction"): a short title "Al-Fatihah ·
 * Ayat 1 dari 7" with one small "‹ Al-Fatihah" link back to the list of
 * ayat → the stage: the numbered ayah, its translation and ONE "▶ Mulai
 * pelajaran" (one click, then it runs to the end of the surah by itself;
 * exercises inside the stage, guided by voice and a spotlight; every
 * secondary control behind "⚙ Pengaturan") → everything else folded into
 * ONE collapsed row, "Materi lengkap ayat ini": word by word, the
 * standalone practice, "learn more" (structure, concepts, tafsir, facts),
 * content unchanged → the ayah navigation, once, at the bottom. The forest
 * glow sits behind the page. Nothing gives positional instructions ("di
 * atas"); every citation (Rujukan) stays reachable inside the row.
 */
export default async function AyahPage({
  params,
}: PageProps<"/[locale]/quran/[surah]/[ayah]">) {
  const { locale, surah: slug, ayah: ayahParam } = await params;
  setRequestLocale(locale);
  const s = getSurah(slug);
  const n = Number(ayahParam);
  const a = s && Number.isInteger(n) ? getAyah(s, n) : undefined;
  if (!s || !a) notFound();

  const t = await getTranslations("Lesson");
  const tw = await getTranslations("Word");
  const tc = await getTranslations("Concept");
  const tp = await getTranslations("Player");

  const playerWords = a.words.map((w, i) => ({
    index: i + 1,
    ar: w.ar,
    translit: w.translit,
    gloss: w.gloss,
  }));
  // Default reciter: Mishary Alafasy (operator's choice, 2026-10-09); Husary
  // Mu'allim stays available for its built-in "repeat after me" gaps. Their
  // credit lines are listed on the Kredit page (kredit/page.tsx). One
  // order for the page and the autoplay engine (RECITER_ORDER there), so
  // the exercises the lesson waits at are exactly the ones rendered.
  const sources = orderRecitations(a.recitation).map((r) => ({
    reciter: r.reciter,
    url: r.url,
    segments: r.segments,
    label: RECITER_LABEL[r.reciter] ?? r.reciter,
  }));
  const timed = new Set(sources.flatMap((r) => r.segments.map(([w]) => w)));
  const pool = s.ayat.flatMap((x) => x.words);
  const facts = s.facts.filter((f) => f.locations.includes(a.loc));
  const prev = getAyah(s, n - 1);
  const next = getAyah(s, n + 1);
  // Storage key for lesson/exercise progress, not a URL: unchanged by the
  // move under /quran so saved progress survives it.
  const key = `${s.slug}/${a.ayah}`;
  const pageTitle = `${s.name_id} · ${t("ayah", { n: a.ayah })}`;
  const introduced = conceptsIntroducedIn(a.loc);
  // The autoplay lesson of this ayah (src/lib/autoplay), built here at build
  // time: captions in the page's locale, narration audio from
  // content/narration/ when it has been rendered.
  const seq = stageSequence(s, a, locale);
  // The word compositions and the harakat primer of this ayah (content/compose,
  // operator 2026-10-10, narration rule 14): the bytes the stage's animation
  // shows, by word number; the sequence above carries only their lines.
  const composeFile = composeFor(s.slug);
  const compose = composeFile
    ? {
        marks: composeFile.marks,
        primer: composeFile.primer && composeFile.primer.ayah === a.ayah ? composeFile.primer : null,
        words: Object.fromEntries(
          a.words.flatMap((w, i) => (composeFile.words[w.loc] ? [[i + 1, composeFile.words[w.loc]]] : [])),
        ),
      }
    : null;
  const lexemes = [...new Set(a.words.map((w) => w.lemma_id).filter((x): x is string => !!x))].flatMap((lid) => {
    const lx = getLexeme(lid);
    return lx?.tashrif ? [lx] : [];
  });
  const surahIdx = SURAHS.findIndex((x) => x.slug === s.slug);
  const after = surahIdx >= 0 ? SURAHS[surahIdx + 1] : undefined;
  const nextSurah = after ? { slug: after.slug, name: after.name_id } : null;
  const conceptTitle = Object.fromEntries(LIBRARY.concepts.map((c) => [c.id, c.title]));
  const wordAr = Object.fromEntries(s.ayat.flatMap((x) => x.words.map((w) => [w.loc, w.ar])));
  const conceptLabels = {
    nahwu: tc("nahwu"),
    sharaf: tc("sharaf"),
    bridge: tc("bridge"),
    examples: tc("examples"),
    more: tc("more"),
    sources: tw("sources"),
  };
  const hasDeeper = !!a.structure || introduced.length > 0 || !!a.tafsir || facts.length > 0;

  // Through MixedText (line breaks, operator 2026-10-10): the quotes and a
  // footnote mark stay on their word ("pembalasan.[1]”"), "orang-orang" and
  // "Al-Qur'an" are never cut, and neither " - " nor " · " starts a line.
  const translation = (
    <figure>
      <blockquote className="text-pretty text-base text-ink">
        <MixedText text={`“${a.translation.text}”`} />
      </blockquote>
      {a.translation.footnotes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-muted">
          {a.translation.footnotes.map((f) => (
            <li key={f}>
              <MixedText text={f} />
            </li>
          ))}
        </ul>
      )}
      <figcaption className="mt-2 text-xs text-ink-soft">
        <MixedText
          text={`${a.translation.source_label}${a.translation.version ? ` · ${a.translation.version}` : ""}`}
        />
      </figcaption>
    </figure>
  );

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 sm:py-8">
        {/* 1. Where am I: one way back, one short title. */}
        <BackLink href={surahHref(s.slug)} label={s.name_id} hint={t("back_to_surah")} />
        <h1 className="mt-2 text-balance font-display text-3xl font-medium">
          <MixedText text={`${s.name_id} · ${t("ayah_of", { n: a.ayah, total: s.ayat.length })}`} />
        </h1>

        {/* 2. The stage: ayah, translation and the autoplay lesson — one
            player. Keyed by ayah: the next ayah (reached by the lesson's own
            hand-off) starts with a fresh runner. */}
        <div className="mt-5">
          <LessonStage
            key={key}
            seq={seq}
            title={pageTitle}
            ayah={a.ayah}
            surahName={s.name_id}
            nextSurah={nextSurah}
            words={playerWords}
            sources={sources}
            translation={translation}
            exercise={{ words: a.words, pool, lexemes }}
            compose={compose && (compose.primer || Object.keys(compose.words).length) ? compose : null}
          />
        </div>

        {/* 3. Everything else, in one collapsed row. */}
        <div className="mt-10">
          <MaterialsDisclosure title={t("materials")} hint={t("materials_hint")}>
            {/* Word by word */}
            <section aria-labelledby="words">
              <h2 id="words" className="font-display text-2xl font-medium">
                {t("words_heading")}
              </h2>
              <p className="mt-1 max-w-prose text-base text-ink-muted">{t("words_intro", { n: a.words.length })}</p>
              {/* Container query, not media query: columns collapse as the text
                  size grows (rem in @media ignores the root size). */}
              <div className="@container mt-4">
                <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
                  {a.words.map((w, i) => (
                    <WordCard
                      key={w.loc}
                      word={w}
                      lexeme={w.lemma_id ? getLexeme(w.lemma_id) : undefined}
                      concepts={w.concepts.flatMap((id) => {
                        const c = getConcept(id);
                        return c ? [{ id: c.id, title: c.title }] : [];
                      })}
                      listen={
                        timed.has(i + 1) ? (
                          <WordListenButton
                            index={i + 1}
                            label={tp("listen")}
                            detail={tp("listen_detail", { n: i + 1, translit: w.translit })}
                          />
                        ) : undefined
                      }
                      labels={{
                        role: tw("role"),
                        concepts: tw("concepts"),
                        lemma: tw("lemma"),
                        sharaf: {
                          heading: tw("sharaf_heading"),
                          forms_note: tw("sharaf_forms_note"),
                          ilal: tw("ilal"),
                          ilal_from: tw("ilal_from"),
                          ilal_to: tw("ilal_to"),
                        },
                        meaning: tw("meaning"),
                        root: tw("root"),
                        wazn: tw("wazn"),
                        why: tw("why"),
                        other_views: tw("other_views"),
                        sources: tw("sources"),
                        no_root: tw("no_root"),
                      }}
                    />
                  ))}
                </div>
              </div>
            </section>

            {/* Practice: the same exercises as the stage's, standalone */}
            <section id="practice" className="mt-12 scroll-mt-24 space-y-4" aria-labelledby="practice-heading">
              <div>
                <h2 id="practice-heading" className="font-display text-2xl font-medium">
                  {t("practice_heading")}
                </h2>
                <p className="mt-1 max-w-prose text-base text-ink-muted">{t("practice_intro")}</p>
              </div>
              <TapWord id={`${key}/tap`} words={playerWords} source={sources[0]} />
              <WhyHarakat id={`${key}/why`} words={a.words} pool={pool} />
              <SortCase id={`${key}/sort`} words={a.words} />
              <LabelRole id={`${key}/role`} words={a.words} pool={pool} />
              <WaznFactory id={`${key}/wazn`} lexemes={lexemes} />
            </section>

            {/* Learn more, each part collapsed again */}
            {hasDeeper && (
              <section className="mt-12" aria-labelledby="deeper">
                <h2 id="deeper" className="font-display text-2xl font-medium">
                  {t("deeper_heading")}
                </h2>
                <p className="mt-1 max-w-prose text-base text-ink-muted">{t("deeper_intro")}</p>
                <div className="mt-4 space-y-3">
                  {a.structure && (
                    <Deeper title={t("structure_heading")}>
                      <StructureSection
                        ayah={a}
                        conceptTitle={conceptTitle}
                        hideHeading
                        labels={{
                          heading: t("structure_heading"),
                          groups: t("structure_groups"),
                          sources: tw("sources"),
                        }}
                      />
                    </Deeper>
                  )}

                  {introduced.length > 0 && (
                    <Deeper
                      title={`${t("concepts_heading")} (${introduced.length})`}
                    >
                      <div className="@container">
                        <div className="grid gap-4 @2xl:grid-cols-2">
                          {introduced.map((c) => (
                            <ConceptCard
                              key={c.id}
                              concept={c}
                              labels={conceptLabels}
                              surahs={SURAH_INDEX}
                              wordAr={wordAr}
                              compact
                            />
                          ))}
                        </div>
                      </div>
                    </Deeper>
                  )}

                  {a.tafsir && (
                    <Deeper title={t("tafsir_heading")}>
                      <p className="max-w-prose text-pretty text-base text-ink">
                        <MixedText text={a.tafsir.text} />
                      </p>
                      <p className="mt-4 text-sm font-semibold text-ink">
                        {tw("sources")} ({a.tafsir.sources.length})
                      </p>
                      <div className="mt-1">
                        <SourceList sources={a.tafsir.sources} />
                      </div>
                    </Deeper>
                  )}

                  {facts.length > 0 && (
                    <Deeper
                      title={`${t("facts_heading")} (${facts.length})`}
                    >
                      <div className="@container">
                        <div className="grid gap-4 @2xl:grid-cols-2">
                          {facts.map((f) => (
                            <FactCard
                              key={f.id}
                              fact={f}
                              labels={{
                                method: t("fact_method"),
                                where: t("fact_where"),
                                sources: tw("sources"),
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </Deeper>
                  )}
                </div>
              </section>
            )}
          </MaterialsDisclosure>
        </div>

        {/* 4. Previous / next ayah: once, here. The stage's "Mulai" stays
            the one primary action on the page. */}
        {prev || next ? (
          <nav
            aria-label={t("nav_bottom")}
            className="mt-10 flex flex-wrap items-center justify-between gap-4"
          >
            {prev ? (
              <Link href={ayahHref(s.slug, prev.ayah)} className="btn-secondary min-h-14!">
                <ChevronLeft aria-hidden className="h-5 w-5" />
                {t("ayah", { n: prev.ayah })}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={ayahHref(s.slug, next.ayah)} className="btn-secondary min-h-14!">
                {t("ayah", { n: next.ayah })}
                <ChevronRight aria-hidden className="h-5 w-5" />
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
