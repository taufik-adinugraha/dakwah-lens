import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Breadcrumb } from "@/components/Breadcrumb";
import { LabelRole } from "@/components/exercises/LabelRole";
import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WaznFactory } from "@/components/exercises/WaznFactory";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import { DraftChip } from "@/components/lesson/DraftChip";
import { LessonStage, WordListenButton } from "@/components/lesson/LessonStage";
import { WordCard } from "@/components/lesson/WordCard";
import { ConceptCard } from "@/components/library/ConceptCard";
import { SourceList } from "@/components/library/SourceList";
import { StructureSection } from "@/components/library/StructureSection";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { getAyah, getSurah, SURAHS } from "@/lib/content";
import { buildLessonSteps } from "@/lib/lessonSteps";
import { conceptsIntroducedIn, getConcept, getLexeme, LIBRARY } from "@/lib/library";
import { ayahHref, hubHref, quranHref, surahHref } from "@/lib/routes";

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

const RECITER_ORDER = ["Alafasy_128kbps", "Husary_Muallim_128kbps"];
const reciterRank = (id: string) => {
  const i = RECITER_ORDER.indexOf(id);
  return i === -1 ? RECITER_ORDER.length : i;
};

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
 * One row of "Pelajari lebih dalam": a collapsed 48px disclosure. A record
 * still awaiting review says so on the row itself, so the draft status is
 * visible before opening; the full marker sits on the record inside.
 */
function Deeper({ title, draft, children }: { title: string; draft?: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-hairline bg-white">
      <summary className="disclosure-row px-5 py-2 text-ink">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{title}</span>
          {draft ? (
            <span className="rounded-full border border-notice bg-notice-bg px-2.5 py-0.5 text-xs font-medium text-notice">
              {draft}
            </span>
          ) : null}
        </span>
        <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
      </summary>
      <div className="px-5 pt-1 pb-5">{children}</div>
    </details>
  );
}

/**
 * Lesson page, in the order a learner needs it (senior-ux §3.6): where am I
 * → the ayah, its translation and the guided lesson (one stage, one player)
 * → word by word → practice → "learn more" behind collapsed rows → the next
 * ayah. Nothing gives positional instructions ("di atas"); every citation
 * stays one tap away.
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
  const tg = await getTranslations("Guided");
  const tp = await getTranslations("Player");
  const tb = await getTranslations("Breadcrumb");

  const playerWords = a.words.map((w, i) => ({
    index: i + 1,
    ar: w.ar,
    translit: w.translit,
    gloss: w.gloss,
  }));
  // Default reciter: Mishary Alafasy (operator's choice, 2026-10-09); Husary
  // Mu'allim stays available for its built-in "repeat after me" gaps.
  const sources = [...a.recitation]
    .sort((x, y) => reciterRank(x.reciter) - reciterRank(y.reciter))
    .map((r) => ({
      reciter: r.reciter,
      url: r.url,
      segments: r.segments,
      credit: r.credit,
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
  const steps = buildLessonSteps(a, introduced, {
    intro: (n) => tg("intro", { n }),
    wordIntro: (translit) => tg("word_intro", { translit }),
    meaning: (gloss) => tg("meaning", { gloss }),
    concept: (title, summary) => tg("concept", { title, summary }),
    conceptBrief: (title) => tg("concept_brief", { title }),
    structure: (summary) => tg("structure", { summary }),
    practice: tg("practice"),
    recap: tg("recap"),
  });
  const conceptTitle = Object.fromEntries(LIBRARY.concepts.map((c) => [c.id, c.title]));
  const wordAr = Object.fromEntries(s.ayat.flatMap((x) => x.words.map((w) => [w.loc, w.ar])));
  const conceptLabels = {
    nahwu: tc("nahwu"),
    sharaf: tc("sharaf"),
    bridge: tc("bridge"),
    examples: tc("examples"),
    more: tc("more"),
    sources: tw("sources"),
    draft: tw("draft"),
  };
  const draftTag = t("draft_short");
  const hasDeeper = !!a.structure || introduced.length > 0 || !!a.tafsir || facts.length > 0;

  const translation = (
    <figure>
      <blockquote className="text-pretty text-base text-ink">“{a.translation.text}”</blockquote>
      {a.translation.footnotes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-ink-muted">
          {a.translation.footnotes.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      <figcaption className="mt-2 text-xs text-ink-soft">
        {a.translation.source_label}
        {a.translation.version ? ` · ${a.translation.version}` : ""}
      </figcaption>
    </figure>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      {/* 1. Where am I. The breadcrumb's surah crumb is the way back to
          the list of ayat (it replaced the separate "‹ Daftar ayat" chip,
          so there is one control per destination). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Breadcrumb
          label={tb("label")}
          items={[
            { label: tb("hub"), href: hubHref() },
            { label: tb("quran"), href: quranHref() },
            { label: s.name_id, href: surahHref(s.slug) },
            { label: t("ayah", { n: a.ayah }) },
          ]}
        />
        {prev || next ? (
          <nav aria-label={t("nav_top")} className="flex flex-wrap gap-2">
            {prev ? (
              <Link href={ayahHref(s.slug, prev.ayah)} className="chip-link">
                <ChevronLeft aria-hidden className="h-5 w-5" />
                {t("ayah", { n: prev.ayah })}
              </Link>
            ) : null}
            {next ? (
              <Link href={ayahHref(s.slug, next.ayah)} className="chip-link">
                {t("ayah", { n: next.ayah })}
                <ChevronRight aria-hidden className="h-5 w-5" />
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
      <h1 className="mt-4 font-display text-3xl font-medium">{pageTitle}</h1>
      <p className="mt-1 text-base text-ink-muted">{t("ayah_of", { n: a.ayah, total: s.ayat.length })}</p>

      {/* 2. The stage: ayah, translation, guided lesson — one player */}
      <div className="mt-5">
        <LessonStage
          lessonId={key}
          title={pageTitle}
          ayah={a.ayah}
          words={playerWords}
          sources={sources}
          steps={steps}
          translation={translation}
        />
      </div>

      {/* 3. Word by word */}
      <section className="mt-12" aria-labelledby="words">
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
                  draft: tw("draft"),
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 4. Practice */}
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
        <WaznFactory
          id={`${key}/wazn`}
          lexemes={[...new Set(a.words.map((w) => w.lemma_id).filter((x): x is string => !!x))].flatMap((lid) => {
            const lx = getLexeme(lid);
            return lx?.tashrif ? [lx] : [];
          })}
        />
      </section>

      {/* 5. Learn more, collapsed */}
      {hasDeeper && (
        <section className="mt-12" aria-labelledby="deeper">
          <h2 id="deeper" className="font-display text-2xl font-medium">
            {t("deeper_heading")}
          </h2>
          <p className="mt-1 max-w-prose text-base text-ink-muted">{t("deeper_intro")}</p>
          <div className="mt-4 space-y-3">
            {a.structure && (
              <Deeper title={t("structure_heading")} draft={a.structure.status === "draft" ? draftTag : undefined}>
                <StructureSection
                  ayah={a}
                  conceptTitle={conceptTitle}
                  hideHeading
                  labels={{
                    heading: t("structure_heading"),
                    groups: t("structure_groups"),
                    sources: tw("sources"),
                    draft: tw("draft"),
                  }}
                />
              </Deeper>
            )}

            {introduced.length > 0 && (
              <Deeper
                title={`${t("concepts_heading")} (${introduced.length})`}
                draft={introduced.some((c) => c.status === "draft") ? draftTag : undefined}
              >
                <div className="@container">
                  <div className="grid gap-4 @2xl:grid-cols-2">
                    {introduced.map((c) => (
                      <ConceptCard
                        key={c.id}
                        concept={c}
                        labels={conceptLabels}
                        surahSlug={s.slug}
                        wordAr={wordAr}
                        compact
                      />
                    ))}
                  </div>
                </div>
              </Deeper>
            )}

            {a.tafsir && (
              <Deeper title={t("tafsir_heading")} draft={a.tafsir.status === "draft" ? draftTag : undefined}>
                <p className="max-w-prose text-pretty text-base text-ink">{a.tafsir.text}</p>
                <p className="mt-4 text-sm font-semibold text-ink">
                  {tw("sources")} ({a.tafsir.sources.length})
                </p>
                <div className="mt-1">
                  <SourceList sources={a.tafsir.sources} />
                </div>
                {a.tafsir.status === "draft" ? <DraftChip label={tw("draft")} /> : null}
              </Deeper>
            )}

            {facts.length > 0 && (
              <Deeper
                title={`${t("facts_heading")} (${facts.length})`}
                draft={facts.some((f) => f.status === "draft") ? draftTag : undefined}
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
                          draft: tw("draft"),
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

      {/* 6. Previous / next ayah */}
      <nav
        aria-label={t("nav_bottom")}
        className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6"
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
          <Link href={ayahHref(s.slug, next.ayah)} className="btn-primary">
            {t("ayah", { n: next.ayah })}
            <ChevronRight aria-hidden className="h-5 w-5" />
          </Link>
        ) : (
          <Link href={surahHref(s.slug)} className="btn-primary">
            {t("back_to_surah")}
          </Link>
        )}
      </nav>
    </div>
  );
}
