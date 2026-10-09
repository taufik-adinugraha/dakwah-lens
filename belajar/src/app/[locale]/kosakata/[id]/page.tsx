import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DraftChip } from "@/components/lesson/DraftChip";
import { SharafPanel } from "@/components/library/SharafPanel";
import { Link } from "@/i18n/navigation";
import { SURAHS } from "@/lib/content";
import { getLexeme, LIBRARY, rootFor } from "@/lib/library";

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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">{t("eyebrow")}</p>
          <h1 className="mt-1 font-display text-3xl font-medium">{lex.translit}</h1>
          <p className="mt-1 text-ink-muted">{lex.meaning}</p>
        </div>
        <p lang="ar" dir="rtl" className="font-arabic text-4xl">
          {lex.lemma_ar}
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl border border-hairline bg-white p-5 text-sm">
        <dt className="text-ink-muted">{t("pos")}</dt>
        <dd>{lex.pos}</dd>
        <dt className="text-ink-muted">{t("root")}</dt>
        <dd>
          {lex.root ? (
            <span lang="ar" dir="rtl" className="font-arabic text-lg">
              {lex.root.join(" ")}
            </span>
          ) : (
            "—"
          )}
          {root ? <span className="ml-2 text-ink-muted">({root.meaning})</span> : null}
        </dd>
        {lex.occurrences && (
          <>
            <dt className="text-ink-muted">{t("occurrences")}</dt>
            <dd>
              {t("occurrences_value", { count: lex.occurrences.count, ayat: lex.occurrences.ayat })}
              <span className="block text-[11px] text-ink-faint">{lex.occurrences.method}</span>
            </dd>
          </>
        )}
      </dl>

      <SharafPanel
        lexeme={lex}
        labels={{
          heading: tw("sharaf_heading"),
          forms_note: tw("sharaf_forms_note"),
          ilal: tw("ilal"),
          ilal_from: tw("ilal_from"),
          ilal_to: tw("ilal_to"),
        }}
      />

      {appearances.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">{t("in_lessons")}</h2>
          <ul className="mt-2 space-y-2">
            {appearances.map(({ s, a, w }) => (
              <li key={w.loc}>
                <Link
                  href={`/${s.slug}/${a.ayah}#w-${w.loc.replaceAll(":", "-")}`}
                  className="flex flex-wrap items-baseline gap-x-3 rounded-xl border border-hairline bg-white px-3 py-2 hover:bg-paper-deep"
                >
                  <span className="text-xs text-ink-faint">
                    {s.name_id} {w.loc}
                  </span>
                  <span lang="ar" dir="rtl" className="quran text-xl leading-[1.8]">
                    {w.ar}
                  </span>
                  <span className="text-sm text-ink-muted">{w.gloss}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-[11px] text-ink-faint">
        {tw("sources")}: {lex.sources.map((x) => (x.ref ? `${x.kitab} ${x.ref}` : x.kitab)).join(" · ")}
      </p>
      {lex.status === "draft" ? <DraftChip label={tw("draft")} /> : null}
    </div>
  );
}
