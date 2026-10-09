import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ConceptCard } from "@/components/library/ConceptCard";
import { Link } from "@/i18n/navigation";
import { SURAH_INDEX, WORD_AR } from "@/lib/content";
import { getConcept, LIBRARY } from "@/lib/library";
import { conceptHref, conceptIndexHref } from "@/lib/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return LIBRARY.concepts.map((c) => ({ id: c.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/konsep/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: getConcept(id)?.title ?? "—" };
}

export default async function ConceptPage({ params }: PageProps<"/[locale]/konsep/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const concept = getConcept(id);
  if (!concept) notFound();
  const t = await getTranslations("Concept");
  const tw = await getTranslations("Word");
  const related = concept.related.flatMap((r) => {
    const c = getConcept(r);
    return c ? [c] : [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav aria-label={t("index_title")}>
        <Link href={conceptIndexHref()} className="chip-link">
          <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
          {t("index_title")}
        </Link>
      </nav>
      <h1 className="sr-only">{concept.title}</h1>
      <div className="mt-4">
        <ConceptCard
          concept={concept}
          surahs={SURAH_INDEX}
          wordAr={WORD_AR}
          labels={{
            nahwu: t("nahwu"),
            sharaf: t("sharaf"),
            bridge: t("bridge"),
            examples: t("examples"),
            more: t("more"),
            sources: tw("sources"),
            draft: tw("draft"),
          }}
        />
      </div>
      {related.length > 0 && (
        <section className="mt-10" aria-labelledby="related">
          <h2 id="related" className="font-display text-2xl font-medium">
            {t("related")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {related.map((c) => (
              <li key={c.id}>
                <Link href={conceptHref(c.id)} className="chip-link">
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
