import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestGlow } from "@/components/ForestGlow";
import { MixedText } from "@/components/library/MixedText";
import { Link } from "@/i18n/navigation";
import { kosakataIndex } from "@/lib/kosakata";
import { MILESTONES, pageCount, pageOfRank, pageRows, parsePage, percent, searchRows } from "@/lib/kosakata-core";
import { kosakataHref, kosakataWordHref } from "@/lib/routes";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Kosakata" });
  return { title: t("title") };
}

/**
 * The Qur'an vocabulary list (operator 2026-11-03: every word of the Qur'an, ranked by frequency
 * only, meanings in Indonesian and English). A page of 100 words at a time (`?hal=`) or the search
 * (`?q=`), both answered on the server from the light index, with a plain GET form: no script, and
 * nothing of the 4,832 rows reaches the browser but the ones shown.
 */
export default async function KosakataPage({ params, searchParams }: PageProps<"/[locale]/kosakata">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Kosakata");
  const { hal, q } = await searchParams;
  const { rows, total_tokens: tokens } = kosakataIndex();
  const total = rows.length;
  const query = typeof q === "string" ? q.trim().slice(0, 60) : "";
  const page = parsePage(hal, total);
  const pages = pageCount(total);
  const found = query ? searchRows(rows, query) : null;
  const shown = found ? found.rows : pageRows(rows, page);
  const nf = new Intl.NumberFormat(locale);

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-4xl">
          <MixedText text={t("title")} />
        </h1>
        <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted">
          <MixedText text={t("intro", { total })} />
        </p>

        {/* On a search the results come first: the figures would push them below the fold. */}
        {found ? null : (
          <section className="mt-8" aria-labelledby="reach">
            <h2 id="reach" className="text-lg font-semibold text-ink">
              {t("reach_heading")}
            </h2>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {MILESTONES.map((n) => (
                <li key={n}>
                  <Link
                    href={`${kosakataHref()}?hal=${pageOfRank(n)}`}
                    className="block rounded-2xl border border-hairline bg-white p-3 transition-shadow hover:shadow-sm"
                  >
                    <span className="block text-sm text-ink-muted">{t("reach_words", { n })}</span>
                    <span className="mt-0.5 block font-display text-2xl font-medium text-forest tabular-nums">
                      {t("reach_percent", { pct: nf.format(percent(rows[n - 1].cum)) })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 max-w-prose text-sm text-ink-soft">
              <MixedText text={t("reach_note", { tokens })} />
            </p>
          </section>
        )}

        <form role="search" action={`/belajar/${locale}/kosakata`} className="mt-8">
          <label htmlFor="kosakata-q" className="text-sm font-semibold text-ink">
            {t("search_label")}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="kosakata-q"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={60}
              placeholder={t("search_placeholder")}
              className="min-h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-white px-4 text-base text-ink"
            />
            <button type="submit" className="chip-link min-h-12! cursor-pointer bg-white">
              <Search aria-hidden className="size-4" />
              {t("search_button")}
            </button>
          </div>
        </form>

        <section className="mt-6" aria-live="polite">
          <p className="text-sm font-semibold text-ink-muted">
            {found
              ? found.total === 0
                ? t("search_none", { q: query })
                : found.total > found.rows.length
                  ? t("search_capped", { shown: found.rows.length, count: found.total, q: query })
                  : t("search_results", { count: found.total, q: query })
              : t("list_status", { from: (page - 1) * 100 + 1, to: Math.min(page * 100, total), total })}
          </p>
          {found ? (
            <p className="mt-1 text-sm">
              <Link href={kosakataHref()} className="font-semibold text-forest underline underline-offset-2">
                {t("search_clear")}
              </Link>
            </p>
          ) : null}

          {shown.length > 0 ? (
            <ol className="mt-3 divide-y divide-hairline rounded-2xl border border-hairline bg-white">
              {shown.map((r) => (
                <li key={r.rank}>
                  <Link
                    href={kosakataWordHref(r.rank)}
                    className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors hover:bg-paper-deep"
                  >
                    <span className="text-sm text-ink-soft tabular-nums">{nf.format(r.rank)}</span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-ink">{r.translit}</span>
                      <span className="block text-base text-forest">{locale === "en" ? r.en : r.id}</span>
                      <span className="block text-sm text-ink-soft">{t("row_count", { count: r.count })}</span>
                    </span>
                    <span lang="ar" dir="rtl" className="arabic-inline text-ar-md text-ink">
                      {r.ar}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        {found ? null : (
          <nav aria-label={t("pager_label")} className="mt-6 flex items-center justify-between gap-3">
            {page > 1 ? (
              <Link href={`${kosakataHref()}?hal=${page - 1}`} rel="prev" className="chip-link min-h-12! bg-white">
                <ChevronLeft aria-hidden className="size-4" />
                {t("prev")}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-ink-muted tabular-nums">{t("pager_status", { page, pages })}</span>
            {page < pages ? (
              <Link href={`${kosakataHref()}?hal=${page + 1}`} rel="next" className="chip-link min-h-12! bg-white">
                {t("next")}
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}

        <p className="mt-8 max-w-prose text-sm text-ink-soft">
          <MixedText text={t("source_note")} />
        </p>
      </div>
    </div>
  );
}
