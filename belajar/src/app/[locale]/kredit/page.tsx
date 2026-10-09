import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SOURCES } from "@/lib/sources";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/kredit">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Credits" });
  return { title: t("title") };
}

export default async function CreditsPage({
  params,
}: PageProps<"/[locale]/kredit">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Credits");

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium">{t("title")}</h1>
      <p className="mt-3 text-pretty leading-relaxed text-ink-muted">
        {t("intro")}
      </p>
      <ul className="mt-8 space-y-4">
        {SOURCES.map((s) => (
          <li
            key={s.name}
            className="rounded-2xl border border-hairline bg-white p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{s.name}</p>
              <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                {s.status === "in_use" ? t("status_in_use") : t("status_planned")}
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">{s.role}</p>
            <p className="mt-2 text-xs text-ink-muted">
              {s.licence} ·{" "}
              <a href={s.url} className="underline hover:text-ink" rel="noopener">
                {s.credit}
              </a>
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-8 rounded-2xl bg-paper-deep p-4 text-sm leading-relaxed text-ink-muted">
        {t("streaming_note")}
      </p>
    </div>
  );
}
