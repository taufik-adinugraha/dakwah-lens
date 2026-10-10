import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestGlow } from "@/components/ForestGlow";
import { ConceptCard } from "@/components/library/ConceptCard";
import { HarakatChart } from "@/components/library/HarakatChart";
import { SourcesDisclosure } from "@/components/library/SourceList";
import { Headword, TermText } from "@/components/library/TermText";
import type { Basic, Concept } from "@/content/schema";
import { Link } from "@/i18n/navigation";
import { SURAH_INDEX, WORD_AR, WORD_INFO } from "@/lib/content";
import { getBasic, getConcept, LIBRARY, TERMS } from "@/lib/library";
import { conceptHref, conceptIndexHref } from "@/lib/routes";
import { annotate, prepareSigns, Scope, soundsOf, titleParts } from "@/lib/terms";

export const dynamicParams = false;

export function generateStaticParams() {
  return [...LIBRARY.basics.map((b) => ({ id: b.id })), ...LIBRARY.concepts.map((c) => ({ id: c.id }))];
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/konsep/[id]">): Promise<Metadata> {
  const { id } = await params;
  // The plain title (no markup, no Arabic) names the browser tab.
  return { title: getBasic(id)?.title ?? getConcept(id)?.title ?? "—" };
}

/**
 * One Konsep page (operator 2026-10-10: Arabic with every term, examples from the ayah's own
 * bytes, harakat for beginners, words by their parts, less clutter): the module's forest glow
 * behind ONE focused reading column, the concept on the lesson stage's card, related concepts
 * as chips with their Arabic headword. /konsep/harakat is the foundation page (Dasar membaca).
 * One first-use scope for the whole page: a term shows its Arabic once.
 */
export default async function ConceptPage({ params }: PageProps<"/[locale]/konsep/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const basic = getBasic(id);
  const concept = basic ? undefined : getConcept(id);
  if (!basic && !concept) notFound();
  const t = await getTranslations("Concept");
  const tw = await getTranslations("Word");
  const relatedIds = (basic ?? concept)!.related;
  const related = relatedIds.flatMap((r) => {
    const c = getConcept(r);
    return c ? [c] : [];
  });

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <nav aria-label={t("index_title")}>
          <Link href={conceptIndexHref()} className="chip-link bg-white">
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            {t("index_title")}
          </Link>
        </nav>
        <div className="mt-5">
          {basic ? (
            <BasicArticle
              basic={basic}
              labels={{
                dasar: t("dasar"),
                signs: t("signs_heading"),
                sound: t("sign_sound"),
                example: t("sign_example"),
                from: t("sign_from"),
                sources: tw("sources"),
              }}
            />
          ) : (
            <ConceptCard
              concept={concept!}
              surahs={SURAH_INDEX}
              wordAr={WORD_AR}
              page
              scope={new Scope()}
              labels={{
                nahwu: t("nahwu"),
                sharaf: t("sharaf"),
                bridge: t("bridge"),
                examples: t("examples"),
                more: t("more"),
                sources: tw("sources"),
              }}
            />
          )}
        </div>
        {related.length > 0 && <Related concepts={related} heading={t("related")} />}
      </div>
    </div>
  );
}

/** The Harakat page: what each sign looks like, its sound, an example letter from the ayat. */
function BasicArticle({
  basic,
  labels,
}: {
  basic: Basic;
  labels: { dasar: string; signs: string; sound: string; example: string; from: string; sources: string };
}) {
  // Its own subject: no "tanda bunyi … " reminders and no links back to itself.
  const sc = new Scope(false);
  const mk = basic.marked;
  const title = mk ? titleParts(mk.title, sc, TERMS, soundsOf(basic.signs)) : { tokens: [{ kind: "text" as const, text: basic.title }], head: [] };
  const summary = mk ? annotate(mk.summary, sc, TERMS) : [{ kind: "text" as const, text: basic.summary }];
  const explanation = (mk?.explanation ?? basic.explanation).map((p) =>
    mk ? annotate(p, sc, TERMS) : [{ kind: "text" as const, text: p }],
  );
  const signs = prepareSigns(basic.signs, TERMS);
  return (
    <article className="stage-card p-5 sm:p-8">
      <p className="text-sm font-semibold text-forest">{labels.dasar}</p>
      <h1 className="mt-1 text-balance font-display text-3xl font-medium text-ink sm:text-4xl">
        <TermText tokens={title.tokens} links={false} />
      </h1>
      <Headword head={title.head} className="mt-2 text-ar-lg" />
      <p className="mt-4 max-w-prose text-pretty text-lg text-ink">
        <TermText tokens={summary} links={false} />
      </p>
      <section className="mt-6" aria-labelledby="signs">
        <h2 id="signs" className="sr-only">
          {labels.signs}
        </h2>
        <HarakatChart
          signs={signs}
          words={WORD_INFO}
          labels={{ sound: labels.sound, example: labels.example, from: labels.from }}
        />
      </section>
      <div className="mt-6 max-w-prose space-y-4 text-pretty text-base text-ink">
        {explanation.map((p, i) => (
          <p key={i}>
            <TermText tokens={p} links={false} />
          </p>
        ))}
      </div>
      <SourcesDisclosure sources={basic.sources} label={labels.sources} className="mt-6" />
    </article>
  );
}

function Related({ concepts, heading }: { concepts: Concept[]; heading: string }) {
  return (
    <section className="mt-10" aria-labelledby="related">
      <h2 id="related" className="font-display text-2xl font-medium">
        {heading}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {concepts.map((c) => {
          const { head } = c.marked ? titleParts(c.marked.title, new Scope(), TERMS) : { head: [] };
          return (
            <li key={c.id}>
              <Link href={conceptHref(c.id)} className="chip-link bg-white">
                <span>{c.title}</span>
                {head[0] ? (
                  <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm text-forest">
                    {head[0].ar}
                  </bdi>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
