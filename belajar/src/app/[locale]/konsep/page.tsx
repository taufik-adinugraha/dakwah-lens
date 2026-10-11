import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ForestGlow } from "@/components/ForestGlow";
import { MarkCircle } from "@/components/library/MarkCircle";
import { Headword, TermText } from "@/components/library/TermText";
import { Link } from "@/i18n/navigation";
import { getBasic, LIBRARY, TERMS } from "@/lib/library";
import { conceptHref } from "@/lib/routes";
import { annotate, type HeadTerm, prepareSigns, Scope, soundsOf, titleParts, type Token } from "@/lib/terms";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/konsep">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Concept" });
  return { title: t("index_title") };
}

const SOUNDS = soundsOf(getBasic("harakat")?.signs ?? []);

/** A card's title (Latin, with any Qur'anic word in Arabic), its Arabic headword and summary,
 *  in one first-use scope per card (each card is read on its own). `hints: false` for the
 *  Harakat card: its summary IS the reminder, so no "(…, tanda bunyi …)" under its own name. */
function cardText(rec: { title: string; summary: string; marked?: { title: string; summary: string } }, hints = true) {
  const sc = new Scope(hints);
  if (!rec.marked) {
    return { title: [{ kind: "text", text: rec.title }] as Token[], head: [] as HeadTerm[], summary: [{ kind: "text", text: rec.summary }] as Token[] };
  }
  const { tokens, head } = titleParts(rec.marked.title, sc, TERMS, SOUNDS);
  return { title: tokens, head, summary: annotate(rec.marked.summary, sc, TERMS) };
}

/**
 * All nahwu & sharaf concepts — each explained once, reused by every lesson. Design pass
 * (operator 2026-10-10: Arabic with every term, beginners first, less clutter, the module's
 * forest glow): ONE reading column; first "Mulai di sini", the Harakat page on the lesson
 * stage's card; then Nahwu and Sharaf, each concept one whole-card link with its Arabic
 * headword and the arrow every whole-card link in the module carries. Nothing inside a card is
 * a link (a harakah term's link lives on the concept page).
 */
export default async function ConceptIndex({ params }: PageProps<"/[locale]/konsep">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Concept");
  const groups = (["nahwu", "sharaf"] as const).map((kind) => ({
    kind,
    head: TERMS.terms.get(kind)?.ar ?? null,
    items: LIBRARY.concepts.filter((c) => c.kind === kind),
  }));
  const basics = LIBRARY.basics;

  return (
    <div className="relative isolate">
      <ForestGlow />
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.015em] sm:text-4xl">
          {t("index_title")}
        </h1>
        <p className="mt-3 max-w-prose text-pretty text-lg text-ink-muted">{t("index_intro")}</p>

        {basics.length > 0 && (
          <section className="mt-10" aria-labelledby="kind-dasar">
            <h2 id="kind-dasar" className="text-lg font-semibold text-ink">
              {t("start_here")}
            </h2>
            <ul className="mt-3 space-y-4">
              {basics.map((b) => {
                const c = cardText(b, false);
                const marks = prepareSigns(b.signs, TERMS).slice(0, 3);
                return (
                  <li key={b.id}>
                    <Link href={conceptHref(b.id)} className="stage-card block p-5 transition-shadow sm:p-7">
                      <span className="text-sm font-semibold text-forest">{t("dasar")}</span>
                      <span className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <span className="font-display text-2xl font-medium text-ink">
                          <TermText tokens={c.title} links={false} />
                        </span>
                        <Headword head={c.head} className="text-ar-lg" />
                      </span>
                      <span className="mt-2 block max-w-prose text-base text-ink">
                        <TermText tokens={c.summary} links={false} />
                      </span>
                      <span className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <span className="flex gap-2">
                          {marks.map((m, i) => (
                            <MarkCircle key={i} mark={m.mark} size="sm" />
                          ))}
                        </span>
                        <ArrowRight aria-hidden className="h-6 w-6 shrink-0 text-forest" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {groups.map(({ kind, head, items }) =>
          items.length ? (
            <section key={kind} className="mt-12" aria-labelledby={`kind-${kind}`}>
              <h2 id={`kind-${kind}`} className="flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-medium">
                <span>{t(kind)}</span>
                {head ? (
                  <bdi lang="ar" dir="rtl" className="arabic-inline text-ar-md font-normal text-forest">
                    {head}
                  </bdi>
                ) : null}
              </h2>
              <ul className="mt-4 space-y-3">
                {items.map((concept) => {
                  const c = cardText(concept);
                  return (
                    <li key={concept.id}>
                      <Link href={conceptHref(concept.id)} className="glow-card block p-5">
                        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                          <span className="font-display text-lg font-medium text-ink">
                            <TermText tokens={c.title} links={false} />
                          </span>
                          <Headword head={c.head} className="text-ar-sm" />
                        </span>
                        <span className="mt-1 block text-pretty text-base text-ink-muted">
                          <TermText tokens={c.summary} links={false} />
                        </span>
                        {/* The card is a link: the arrow says so, as on the hub and track cards. */}
                        <span className="mt-2 flex justify-end">
                          <ArrowRight aria-hidden className="h-6 w-6 shrink-0 text-forest" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null,
        )}
      </div>
    </div>
  );
}
