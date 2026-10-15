import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { lessonExamplesFor, stageSequence } from "@/components/autoplay/build";
import { BackLink } from "@/components/BackLink";
import { LabelRole } from "@/components/exercises/LabelRole";
import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WaznFactory } from "@/components/exercises/WaznFactory";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import { WordKind } from "@/components/exercises/WordKind";
import { ForestGlow } from "@/components/ForestGlow";
import { MainSiteBridge } from "@/components/MainSiteBridge";
import { ShareButton } from "@/components/ShareButton";
import { LessonStage, WordListenButton } from "@/components/lesson/LessonStage";
import { MaterialsDisclosure } from "@/components/lesson/MaterialsDisclosure";
import { WordCard } from "@/components/lesson/WordCard";
import { ConceptCard } from "@/components/library/ConceptCard";
import { StepCard } from "@/components/library/StepCard";
import { MixedText } from "@/components/library/MixedText";
import { SourceList } from "@/components/library/SourceList";
import { StructureSection } from "@/components/library/StructureSection";
import { AyahDialogProvider } from "@/components/surah/AyahDialog";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { surahNamesFor } from "@/lib/ayat";
import { composeFor } from "@/lib/compose-content";
import { getAyah, getSurah, SURAH_INDEX, SURAHS } from "@/lib/content";
import { primerAyah, stageExamples } from "@/lib/autoplay";
import { taughtAt, taughtBefore, ZERO_HOST } from "@/lib/curriculum";
import { getConcept, getLexeme, LIBRARY, TERMS } from "@/lib/library";
import { lessonMapInput } from "@/lib/map-content";
import { quizAyah } from "@/lib/quiz-content";
import { planOf } from "@/lib/quiz-plan";
import { ayahHref, introHref, surahHref } from "@/lib/routes";
import { lessonCard, translationExcerpt } from "@/lib/og/text";
import { alternatesFor, lessonShareable, pageUrl, shareMetadata } from "@/lib/share";
import { headwordOf, lessonLookup } from "@/lib/terms";
import { wordVoice } from "@/lib/wordvoice";

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

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/quran/[surah]/[ayah]">): Promise<Metadata> {
  const { locale, surah: slug, ayah } = await params;
  const s = getSurah(slug);
  const a = s ? getAyah(s, Number(ayah)) : undefined;
  if (!s || !a) return { title: "—" };
  const path = ayahHref(s.slug, a.ayah);
  const meta: Metadata = { title: `${s.name_id} ${ayah}`, alternates: alternatesFor(locale, path) };
  // Share preview (og:*, twitter:*) only for a lesson that may be shared: the one check,
  // lib/share.ts lessonShareable. Its card is this folder's og/route.ts.
  if (!lessonShareable(s.slug)) return meta;
  const to = await getTranslations({ locale, namespace: "Og" });
  const card = lessonCard(to, s, a);
  return {
    ...meta,
    ...shareMetadata({
      locale,
      path,
      title: `${card.title} · ${card.eyebrow}`,
      description: to("lesson_description", { translation: translationExcerpt(a.translation.text) }),
      imageAlt: to("lesson_image_alt", { surah: s.name_id, n: a.ayah }),
    }),
  };
}

/**
 * One row of "Pelajari lebih dalam": a collapsed 48px disclosure. No per-row
 * "Dibantu AI" tag: the operator removed those chips (2026-10-10) because each
 * record shows its Rujukan; the page footer carries the AI-assisted label.
 * Narrow side padding while "Materi lengkap" (a container) is narrower than
 * 18rem, i.e. from Besar up on a phone: the row sits in that card and holds
 * cards of its own, and at Sangat besar the nested paddings left a 192px column,
 * too narrow for words like "mencantumkannya" or "menerangkannya" (CI
 * 2026-10-11, rule 15: no word is cut, so the column must hold it).
 */
function Deeper({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-hairline bg-white">
      <summary className="disclosure-row px-3 py-2 text-ink @2xs:px-5">
        <span>{title}</span>
        <ChevronDown aria-hidden className="chev h-5 w-5 shrink-0 text-forest" />
      </summary>
      <div className="px-3 pt-1 pb-5 @2xs:px-5">{children}</div>
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
 * content unchanged, and last two links to the main site → the ayah
 * navigation, once, at the bottom → one "Bagikan" under it. The forest
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
  const tm = await getTranslations("MainSite");
  const tshare = await getTranslations("Share");
  const ti = await getTranslations("Intro");

  const playerWords = a.words.map((w, i) => ({
    index: i + 1,
    ar: w.ar,
    translit: w.translit,
    gloss: w.gloss,
  }));
  // One imam everywhere, and no reciter setting (operator 2026-10-13: "better to use alafasy for
  // all? no need to give option to user to change"; plan L21): the ayah's one recitation, Mishary
  // Alafasy's (the content has exactly one, schema.ts). Its credit line is on the Kredit page
  // (kredit/page.tsx). The stage plays it for the WHOLE ayah. A word heard on its own — the
  // standalone "Dengar dan klik", a word card's "Dengar", every word step of the stage — is the
  // narrator Kang Nandar's recording of it, an AI voice (operator 2026-10-14; src/lib/wordvoice.ts),
  // never this recording cut at the word.
  const [recitation] = a.recitation;
  const source = { url: recitation.url, segments: recitation.segments };
  const tapWords = playerWords.map((w) => ({ ...w, voice: wordVoice(w.ar) }));
  // The ayah's quiz (content/quiz, pipeline/build_quiz.py): every exercise asks only what the
  // lesson has taught by this ayah, with wrong options from the ayat already studied (operator
  // 2026-10-10: "make sure all questions in quiz already have lesson beforehand"). The stage and
  // the standalone copies below ask the same questions.
  const quiz = quizAyah(s.slug, a.ayah);
  const kindPlan = planOf(quiz, "word-kind");
  const tapPlan = planOf(quiz, "tap-word");
  const whyPlan = planOf(quiz, "why-harakat");
  const sortPlan = planOf(quiz, "sort-case");
  const rolePlan = planOf(quiz, "label-role");
  const waznPlan = planOf(quiz, "wazn-factory");
  const facts = s.facts.filter((f) => f.locations.includes(a.loc));
  const prev = getAyah(s, n - 1);
  const next = getAyah(s, n + 1);
  // Storage key for lesson/exercise progress, not a URL: unchanged by the
  // move under /quran so saved progress survives it.
  const key = `${s.slug}/${a.ayah}`;
  const pageTitle = `${s.name_id} · ${t("ayah", { n: a.ayah })}`;
  // What this ayah's lesson teaches as "Konsep baru": the curriculum's steps (operator-approved
  // 2026-10-13, plan L26; at most three), each a whole Konsep record or a step's own text.
  const introduced = taughtAt(a);
  // The autoplay lesson of this ayah (src/lib/autoplay), built here at build
  // time: captions in the page's locale, narration audio from
  // content/narration/ when it has been rendered.
  const seq = stageSequence(s, a, locale);
  // The example beats' drawing (operator 2026-10-12: "each explanation should be followed by
  // examples (visual + voice)"; plan L20): each example's Arabic, exactly the content's bytes, its
  // transliteration and meaning, by beat id; the sequence above carries their captions only.
  const examples = stageExamples(lessonExamplesFor(s, a).examples);
  // The word compositions and the harakat primer of this ayah (content/compose,
  // operator 2026-10-10, narration rule 14): the bytes the stage's animation
  // shows, by word number; the sequence above carries only their lines.
  const composeFile = composeFor(s.slug);
  const compose = composeFile
    ? {
        marks: composeFile.marks,
        // The primer opens the lesson of its own ayah — unless it is lesson zero's (Al-Fatihah's
        // is, since 2026-10-13: /quran/pengantar plays it, and ayah 1 no longer does).
        primer: composeFile.primer && primerAyah(composeFile.primer) === a.ayah ? composeFile.primer : null,
        words: Object.fromEntries(
          a.words.flatMap((w, i) => (composeFile.words[w.loc] ? [[i + 1, composeFile.words[w.loc]]] : [])),
        ),
      }
    : null;
  const lexemes = [...new Set(a.words.map((w) => w.lemma_id).filter((x): x is string => !!x))].flatMap((lid) => {
    const lx = getLexeme(lid);
    return lx?.tashrif ? [lx] : [];
  });
  // For the end card of a surah's last ayah: the surahs after it. Which of
  // them are published (BELAJAR_SURAHS) is read per request, and this page is
  // prerendered, so the stage asks /belajar/api/surahs in the browser and
  // offers only a published one; at the end of Al-Fatihah, while it is the
  // only one, the card says the next surah is coming soon (operator,
  // 2026-10-10).
  const surahIdx = SURAHS.findIndex((x) => x.slug === s.slug);
  const following = next ? [] : SURAHS.slice(surahIdx + 1).map((x) => ({ slug: x.slug, name: x.name_id }));
  const conceptTitle = Object.fromEntries(LIBRARY.concepts.map((c) => [c.id, c.title]));
  // A marked lesson's word cards, structure and facts draw their Arabic (operator 2026-10-12:
  // terms and Qur'anic words in Arabic, "not only the transliteration"): the library's terms and
  // bytes with the lesson's own; a concept chip carries its title's Arabic headword.
  const lookup = lessonLookup(TERMS, s);
  const conceptHead = Object.fromEntries(LIBRARY.concepts.map((c) => [c.id, headwordOf(c.marked?.title, TERMS)]));
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
  // The lesson map of this ayah (operator 2026-10-13, plan L23 and L26), for a surah that has one:
  // the stage's cards. With it, a word card marks a concept an EARLIER lesson of the curriculum
  // taught, under its chip: "sudah dipelajari di ayat 1" — for a record that arrives in parts
  // (i'rab), the part this word shows (its state). Text only; nothing for a next-level record.
  // A step of LESSON ZERO (the three kinds of word) says "sudah dipelajari di Pengantar", and
  // links that lesson (main session 2026-10-13) — in the surah that hosts it only: this page is
  // prerendered and cannot ask which surahs are published (lib/curriculum.ts introOpen), but a
  // visitor reading the host surah's page has that surah published, so the one rule holds.
  const lessonMap = lessonMapInput(s.slug, a.ayah);
  const taughtNote = (w: (typeof a.words)[number], record: string): { text: string; href: string | null } | null => {
    const at = lessonMap ? taughtBefore(a, w, record) : null;
    if (!at) return null;
    if (at.zero) return { text: tw("concept_taught_intro"), href: ZERO_HOST?.slug === s.slug ? introHref() : null };
    return { text: at.surah === s.surah ? tw("concept_taught", { n: at.ayah }) : tw("concept_taught_surah", { surah: at.surah, ayah: at.ayah }), href: null };
  };

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
      {/* No source line under the translation (operator 2026-10-12: "remove this line, to make
          the space more clean"): the translation is credited on the Kredit page (lib/sources.ts,
          QuranEnc), linked from the Menu, and its version is in "Versi data" there. */}
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
        {/* One quiet line for someone who lands on the first ayah first (2026-10-13): the harakat
            primer is lesson zero's now, so this lesson starts with two things already learnt. */}
        {ZERO_HOST?.slug === s.slug && a.ayah === s.ayat[0].ayah && (
          <p data-intro-hint className="mt-1 text-base text-ink-muted">
            {ti("ayah1_question")}{" "}
            <Link href={introHref()} className="link-text font-medium">
              {ti("ayah1_link")}
            </Link>
          </p>
        )}

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
            following={following}
            words={playerWords}
            source={source}
            translation={translation}
            exercise={{ words: a.words, lexemes, quiz }}
            compose={compose && (compose.primer || Object.keys(compose.words).length) ? compose : null}
            examples={examples}
            marks={composeFile?.marks ?? null}
            // The lesson map's card (operator 2026-10-13, plan L23 and L26): what this ayah brings,
            // one group at a time, and what it taught, for a surah that has a map (content/map);
            // the sequence above has its steps.
            lessonMap={lessonMap}
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
                  size grows (rem in @media ignores the root size). grid-cols-1, not
                  the implicit auto column: a card never grows past the page to fit a
                  long kept-together word, the word breaks in the flow instead
                  (src/lib/lineFit.ts; CI 2026-10-11: the page scrolled sideways). */}
              <div className="@container mt-4">
                <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
                  {a.words.map((w, i) => (
                    <WordCard
                      key={w.loc}
                      word={w}
                      lexeme={w.lemma_id ? getLexeme(w.lemma_id) : undefined}
                      concepts={w.concepts.flatMap((id) => {
                        const c = getConcept(id);
                        const note = c ? taughtNote(w, c.id) : null;
                        return c ? [{ id: c.id, title: c.title, head: conceptHead[c.id], taught: note?.text ?? null, taughtHref: note?.href ?? null }] : [];
                      })}
                      lookup={lookup}
                      listen={
                        wordVoice(w.ar) ? (
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
              {kindPlan && <WordKind id={`${key}/kind`} words={a.words} questions={kindPlan.questions} kinds={quiz.kinds} />}
              {tapPlan && <TapWord id={`${key}/tap`} words={tapWords} questions={tapPlan.questions} />}
              {whyPlan && <WhyHarakat id={`${key}/why`} words={a.words} questions={whyPlan.questions} states={quiz.states} />}
              {sortPlan && (
                <SortCase id={`${key}/sort`} words={a.words} questions={sortPlan.questions} bins={sortPlan.bins} states={quiz.states} />
              )}
              {rolePlan && <LabelRole id={`${key}/role`} words={a.words} questions={rolePlan.questions} />}
              {waznPlan && <WaznFactory id={`${key}/wazn`} lexemes={lexemes} questions={waznPlan.questions} labels={quiz.labels} />}
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
                        conceptHead={conceptHead}
                        lookup={lookup}
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
                        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                          {introduced.map((it) => {
                            // A whole Konsep record: its own card. A step with its own text (a
                            // part of a record, or no record): the same card from that text.
                            const record = it.whole && it.concept ? getConcept(it.concept) : undefined;
                            return record ? (
                              <ConceptCard key={it.id} concept={record} labels={conceptLabels} surahs={SURAH_INDEX} wordAr={wordAr} compact />
                            ) : (
                              <StepCard key={it.id} taught={it} labels={{ more: tc("more"), sources: tw("sources") }} />
                            );
                          })}
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
                      {/* Location chips open the ayah in a dialog (operator 2026-10-12). */}
                      <AyahDialogProvider names={surahNamesFor(facts.flatMap((f) => f.locations))}>
                        <div className="@container">
                          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                            {facts.map((f) => (
                              <FactCard
                                key={f.id}
                                fact={f}
                                lookup={lookup}
                                labels={{
                                  method: t("fact_method"),
                                  where: t("fact_where"),
                                  sources: tw("sources"),
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </AyahDialogProvider>
                    </Deeper>
                  )}
                </div>
              </section>
            )}

            {/* More on the main site (operator, 2026-10-10): two labelled
                links, inside this collapsed row, so the stage stays the one
                focus of the page. */}
            <section className="mt-12" aria-labelledby="main-site">
              <h2 id="main-site" className="font-display text-2xl font-medium">
                {tm("materials_heading")}
              </h2>
              <div className="mt-2 space-y-1">
                <MainSiteBridge id="ayah_kitab" />
                <MainSiteBridge id="ayah_khutbah" />
              </div>
            </section>
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

        {/* 5. One "Bagikan", under the ayah navigation, outside the stage
            (operator, 2026-10-10: one focused stage; sharing comes after
            the lesson). Only for a lesson that may be shared: the one check,
            lib/share.ts lessonShareable. */}
        {lessonShareable(s.slug) ? (
          <ShareButton
            className="mt-8"
            url={pageUrl(locale, ayahHref(s.slug, a.ayah))}
            text={tshare("lesson_text", { surah: s.name_id, n: a.ayah })}
          />
        ) : null}
      </div>
    </div>
  );
}
