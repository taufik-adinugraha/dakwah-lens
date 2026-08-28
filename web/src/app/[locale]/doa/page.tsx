import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { ForestWash } from "@/components/ForestWash";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/lib/seo";
import { TOPICS, DUAS, duasForTopic } from "@/lib/doa";

/** Index for the du'a topic pages. See `docs/doa-pages-plan.md`. */
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const title = `Kumpulan Doa Harian — Arab, Latin, dan Artinya`;
  const description =
    `${DUAS.length} doa dari kitab hadits, dikelompokkan per tema: rezeki, ` +
    `ampunan, perlindungan, kesembuhan, dan lainnya. Lengkap dengan tulisan ` +
    `Arab, latin, terjemahan, dan rujukan haditsnya.`;
  return {
    title,
    description,
    alternates: localeAlternates({
      locale,
      canonicalPath: "/doa",
      hasEn: false,
      canonicalLocale: "id",
    }),
    openGraph: { title, description, type: "website" },
  };
}

export default async function DoaIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="relative isolate overflow-hidden bg-paper font-body text-ink">
      <ForestWash />
      <section className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/50">
          Pustaka Doa
        </p>
        <h1 className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
          Kumpulan Doa Harian
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink/80">
          {DUAS.length} doa yang bersumber dari kitab hadits, dikelompokkan
          menurut kebutuhan sehari-hari. Setiap doa disertai tulisan Arab,
          bacaan latin, terjemahan, dan rujukan haditsnya — supaya bisa
          ditelusuri sendiri.
        </p>

        <ul className="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {TOPICS.map((t) => (
            <li key={t.slug} className="border-t border-ink/10 pt-4">
              <Link href={`/doa/${t.slug}`} className="group block">
                <span className="font-display text-lg text-ink group-hover:text-forest">
                  {t.query}
                </span>
                <span className="mt-1 block text-sm text-ink/60">
                  {duasForTopic(t.slug).length} doa · {t.lead}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
