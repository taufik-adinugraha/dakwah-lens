import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SURAHS } from "@/lib/content";
import { visibleSurahs } from "@/lib/features";
import { LIBRARY } from "@/lib/library";
import { SOURCES } from "@/lib/sources";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/kredit">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Credits" });
  return { title: t("title") };
}

/** Pinned data inputs, as the content pipeline wrote them into content/. */
function VersionList({ title, versions }: { title: string; versions: Record<string, string> }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <dl className="mt-2 divide-y divide-hairline rounded-xl border border-hairline bg-white">
        {Object.entries(versions).map(([k, v]) => (
          <div key={k} className="px-4 py-2">
            <dt className="text-sm font-medium text-ink-muted">{k}</dt>
            <dd className="break-all font-mono text-xs text-ink-soft">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default async function CreditsPage({
  params,
}: PageProps<"/[locale]/kredit">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Credits");
  // Only the surahs BELAJAR_SURAHS publishes (operator, 2026-10-10: Al-Fatihah
  // first; lib/features.ts), read per request, so this page renders at
  // request time.
  const published = new Set(await visibleSurahs());
  const surahs = SURAHS.filter((s) => published.has(s.slug));
  // The exact credit line of every recording the lesson pages stream (moved
  // here from the lesson stage, operator 2026-10-10), once each, in the
  // order the content lists them.
  const recitationCredits = [
    ...new Set(surahs.flatMap((s) => s.ayat.flatMap((a) => a.recitation.map((r) => r.credit)))),
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-medium">{t("title")}</h1>
      <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted">
        {t("intro")}
      </p>
      <ul className="mt-8 space-y-4">
        {SOURCES.map((s) => (
          <li
            key={s.name}
            className="rounded-2xl border border-hairline bg-white p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-lg font-semibold">{s.name}</p>
              <span className="rounded-full bg-paper-deep px-3 py-0.5 text-sm font-medium text-ink-muted">
                {s.status === "in_use" ? t("status_in_use") : t("status_planned")}
              </span>
            </div>
            <p className="mt-1 text-base text-ink-muted">{s.role}</p>
            <p className="mt-2 text-sm text-ink-muted">{s.licence}</p>
            <a
              href={s.url}
              className="link-text inline-flex min-h-11 items-center text-sm"
              rel="noopener"
            >
              {s.credit}
            </a>
          </li>
        ))}
      </ul>
      {recitationCredits.length > 0 && (
        <section className="mt-8" aria-labelledby="recitations">
          <h2 id="recitations" className="text-lg font-semibold text-ink">
            {t("recitation_heading")}
          </h2>
          <p className="mt-1 max-w-prose text-base text-ink-muted">{t("recitation_body")}</p>
          <ul className="mt-3 space-y-2">
            {recitationCredits.map((c) => (
              <li key={c} className="rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-8 rounded-2xl bg-paper-deep p-5 text-base text-ink-muted">
        {t("streaming_note")}
      </p>

      {/* Developer-facing provenance, moved off the learner pages
          (senior-ux.md §3.6) but kept public and one tap away. */}
      <section className="mt-10" aria-labelledby="data-versions">
        <h2 id="data-versions" className="font-display text-2xl font-medium">
          {t("data_versions_heading")}
        </h2>
        <p className="mt-2 max-w-prose text-base text-ink-muted">
          {t("data_versions_body")}
        </p>
        <details className="mt-4 rounded-2xl border border-hairline bg-white px-5">
          <summary className="disclosure-row text-ink">
            {t("data_versions_summary")}
            <ChevronDown className="chev h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
          </summary>
          <div className="space-y-6 pb-5 pt-2">
            {surahs.map((s) => (
              <VersionList key={s.slug} title={s.name_id} versions={s.data_versions} />
            ))}
            <VersionList title={t("data_versions_library")} versions={LIBRARY.data_versions} />
          </div>
        </details>
      </section>
    </div>
  );
}
