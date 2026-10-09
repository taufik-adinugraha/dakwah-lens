import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ConceptCard } from "@/components/library/ConceptCard";
import { Link } from "@/i18n/navigation";
import { SURAHS } from "@/lib/content";
import { getConcept, LIBRARY } from "@/lib/library";

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
  // v1 has one surah; examples are word locs within it.
  const surah = SURAHS[0];
  const wordAr = Object.fromEntries(surah.ayat.flatMap((a) => a.words.map((w) => [w.loc, w.ar])));
  const related = concept.related.flatMap((r) => {
    const c = getConcept(r);
    return c ? [c] : [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-sm text-ink-muted">
        <Link href="/konsep" className="hover:text-ink">
          {t("index_title")}
        </Link>
      </nav>
      <div className="mt-3">
        <ConceptCard
          concept={concept}
          surahSlug={surah.slug}
          wordAr={wordAr}
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
        <section className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{t("related")}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/konsep/${c.id}`}
                  className="inline-flex rounded-full border border-hairline bg-white px-3 py-1 text-sm hover:bg-paper-deep"
                >
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
