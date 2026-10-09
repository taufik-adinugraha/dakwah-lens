import type { Metadata } from "next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SortCase } from "@/components/exercises/SortCase";
import { TapWord } from "@/components/exercises/TapWord";
import { WhyHarakat } from "@/components/exercises/WhyHarakat";
import { AyahPlayer } from "@/components/lesson/AyahPlayer";
import { DraftChip } from "@/components/lesson/DraftChip";
import { WordCard } from "@/components/lesson/WordCard";
import { FactCard } from "@/components/surah/FactCard";
import { Link } from "@/i18n/navigation";
import { getAyah, getSurah, SURAHS } from "@/lib/content";

export const dynamicParams = false;

// Generates BOTH dynamic segments: [surah] has no layout, so its page's
// generateStaticParams never reaches this route — relying on a parent
// `params.surah` here produced zero paths (every ayah page 404'd under
// dynamicParams=false; caught by the image smoke test).
export function generateStaticParams() {
  return SURAHS.flatMap((s) =>
    s.ayat.map((a) => ({ surah: s.slug, ayah: String(a.ayah) })),
  );
}

const RECITER_ORDER = ["Alafasy_128kbps", "Husary_Muallim_128kbps"];
const reciterRank = (id: string) => {
  const i = RECITER_ORDER.indexOf(id);
  return i === -1 ? RECITER_ORDER.length : i;
};

const RECITER_LABEL: Record<string, string> = {
  Husary_Muallim_128kbps: "Al-Husary (Mu'allim)",
  Alafasy_128kbps: "Mishary Alafasy",
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/[surah]/[ayah]">): Promise<Metadata> {
  const { surah: slug, ayah } = await params;
  const s = getSurah(slug);
  return { title: s ? `${s.name_id} ${ayah}` : "—" };
}

export default async function AyahPage({
  params,
}: PageProps<"/[locale]/[surah]/[ayah]">) {
  const { locale, surah: slug, ayah: ayahParam } = await params;
  setRequestLocale(locale);
  const s = getSurah(slug);
  const n = Number(ayahParam);
  const a = s && Number.isInteger(n) ? getAyah(s, n) : undefined;
  if (!s || !a) notFound();

  const t = await getTranslations("Lesson");
  const tw = await getTranslations("Word");

  const playerWords = a.words.map((w, i) => ({
    index: i + 1,
    ar: w.ar,
    translit: w.translit,
    gloss: w.gloss,
  }));
  // Default reciter: Mishary Alafasy (operator's choice, 2026-10-09); Husary
  // Mu'allim stays available for its built-in "repeat after me" gaps.
  const sources = [...a.recitation]
    .sort((x, y) => reciterRank(x.reciter) - reciterRank(y.reciter))
    .map((r) => ({
    reciter: r.reciter,
    url: r.url,
    segments: r.segments,
    credit: r.credit,
    label: RECITER_LABEL[r.reciter] ?? r.reciter,
  }));
  const pool = s.ayat.flatMap((x) => x.words);
  const facts = s.facts.filter((f) => f.locations.includes(a.loc));
  const prev = getAyah(s, n - 1);
  const next = getAyah(s, n + 1);
  const key = `${s.slug}/${a.ayah}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <nav className="text-sm text-ink-muted">
        <Link href={`/${s.slug}`} className="hover:text-ink">
          {s.name_id}
        </Link>{" "}
        / {t("ayah", { n: a.ayah })}
      </nav>
      <h1 className="mt-2 font-display text-3xl font-medium">
        {s.name_id} · {t("ayah", { n: a.ayah })}
      </h1>

      <div className="mt-6">
        <AyahPlayer ayah={a.ayah} words={playerWords} sources={sources} />
      </div>

      <figure className="mt-4 rounded-2xl bg-paper-deep p-4">
        <blockquote className="text-pretty leading-relaxed">“{a.translation.text}”</blockquote>
        {a.translation.footnotes.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-ink-muted">
            {a.translation.footnotes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <figcaption className="mt-1 text-[11px] text-ink-faint">
          {a.translation.source_label}
          {a.translation.version ? ` · ${a.translation.version}` : ""}
        </figcaption>
      </figure>

      {a.tafsir && (
        <section className="mt-6 rounded-2xl border border-hairline bg-white p-5">
          <h2 className="font-display text-xl font-medium">{t("tafsir_heading")}</h2>
          <p className="mt-2 text-pretty leading-relaxed">{a.tafsir.text}</p>
          <p className="mt-2 text-[11px] text-ink-faint">
            {tw("sources")}: {a.tafsir.sources.map((x) => (x.ref ? `${x.kitab} ${x.ref}` : x.kitab)).join(" · ")}
          </p>
          {a.tafsir.status === "draft" ? <DraftChip label={tw("draft")} /> : null}
        </section>
      )}

      <section className="mt-10" aria-labelledby="words">
        <h2 id="words" className="font-display text-2xl font-medium">
          {t("words_heading", { n: a.words.length })}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{t("words_intro")}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {a.words.map((w) => (
            <WordCard
              key={w.loc}
              word={w}
              labels={{
                meaning: tw("meaning"),
                root: tw("root"),
                wazn: tw("wazn"),
                why: tw("why"),
                other_views: tw("other_views"),
                sources: tw("sources"),
                no_root: tw("no_root"),
                draft: tw("draft"),
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-12 space-y-4" aria-labelledby="practice">
        <h2 id="practice" className="font-display text-2xl font-medium">
          {t("practice_heading")}
        </h2>
        <TapWord id={`${key}/tap`} words={playerWords} source={sources[0]} />
        <WhyHarakat id={`${key}/why`} words={a.words} pool={pool} />
        <SortCase id={`${key}/sort`} words={a.words} />
      </section>

      {facts.length > 0 && (
        <section className="mt-12" aria-labelledby="facts">
          <h2 id="facts" className="font-display text-2xl font-medium">
            {t("facts_heading")}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {facts.map((f) => (
              <FactCard
                key={f.id}
                fact={f}
                labels={{
                  method: t("fact_method"),
                  where: t("fact_where"),
                  sources: tw("sources"),
                  draft: tw("draft"),
                }}
              />
            ))}
          </div>
        </section>
      )}

      <nav className="mt-12 flex items-center justify-between gap-3 border-t border-hairline pt-6 text-sm">
        {prev ? (
          <Link href={`/${s.slug}/${prev.ayah}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> {t("ayah", { n: prev.ayah })}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/${s.slug}/${next.ayah}`}
            className="inline-flex items-center gap-1 rounded-full bg-forest px-4 py-2 font-semibold text-paper hover:bg-forest-hover"
          >
            {t("ayah", { n: next.ayah })} <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link href={`/${s.slug}`} className="font-semibold text-forest">
            {t("back_to_surah")}
          </Link>
        )}
      </nav>
    </div>
  );
}
