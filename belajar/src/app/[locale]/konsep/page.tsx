import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

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
      <p className="mt-2 text-pretty leading-relaxed text-ink-muted">{t("index_intro")}</p>
      {groups.map(({ kind, items }) =>
        items.length ? (
          <section key={kind} className="mt-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              {t(kind)}
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {items.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/konsep/${c.id}`}
                    className="block h-full rounded-2xl border border-hairline bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <p className="font-display text-lg font-medium">{c.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{c.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </div>
  );
}
