import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DraftChip } from "@/components/lesson/DraftChip";
import { MixedText } from "@/components/library/MixedText";
import { SharafPanel } from "@/components/library/SharafPanel";
import { SourcesDisclosure } from "@/components/library/SourceList";
import { Link } from "@/i18n/navigation";
import { SURAHS } from "@/lib/content";
import { getLexeme, LIBRARY, parseLoc, rootFor } from "@/lib/library";
import { ayahHref } from "@/lib/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return LIBRARY.lexicon.map((l) => ({ id: l.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/kosakata/[id]">): Promise<Metadata> {
  const { id } = await params;
  const l = getLexeme(id);
  return { title: l ? `${l.translit} (${l.lemma_ar})` : "—" };
}

/** One lemma, shared by every lesson it appears in (Kosakata library). */
export default async function LexemePage({ params }: PageProps<"/[locale]/kosakata/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const lex = getLexeme(id);
  if (!lex) notFound();
  const t = await getTranslations("Lexeme");
  const tw = await getTranslations("Word");
  const root = rootFor(lex.root);
  const appearances = SURAHS.flatMap((s) =>
    s.ayat.flatMap((a) =>
      a.words.filter((w) => w.lemma_id === lex.id).map((w) => ({ s, a, w })),
    ),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-forest">{t("eyebrow")}</p>
          <h1 className="mt-1 font-display text-3xl font-medium">{lex.translit}</h1>
          <p className="mt-1 max-w-prose text-base text-ink-muted">
            <MixedText text={lex.meaning} />
          </p>
        </div>
        <div className="text-end">
          <p lang="ar" dir="rtl" className="arabic-inline text-ar-xl text-ink">
            {lex.lemma_ar}
          </p>
          {/* The headword is QAC's lemma form (e.g. the mudhari' for some
              verbs), not always the madhi a textbook would list first. */}
          <p className="mt-1 text-sm text-ink-soft">{t("lemma_caption")}</p>
        </div>
      </div>

      <dl className="mt-6 space-y-4 rounded-2xl border border-hairline bg-white p-5">
        <div>
          <dt className="text-sm font-semibold text-ink-muted">{t("pos")}</dt>
          <dd className="text-base text-ink">{lex.pos}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-ink-muted">{t("root")}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 text-base text-ink">
            {lex.root ? (
              <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-sm">
                {lex.root.join(" ")}
              </bdi>
            ) : (
              <span className="text-ink-muted">{tw("no_root")}</span>
            )}
            {root ? (
              <span className="text-ink-muted">
                (<MixedText text={root.meaning} />)
              </span>
            ) : null}
          </dd>
        </div>
        {lex.occurrences && (
          <div>
            <dt className="text-sm font-semibold text-ink-muted">{t("occurrences")}</dt>
            <dd className="text-base text-ink">
              {t("occurrences_value", { count: lex.occurrences.count, ayat: lex.occurrences.ayat })}
              <span className="mt-1 block text-sm text-ink-soft">
                <MixedText text={lex.occurrences.method} />
              </span>
            </dd>
          </div>
        )}
      </dl>

      <SharafPanel
        lexeme={lex}
        defaultOpen
        labels={{
          heading: tw("sharaf_heading"),
          forms_note: tw("sharaf_forms_note"),
          ilal: tw("ilal"),
          ilal_from: tw("ilal_from"),
          ilal_to: tw("ilal_to"),
        }}
      />

      {appearances.length > 0 && (
        <section className="mt-10" aria-labelledby="in-lessons">
          <h2 id="in-lessons" className="font-display text-2xl font-medium">
            {t("in_lessons")}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {appearances.map(({ s, a, w }) => {
              const { word } = parseLoc(w.loc);
              return (
                <li key={w.loc}>
                  <Link
                    href={ayahHref(s.slug, a.ayah, w.loc)}
                    className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-hairline bg-white px-4 py-2 transition-colors hover:border-forest"
                  >
                    <span className="text-sm font-semibold text-forest">
                      {t("loc_label", { surah: s.name_id, ayah: a.ayah, word })}
                    </span>
                    <span lang="ar" dir="rtl" className="quran text-ar-md text-ink">
                      {w.ar}
                    </span>
                    <span className="text-base text-ink-muted">{w.gloss}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SourcesDisclosure sources={lex.sources} label={tw("sources")} className="mt-8" />
      {lex.status === "draft" ? (
        <p>
          <DraftChip label={tw("draft")} />
        </p>
      ) : null}
    </div>
  );
}
