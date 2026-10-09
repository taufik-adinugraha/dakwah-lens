import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { LIBRARY } from "@/lib/library";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/konsep">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Concept" });
  return { title: t("index_title") };
}

/** All nahwu & sharaf concepts — each explained once, reused by every lesson. */
export default async function ConceptIndex({ params }: PageProps<"/[locale]/konsep">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Concept");
  const groups = (["nahwu", "sharaf"] as const).map((kind) => ({
    kind,
    items: LIBRARY.concepts.filter((c) => c.kind === kind),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-medium">{t("index_title")}</h1>
      <p className="mt-2 max-w-prose text-pretty text-base text-ink-muted">{t("index_intro")}</p>
      {groups.map(({ kind, items }) =>
        items.length ? (
          <section key={kind} className="mt-10" aria-labelledby={`kind-${kind}`}>
            <h2 id={`kind-${kind}`} className="font-display text-2xl font-medium">
              {t(kind)}
            </h2>
            <div className="@container mt-4">
              <ul className="grid gap-4 @2xl:grid-cols-2">
                {items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/konsep/${c.id}`}
                      className="flex h-full flex-col rounded-2xl border border-hairline bg-white p-5 transition-colors hover:border-forest"
                    >
                      <span className="font-display text-lg font-medium text-ink">
                        <MixedText text={c.title} />
                      </span>
                      <span className="mt-1 text-base text-ink-muted">
                        <MixedText text={c.summary} />
                      </span>
                      <span className="mt-auto inline-flex items-center gap-1.5 pt-3 text-base font-semibold text-forest">
                        {t("more")}
                        <ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
