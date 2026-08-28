import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { BookOpen } from "lucide-react";

import { ForestWash } from "@/components/ForestWash";
import { Link } from "@/i18n/navigation";
import { localeAlternates, SITE_URL } from "@/lib/seo";
import { TOPICS, getTopic, duasForTopic, corpusLabel } from "@/lib/doa";

/**
 * A du'a topic page — the ranking target of the Halaman Doa track.
 *
 * Fully static: `generateStaticParams` prerenders all 16, since the library
 * is a build-time JSON import that changes rarely.
 *
 * Canonical is pinned to `/id` (`canonicalLocale`) because this content is
 * Indonesian-only. Without pinning, `/en/doa/<topic>` would self-canonicalise
 * while serving the same body — the duplicate-mirror pattern already sitting
 * in GSC as 59 + 12 pages.
 */
export function generateStaticParams() {
  return TOPICS.map((t) => ({ topic: t.slug }));
}

type Props = { params: Promise<{ locale: string; topic: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, topic } = await params;
  const t = getTopic(topic);
  if (!t) return { title: { absolute: "Dakwah-Lens" } };
  const n = duasForTopic(topic).length;
  const title = `${t.query} — ${n} Doa Arab, Latin, dan Artinya`;
  const description =
    `Kumpulan ${n} doa ${t.lead}, lengkap dengan tulisan Arab, latin, ` +
    `dan terjemahan Indonesia. Setiap doa disertai rujukan haditsnya.`;
  return {
    title,
    description,
    alternates: localeAlternates({
      locale,
      canonicalPath: `/doa/${topic}`,
      hasEn: false,
      canonicalLocale: "id",
    }),
    openGraph: { title, description, type: "article" },
  };
}

export default async function DoaTopicPage({ params }: Props) {
  const { locale, topic } = await params;
  setRequestLocale(locale);

  const t = getTopic(topic);
  if (!t) notFound();
  const duas = duasForTopic(topic);
  if (duas.length === 0) notFound();

  const others = TOPICS.filter((x) => x.slug !== topic);

  // CollectionPage + ItemList: this is a curated set of works, not one article.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t.query,
    inLanguage: "id",
    url: `${SITE_URL}/id/doa/${topic}`,
    isPartOf: { "@type": "WebSite", name: "Dakwah-Lens", url: SITE_URL },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: duas.length,
      itemListElement: duas.map((d, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: d.citation,
      })),
    },
  };

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body text-ink">
      <ForestWash />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <article className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
          Pustaka Doa
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
          {t.query}
        </h1>

        <p className="mt-5 text-base leading-relaxed text-ink/80">
          Berikut {duas.length} doa {t.lead}, lengkap dengan tulisan Arab,
          bacaan latin, dan terjemahannya. Semua doa di halaman ini diambil
          dari kitab hadits — setiap doa dicantumkan rujukannya agar bisa
          ditelusuri sendiri, bukan sekadar disalin tanpa sumber.
        </p>

        {/* 31 citations are shared by 2-5 DISTINCT du'a (different fragments
            of one hadith), so `citation` is not a unique key — React would
            collapse siblings. Index-suffixed. */}
        <ol className="mt-10 space-y-10">
          {duas.map((d, i) => (
            <li key={`${d.citation}-${i}`} className="border-t border-ink/10 pt-8">
              <p
                dir="rtl"
                lang="ar"
                className="text-right font-arabic text-2xl leading-loose text-ink"
              >
                {d.arabic}
              </p>
              {d.transliteration ? (
                <p className="mt-4 text-sm italic leading-relaxed text-ink/70">
                  {d.transliteration}
                </p>
              ) : null}
              <p className="mt-3 text-base leading-relaxed text-ink/90">
                “{d.translation_id}”
              </p>
              <p className="mt-3 font-mono text-xs text-ink/55">
                {corpusLabel(d.corpus)} — {d.citation}
              </p>
            </li>
          ))}
        </ol>

        <section className="mt-16 border-t border-ink/10 pt-8">
          <h2 className="font-display text-xl text-ink">Doa lainnya</h2>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link
                  href={`/doa/${o.slug}`}
                  className="text-sm text-forest underline-offset-4 hover:underline"
                >
                  {o.query}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-12 flex items-start gap-2 text-xs leading-relaxed text-ink/55">
          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Teks Arab dan terjemahan diambil dari kitab hadits yang dirujuk.
            Bacaan latin disediakan sebagai alat bantu, bukan pengganti belajar
            membaca Arab dari guru.
          </span>
        </p>
      </article>
    </div>
  );
}
