import type { Metadata } from "next";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { MixedText } from "@/components/library/MixedText";
import { AyahChip, AyahDialogProvider } from "@/components/surah/AyahDialog";
import { Link } from "@/i18n/navigation";
import { parseAyahLoc } from "@/lib/ayah";
import { kosakataIndex, kosakataWord } from "@/lib/kosakata";
import { pageOfRank, parseRank } from "@/lib/kosakata-core";
import { kosakataHref, kosakataWordHref, lexemeHref } from "@/lib/routes";

export async function generateMetadata({ params }: PageProps<"/[locale]/kosakata/kata/[rank]">): Promise<Metadata> {
  const { rank: raw } = await params;
  const rank = parseRank(raw, kosakataIndex().rows.length);
  const row = rank ? kosakataIndex().rows[rank - 1] : null;
  return { title: row ? `${row.translit} (${row.ar})` : "—" };
}

/**
 * One word of the Qur'an vocabulary list: its meanings, each with the ayat that show it (the chips
 * open the same ayah popup as the fact cards: Arabic, translation, the imam's recitation), its
 * counts, root and forms. Rendered per request from one small file (lib/kosakata.ts). Lighter than
 * the lesson Kosakata page, which cites a kitab by page: this page says so, and links to that page
 * when the word has one.
 */
export default async function KosakataWordPage({ params }: PageProps<"/[locale]/kosakata/kata/[rank]">) {
  const { locale, rank: raw } = await params;
  setRequestLocale(locale);
  const { rows, names } = kosakataIndex();
  const total = rows.length;
  const rank = parseRank(raw, total);
  const word = rank ? kosakataWord(rank) : null;
  if (!rank || !word) notFound();
  const t = await getTranslations("Kosakata");
  const nf = new Intl.NumberFormat(locale);
  const cited = word.senses.flatMap((s) => s.ayat);
  const surahNames = Object.fromEntries(
    [...new Set(cited.map((loc) => String(parseAyahLoc(loc)?.surah)))].map((s) => [s, names[s]]),
  );

  return (
    <AyahDialogProvider names={surahNames}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link
          href={`${kosakataHref()}?hal=${pageOfRank(rank)}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-forest"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("back")}
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-forest">
              {t("word_eyebrow", { rank: nf.format(rank), total: nf.format(total) })}
            </p>
            <h1 className="mt-1 font-display text-3xl font-medium">{word.translit}</h1>
          </div>
          <div className="text-end">
            {/* Its caption right under it: room for the marks (ar-clear, globals.css). */}
            <p lang="ar" dir="rtl" className="arabic-inline ar-clear text-ar-xl text-ink">
              {word.ar}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{t("lemma_caption")}</p>
          </div>
        </div>

        <section className="mt-6" aria-labelledby="meanings">
          <h2 id="meanings" className="text-lg font-semibold text-ink">
            {t("meanings")}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{t("meanings_hint")}</p>
          <ul className="mt-3 space-y-3">
            {word.senses.map((s) => (
              <li key={`${s.id}-${s.en}`} className="rounded-2xl border border-hairline bg-white p-4">
                {/* A meaning is always forest (plan L22); the other language under it. */}
                <p className="text-lg font-semibold text-forest">{locale === "en" ? s.en : s.id}</p>
                <p className="text-sm text-ink-muted">{locale === "en" ? s.id : s.en}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.ayat.map((loc) => (
                    <AyahChip key={loc} loc={loc} label={t("chip", { loc })} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <dl className="mt-6 space-y-4 rounded-2xl border border-hairline bg-white p-5">
          <div>
            <dt className="text-sm font-semibold text-ink-muted">{t("occurrences")}</dt>
            <dd className="text-base text-ink">
              {t("occurrences_value", { count: word.count, ayat: word.ayat, surahs: word.surahs })}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-ink-muted">{t("root")}</dt>
            <dd className="text-base text-ink">
              {word.root.length > 0 ? (
                <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
                  {word.root.join(" ")}
                </bdi>
              ) : (
                <span className="text-ink-muted">{t("no_root")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-ink-muted">{t("forms")}</dt>
            <dd>
              <ul className="flex flex-wrap gap-x-5" dir="rtl">
                {word.forms.map((f) => (
                  <li key={f} lang="ar" className="arabic-inline text-ar-sm text-ink">
                    {f}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>

        {word.lexeme ? (
          <p className="mt-4">
            <Link href={lexemeHref(word.lexeme)} className="font-semibold text-forest underline underline-offset-2">
              {t("full_entry")}
            </Link>
          </p>
        ) : null}

        <nav aria-label={t("word_pager_label")} className="mt-6 flex items-center justify-between gap-3">
          {rank > 1 ? (
            <Link href={kosakataWordHref(rank - 1)} rel="prev" className="chip-link min-h-12! bg-white">
              <ChevronLeft aria-hidden className="size-4" />
              {t("prev_word")}
            </Link>
          ) : (
            <span />
          )}
          {rank < total ? (
            <Link href={kosakataWordHref(rank + 1)} rel="next" className="chip-link min-h-12! bg-white">
              {t("next_word")}
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <span />
          )}
        </nav>

        <p className="mt-8 max-w-prose text-sm text-ink-soft">
          <MixedText text={t("source_note")} />
        </p>
      </div>
    </AyahDialogProvider>
  );
}
